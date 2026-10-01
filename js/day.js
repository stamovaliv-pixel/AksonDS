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

  // ЗАГРУЗКА ГЛОБАЛЬНЫХ НАСТРОЕК
  const { data: settings } = await sb.from('app_settings').select('*').eq('id', 1).single();
  if (!settings) return console.error('Не удалось загрузить настройки');

  function getLocalDateString(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getSlotWord(num) {
    if (num === 1) return 'слот';
    if (num >= 2 && num <= 4) return 'слота';
    return 'слотов';
  }

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

  if (prevDate < todayMidnight) prevBtn.disabled = true;
  else prevBtn.onclick = () => window.location.href = `day.html?date=${getLocalDateString(prevDate)}`;

  if (nextDate > maxDate) nextBtn.disabled = true;
  else nextBtn.onclick = () => window.location.href = `day.html?date=${getLocalDateString(nextDate)}`;

  const { data: bookings, error } = await sb
    .from('bookings')
    .select('id, slot_hour, profile_id, supply_type, order_type, order_number')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  if (error) console.error('Ошибка загрузки записей:', error);

  const slotsContainer = document.getElementById('slotsContainer');
  slotsContainer.innerHTML = ''; 
  
  const currentHour = now.getHours();
  const isToday = selectedMidnight.getTime() === todayMidnight.getTime();
  const isPastDay = selectedMidnight < todayMidnight;

  const groups = {
    morning: { title: '☕ Утро', el: null, min: 0, max: 11 },
    afternoon: { title: '☀️ День', el: null, min: 12, max: 16 },
    evening: { title: '🌙 Вечер', el: null, min: 17, max: 23 }
  };

  for (const key in groups) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'time-group';
    groupDiv.innerHTML = `<div class="time-group-title">${groups[key].title}</div><div class="slot-grid"></div>`;
    groups[key].el = groupDiv.querySelector('.slot-grid');
    slotsContainer.appendChild(groupDiv);
  }

  // Создаем словари для отображения названий типов поставок из настроек
  const supplyTypesDict = {};
  settings.supply_types.forEach(t => supplyTypesDict[t.id] = t.name);
  const orderTypes = { 'order': 'Заказ', 'upd': 'УПД', 'etrn': 'ЭТрН' };

  // Используем часы из настроек
  for (let hour = settings.slot_start_hour; hour <= settings.slot_end_hour; hour++) {
    const bookingsForHour = bookings ? bookings.filter(b => b.slot_hour === hour) : [];
    const count = bookingsForHour.length;
    // Используем лимит из настроек
    const placesLeft = settings.slots_per_hour - count;
    const myBooking = bookingsForHour.find(b => b.profile_id === user.id);

    let isPast = isPastDay;
    // Учитываем дедлайн записи из настроек
    if (isToday && currentHour >= hour - settings.booking_deadline_hours) {
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
      btnHtml = `<button class="btn-cancel">Подробнее</button>`;
      
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        const sType = supplyTypesDict[myBooking.supply_type] || myBooking.supply_type;
        const oType = orderTypes[myBooking.order_type] || myBooking.order_type;
        openDetailsModal(myBooking.id, selectedDate, hour, sType, oType, myBooking.order_number);
      });
    } 
    else if (placesLeft <= 0) {
      card.classList.add('inactive');
      statusHtml = `<span style="color: #64748b;">0 слотов</span>`;
      btnHtml = `<button class="btn-disabled" disabled>Занято</button>`;
    } 
    else {
      // Динамический цвет статуса на основе лимитов
      const greenThresh = Math.floor(settings.slots_per_hour * 0.6); // 60% мест
      const orangeThresh = Math.floor(settings.slots_per_hour * 0.3); // 30% мест
      
      let statusColor = placesLeft >= greenThresh ? '#10b981' : (placesLeft >= orangeThresh ? '#f59e0b' : '#ef4444');
      statusHtml = `<span style="color: ${statusColor};">Свободно (${placesLeft} ${getSlotWord(placesLeft)})</span>`;
      btnHtml = `<button class="btn-book">Записаться</button>`;
      
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

    if (hour >= groups.morning.min && hour <= groups.morning.max) groups.morning.el.appendChild(card);
    else if (hour >= groups.afternoon.min && hour <= groups.afternoon.max) groups.afternoon.el.appendChild(card);
    else if (hour >= groups.evening.min && hour <= groups.evening.max) groups.evening.el.appendChild(card);
  }

  // Очистка пустых групп времени
  for (const key in groups) {
    if (groups[key].el.children.length === 0) {
      groups[key].el.parentElement.style.display = 'none';
    }
  }

  const createModal = document.getElementById('bookingModal');
  const closeCreateBtn = document.getElementById('closeModalBtn');
  const bookingForm = document.getElementById('bookingForm');
  const hourInput = document.getElementById('selectedHour');

  // Динамическое заполнение Select для Типов поставки в модальном окне
  const supplySelect = document.getElementById('supplyType');
  if (supplySelect) {
    supplySelect.innerHTML = '';
    settings.supply_types.forEach(st => {
      const option = document.createElement('option');
      option.value = st.id;
      option.textContent = st.name;
      supplySelect.appendChild(option);
    });
  }

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

  const detailsModal = document.getElementById('bookingDetailsModal');
  const closeDetailsBtn = document.getElementById('closeDetailsModalBtn');
  const trashBtn = document.getElementById('deleteBookingBtn');

  function openDetailsModal(id, dateStr, hour, supplyType, orderType, orderNum) {
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
  }

  if(closeDetailsBtn) closeDetailsBtn.onclick = () => detailsModal.style.display = 'none';

  window.onclick = (e) => { 
    if (e.target === createModal) createModal.style.display = 'none';
    if (e.target === detailsModal) detailsModal.style.display = 'none';
  };
});
