document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    window.location.href = '../index.html';
    return;
  }

  // ЗАГРУЗКА ГЛОБАЛЬНЫХ НАСТРОЕК
  const { data: settings } = await sb.from('app_settings').select('*').eq('id', 1).single();
  if (!settings) return console.error('Не удалось загрузить настройки');

  const calendarGrid = document.getElementById('calendarGrid');
  const upcomingList = document.getElementById('upcomingBookingsList');
  
  const modal = document.getElementById('bookingDetailsModal');
  const closeBtn = document.getElementById('closeDetailsModalBtn');
  const trashBtn = document.getElementById('deleteBookingBtn');

  if (closeBtn) {
    closeBtn.onclick = () => modal.style.display = 'none';
  }
  window.onclick = (e) => {
    if (e.target === modal) modal.style.display = 'none';
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const isoToday = `${year}-${month}-${day}`;

  const { data: allBookings, error } = await sb
    .from('bookings')
    .select('id, slot_date, slot_hour, supply_type, order_type, order_number, profile_id')
    .eq('status', 'active')
    .gte('slot_date', isoToday)
    .order('slot_date', { ascending: true })
    .order('slot_hour', { ascending: true });

  if (error) console.error('Ошибка загрузки записей:', error);

  // Выделяем записи ТОЛЬКО текущего пользователя
  const userBookings = allBookings ? allBookings.filter(b => b.profile_id === user.id) : [];
  const bookedDates = new Set();
  userBookings.forEach(b => bookedDates.add(b.slot_date));

  // Считаем общую загруженность каждого дня
  const dateCapacities = {};
  if (allBookings) {
    allBookings.forEach(b => {
      dateCapacities[b.slot_date] = (dateCapacities[b.slot_date] || 0) + 1;
    });
  }

  // Динамические словари из настроек
  const supplyTypes = {};
  settings.supply_types.forEach(st => supplyTypes[st.id] = st.name);
  const orderTypes = { 'order': 'Заказ', 'upd': 'УПД', 'etrn': 'ЭТрН' };

  if (upcomingList) {
    upcomingList.innerHTML = '';
    
    if (userBookings.length === 0) {
      upcomingList.innerHTML = '<div style="grid-column: 1 / -1; color: var(--color-text-muted); font-size: 14px;">У вас пока нет активных слотов.</div>';
    } else {
      const nextSeven = userBookings.slice(0, 7);
      
      nextSeven.forEach(booking => {
        const bDate = new Date(booking.slot_date);
        const dateStr = bDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = `${booking.slot_hour}:00 - ${booking.slot_hour + 1}:00`;
        
        const supplyName = supplyTypes[booking.supply_type] || booking.supply_type;
        const orderName = orderTypes[booking.order_type] || booking.order_type;
        const orderNum = booking.order_number;
        
        const item = document.createElement('div');
        item.className = 'booking-item';
        item.title = "Нажмите для просмотра деталей";
        
        item.innerHTML = `
          <div class="booking-date">${dateStr}</div>
          <div class="booking-time">${timeStr}</div>
        `;
        
        item.addEventListener('click', () => {
          document.getElementById('modalDate').innerText = dateStr;
          document.getElementById('modalTime').innerText = timeStr;
          document.getElementById('modalType').innerText = supplyName;
          document.getElementById('modalDoc').innerText = `${orderName} №${orderNum}`;
          
          trashBtn.onclick = async () => {
            const confirmCancel = confirm(`Вы уверены, что хотите отменить запись на ${dateStr} (${timeStr})?`);
            if (confirmCancel) {
              const { error: delError } = await sb.from('bookings').delete().eq('id', booking.id);
              if (delError) {
                alert('Ошибка при отмене: ' + delError.message);
              } else {
                window.location.reload();
              }
            }
          };
          
          modal.style.display = 'flex';
        });

        upcomingList.appendChild(item);
      });
    }
  }

  if (calendarGrid) {
    calendarGrid.innerHTML = ''; 

    const currentDayIndex = today.getDay(); 
    const diffToMonday = currentDayIndex === 0 ? 6 : currentDayIndex - 1;
    
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - diffToMonday);

    const endActiveDate = new Date(today);
    endActiveDate.setDate(today.getDate() + 29);

    const currentRealHour = new Date().getHours();
    
    // Считаем макс. кол-во слотов в день на основе настроек
    const maxCapacityPerDay = (settings.slot_end_hour - settings.slot_start_hour + 1) * settings.slots_per_hour;

    for (let i = 0; i < 35; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      d.setHours(0, 0, 0, 0);

      const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      
      const iterYear = d.getFullYear();
      const iterMonth = String(d.getMonth() + 1).padStart(2, '0');
      const iterDay = String(d.getDate()).padStart(2, '0');
      const isoDate = `${iterYear}-${iterMonth}-${iterDay}`;

      const dayCell = document.createElement('div');
      
      let isActive = d >= today && d <= endActiveDate;
      
      // Проверяем доступность дня недели из настроек (Пн=1 ... Вс=7)
      const jsDay = d.getDay();
      const dbDay = jsDay === 0 ? 7 : jsDay;
      if (!settings.available_days.includes(dbDay)) {
        isActive = false;
      }
      
      let isFull = (dateCapacities[isoDate] || 0) >= maxCapacityPerDay;
      
      // Если сегодня уже перевалило за час окончания слотов, день считается закрытым
      if (isoDate === isoToday && currentRealHour >= settings.slot_end_hour) {
        isFull = true;
      }

      let isClickable = false;

      // Логика состояний дня
      if (!isActive) {
        dayCell.className = 'day-cell inactive';
      } else if (bookedDates.has(isoDate)) {
        // Даже если день переполнен, если у нас там запись — день красный и кликабельный
        dayCell.className = 'day-cell booked';
        isClickable = true;
      } else if (isFull) {
        // День активен, но мест больше нет
        dayCell.className = 'day-cell inactive';
      } else {
        // Свободный активный день
        dayCell.className = 'day-cell';
        isClickable = true;
      }

      // Подсветка выходных
      if ((jsDay === 0 || jsDay === 6) && isActive && !isFull) {
        dayCell.style.backgroundColor = '#f8fafc';
      }

      dayCell.innerHTML = `<div class="date-text">${dateStr}</div>`;

      // Переход разрешен только в кликабельные дни
      if (isClickable) {
        dayCell.addEventListener('click', () => {
          window.location.href = `day.html?date=${isoDate}`;
        });
      }

      calendarGrid.appendChild(dayCell);
    }
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await sb.auth.signOut();
      window.location.href = '../index.html';
    });
  }
});
