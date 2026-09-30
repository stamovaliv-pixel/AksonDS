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

  // Надежная функция для получения локальной даты (Y-M-D) без сбоев из-за часовых поясов
  function getLocalDateString(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

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

  // Блокируем кнопку "пред. день", если это прошлое
  if (prevDate < todayMidnight) {
    prevBtn.disabled = true;
  } else {
    prevBtn.onclick = () => window.location.href = `day.html?date=${getLocalDateString(prevDate)}`;
  }

  // Блокируем кнопку "след. день", если вышли за 30 дней
  if (nextDate > maxDate) {
    nextBtn.disabled = true;
  } else {
    nextBtn.onclick = () => window.location.href = `day.html?date=${getLocalDateString(nextDate)}`;
  }

  // Загружаем данные из БД
  const { data: bookings, error } = await sb
    .from('bookings')
    .select('id, slot_hour, profile_id, supply_type, order_type, order_number')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  if (error) console.error('Ошибка загрузки записей:', error);

  const slotsContainer = document.getElementById('slotsContainer');
  slotsContainer.innerHTML = ''; // Очищаем текст "Загрузка..."
  
  const currentHour = now.getHours();
  const isToday = selectedMidnight.getTime() === todayMidnight.getTime();
  const isPastDay = selectedMidnight < todayMidnight;

  // Создаем контейнеры для Утра, Дня и Вечера
  const groups = {
    morning: { title: '🌅 Утро', el: null },
    afternoon: { title: '☀️ День', el: null },
    evening: { title: '🌆 Вечер', el: null }
  };

  for (const key in groups) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'time-group';
    groupDiv.innerHTML = `<div class="time-group-title">${groups[key].title}</div><div class="slot-grid"></div>`;
    groups[key].el = groupDiv.querySelector('.slot-grid');
    slotsContainer.appendChild(groupDiv);
  }

  const supplyTypes = { 'orders_im': 'Заказы ИМ', 'mix': 'МИКС', 'return': 'Возврат' };
  const orderTypes = { 'order': 'Заказ', 'upd': 'УПД', 'etrn': 'ЭТрН' };

  // Генерируем слоты надежным методом createElement (избегает ошибок кликов)
  for (let hour = 9; hour <= 17; hour++) {
    const bookingsForHour = bookings ? bookings.filter(b => b.slot_hour === hour) : [];
    const count = bookingsForHour.length;
    const placesLeft = 5 - count;
    const myBooking = bookingsForHour.find(b => b.profile_id === user.id);

    let isPast = isPastDay;
    if (isToday && currentHour >= hour - 1) {
      isPast = true;
    }

    const card = document.createElement('div');
    card.className = 'slot-card';
    
    let statusHtml = '';
    let btnHtml = '';

    if (isPast) {
      card.classList.add('inactive');
      statusHtml = `<span style="color: #64748b;">Время вышло</span>`;
      btnHtml = `<button class="btn-disabled" disabled>Недоступно</button>`;
    } 
    else if (myBooking) {
      statusHtml = `<span style="color: #1f2937;">Вы записаны</span>`;
      btnHtml = `<button class="btn-cancel">Отменить</button>`;
      
      // Делаем кликабельной ВСЮ иконку, если есть запись
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        const sType = supplyTypes[myBooking.supply_type] || myBooking.supply_type;
        const oType = orderTypes[myBooking.order_type] || myBooking.order_type;
        openDetailsModal(myBooking.id, selectedDate, hour, sType, oType, myBooking.order_number);
      });
    } 
    else if (placesLeft === 0) {
      card.classList.add('inactive');
      statusHtml = `<span style="color: #64748b;">Мест нет (5/5)</span>`;
      btnHtml = `<button class="btn-disabled" disabled>Занято</button>`;
    } 
    else {
      let statusColor = placesLeft >= 4 ? '#10b981' : (placesLeft >= 2 ? '#f59e0b' : '#ef4444');
      statusHtml = `<span style="color: ${statusColor};">Свободно (${placesLeft} мест)</span>`;
      btnHtml = `<button class="btn-book">Записаться</button>`;
      
      // Делаем кликабельной иконку для свободных мест тоже
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => openCreateModal(hour));
    }

    card.innerHTML = `
      <div>
        <div class="slot-time">${hour}:00 - ${hour + 1}:00</div>
        <div class="slot-status">${statusHtml}</div>
      </div>
      ${btnHtml}
    `;

    // Распределяем карточки по блокам
    if (hour >= 9 && hour <= 11) groups.morning.el.appendChild(card);
    else if (hour >= 12 && hour <= 16) groups.afternoon.el.appendChild(card);
    else if (hour === 17) groups.evening.el.appendChild(card);
  }

  // --- Логика Модального окна СОЗДАНИЯ записи ---
  const createModal = document.getElementById('bookingModal');
  const closeCreateBtn = document.getElementById('closeModalBtn');
  const bookingForm = document.getElementById('bookingForm');
  const hourInput = document.getElementById('selectedHour');

  function openCreateModal(hour) {
    hourInput.value = hour;
    createModal.style.display = 'flex';
  }

  if(closeCreateBtn) closeCreateBtn.onclick = () => createModal.style.display = 'none';

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

  // --- Логика Модального окна ДЕТАЛЕЙ (удаление) ---
  const detailsModal = document.getElementById('bookingDetailsModal');
  const closeDetailsBtn = document.getElementById('closeDetailsModalBtn');
  const trashBtn = document.getElementById('deleteBookingBtn');

  function openDetailsModal(id, dateStr, hour, supplyType, orderType, orderNum) {
    const bDate = new Date(dateStr).toLocaleDateString('ru-RU');
    const timeStr = `${hour}:00 - ${hour + 1}:00`;
    
    // Заполняем данные в окне
    document.getElementById('modalDate').innerText = bDate;
    document.getElementById('modalTime').innerText = timeStr;
    document.getElementById('modalType').innerText = supplyType;
    document.getElementById('modalDoc').innerText = `${orderType} №${orderNum}`;
    
    // Назначаем действие на корзину
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
  }

  if(closeDetailsBtn) closeDetailsBtn.onclick = () => detailsModal.style.display = 'none';

  // Закрытие окон при клике на темный фон
  window.onclick = (e) => { 
    if (e.target === createModal) createModal.style.display = 'none';
    if (e.target === detailsModal) detailsModal.style.display = 'none';
  };
});
