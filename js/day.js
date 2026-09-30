document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;

  // Проверка авторизации
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    window.location.href = '../index.html';
    return;
  }

  // Получаем дату из URL (например, ?date=2026-10-01)
  const urlParams = new URLSearchParams(window.location.search);
  const selectedDate = urlParams.get('date');
  
  if (!selectedDate) {
    window.location.href = 'calendar.html';
    return;
  }

  // Выводим красиво дату на экран
  const dateObj = new Date(selectedDate);
  document.getElementById('currentDateDisplay').innerText = dateObj.toLocaleDateString('ru-RU');

  // Запрашиваем из БД бронирования на эту дату
  const { data: bookings, error } = await sb
    .from('bookings')
    .select('slot_hour, profile_id')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  const slotsContainer = document.getElementById('slotsContainer');
  slotsContainer.innerHTML = ''; // очищаем "Загрузку..."

  // Генерируем слоты с 9:00 до 17:00
  for (let hour = 9; hour <= 17; hour++) {
    // Считаем, сколько записей уже есть на этот час
    const bookingsForHour = bookings ? bookings.filter(b => b.slot_hour === hour) : [];
    const count = bookingsForHour.length;
    const isFull = count >= 5;
    
    // Проверяем, есть ли уже в этом слоте запись текущего пользователя
    const myBooking = bookingsForHour.find(b => b.profile_id === user.id);

    const row = document.createElement('div');
    row.className = `slot-row ${isFull ? 'full-row' : ''}`;

    let statusHtml = '';
    let btnHtml = '';

    if (myBooking) {
      statusHtml = `<span class="slot-status" style="color: var(--color-blue);">Вы записаны!</span>`;
      btnHtml = `<button class="btn-primary" style="background: var(--color-text-muted); opacity: 0.5;" disabled>Записан</button>`;
    } else if (isFull) {
      statusHtml = `<span class="slot-status full">Мест нет (5/5)</span>`;
      btnHtml = `<button class="btn-primary" style="background: var(--color-text-muted);" disabled>Занято</button>`;
    } else {
      statusHtml = `<span class="slot-status">Свободно (${5 - count} мест)</span>`;
      btnHtml = `<button class="btn-primary" onclick="openModal(${hour})">Записаться</button>`;
    }

    row.innerHTML = `
      <div style="display:flex; flex-direction:column;">
        <span class="slot-time">${hour}:00 - ${hour + 1}:00</span>
        ${statusHtml}
      </div>
      <div>${btnHtml}</div>
    `;
    slotsContainer.appendChild(row);
  }

  // --- Логика Модального окна ---
  const modal = document.getElementById('bookingModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const bookingForm = document.getElementById('bookingForm');
  const hourInput = document.getElementById('selectedHour');

  window.openModal = (hour) => {
    hourInput.value = hour;
    modal.style.display = 'flex';
  };

  closeModalBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  // Отправка формы бронирования
  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitBookingBtn');
    btn.innerText = 'Запись...';
    btn.disabled = true;

    const payload = {
      profile_id: user.id,
      slot_date: selectedDate,
      slot_hour: parseInt(hourInput.value),
      supply_type: document.getElementById('supplyType').value,
      order_type: document.getElementById('orderType').value,
      order_number: document.getElementById('orderNumber').value,
      status: 'active'
    };

    const { error: insertError } = await sb.from('bookings').insert([payload]);

    if (insertError) {
      alert('Ошибка записи: ' + insertError.message);
      btn.innerText = 'Подтвердить запись';
      btn.disabled = false;
    } else {
      alert('Запись успешно создана!');
      window.location.reload(); // Перезагружаем страницу для обновления слотов
    }
  });
});