document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    window.location.href = '../index.html';
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  const selectedDate = urlParams.get('date');
  
  if (!selectedDate) {
    window.location.href = 'calendar.html';
    return;
  }

  const dateObj = new Date(selectedDate);
  document.getElementById('currentDateDisplay').innerText = dateObj.toLocaleDateString('ru-RU');

  const { data: bookings, error } = await sb
    .from('bookings')
    .select('id, slot_hour, profile_id')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  const slotsContainer = document.getElementById('slotsContainer');
  
  // Логика времени
  const now = new Date();
  const currentHour = now.getHours();
  // Сбрасываем время до полуночи для сравнения дат
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  const selectedMidnight = new Date(selectedDate);
  selectedMidnight.setHours(0, 0, 0, 0);

  const isToday = selectedMidnight.getTime() === todayMidnight.getTime();
  const isPastDay = selectedMidnight < todayMidnight;

  let morningHtml = `<div class="time-group"><div class="time-group-title">🌅 Утро</div><div class="slot-grid">`;
  let afternoonHtml = `</div></div><div class="time-group"><div class="time-group-title">☀️ День</div><div class="slot-grid">`;
  let eveningHtml = `</div></div><div class="time-group"><div class="time-group-title">🌆 Вечер</div><div class="slot-grid">`;

  for (let hour = 9; hour <= 17; hour++) {
    const bookingsForHour = bookings ? bookings.filter(b => b.slot_hour === hour) : [];
    const count = bookingsForHour.length;
    const placesLeft = 5 - count;
    const myBooking = bookingsForHour.find(b => b.profile_id === user.id);

    // Блокировка прошлых дней и слотов, до которых осталось меньше часа (или они уже идут)
    let isPast = isPastDay;
    if (isToday && currentHour >= hour - 1) {
      isPast = true;
    }

    let statusHtml = '';
    let btnHtml = '';
    let cardClass = 'slot-card';

    if (isPast) {
      // Если время ушло
      cardClass += ' inactive';
      statusHtml = `<span style="color: #64748b;">Время вышло</span>`;
      btnHtml = `<button class="btn-disabled" disabled>Недоступно</button>`;
    } 
    else if (myBooking) {
      // Если пользователь уже записан на этот слот
      statusHtml = `<span style="color: #1f2937;">Вы записаны</span>`;
      btnHtml = `<button class="btn-cancel" onclick="cancelBooking(${myBooking.id}, '${selectedDate}', ${hour})">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                   Записан (отменить)
                 </button>`;
    } 
    else if (placesLeft === 0) {
      // Если мест нет
      cardClass += ' inactive';
      statusHtml = `<span style="color: #64748b;">Мест нет (5/5)</span>`;
      btnHtml = `<button class="btn-disabled" disabled>Занято</button>`;
    } 
    else {
      // Если места есть - красим текст
      let statusColor = '';
      if (placesLeft >= 4) statusColor = '#10b981'; // Зеленый
      else if (placesLeft >= 2) statusColor = '#f59e0b'; // Оранжевый
      else statusColor = '#ef4444'; // Красный

      statusHtml = `<span style="color: ${statusColor};">Свободно (${placesLeft} мест)</span>`;
      btnHtml = `<button class="btn-book" onclick="openModal(${hour})">Записаться</button>`;
    }

    const slotHtml = `
      <div class="${cardClass}">
        <div>
          <div class="slot-time">${hour}:00 - ${hour + 1}:00</div>
          <div class="slot-status">${statusHtml}</div>
        </div>
        ${btnHtml}
      </div>
    `;

    // Распределяем слоты по группам
    if (hour >= 9 && hour <= 11) morningHtml += slotHtml;
    else if (hour >= 12 && hour <= 16) afternoonHtml += slotHtml;
    else if (hour === 17) eveningHtml += slotHtml;
  }

  // Собираем весь HTML
  slotsContainer.innerHTML = morningHtml + afternoonHtml + eveningHtml + `</div></div>`;

  // --- Логика отмены записи (глобальная функция) ---
  window.cancelBooking = async (id, dateStr, hour) => {
    const confirmCancel = confirm(`Отменить вашу запись на ${dateStr} (время: ${hour}:00)?`);
    if (confirmCancel) {
      const { error: delError } = await sb.from('bookings').delete().eq('id', id);
      if (delError) {
        alert('Ошибка при отмене: ' + delError.message);
      } else {
        window.location.reload();
      }
    }
  };

  // --- Логика Модального окна записи ---
  const modal = document.getElementById('bookingModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const bookingForm = document.getElementById('bookingForm');
  const hourInput = document.getElementById('selectedHour');

  window.openModal = (hour) => {
    hourInput.value = hour;
    modal.style.display = 'flex';
  };

  closeModalBtn.onclick = () => modal.style.display = 'none';
  window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };

  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitBookingBtn');
    btn.innerText = 'Оформление...';
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
      window.location.reload(); 
    }
  });
});
