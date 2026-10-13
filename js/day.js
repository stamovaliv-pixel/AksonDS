document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  const urlParams = new URLSearchParams(window.location.search);
  const selectedDate = urlParams.get('date');
  if (!selectedDate) return window.location.href = 'calendar.html';

  const dateObj = new Date(selectedDate);
  document.getElementById('currentDateDisplay').innerText = dateObj.toLocaleDateString('ru-RU');

  document.getElementById('logoutBtn').onclick = async (e) => { 
    e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html'; 
  };

  function getLocalDateString(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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

  const { data: settings } = await sb.from('app_settings').select('*').eq('id', 1).single();
  
  const templateBtn = document.getElementById('downloadTemplateBtn');
  if (templateBtn) {
    if (settings && settings.registry_template_url) {
      templateBtn.href = settings.registry_template_url;
      templateBtn.style.display = 'inline-flex';
    } else {
      templateBtn.style.display = 'inline-flex';
      templateBtn.onclick = (e) => {
        e.preventDefault();
        alert('Шаблон реестра еще не загружен администратором в настройках системы.');
      };
    }
  }

  const registryFile = document.getElementById('registryFile');
  const fileName = document.getElementById('fileName');
  if (registryFile && fileName) {
    registryFile.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        fileName.textContent = e.target.files[0].name;
        fileName.style.color = '#10b981';
      } else {
        fileName.textContent = 'Загрузить реестр';
        fileName.style.color = '#475569';
      }
    });
  }

  const getSupplyIcon = (id, name) => {
    const n = name.toLowerCase();
    if (id === 'orders_im' || n.includes('им')) return '📦';
    if (id === 'return' || n.includes('возврат')) return '↩️';
    if (id === 'mix' || n.includes('микс')) return '🔀';
    if (n.includes('сток')) return '🏭';
    if (n.includes('кросс')) return '🚚';
    return '🏷'; 
  };

  const typesContainer = document.getElementById('supplyTypesGroup');
  if (typesContainer && settings) {
    typesContainer.innerHTML = '';
    settings.supply_types.forEach(st => {
      const icon = getSupplyIcon(st.id, st.name);
      typesContainer.innerHTML += `<label style="display:flex; align-items:center; gap:5px; cursor:pointer; white-space:nowrap;"><input type="checkbox" value="${st.id}" style="width:16px; height:16px; cursor:pointer;"> ${icon} ${st.name}</label>`;
    });
  }

  let isTkModal = false;
  const tkWrapper = document.getElementById('tkWrapper');
  const tkDot = document.getElementById('tkDot');
  if(tkWrapper) {
    tkWrapper.onclick = () => {
      isTkModal = !isTkModal;
      tkDot.className = isTkModal ? 'tk-dot-modal active' : 'tk-dot-modal inactive';
    };
  }

  const { data: bookings } = await sb
    .from('bookings')
    .select('id, slot_hour, profile_id, supply_type, supply_types, order_type, order_number, registry_file_url, comment, is_tk')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  const slotsContainer = document.getElementById('slotsContainer');
  slotsContainer.innerHTML = ''; 
  
  const groups = {
    morning: { title: '☕ Утро (до 12:00)', el: null },
    afternoon: { title: '☀️ День (12:00 - 16:00)', el: null },
    evening: { title: '🌙 Вечер (от 17:00)', el: null }
  };

  for (const key in groups) {
    const groupDiv = document.createElement('div');
    groupDiv.className = 'time-group';
    groupDiv.innerHTML = `<div class="time-group-title">${groups[key].title}</div><div class="slot-grid"></div>`;
    groups[key].el = groupDiv.querySelector('.slot-grid');
    slotsContainer.appendChild(groupDiv);
  }

  const currentHour = now.getHours();
  const isToday = selectedMidnight.getTime() === todayMidnight.getTime();
  const isPastDay = selectedMidnight < todayMidnight;
  
  const startHour = settings?.slot_start_hour ?? 9;
  const endHour = settings?.slot_end_hour ?? 17;

  for (let hour = startHour; hour <= endHour; hour++) {
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
    const mainLeft = (settings.slots_per_hour || 5) - mainUsed;

    let isPast = isPastDay;
    if (isToday && currentHour >= hour - (settings.booking_deadline_hours || 1)) isPast = true;

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
      if (mainLeft > 0) statusHtml = `<span style="color: #10b981;">Свободно: <br/>${mainLeft} осн. / ${reserveLeft} рез.</span>`;
      else statusHtml = `<span style="color: #f59e0b;">Осталось ${reserveLeft}<br/>(только ИМ)</span>`;
      btnHtml = `<button class="btn-book">Записаться</button>`;
      card.onclick = () => openCreateModal(hour, mainLeft);
    }

    card.innerHTML = `<div><div class="slot-time">${hour}:00 - ${hour + 1}:00</div><div class="slot-status">${statusHtml}</div></div>${btnHtml}`;
    
    if (hour < 12) groups.morning.el.appendChild(card);
    else if (hour < 17) groups.afternoon.el.appendChild(card);
    else groups.evening.el.appendChild(card);
  }

  for (const key in groups) {
    if (groups[key].el.children.length === 0) {
      groups[key].el.parentElement.style.display = 'none';
    }
  }

  // Переменные состояния для редактирования
  let currentMainLeft = 0;
  let currentEditBookingId = null;
  let existingFileUrl = null;

  const createModal = document.getElementById('bookingModal');
  const hourInput = document.getElementById('selectedHour');

  function openCreateModal(hour, mainLeft) {
    currentEditBookingId = null;
    existingFileUrl = null;
    hourInput.value = hour;
    currentMainLeft = mainLeft;
    
    document.getElementById('bookingModalTitle').innerText = 'Оформление записи';
    document.getElementById('submitBookingBtn').innerText = 'Подтвердить запись';
    document.getElementById('bookingForm').reset();
    
    if (fileName) {
      fileName.textContent = 'Загрузить реестр';
      fileName.style.color = '#475569';
    }
    isTkModal = false;
    if(tkDot) tkDot.className = 'tk-dot-modal inactive';

    createModal.style.display = 'flex';
  }

  function openEditModal(b, hour) {
    currentEditBookingId = b.id;
    existingFileUrl = b.registry_file_url;
    hourInput.value = hour; // Не изменяем время, сохраняем текущий час

    document.getElementById('bookingModalTitle').innerText = 'Редактирование записи';
    document.getElementById('submitBookingBtn').innerText = 'Сохранить изменения';
    document.getElementById('bookingForm').reset();

    // Заполнение чекбоксов типов поставки
    const types = b.supply_types?.length ? b.supply_types : [b.supply_type];
    document.querySelectorAll('#supplyTypesGroup input').forEach(cb => {
      cb.checked = types.includes(cb.value);
    });

    document.getElementById('orderType').value = b.order_type || 'order';
    document.getElementById('orderNumber').value = b.order_number || '';
    document.getElementById('bookingComment').value = b.comment || '';

    isTkModal = !!b.is_tk;
    if(tkDot) tkDot.className = isTkModal ? 'tk-dot-modal active' : 'tk-dot-modal inactive';

    if (fileName) {
      fileName.textContent = b.registry_file_url ? 'Файл прикреплен (нажмите, чтобы заменить)' : 'Загрузить реестр';
      fileName.style.color = '#10b981';
    }

    createModal.style.display = 'flex';
  }

  document.getElementById('closeModalBtn').onclick = () => createModal.style.display = 'none';

  document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const file = registryFile.files[0];
    
    // Файл обязателен только при создании. При редактировании можно оставить старый.
    if (!currentEditBookingId && !file) {
      return alert('Пожалуйста, загрузите реестр поставки (.csv)');
    }

    const selectedTypes = Array.from(document.querySelectorAll('#supplyTypesGroup input:checked')).map(cb => cb.value);
    if (selectedTypes.length === 0) return alert('Выберите хотя бы один тип поставки');

    const isImOnly = selectedTypes.length === 1 && selectedTypes[0] === 'orders_im';
    
    // Если создаем запись и кончились места, блокируем
    if (!currentEditBookingId && !isImOnly && currentMainLeft <= 0) {
      return alert('В этом слоте закончились основные места. Запись доступна только для типа "Заказы ИМ".');
    }

    if (selectedTypes.includes('return')) {
      const returnDeadlineDays = settings.return_deadline_days || 0;
      if (returnDeadlineDays > 0) {
        const minAllowedDate = new Date(todayMidnight);
        minAllowedDate.setDate(todayMidnight.getDate() + returnDeadlineDays);
        
        if (selectedMidnight < minAllowedDate) {
          return alert(`Для поставок, включающих "Возврат", запись возможна только начиная с ${minAllowedDate.toLocaleDateString('ru-RU')}.`);
        }
      }
    }

    const btn = document.getElementById('submitBookingBtn');
    btn.innerText = 'Сохранение...';
    btn.disabled = true;

    let finalFileUrl = existingFileUrl;

    // Если загружен новый файл, обновляем
    if (file) {
      const fileExt = file.name.split('.').pop();
      const newFileName = `${user.id}_${Date.now()}.${fileExt}`;
      const { error: uploadError } = await sb.storage.from('registries').upload(newFileName, file);
      
      if (uploadError) {
        alert('Ошибка загрузки файла: ' + uploadError.message);
        btn.innerText = currentEditBookingId ? 'Сохранить изменения' : 'Подтвердить запись';
        btn.disabled = false;
        return;
      }
      finalFileUrl = sb.storage.from('registries').getPublicUrl(newFileName).data.publicUrl;
    }

    const payload = {
      supply_types: selectedTypes,
      order_type: document.getElementById('orderType').value,
      order_number: document.getElementById('orderNumber').value,
      registry_file_url: finalFileUrl,
      is_tk: isTkModal,
      comment: document.getElementById('bookingComment').value.trim()
    };

    let errorResult;

    if (currentEditBookingId) {
      // Редактирование
      const { error } = await sb.from('bookings').update(payload).eq('id', currentEditBookingId);
      errorResult = error;
    } else {
      // Создание
      payload.profile_id = user.id;
      payload.slot_date = selectedDate;
      payload.slot_hour = parseInt(hourInput.value);
      payload.status = 'active';
      const { error } = await sb.from('bookings').insert([payload]);
      errorResult = error;
    }

    if (errorResult) {
      alert('Ошибка записи: ' + errorResult.message);
      btn.innerText = currentEditBookingId ? 'Сохранить изменения' : 'Подтвердить запись';
      btn.disabled = false;
    } else {
      window.location.reload(); 
    }
  });

  const detailsModal = document.getElementById('bookingDetailsModal');
  document.getElementById('closeDetailsModalBtn').onclick = () => detailsModal.style.display = 'none';

  function openDetailsModal(b, hour) {
    const supplyDict = {}; settings.supply_types.forEach(st => supplyDict[st.id] = st.name);
    const typesStr = b.supply_types?.length ? b.supply_types.map(t => `${getSupplyIcon(t, supplyDict[t]||t)} ${supplyDict[t] || t}`).join(', ') : `${getSupplyIcon(b.supply_type, supplyDict[b.supply_type]||b.supply_type)} ${supplyDict[b.supply_type] || b.supply_type}`;
    
    document.getElementById('modalDate').innerText = new Date(selectedDate).toLocaleDateString('ru-RU');
    document.getElementById('modalTime').innerText = `${hour}:00 - ${hour+1}:00`;
    document.getElementById('modalType').innerHTML = typesStr;
    const oTypes = { 'order': 'Заказ', 'upd': 'УПД', 'etrn': 'ЭТрН' };
    document.getElementById('modalDoc').innerText = `${oTypes[b.order_type] || b.order_type} №${b.order_number}`;
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
    
    const editBtn = document.getElementById('editBookingBtn');
    if (isPastDay) {
      // Редактирование в прошедших датах недоступно
      editBtn.style.display = 'none';
    } else {
      editBtn.style.display = 'block';
      editBtn.onclick = () => {
        detailsModal.style.display = 'none';
        openEditModal(b, hour);
      };
    }
    
    document.getElementById('deleteBookingBtn').onclick = async () => {
      if(confirm('Отменить запись?')) {
        await sb.from('bookings').delete().eq('id', b.id);
        window.location.reload();
      }
    };
    detailsModal.style.display = 'flex';
  }
  
  window.onclick = (e) => { 
    if (e.target === createModal) createModal.style.display = 'none';
    if (e.target === detailsModal) detailsModal.style.display = 'none';
  };
});
