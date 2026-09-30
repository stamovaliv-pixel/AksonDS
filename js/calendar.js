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

  // Получаем сегодняшнюю дату для фильтрации
  const today = new Date();
  
  // Правильное форматирование даты (YYYY-MM-DD) для запроса в БД
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const isoToday = `${year}-${month}-${day}`;

  // 2. Запрашиваем записи пользователя из базы данных
  const { data: bookings, error } = await sb
    .from('bookings')
    .select('slot_date, slot_hour')
    .eq('profile_id', user.id)
    .eq('status', 'active')
    .gte('slot_date', isoToday)
    .order('slot_date', { ascending: true })
    .order('slot_hour', { ascending: true });

  if (error) console.error('Ошибка загрузки записей:', error);

  // Сохраняем даты, в которые есть записи, чтобы покрасить их в зеленый
  const bookedDates = new Set();
  if (bookings) {
    bookings.forEach(b => bookedDates.add(b.slot_date));
  }

  // 3. Отрисовываем 3 ближайшие записи в левой колонке
  if (upcomingList) {
    upcomingList.innerHTML = '';
    
    if (!bookings || bookings.length === 0) {
      upcomingList.innerHTML = '<div style="color: var(--color-text-muted); font-size: 14px;">У вас пока нет активных записей.</div>';
    } else {
      // Берем максимум 3 первые записи
      const nextThree = bookings.slice(0, 3);
      
      nextThree.forEach(booking => {
        const bDate = new Date(booking.slot_date);
        const dateStr = bDate.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = `${booking.slot_hour}:00 - ${booking.slot_hour + 1}:00`;
        
        const item = document.createElement('div');
        item.className = 'booking-item';
        item.innerHTML = `
          <div class="booking-date">${dateStr}</div>
          <div class="booking-time">Время: ${timeStr}</div>
        `;
        upcomingList.appendChild(item);
      });
    }
  }

  // 4. Генерируем 30 дней для календаря
  if (calendarGrid) {
    const daysOfWeek = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    calendarGrid.innerHTML = ''; 

    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);

      const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
      const dayOfWeekStr = daysOfWeek[d.getDay()];
      
      const iterYear = d.getFullYear();
      const iterMonth = String(d.getMonth() + 1).padStart(2, '0');
      const iterDay = String(d.getDate()).padStart(2, '0');
      const isoDate = `${iterYear}-${iterMonth}-${iterDay}`;

      const dayCell = document.createElement('div');
      
      // Красим полоску: если день есть в Set, добавляем класс booked (зеленая)
      if (bookedDates.has(isoDate)) {
        dayCell.className = 'day-cell booked';
      } else {
        dayCell.className = 'day-cell'; // По умолчанию серая
      }

      // Выделяем выходные легким фоном
      if (d.getDay() === 0 || d.getDay() === 6) {
        dayCell.style.backgroundColor = '#f8fafc';
      }

      dayCell.innerHTML = `
        <div class="date-text">${dateStr}</div>
        <div class="day-text">${dayOfWeekStr}</div>
      `;

      dayCell.addEventListener('click', () => {
        window.location.href = `day.html?date=${isoDate}`;
      });

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
