document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;
  const escapeHtml = window.escapeHtml;

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
  const getBusinessTodayISODate = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const canEditRegistryForDate = (dateString) => String(dateString || '') >= getBusinessTodayISODate();

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

  // ОПТИМИЗАЦИЯ: Кэширование настроек
  async function getSettings() {
    const cached = sessionStorage.getItem('app_settings');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        // Force one refresh when cache was created by a version older than v4.1.
        if (parsed && Object.prototype.hasOwnProperty.call(parsed, 'booking_excluded_dates')) return parsed;
      } catch (_) { /* discard malformed/legacy cache */ }
      sessionStorage.removeItem('app_settings');
    }
    const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
    if (error) console.error('Не удалось загрузить системные настройки:', error);
    if (data) sessionStorage.setItem('app_settings', JSON.stringify(data));
    return data || {};
  }
  const settings = await getSettings();
  const excludedBookingDates = Array.isArray(settings.booking_excluded_dates) ? settings.booking_excluded_dates : [];
  const isExcludedBookingDate = excludedBookingDates.includes(selectedDate);
  
  const templateBtn = document.getElementById('downloadTemplateBtn');
  if (templateBtn) {
    if (settings && settings.registry_template_url) {
      templateBtn.removeAttribute('href');
      templateBtn.style.display = 'inline-flex';
      window.registryStorage.signedUrl(settings.registry_template_url).then(url => {
        templateBtn.href = url;
        templateBtn.target = '_blank';
        templateBtn.rel = 'noopener noreferrer';
      }).catch(() => { templateBtn.style.display = 'none'; });
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
  const registryEditHint = document.getElementById('registryEditHint');
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
  if (typesContainer && settings && settings.supply_types) {
    typesContainer.replaceChildren();
    settings.supply_types.forEach(st => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex; align-items:center; gap:5px; cursor:pointer; white-space:nowrap;';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(st.id ?? '');
      checkbox.style.cssText = 'width:16px; height:16px; cursor:pointer;';
      label.append(checkbox, document.createTextNode(` ${getSupplyIcon(checkbox.value, String(st.name || ''))} ${String(st.name || '')}`));
      typesContainer.appendChild(label);
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

  // Для прошедших дат занятость новых слотов не требуется и RPC вызывать нельзя:
  // сервер корректно отклоняет get_slot_occupancy для дат раньше сегодняшней.
  // Историю собственных бронирований продолжаем загружать, чтобы поставщик мог
  // открыть существующую запись (правила редактирования реестра проверяются отдельно).
  const isHistoricalDate = selectedDate < getBusinessTodayISODate();
  const [{ data: bookings, error: bookingsError }, { data: occupancy, error: occupancyError }] = await Promise.all([
    sb.from('bookings')
      .select('id, slot_hour, profile_id, supply_type, supply_types, order_type, order_number, registry_file_url, comment, is_tk, slot_date, status')
      .eq('profile_id', user.id).eq('slot_date', selectedDate).eq('status', 'active'),
    isHistoricalDate
      ? Promise.resolve({ data: [], error: null })
      : sb.rpc('get_slot_occupancy', { p_slot_date: selectedDate })
  ]);
  // Ошибка проверки занятости не должна блокировать просмотр существующей записи.
  // Но новые бронирования остаются недоступны, если для сегодняшней/будущей даты
  // сервер не подтвердил занятость слотов.
  if (bookingsError) {
    console.error('Не удалось загрузить записи поставщика:', bookingsError);
    alert('Не удалось загрузить ваши записи. Обновите страницу или обратитесь в поддержку.');
    return;
  }
  const occupancyAvailable = isHistoricalDate || (!occupancyError && Array.isArray(occupancy));
  if (!occupancyAvailable) {
    console.error('Не удалось проверить занятость слотов:', {
      requestedDate: selectedDate,
      businessToday: getBusinessTodayISODate(),
      error: occupancyError
    });
  }

  const slotsContainer = document.getElementById('slotsContainer');
  slotsContainer.innerHTML = '';
  if (!occupancyAvailable) {
    const warning = document.createElement('div');
    warning.setAttribute('role', 'status');
    warning.style.cssText = 'margin:0 0 14px;padding:12px 14px;border-radius:10px;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;font-size:13px;line-height:1.45;';
    warning.textContent = 'Не удалось проверить доступность новых слотов. Новую запись временно оформить нельзя, но существующую запись можно открыть и заменить реестр до конца дня приезда.';
    slotsContainer.appendChild(warning);
  }
  
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
  const deadlineHours = settings?.booking_deadline_hours ?? 1;

  const MAX_SUPPLIER_BOOKINGS_PER_HOUR = 3;
  const orderTypeLabels = { order: 'Заказ', upd: 'УПД', etrn: 'ЭТрН' };

  function getNewBookingBlockReason(isPast, mainLeft, reserveLeft) {
    if (isExcludedBookingDate) return 'Новые записи на эту дату закрыты';
    if (isPast) return 'Время для новых записей вышло';
    if (!occupancyAvailable) return 'Не удалось проверить свободные места';
    if (mainLeft <= 0 && reserveLeft <= 0) return 'В выбранном периоде свободных мест нет';
    return '';
  }

  function makeSlotStatus(text, modifier = '') {
    const el = document.createElement('div');
    el.className = `slot-status${modifier ? ` ${modifier}` : ''}`;
    el.textContent = text;
    return el;
  }

  function makeSlotButton(text, className, onClick, disabled = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = text;
    button.disabled = disabled;
    if (onClick) button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  for (let hour = startHour; hour <= endHour; hour++) {
    // This query is already scoped to the signed-in supplier and selected date.
    // Keep each active booking as its own item; never collapse a period to one record.
    const hourBookings = (bookings || [])
      .filter(b => Number(b.slot_hour) === Number(hour))
      .slice()
      .sort((a, b) => String(a.order_number || '').localeCompare(String(b.order_number || ''), 'ru', { numeric: true, sensitivity: 'base' })
        || String(a.id || '').localeCompare(String(b.id || '')));
    const myBookingCount = hourBookings.length;
    const slotOccupancy = (occupancy || []).find(row => Number(row.slot_hour) === Number(hour)) || {};
    const reserveUsed = Number(slotOccupancy.reserve_used || 0);
    const mainUsed = Number(slotOccupancy.main_used || 0);

    const reserveLeft = (settings.reserve_slots_per_hour || 3) - reserveUsed;
    const mainLeft = (settings.slots_per_hour || 5) - mainUsed;

    let isPast = isPastDay;
    if (isToday && currentHour >= hour - deadlineHours) isPast = true;

    const card = document.createElement('div');
    card.className = 'slot-card';

    const timeElement = document.createElement('div');
    timeElement.className = 'slot-time';
    timeElement.textContent = `${hour}:00 - ${hour + 1}:00`;
    card.appendChild(timeElement);

    const capacitySummary = mainLeft > 0
      ? `Свободно: ${mainLeft} осн. / ${Math.max(0, reserveLeft)} рез.`
      : (reserveLeft > 0 ? `Осталось ${reserveLeft} резервных мест (только ИМ)` : 'Свободных мест нет');

    if (myBookingCount > 0) {
      card.appendChild(makeSlotStatus(`Ваши записи: ${myBookingCount} из ${MAX_SUPPLIER_BOOKINGS_PER_HOUR}`, 'status-info'));

      const bookingList = document.createElement('div');
      bookingList.className = 'supplier-bookings';
      bookingList.setAttribute('aria-label', 'Ваши записи в этом временном периоде');

      hourBookings.forEach((booking, index) => {
        const row = document.createElement('div');
        row.className = 'supplier-booking-row';

        const identity = document.createElement('div');
        identity.className = 'supplier-booking-identity';
        const documentType = orderTypeLabels[booking.order_type] || 'Документ';
        const fullOrderNumber = String(booking.order_number || '').trim();
        const shortOrderNumber = fullOrderNumber.length > 6 ? `${fullOrderNumber.slice(0, 6)}…` : (fullOrderNumber || 'без номера');

        const title = document.createElement('div');
        title.className = 'supplier-booking-title';
        title.textContent = `Запись ${index + 1} · ${documentType} №${shortOrderNumber}`;
        if (fullOrderNumber) title.title = `${documentType} №${fullOrderNumber}`;
        identity.appendChild(title);

        const supplyTypeIds = Array.isArray(booking.supply_types) && booking.supply_types.length
          ? booking.supply_types
          : (booking.supply_type ? [booking.supply_type] : []);
        if (supplyTypeIds.length) {
          const typeNames = {};
          if (Array.isArray(settings.supply_types)) settings.supply_types.forEach(st => { typeNames[String(st.id)] = String(st.name || st.id); });
          const typeLine = document.createElement('div');
          typeLine.className = 'supplier-booking-meta';
          typeLine.textContent = supplyTypeIds.map(typeId => typeNames[String(typeId)] || String(typeId)).join(', ');
          identity.appendChild(typeLine);
        }
        row.appendChild(identity);

        const actions = document.createElement('div');
        actions.className = 'supplier-booking-actions';
        if (canEditRegistryForDate(selectedDate)) {
          actions.appendChild(makeSlotButton('Изменить', 'btn-book', () => openEditModal(booking, hour)));
        }
        actions.appendChild(makeSlotButton('Подробнее', 'btn-cancel', () => openDetailsModal(booking, hour)));
        row.appendChild(actions);
        bookingList.appendChild(row);
      });
      card.appendChild(bookingList);

      if (myBookingCount >= MAX_SUPPLIER_BOOKINGS_PER_HOUR) {
        card.appendChild(makeSlotStatus('Лимит достигнут: добавление недоступно', 'status-warning'));
      } else {
        const blockReason = getNewBookingBlockReason(isPast, mainLeft, reserveLeft);
        if (!blockReason) {
          const addButton = makeSlotButton('+ Добавить запись', 'btn-book btn-add-booking', () => openCreateModal(hour, mainLeft, myBookingCount));
          card.appendChild(addButton);
          const capacityNote = mainLeft > 0
            ? `${mainLeft} основных / ${Math.max(0, reserveLeft)} резервных`
            : `только ИМ: ${Math.max(0, reserveLeft)} резервных`;
          card.appendChild(makeSlotStatus(`Доступно: ${capacityNote}`, 'status-availability'));
        } else {
          card.appendChild(makeSlotStatus(blockReason, 'status-warning'));
        }
      }
    } else {
      if (isExcludedBookingDate) {
        card.classList.add('inactive');
        card.appendChild(makeSlotStatus('Дата закрыта администратором', 'status-warning'));
        card.appendChild(makeSlotButton('Запись закрыта', 'btn-disabled', null, true));
      } else if (isPast) {
        card.classList.add('inactive');
        card.appendChild(makeSlotStatus('Время вышло', 'status-muted'));
        card.appendChild(makeSlotButton('Недоступно', 'btn-disabled', null, true));
      } else if (!occupancyAvailable) {
        card.classList.add('inactive');
        card.appendChild(makeSlotStatus('Не удалось проверить занятость', 'status-warning'));
        card.appendChild(makeSlotButton('Временно недоступно', 'btn-disabled', null, true));
      } else if (mainLeft <= 0 && reserveLeft <= 0) {
        card.classList.add('inactive');
        card.appendChild(makeSlotStatus('Мест нет', 'status-unavailable'));
        card.appendChild(makeSlotButton('Занято', 'btn-disabled', null, true));
      } else {
        card.appendChild(makeSlotStatus(capacitySummary, mainLeft > 0 ? 'status-available' : 'status-reserve'));
        card.appendChild(makeSlotButton('Записаться', 'btn-book', () => openCreateModal(hour, mainLeft, 0)));
      }
    }

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

  function openCreateModal(hour, mainLeft, existingCount = 0) {
    currentEditBookingId = null;
    existingFileUrl = null;
    hourInput.value = hour;
    currentMainLeft = mainLeft;
    
    document.getElementById('bookingModalTitle').innerText = existingCount > 0
      ? `Добавление записи ${existingCount + 1} из ${MAX_SUPPLIER_BOOKINGS_PER_HOUR}`
      : 'Оформление записи';
    document.getElementById('submitBookingBtn').innerText = 'Подтвердить запись';
    document.getElementById('bookingForm').reset();
    
    if (fileName) {
      fileName.textContent = 'Загрузить реестр';
      fileName.style.color = '#475569';
    }
    if (registryFile) registryFile.value = '';
    if (registryEditHint) registryEditHint.style.display = 'none';
    isTkModal = false;
    if(tkDot) tkDot.className = 'tk-dot-modal inactive';

    createModal.style.display = 'flex';
  }

  function openEditModal(b, hour) {
    currentEditBookingId = b.id;
    existingFileUrl = b.registry_file_url;
    hourInput.value = hour; 

    document.getElementById('bookingModalTitle').innerText = 'Редактирование записи';
    document.getElementById('submitBookingBtn').innerText = 'Сохранить изменения';
    document.getElementById('bookingForm').reset();

    const types = b.supply_types?.length ? b.supply_types : [b.supply_type];
    document.querySelectorAll('#supplyTypesGroup input').forEach(cb => {
      cb.checked = types.includes(cb.value);
    });

    document.getElementById('orderType').value = ['order', 'upd', 'etrn'].includes(b.order_type) ? b.order_type : 'order';
    document.getElementById('orderNumber').value = b.order_number || '';
    document.getElementById('bookingComment').value = b.comment || '';

    isTkModal = !!b.is_tk;
    if(tkDot) tkDot.className = isTkModal ? 'tk-dot-modal active' : 'tk-dot-modal inactive';

    if (fileName) {
      fileName.textContent = b.registry_file_url ? 'Файл прикреплен (нажмите, чтобы заменить)' : 'Загрузить реестр';
      fileName.style.color = b.registry_file_url ? '#10b981' : '#475569';
    }
    if (registryFile) registryFile.value = '';
    if (registryEditHint) registryEditHint.style.display = canEditRegistryForDate(selectedDate) ? 'block' : 'none';

    createModal.style.display = 'flex';
  }

  document.getElementById('closeModalBtn').onclick = () => createModal.style.display = 'none';

  document.getElementById('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const file = registryFile.files[0];
    if (currentEditBookingId && file && !canEditRegistryForDate(selectedDate)) {
      return alert('Реестр можно изменить только до конца дня приезда.');
    }
    
    if (!currentEditBookingId && !file) {
      return alert('Пожалуйста, загрузите реестр поставки (.csv)');
    }

    const selectedTypes = Array.from(document.querySelectorAll('#supplyTypesGroup input:checked')).map(cb => cb.value);
    if (selectedTypes.length === 0) return alert('Выберите хотя бы один тип поставки');

    const isImOnly = selectedTypes.length === 1 && selectedTypes[0] === 'orders_im';
    
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

    if (file) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
      const newFilePath = `${user.id}/${Date.now()}_${safeName}`;
      try {
        finalFileUrl = await window.registryStorage.upload(file, newFilePath);
      } catch (uploadError) {
        alert(`Ошибка загрузки файла: ${uploadError.message || 'проверьте формат и размер файла'}`);
        btn.innerText = currentEditBookingId ? 'Сохранить изменения' : 'Подтвердить запись';
        btn.disabled = false;
        return;
      }
    }

    const payload = {
      supply_types: selectedTypes,
      order_type: ['order', 'upd', 'etrn'].includes(document.getElementById('orderType')?.value) ? document.getElementById('orderType').value : 'order',
      order_number: document.getElementById('orderNumber').value,
      registry_file_url: finalFileUrl,
      is_tk: isTkModal,
      comment: document.getElementById('bookingComment').value.trim()
    };

    let errorResult;

    if (currentEditBookingId) {
      const { error } = await sb.from('bookings').update(payload).eq('id', currentEditBookingId);
      errorResult = error;
    } else {
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
    const supplyDict = {}; 
    if(settings.supply_types) settings.supply_types.forEach(st => supplyDict[st.id] = st.name);
    
    const typesStr = b.supply_types?.length ? b.supply_types.map(t => `${getSupplyIcon(t, supplyDict[t]||t)} ${supplyDict[t] || t}`).join(', ') : `${getSupplyIcon(b.supply_type, supplyDict[b.supply_type]||b.supply_type)} ${supplyDict[b.supply_type] || b.supply_type}`;
    
    document.getElementById('modalDate').innerText = new Date(selectedDate).toLocaleDateString('ru-RU');
    document.getElementById('modalTime').innerText = `${hour}:00 - ${hour+1}:00`;
    document.getElementById('modalType').textContent = typesStr;
    const oTypes = { 'order': 'Заказ', 'upd': 'УПД', 'etrn': 'ЭТрН' };
    document.getElementById('modalDoc').innerText = `${oTypes[b.order_type] || b.order_type} №${b.order_number}`;
    document.getElementById('modalTk').innerText = b.is_tk ? 'Да' : 'Нет';
    document.getElementById('modalComment').innerText = b.comment || 'Нет комментария';
    
    const fileLink = document.getElementById('modalFileLink');
    if (b.registry_file_url) {
      fileLink.removeAttribute('href');
      fileLink.innerText = 'Скачать файл';
      fileLink.style.display = 'inline-block';
      window.registryStorage.signedUrl(b.registry_file_url).then(url => {
        fileLink.href = url;
        fileLink.target = '_blank';
        fileLink.rel = 'noopener noreferrer';
      }).catch(() => { fileLink.style.display = 'none'; });
    } else {
      fileLink.style.display = 'none';
    }
    
    const editBtn = document.getElementById('editBookingBtn');
    if (!canEditRegistryForDate(selectedDate)) {
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
