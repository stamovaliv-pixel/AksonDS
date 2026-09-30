document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;

  // 1. Проверяем авторизацию
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    window.location.href = '../index.html';
    return;
  }

  const calendarGrid = document.getElementById('calendarGrid');
  const upcomingList = document.getElementById('upcomingBookingsList');

  // Устанавливаем текущую дату без времени
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const isoToday = `${year}-${month}-${day}`;

  // 2. Запрашиваем записи пользователя (Добавлены поля supply_type, order_type, order_number)
  const { data: bookings, error } = await sb
    .from('bookings')
    .select('slot_date, slot_hour, supply_type, order_type, order_number')
    .eq('profile_id', user.id)
    .eq('status', 'active')
    .gte('slot_date', isoToday)
    .order('slot_date', { ascending: true })
    .order('slot_hour', { ascending: true });

  if (error) console.error('Ошибка загрузки записей:', error);

  const bookedDates = new Set();
  if (bookings) {
    bookings.forEach(b => bookedDates.add(b.slot_date));
  }

  // Словари для перевода технических названий БД в красивый русский текст
  const supplyTypes = {
    'orders_im': 'Заказы ИМ',
    'mix': 'МИКС',
    'return': 'Возврат'
  };
  
  const orderTypes = {
    'order': 'Заказ',
    'upd': 'УПД',
    'etrn': 'ЭТрН'
  };

  // 3. Отрисовываем 5 ближайших записей
  if (upcomingList) {
    upcomingList.innerHTML = '';
    
    if (!bookings || bookings.length === 0) {
      upcomingList.innerHTML = '<div style="color: var(--color-text-muted); font-size: 14px;">У вас пока нет активных слотов.</div>';
    } else {
      const nextFive = bookings.slice(0, 5);
      
      nextFive.forEach(booking => {
        const bDate = new Date(booking.slot_date);
        const dateStr = bDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = `${booking.slot_hour}:00 - ${booking.slot_hour + 1}:00`;
        
        // Получаем красивые названия или оставляем как есть, если не найдено
        const supplyName = supplyTypes[booking.supply_type] || booking.supply_type;
        const orderName = orderTypes[booking.order_type] || booking.order_type;
        const orderNum = booking.order_number;
        
        const item = document.createElement('div');
        item.className = 'booking-item';
        // Добавлены новые строки с типом поставки и номером документа
        item.innerHTML = `
          <div class="booking-date">${dateStr}</div>
          <div class="booking-time">Время: ${timeStr}</div>
          <div class="booking-time" style="margin-top: 6px; color: var(--color-text-main); font-weight: 500;">Тип: ${supplyName}</div>
          <div class="booking-time">Док: ${orderName} №${orderNum}</div>
        `;
        upcomingList.appendChild(item);
      });
    }
  }

  // 4. Логика генерации 5 недель (35 дней)
  if (calendarGrid) {
    calendarGrid.innerHTML = ''; 

    const currentDayIndex = today.getDay(); 
    const diffToMonday = currentDayIndex === 0 ? 6 : currentDayIndex - 1;
    
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - diffToMonday);

    const endActiveDate = new Date(today);
    endActiveDate.setDate(today.getDate() + 29);

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
      
      const isActive = d >= today && d <= endActiveDate;

      if (!isActive) {
        dayCell.className = 'day-cell inactive';
      } else if (bookedDates.has(isoDate)) {
        dayCell.className = 'day-cell booked'; // Применится красная полоса из CSS
      } else {
        dayCell.className = 'day-cell'; // Применится зеленая полоса из CSS
      }

      if ((d.getDay() === 0 || d.getDay() === 6) && isActive) {
        dayCell.style.backgroundColor = '#f8fafc';
      }

      dayCell.innerHTML = `<div class="date-text">${dateStr}</div>`;

      if (isActive) {
        dayCell.addEventListener('click', () => {
          window.location.href = `day.html?date=${isoDate}`;
        });
      }

      calendarGrid.appendChild(dayCell);
    }
  }

  // 5. Логика кнопки "Выйти"
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      await sb.auth.signOut();
      window.location.href = '../index.html';
    });
  }
});
