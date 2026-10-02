document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  const urlParams = new URLSearchParams(window.location.search);
  const selectedDate = urlParams.get('date');
  if (!selectedDate) return window.location.href = 'calendar.html';

  document.getElementById('currentDateDisplay').innerText = new Date(selectedDate).toLocaleDateString('ru-RU');

  document.getElementById('logoutBtn').onclick = async (e) => { 
    e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html'; 
  };

  const { data: settings } = await sb.from('app_settings').select('*').eq('id', 1).single();
  
  // Ссылка на шаблон
  const templateBtn = document.getElementById('downloadTemplateBtn');
  if (templateBtn) {
    if (settings && settings.registry_template_url) {
      templateBtn.href = settings.registry_template_url;
    } else {
      templateBtn.style.display = 'none';
    }
  }

  const typesContainer = document.getElementById('supplyTypesGroup');
  if (typesContainer && settings) {
    typesContainer.innerHTML = '';
    settings.supply_types.forEach(st => {
      typesContainer.innerHTML += `<label style="display:flex; align-items:center; gap:5px; cursor:pointer;"><input type="checkbox" value="${st.id}" style="width:16px; height:16px; cursor:pointer;"> ${st.name}</label>`;
    });
  }

  const { data: bookings } = await sb
    .from('bookings')
    .select('id, slot_hour, profile_id, supply_type, supply_types, order_type, order_number, registry_file_url, comment, is_tk')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  const slotsContainer = document.getElementById('slotsContainer');
  slotsContainer.innerHTML = ''; 
  
  const now = new Date();
  const currentHour = now.getHours();
  const isToday = new Date(selectedDate).toDateString() === now.toDateString();
  const isPastDay = new Date(selectedDate) < new Date(now.toDateString());

  for (let hour = settings.slot_start_hour; hour <= settings.slot_end_hour; hour++) {
    const hourBookings = (bookings || []).filter(b => b.slot_hour === hour);
    const myBooking = hourBookings.find(b => b.profile_id === user.id);

    let reserveUsed = 0, mainUsed = 0;
    
    hourBookings.forEach(b => {
      const types = b.supply_types?.length ? b.supply_types : [b.supply_type];
      const isImOnly = types.length === 1 && types[0] === 'orders_im';
      if (isImOnly && reserveUsed < (settings.reserve_slots_per_hour || 3)) reserveUsed++; 
      else mainUsed++;
    });

    const reserveLeft = (settings.reserve_slots_per_hour || 3) - reserveUsed;
    const mainLeft = settings.slots_per_hour - mainUsed;

    let isPast = isPastDay;
    if (isToday && currentHour >= hour - settings.booking_deadline_hours) isPast = true;

    const card = document.createElement('div');
    card.className = 'slot-card';
    
    let statusHtml = '', btnHtml = '';

    if (isPast) {
      card.classList.add('inactive');
      statusHtml = `<span style="color: #64748b;">Время вышло</span>`;
      btnHtml = `<button class="btn-disabled" disabled>Недоступно</button>`;
    } 
    else if (myBooking) {
      statusHtml = `<span style="color: #1f2937;">Вы записаны</span>`;
      btnHtml = `<button class="btn-cancel">Подробнее</button>`;
      card.onclick = () => openDetailsModal(myBooking, hour);
    } 
    else if (mainLeft <= 0 && reserveLeft <= 0) {
      card.classList.add('inactive');
      statusHtml = `<span style="color: #ef4444;">Мест нет</span>`;
      btnHtml = `<button class="btn-disabled" disabled>Занято</button>`;
    } 
    else {
      if (mainLeft > 0) statusHtml = `<span style="color: #10b981;">Свободно: ${mainLeft} осн. / ${reserveLeft} рез.</span>`;
      else statusHtml = `<span style="color: #f59e0b;">Осталось ${reserveLeft} (только Заказы ИМ)</span>`;
      btnHtml = `<button class="btn-book">Записаться</button>`;
      card.onclick = () => openCreateModal(hour, mainLeft);
    }

    card.innerHTML = `<div><div class="slot-time">${hour}:00 - ${hour + 1}:00</div><div class="slot-status">${statusHtml}</div></div>${btnHtml}`;
    slotsContainer.appendChild(card);
  }

  let currentMainLeft = 0;
  const createModal = document.getElementById('bookingModal');
  const hourInput = document.getElementById('selectedHour');

  function openCreateModal(hour, mainLeft) {
    hourInput.value = hour;
    currentMainLeft = mainLeft;
    document.getElementById('bookingForm').reset();
    createModal.style.display = 'flex';
  }

  document.getElementById('closeModalBtn').onclick = () => createModal.style.display = 'none';

  document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const selectedTypes = Array.from(document.querySelectorAll('#supplyTypesGroup input:checked')).map(cb => cb.value);
    if (selectedTypes.length === 0) return alert('Выберите хотя бы один тип поставки');

    const isImOnly = selectedTypes.length === 1 && selectedTypes[0] === 'orders_im';
    
    if (!isImOnly && currentMainLeft <= 0) {
      return alert('В этом слоте закончились основные места. Запись доступна только для типа "Заказы ИМ".');
    }

    if (selectedTypes.includes('return')) {
      const slotTime = new Date(selectedDate);
      slotTime.setHours(parseInt(hourInput.value), 0, 0, 0);
      const diffHours = (slotTime - new Date()) / (1000 * 60 * 60);
      if (diffHours < 24) return alert('Для поставок, включающих "Возврат", запись возможна не ранее чем за 24 часа.');
    }

    const btn = document.getElementById('submitBookingBtn');
    btn.innerText = 'Оформление...';
    btn.disabled = true;

    const fileInput = document.getElementById('registryFile');
    const file = fileInput.files[0];
    let fileUrl = null;

    if (file) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}_${Date.now()}.${fileExt}`;
      const { data: uploadData, error: uploadError } = await sb.storage.from('registries').upload(fileName, file);
      
      if (uploadError) {
        alert('Ошибка загрузки файла: ' + uploadError.message);
        btn.innerText = 'Подтвердить запись';
        btn.disabled = false;
        return;
      }
      fileUrl = sb.storage.from('registries').getPublicUrl(fileName).data.publicUrl;
    }

    const payload = {
      profile_id: user.id,
      slot_date: selectedDate,
      slot_hour: parseInt(hourInput.value),
      supply_types: selectedTypes,
      order_type: document.getElementById('orderType').value,
      order_number: document.getElementById('orderNumber').value,
      registry_file_url: fileUrl,
      is_tk: document.getElementById('isTk').checked,
      comment: document.getElementById('bookingComment').value.trim(),
      status: 'active'
    };

    const { error } = await sb.from('bookings').insert([payload]);
    if (error) {
      alert('Ошибка записи: ' + error.message);
      btn.innerText = 'Подтвердить запись';
      btn.disabled = false;
    } else {
      window.location.reload(); 
    }
  });

  const detailsModal = document.getElementById('bookingDetailsModal');
  document.getElementById('closeDetailsModalBtn').onclick = () => detailsModal.style.display = 'none';

  function openDetailsModal(b, hour) {
    const supplyDict = {}; settings.supply_types.forEach(st => supplyDict[st.id] = st.name);
    const typesStr = b.supply_types?.length ? b.supply_types.map(t => supplyDict[t] || t).join(', ') : (supplyDict[b.supply_type] || b.supply_type);
    
    document.getElementById('modalDate').innerText = new Date(selectedDate).toLocaleDateString('ru-RU');
    document.getElementById('modalTime').innerText = `${hour}:00 - ${hour+1}:00`;
    document.getElementById('modalType').innerText = typesStr;
    document.getElementById('modalDoc').innerText = `№${b.order_number}`;
    document.getElementById('modalTk').innerText = b.is_tk ? 'Да' : 'Нет';
    document.getElementById('modalComment').innerText = b.comment || 'Нет комментария';
    
    const fileLink = document.getElementById('modalFileLink');
    if (b.registry_file_url) {
      fileLink.href = b.registry_file_url;
      fileLink.innerText = 'Скачать файл (.csv)';
      fileLink.style.display = 'inline-block';
    } else {
      fileLink.style.display = 'none';
    }
    
    document.getElementById('deleteBookingBtn').onclick = async () => {
      if(confirm('Отменить запись?')) {
        await sb.from('bookings').delete().eq('id', b.id);
        window.location.reload();
      }
    };
    detailsModal.style.display = 'flex';
  }
});
