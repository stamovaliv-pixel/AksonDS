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

  // Устанавливаем текущую дату без времени для точного сравнения
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Форматируем сегодняшний день для БД
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

  const bookedDates = new Set();
  if (bookings) {
    bookings.forEach(b => bookedDates.add(b.slot_date));
  }

  // 3. Отрисовываем 3 ближайшие записи
  if (upcomingList) {
    upcomingList.innerHTML = '';
    
    if (!bookings || bookings.length === 0) {
      upcomingList.innerHTML = '<div style="color: var(--color-text-muted); font-size: 14px;">У вас пока нет активных записей.</div>';
    } else {
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

  // 4. Логика генерации 5 недель (35 дней)
  if (calendarGrid) {
    calendarGrid.innerHTML = ''; 

    // Находим понедельник текущей недели
    const currentDayIndex = today.getDay(); // 0 - Вс, 1 - Пн ... 6 - Сб
    const diffToMonday = currentDayIndex === 0 ? 6 : currentDayIndex - 1;
    
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - diffToMonday);

    // Определяем крайний день доступности (+29 дней от сегодня)
    const endActiveDate = new Date(today);
    endActiveDate.setDate(today.getDate() + 29);

    // Генерируем ровно 35 дней (5 недель по 7 дней)
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
      
      // Проверяем, является ли день активным
      const isActive = d >= today && d <= endActiveDate;

      if (!isActive) {
        // Прошедшие даты и даты за пределом 30 дней
        dayCell.className = 'day-cell inactive';
      } else if (bookedDates.has(isoDate)) {
        // Если день активен и в нем есть запись пользователя
        dayCell.className = 'day-cell booked';
      } else {
        // Обычный активный свободный день (серая полоса)
        dayCell.className = 'day-cell'; 
      }

      // Выходные делаем со слегка серым фоном (если они активны)
      if ((d.getDay() === 0 || d.getDay() === 6) && isActive) {
        dayCell.style.backgroundColor = '#f8fafc';
      }

      dayCell.innerHTML = `<div class="date-text">${dateStr}</div>`;

      // Разрешаем клик только для активных дней
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
