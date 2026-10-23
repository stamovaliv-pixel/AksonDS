document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    window.location.href = '../index.html';
    return;
  }

  // ОПТИМИЗАЦИЯ: Кэширование глобальных настроек
  async function getSettings() {
    const cached = sessionStorage.getItem('app_settings');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // Force one refresh when cache was created by a version older than v4.1.
        if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'booking_excluded_dates')) return parsed;
      } catch (_) { /* discard malformed/legacy cache */ }
      sessionStorage.removeItem('app_settings');
    }
    const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
    if (error) console.error('Не удалось загрузить системные настройки:', error);
    if (data) sessionStorage.setItem('app_settings', JSON.stringify(data));
    return data || {};
  }
  const settings = await getSettings();
  if (!settings || Object.keys(settings).length === 0) return console.error('Не удалось загрузить настройки');

  // Принудительно показываем цветные полоски даже для неактивных дней
  const styleBlock = document.createElement('style');
  styleBlock.innerHTML = `
    .day-cell.inactive::before { display: block !important; }
    .day-cell.inactive { background-color: #f1f5f9 !important; opacity: 0.5 !important; cursor: not-allowed !important; pointer-events: none !important; }
    .day-cell.inactive.booked { pointer-events: auto !important; cursor: pointer !important; }
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

  const countTo = new Date(today);
  countTo.setDate(countTo.getDate() + 35);
  const countToIso = `${countTo.getFullYear()}-${String(countTo.getMonth() + 1).padStart(2, '0')}-${String(countTo.getDate()).padStart(2, '0')}`;
  const [{ data: userBookings, error: bookingsError }, { data: bookingCounts, error: countsError }] = await Promise.all([
    sb.from('bookings')
      .select('id, slot_date, slot_hour, supply_type, order_type, order_number, profile_id')
      .eq('profile_id', user.id).eq('status', 'active').gte('slot_date', isoToday)
      .order('slot_date', { ascending: true }).order('slot_hour', { ascending: true }),
    sb.rpc('get_calendar_booking_counts', { p_from: isoToday, p_to: countToIso })
  ]);
  if (bookingsError || countsError) {
    console.error('Ошибка загрузки календаря:', bookingsError || countsError);
    alert('Не удалось загрузить доступность календаря. Обновите страницу.');
    return;
  }
  const bookedDates = new Set();
  userBookings.forEach(b => bookedDates.add(b.slot_date));

  const dateCapacities = {};
  (bookingCounts || []).forEach(row => { dateCapacities[row.slot_date] = Number(row.booking_count || 0); });

  const supplyTypes = {};
  if (settings.supply_types) {
    settings.supply_types.forEach(st => supplyTypes[st.id] = st.name);
  }
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
    const startHour = settings.slot_start_hour ?? 9;
    const endHour = settings.slot_end_hour ?? 17;
    const slotsPerHour = settings.slots_per_hour ?? 5;
    const maxCapacityPerDay = (endHour - startHour + 1) * slotsPerHour;

    for (let i = 0; i < 35; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      d.setHours(0, 0, 0, 0);

      const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayCell = document.createElement('div');
      
      let isActive = d >= today && d <= endActiveDate;
      const excludedDates = Array.isArray(settings.booking_excluded_dates) ? settings.booking_excluded_dates : [];
      const isExcludedDate = excludedDates.includes(isoDate);
      if (isExcludedDate) isActive = false;
      
      const jsDay = d.getDay();
      const dbDay = jsDay === 0 ? 7 : jsDay;
      if (settings.available_days && !settings.available_days.includes(dbDay)) {
        isActive = false; 
      }
      
      let isFull = (dateCapacities[isoDate] || 0) >= maxCapacityPerDay;
      if (isoDate === isoToday && currentRealHour >= endHour) isFull = true;

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

      if ((jsDay === 0 || jsDay === 6) && isActive && !isFull) {
        dayCell.style.backgroundColor = '#f8fafc';
      }

      dayCell.innerHTML = `<div class="date-text">${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</div>`;
      if (isExcludedDate) {
        dayCell.title = 'Запись на эту дату закрыта администратором';
        dayCell.setAttribute('aria-label', `${d.toLocaleDateString('ru-RU')}: запись закрыта администратором`);
        dayCell.classList.add('date-excluded');
      }

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
