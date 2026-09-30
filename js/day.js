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

  // --- Логика навигации по дням ---
  const now = new Date();
  const todayMidnight = new Date(now);
  todayMidnight.setHours(0, 0, 0, 0);
  
  const selectedMidnight = new Date(selectedDate);
  selectedMidnight.setHours(0, 0, 0, 0);

  const prevDate = new Date(selectedMidnight);
  prevDate.setDate(selectedMidnight.getDate() - 1);
  
  const nextDate = new Date(selectedMidnight);
  nextDate.setDate(selectedMidnight.getDate() + 1);

  const maxDate = new Date(todayMidnight);
  maxDate.setDate(todayMidnight.getDate() + 29);

  const prevBtn = document.getElementById('prevDayBtn');
  const nextBtn = document.getElementById('nextDayBtn');

  // Проверяем рамки активных дней
  if (prevDate < todayMidnight) {
    prevBtn.disabled = true;
  } else {
    prevBtn.onclick = () => window.location.href = `day.html?date=${prevDate.toISOString().split('T')[0]}`;
  }

  if (nextDate > maxDate) {
    nextBtn.disabled = true;
  } else {
    nextBtn.onclick = () => window.location.href = `day.html?date=${nextDate.toISOString().split('T')[0]}`;
  }

  // Загружаем данные из БД (Добавлены supply_type, order_type, order_number)
  const { data: bookings, error } = await sb
    .from('bookings')
    .select('id, slot_hour, profile_id, supply_type, order_type, order_number')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  const slotsContainer = document.getElementById('slotsContainer');
  const currentHour = now.getHours();
  const isToday = selectedMidnight.getTime() === todayMidnight.getTime();
  const isPastDay = selectedMidnight < todayMidnight;

  let morningHtml = `<div class="time-group"><div class="time-group-title">🌅 Утро</div><div class="slot-grid">`;
  let afternoonHtml = `</div></div><div class="time-group"><div class="time-group-title">☀️ День</div><div class="slot-grid">`;
  let eveningHtml = `</div></div><div class="time-group"><div class="time-group-title">🌆 Вечер</div><div class="slot-grid">`;

  // Словари для красивого отображения в модальном окне
  const supplyTypes = { 'orders_im': 'Заказы ИМ', 'mix': 'МИКС', 'return': 'Возврат' };
  const orderTypes = { 'order': 'Заказ', 'upd': 'УПД', 'etrn': 'ЭТрН' };

  for (let hour = 9; hour <= 17; hour++) {
    const bookingsForHour = bookings ? bookings.filter(b => b.slot_hour === hour) : [];
    const count = bookingsForHour.length;
    const placesLeft = 5 - count;
    const myBooking = bookingsForHour.find(b => b.profile_id === user.id);

    let isPast = isPastDay;
    if (isToday && currentHour >= hour - 1) {
      isPast = true;
    }

    let statusHtml = '';
    let btnHtml = '';
    let cardClass = 'slot-card';

    if (isPast) {
      cardClass += ' inactive';
      statusHtml = `<span style="color: #64748b;">Время вышло</span>`;
      btnHtml = `<button class="btn-disabled" disabled>Недоступно</button>`;
    } 
    else if (myBooking) {
      statusHtml = `<span style="color: #1f2937;">Вы записаны</span>`;
      
      // Формируем данные для передачи в функцию открытия окна деталей
      const sType = supplyTypes[myBooking.supply_type] || myBooking.supply_type;
      const oType = orderTypes[myBooking.order_type] || myBooking.order_type;
      
      btnHtml = `<button class="btn-cancel" onclick="openDetailsModal(${myBooking.id}, '${selectedDate}', ${hour}, '${sType}', '${oType}', '${myBooking.order_number}')">
                   Отменить
                 </button>`;
    } 
    else if (placesLeft === 0) {
      cardClass += ' inactive';
      statusHtml = `<span style="color: #64748b;">Мест нет (5/5)</span>`;
      btnHtml = `<button class="btn-disabled" disabled>Занято</button>`;
    } 
    else {
      let statusColor = '';
      if (placesLeft >= 4) statusColor = '#10b981'; 
      else if (placesLeft >= 2) statusColor = '#f59e0b'; 
      else statusColor = '#ef4444'; 

      statusHtml = `<span style="color: ${statusColor};">Свободно (${placesLeft} мест)</span>`;
      btnHtml = `<button class="btn-book" onclick="openCreateModal(${hour})">Записаться</button>`;
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

    if (hour >= 9 && hour <= 11) morningHtml += slotHtml;
    else if (hour >= 12 && hour <= 16) afternoonHtml += slotHtml;
    else if (hour === 17) eveningHtml += slotHtml;
  }

  slotsContainer.innerHTML = morningHtml + afternoonHtml + eveningHtml + `</div></div>`;

  // --- Логика Модального окна СОЗДАНИЯ записи ---
  const createModal = document.getElementById('bookingModal');
  const closeCreateBtn = document.getElementById('closeModalBtn');
  const bookingForm = document.getElementById('bookingForm');
  const hourInput = document.getElementById('selectedHour');

  window.openCreateModal = (hour) => {
    hourInput.value = hour;
    createModal.style.display = 'flex';
  };

  closeCreateBtn.onclick = () => createModal.style.display = 'none';

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

  // --- Логика Модального окна ДЕТАЛЕЙ (отмена) ---
  const detailsModal = document.getElementById('bookingDetailsModal');
  const closeDetailsBtn = document.getElementById('closeDetailsModalBtn');
  const trashBtn = document.getElementById('deleteBookingBtn');

  window.openDetailsModal = (id, dateStr, hour, supplyType, orderType, orderNum) => {
    const bDate = new Date(dateStr).toLocaleDateString('ru-RU');
    const timeStr = `${hour}:00 - ${hour + 1}:00`;
    
    document.getElementById('modalDate').innerText = bDate;
    document.getElementById('modalTime').innerText = timeStr;
    document.getElementById('modalType').innerText = supplyType;
    document.getElementById('modalDoc').innerText = `${orderType} №${orderNum}`;
    
    trashBtn.onclick = async () => {
      const confirmCancel = confirm(`Отменить запись на ${bDate} (${timeStr})?`);
      if (confirmCancel) {
        const { error: delError } = await sb.from('bookings').delete().eq('id', id);
        if (delError) {
          alert('Ошибка при отмене: ' + delError.message);
        } else {
          window.location.reload();
        }
      }
    };
    
    detailsModal.style.display = 'flex';
  };

  closeDetailsBtn.onclick = () => detailsModal.style.display = 'none';

  // Закрытие окон по клику вне их области
  window.onclick = (e) => { 
    if (e.target === createModal) createModal.style.display = 'none';
    if (e.target === detailsModal) detailsModal.style.display = 'none';
  };
});
