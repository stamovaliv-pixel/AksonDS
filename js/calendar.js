document.addEventListener('DOMContentLoaded', () => {
  const calendarGrid = document.getElementById('calendarGrid');
  if (!calendarGrid) return;

  const today = new Date();
  const daysOfWeek = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

  // Генерируем 30 дней
  for (let i = 0; i < 30; i++) {
    // Вычисляем следующую дату
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const dayOfWeekStr = daysOfWeek[d.getDay()];
    
    // Форматируем дату для ссылки (YYYY-MM-DD)
    const isoDate = d.toISOString().split('T')[0];

    // Создаем карточку дня
    const dayCell = document.createElement('div');
    dayCell.className = 'day-cell free'; // Пока все слоты помечаем зеленым как "свободные"

    // Если это выходной, делаем фон слегка серым
    if (d.getDay() === 0 || d.getDay() === 6) {
      dayCell.style.backgroundColor = '#f8fafc';
    }

    dayCell.innerHTML = `
      <div class="date-text">${dateStr}</div>
      <div class="day-text">${dayOfWeekStr}</div>
    `;

    // При клике переходим на страницу конкретного дня
    dayCell.addEventListener('click', () => {
      window.location.href = `day.html?date=${isoDate}`;
    });

    calendarGrid.appendChild(dayCell);
  }
  
  // Логика кнопки "Выйти"
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (window.supabaseClient) {
        await window.supabaseClient.auth.signOut();
      }
      window.location.href = '../index.html';
    });
  }
});