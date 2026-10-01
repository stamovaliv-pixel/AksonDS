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

  // Внедряем строгие стили для неактивных дней (убираем синюю полоску и запрещаем клик)
  const styleBlock = document.createElement('style');
  styleBlock.innerHTML = `
    .day-cell.inactive::before { display: none !important; }
    .day-cell.inactive { background-color: #f1f5f9 !important; opacity: 0.6 !important; cursor: not-allowed !important; pointer-events: none; }
    .day-cell.inactive.booked { pointer-events: auto !important; cursor: pointer !important; }
    .day-cell.inactive.booked::before { display: block !important; background-color: #ef4444 !important; }
  `;
  document.head.appendChild(styleBlock);

  const calendarGrid = document.getElementById('calendarGrid');
  const upcomingList = document.getElementById('upcomingBookingsList');
  
  const modal = document.getElementById('bookingDetailsModal');
  const closeBtn = document.getElementById('closeDetailsModalBtn');
  const trashBtn = document.getElementById('deleteBookingBtn');

  if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
  window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const { data: allBookings, error } = await sb
    .from('bookings')
    .select('id, slot_date, slot_hour, supply_type, order_type, order_number, profile_id')
    .eq('status', 'active')
    .gte('slot_date', isoToday)
    .order('slot_date', { ascending: true })
    .order('slot_hour', { ascending: true });

  if (error) console.error('Ошибка загрузки записей:', error);

  const userBookings = allBookings ? allBookings.filter(b => b.profile_id === user.id) : [];
  const bookedDates = new Set();
  userBookings.forEach(b => bookedDates.add(b.slot_date));

  const dateCapacities = {};
  if (allBookings) {
    allBookings.forEach(b => { dateCapacities[b.slot_date] = (dateCapacities[b.slot_date] || 0) + 1; });
  }

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
        item.innerHTML = `<div class="booking-date">${dateStr}</div><div class="booking-time">${timeStr}</div>`;
        
        item.addEventListener('click', () => {
          document.getElementById('modalDate').innerText = dateStr;
          document.getElementById('modalTime').innerText = timeStr;
          document.getElementById('modalType').innerText = supplyName;
          document.getElementById('modalDoc').innerText = `${orderName} №${orderNum}`;
          
          trashBtn.onclick = async () => {
            if (confirm(`Вы уверены, что хотите отменить запись на ${dateStr} (${timeStr})?`)) {
              const { error: delError } = await sb.from('bookings').delete().eq('id', booking.id);
              if (delError) alert('Ошибка при отмене: ' + delError.message);
              else window.location.reload();
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
    const diffToMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - diffToMonday);

    const endActiveDate = new Date(today);
    endActiveDate.setDate(today.getDate() + 29);
    const currentRealHour = new Date().getHours();
    const maxCapacityPerDay = (settings.slot_end_hour - settings.slot_start_hour + 1) * settings.slots_per_hour;

    for (let i = 0; i < 35; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      d.setHours(0, 0, 0, 0);

      const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayCell = document.createElement('div');
      
      let isActive = d >= today && d <= endActiveDate;
      
      // СТРОГАЯ ПРОВЕРКА ДНЕЙ НЕДЕЛИ ИЗ НАСТРОЕК
      const jsDay = d.getDay();
      const dbDay = jsDay === 0 ? 7 : jsDay;
      if (settings.available_days && !settings.available_days.includes(dbDay)) {
        isActive = false; // День отключен администратором
      }
      
      let isFull = (dateCapacities[isoDate] || 0) >= maxCapacityPerDay;
      if (isoDate === isoToday && currentRealHour >= settings.slot_end_hour) isFull = true;

      let isClickable = false;

      if (!isActive) {
        dayCell.className = 'day-cell inactive';
      } else if (bookedDates.has(isoDate)) {
        dayCell.className = 'day-cell booked';
        isClickable = true;
      } else if (isFull) {
        dayCell.className = 'day-cell inactive';
      } else {
        dayCell.className = 'day-cell';
        isClickable = true;
      }

      // Подсветка выходных, если они разрешены
      if ((jsDay === 0 || jsDay === 6) && isActive && !isFull) {
        dayCell.style.backgroundColor = '#f8fafc';
      }

      dayCell.innerHTML = `<div class="date-text">${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</div>`;

      // Навешиваем клик только если день активен или есть наша запись
      if (isClickable || bookedDates.has(isoDate)) {
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
      e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html';
    });
  }
});
