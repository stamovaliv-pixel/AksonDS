document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;
  const escapeHtml = window.escapeHtml;
  const urlParams = new URLSearchParams(window.location.search);
  const selectedDate = urlParams.get('date');
  if (!selectedDate) return window.location.href = 'admin_calendar.html';
  const getBusinessTodayISODate = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const canEditRegistryForDate = (dateString) => String(dateString || '') >= getBusinessTodayISODate();
  const resolveOrderTypeForUpdate = (selectId, currentOrderType) => {
    const allowed = ['order', 'upd', 'etrn'];
    const selected = document.getElementById(selectId)?.value;
    if (allowed.includes(selected)) return selected;
    if (allowed.includes(currentOrderType)) return currentOrderType;
    return 'order';
  };

  // Match server-side bookings validation (security_hardening_v4_1.sql):
  // order_number <= 200 characters; comment <= 5000 characters.
  function validateBookingTextLengths(orderNumber, comment) {
    const orderLength = Array.from(String(orderNumber ?? '')).length;
    const commentLength = Array.from(String(comment ?? '')).length;
    if (orderLength > 200) {
      alert(`Номер документа содержит ${orderLength} символов. Максимум — 200. Сократите номер перед сохранением.`);
      return false;
    }
    if (commentLength > 5000) {
      alert(`Комментарий содержит ${commentLength} символов. Максимум — 5000. Сократите комментарий перед сохранением.`);
      return false;
    }
    return true;
  }

  const dateObj = new Date(selectedDate);
  document.getElementById('dateDisplay').innerText = dateObj.toLocaleDateString('ru-RU');

  // Серверная RLS остаётся основной защитой; клиентская проверка не даёт показывать неверные элементы UI.
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';
  const { data: profile, error: profileError } = await sb.from('profiles').select('role, is_blocked').eq('id', user.id).single();
  if (profileError || !profile || profile.is_blocked || !['admin', 'operator', 'viewer'].includes(profile.role)) {
    await sb.auth.signOut();
    return window.location.href = '../index.html';
  }
  const isAdmin = profile.role === 'admin';
  const isOperator = profile.role === 'operator';
  const isViewer = profile.role === 'viewer';
  if (isViewer) document.body.classList.add('role-viewer');

  // ОПТИМИЗАЦИЯ: Кэширование настроек
  async function getSettings() {
    const cached = sessionStorage.getItem('app_settings');
    if (cached) return JSON.parse(cached);
    const { data } = await sb.from('app_settings').select('*').eq('id', 1).single();
    if (data) sessionStorage.setItem('app_settings', JSON.stringify(data));
    return data || {};
  }
  const settings = await getSettings();

  const supplyTypes = {};
  if (settings.supply_types) {
    settings.supply_types.forEach(st => supplyTypes[st.id] = st.name);
  }
  const orderTypes = { 'order': 'Заказ', 'upd': 'УПД', 'etrn': 'ЭТрН' };

  // Логика кнопки шаблона в окне СОЗДАНИЯ записи
  const cTemplateBtn = document.getElementById('cDownloadTemplateBtn');
  if (cTemplateBtn) {
    if (settings && settings.registry_template_url) {
      cTemplateBtn.style.display = 'inline-flex';
      cTemplateBtn.removeAttribute('href');
      window.registryStorage.signedUrl(settings.registry_template_url).then(url => {
        cTemplateBtn.href = url;
        cTemplateBtn.target = '_blank';
        cTemplateBtn.rel = 'noopener noreferrer';
      }).catch(() => { cTemplateBtn.style.display = 'none'; });
    } else {
      cTemplateBtn.style.display = 'inline-flex';
      cTemplateBtn.onclick = (e) => {
        e.preventDefault();
        alert('Шаблон реестра еще не загружен администратором в настройках системы.');
      };
    }
  }

  // Обновление названия загруженного файла и цвета текста
  const cRegistryFile = document.getElementById('cRegistryFile');
  const cFileName = document.getElementById('cFileName');
  if (cRegistryFile && cFileName) {
    cRegistryFile.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        cFileName.textContent = e.target.files[0].name;
        cFileName.style.color = '#059669';
      } else {
        cFileName.textContent = 'Загрузить реестр';
        cFileName.style.color = '';
      }
    });
  }

  const mRegistryFile = document.getElementById('mRegistryFile');
  const mRegistryFileName = document.getElementById('mRegistryFileName');
  const mRegistryEditHint = document.getElementById('mRegistryEditHint');
  if (mRegistryFile && mRegistryFileName) {
    mRegistryFile.addEventListener('change', () => {
      mRegistryFileName.textContent = mRegistryFile.files?.[0]?.name || 'Выбрать новый реестр';
      mRegistryFileName.style.color = mRegistryFile.files?.length ? '#059669' : '#475569';
    });
  }

  // УМНЫЙ ПОДБОР ИКОНОК ПО НАЗВАНИЮ
  const getSupplyIcon = (id, name) => {
    const n = name.toLowerCase();
    if (id === 'orders_im' || n.includes('им')) return '📦';
    if (id === 'return' || n.includes('возврат')) return '↩️';
    if (id === 'mix' || n.includes('микс')) return '🔀';
    if (n.includes('сток')) return '🏭';
    if (n.includes('кросс')) return '🚚';
    return '🏷️';
  };

  // Отрисовка чекбоксов с пиктограммами
  const fillCheckboxes = (containerId) => {
    const el = document.getElementById(containerId);
    if (!el || !settings.supply_types) return;
    el.replaceChildren();
    settings.supply_types.forEach(st => {
      const label = document.createElement('label');
      label.className = 'checkbox-label';
      label.style.cssText = 'display:flex; align-items:center; gap:4px; cursor:pointer; white-space:nowrap;';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(st.id ?? '');
      const text = document.createTextNode(` ${getSupplyIcon(checkbox.value, String(st.name || ''))} ${String(st.name || '')}`);
      label.append(checkbox, text);
      el.appendChild(label);
    });
  };
  fillCheckboxes('mSupplyTypesGroup');
  fillCheckboxes('cSupplyTypesGroup');

  // Логика кастомной кнопки-индикатора ТК
  let isTkEditModal = false;
  const tkEditWrapper = document.getElementById('mTkWrapper');
  const tkEditDot = document.getElementById('mTkDot');
  
  let isTkCreateModal = false;
  const tkCreateWrapper = document.getElementById('cTkWrapper');
  const tkCreateDot = document.getElementById('cTkDot');

  const updateTkDot = (dotElement, isActive) => {
    dotElement.className = isActive ? 'tk-dot-modal active' : 'tk-dot-modal inactive';
  };

  if(tkEditWrapper) {
    tkEditWrapper.onclick = () => {
      if (document.getElementById('mFieldset').disabled) return; 
      isTkEditModal = !isTkEditModal;
      updateTkDot(tkEditDot, isTkEditModal);
    };
  }

  if(tkCreateWrapper) {
    tkCreateWrapper.onclick = () => {
      isTkCreateModal = !isTkCreateModal;
      updateTkDot(tkCreateDot, isTkCreateModal);
    };
  }

  // ОПТИМИЗАЦИЯ: Функция debounce для поиска
  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  // 1. Загрузка данных
  const { data: bookings } = await sb
    .from('bookings')
    .select('id, profile_id, slot_date, slot_hour, order_number, order_type, supply_type, supply_types, arrival_time, departure_time, gate_number, is_tk, comment, registry_file_url, profiles(company_name, inn)')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  let allProfiles = [];
  let selectedSupplier = null;
  let currentEditBooking = null;
  // Слот не должен меняться при сохранении реестра или других полей.
  // slot_hour отправляется только после явного изменения пользователем.
  let editHourWasChanged = false;

  if (!isViewer) {
    const { data: profilesData } = await sb.from('profiles').select('id, company_name, inn').eq('role', 'supplier');
    if (profilesData) allProfiles = profilesData;

    const searchInput = document.getElementById('cSupplierSearch');
    if (searchInput) {
      searchInput.removeAttribute('list'); 
      const resultsContainer = document.createElement('div');
      resultsContainer.style.cssText = 'position: absolute; background: #fff; border: 1px solid #cbd5e1; border-radius: 4px; max-height: 200px; overflow-y: auto; width: 100%; z-index: 99999; box-shadow: 0 4px 10px rgba(0,0,0,0.1); display: none; margin-top: 4px; left: 0; box-sizing: border-box;';
      searchInput.parentElement.style.position = 'relative';
      searchInput.parentElement.appendChild(resultsContainer);

      const performSearch = (val) => {
        resultsContainer.replaceChildren();
        selectedSupplier = null;
        if (!val) {
          resultsContainer.style.display = 'none';
          return;
        }
        const matches = allProfiles.filter(p => 
          (p.company_name && p.company_name.toLowerCase().includes(val)) || 
          (p.inn && p.inn.toLowerCase().includes(val))
        );
        if (matches.length > 0) {
          matches.forEach(p => {
            const item = document.createElement('div');
            item.style.cssText = 'padding: 10px 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9; font-size: 14px; transition: 0.2s;';
            const company = document.createElement('strong');
            company.style.color = '#1e293b';
            company.textContent = p.company_name || 'Без названия';
            const inn = document.createElement('div');
            inn.style.cssText = 'color:#64748b; font-size:12px;';
            inn.textContent = `ИНН: ${p.inn || 'Не указан'}`;
            item.append(company, inn);
            item.onmouseover = () => item.style.background = '#f8fafc';
            item.onmouseout = () => item.style.background = '#fff';
            item.onclick = () => {
              searchInput.value = `${p.company_name} (ИНН: ${p.inn})`;
              selectedSupplier = p;
              resultsContainer.style.display = 'none';
            };
            resultsContainer.appendChild(item);
          });
          resultsContainer.style.display = 'block';
        } else {
          const noResults = document.createElement('div');
          noResults.style.cssText = 'padding: 10px; color: #ef4444; font-size: 13px; text-align: center;';
          noResults.textContent = 'Поставщик не найден';
          resultsContainer.appendChild(noResults);
          resultsContainer.style.display = 'block';
        }
      };

      // Применяем debounce к поиску
      const debouncedSearch = debounce((e) => performSearch(e.target.value.toLowerCase().trim()), 300);
      searchInput.addEventListener('input', debouncedSearch);

      document.addEventListener('click', (e) => {
        if (e.target !== searchInput && e.target !== resultsContainer) resultsContainer.style.display = 'none';
      });
    }
  }

  const container = document.getElementById('hoursContainer');
  container.innerHTML = '';
  
  // 2. ОТРИСОВКА СЕТКИ
  const startHour = settings.slot_start_hour ?? 9;
  const endHour = settings.slot_end_hour ?? 17;

  for (let hour = startHour; hour <= endHour; hour++) {
    const hourBookings = (bookings || []).filter(b => b.slot_hour === hour);
    const block = document.createElement('div');
    block.className = 'hour-block';
    
    let reserveCards = [];
    let mainCards = [];

    hourBookings.forEach(b => {
      const types = b.supply_types?.length ? b.supply_types : [b.supply_type];
      const isImOnly = types.length === 1 && types[0] === 'orders_im';
      if (isImOnly && reserveCards.length < (settings.reserve_slots_per_hour || 3)) {
        reserveCards.push(b);
      } else {
        mainCards.push(b);
      }
    });

    let cardsHtml = '';
    const limitMain = settings.slots_per_hour || 5;
    const limitRes = settings.reserve_slots_per_hour || 3;

    const generateBookedCardHtml = (b, cssClass) => {
      const typesArr = b.supply_types?.length ? b.supply_types : [b.supply_type];
      const iconsHtml = typesArr.map(t => {
        const title = supplyTypes[t] || t;
        const icon = getSupplyIcon(t, title);
        return `<span title="${escapeHtml(title)}">${icon}</span>`;
      }).join(' ');

      const compName = b.profiles?.company_name || 'Неизвестно';
      const tkHtml = b.is_tk ? `<div class="tk-dot" title="Транспортная компания (ТК)"></div>` : `<div style="width:10px;"></div>`;

      const dataStr = encodeURIComponent(JSON.stringify({
        id: b.id, profileId: b.profile_id, slotDate: b.slot_date, hour: b.slot_hour, doc: b.order_number,
        sTypesRaw: b.supply_types || [b.supply_type], oTypeRaw: b.order_type,
        fullCompany: `${compName} (ИНН: ${b.profiles?.inn || ''})`,
        is_tk: b.is_tk, comment: b.comment, registry_file_url: b.registry_file_url
      }));

      return `
        <div class="slot-box ${cssClass}" data-info="${dataStr}">
          <div class="sb-header"><div class="sb-title" title="${escapeHtml(compName)}">${escapeHtml(compName)}</div><button class="btn-dots" type="button" aria-label="Детали записи">⋮</button></div>
          <div class="sb-icons"><div style="display:flex; gap:4px; font-size:16px;">${iconsHtml}</div>${tkHtml}</div>
          <div class="card-actions" data-id="${escapeHtml(b.id)}">
            <div class="inline-input-group"><label>Приб.</label><input type="time" class="inline-arr viewer-disable" value="${escapeHtml(b.arrival_time ? b.arrival_time.substring(0,5) : '')}"></div>
            <div class="inline-input-group"><label>Убыл</label><input type="time" class="inline-dep viewer-disable" value="${escapeHtml(b.departure_time ? b.departure_time.substring(0,5) : '')}"></div>
            <div class="inline-input-group"><label>Вор.</label><input type="text" class="inline-gate viewer-disable" value="${escapeHtml(b.gate_number || '')}"></div>
          </div>
        </div>`;
    };

    for(let i=0; i<limitMain; i++) {
      if (mainCards[i]) cardsHtml += generateBookedCardHtml(mainCards[i], 'main-booked');
      else cardsHtml += `<div class="slot-box main-empty sb-empty ${isViewer ? 'viewer-hide' : ''}" data-hour="${hour}"><div class="sb-empty-text">+ Осн. слот<br><span style="font-size:11px; font-weight:normal;">Свободно</span></div></div>`;
    }

    for(let i=0; i<limitRes; i++) {
      if (reserveCards[i]) cardsHtml += generateBookedCardHtml(reserveCards[i], 'res-booked');
      else cardsHtml += `<div class="slot-box res-empty sb-empty ${isViewer ? 'viewer-hide' : ''}" data-hour="${hour}"><div class="sb-empty-text">+ Резерв<br><span style="font-size:11px; font-weight:normal;">Только ИМ</span></div></div>`;
    }

    const totalBookingsForHour = hourBookings.length;
    const hourCountBadge = totalBookingsForHour > 0
      ? `<span class="hour-count-badge" aria-label="Записей: ${totalBookingsForHour}" title="Записей: ${totalBookingsForHour}">${totalBookingsForHour > 99 ? '99+' : totalBookingsForHour}</span>`
      : '';
    block.innerHTML = `<div class="hour-header"><span class="hour-period-label">${hour}:00 - ${hour+1}:00${hourCountBadge}</span></div><div class="cards-grid">${cardsHtml}</div>`;
    container.appendChild(block);
  }

  if (!isViewer) {
    container.addEventListener('change', async (e) => {
      if (!e.target.classList.contains('inline-gate') && !e.target.classList.contains('inline-arr') && !e.target.classList.contains('inline-dep')) return;

      const id = e.target.closest('.card-actions').dataset.id;
      const booking = (bookings || []).find(row => String(row.id) === String(id));
      const fieldName = e.target.classList.contains('inline-gate') ? 'gate_number' : (e.target.classList.contains('inline-arr') ? 'arrival_time' : 'departure_time');
      const previousValue = booking ? (booking[fieldName] == null ? '' : String(booking[fieldName]).substring(0, 5)) : '';
      const rawValue = e.target.value.trim();
      const valueToSave = e.target.type === 'time' && rawValue ? rawValue + ':00' : (rawValue || null);
      const proposedGate = fieldName === 'gate_number' ? rawValue : String(booking?.gate_number || '').trim();
      const proposedDeparture = fieldName === 'departure_time' ? rawValue : (booking?.departure_time || '');

      // Client pre-check improves feedback; the database trigger remains authoritative for concurrency/API calls.
      if (proposedGate && !proposedDeparture) {
        const normalizedGate = proposedGate.toLocaleLowerCase('ru-RU');
        const conflict = (bookings || []).find(row =>
          String(row.id) !== String(id) &&
          String(row.gate_number || '').trim().toLocaleLowerCase('ru-RU') === normalizedGate &&
          !row.departure_time
        );
        if (conflict) {
          alert(`Ворота ${proposedGate} уже заняты другой поставкой. После указания времени убытия ворота освободятся.`);
          e.target.value = previousValue;
          e.target.style.borderColor = '#ef4444';
          return;
        }
      }

      e.target.style.borderColor = '#3b82f6';
      const { error } = await sb.from('bookings').update({ [fieldName]: valueToSave }).eq('id', id);
      e.target.style.borderColor = error ? '#ef4444' : '#10b981';
      if (error) {
        alert(`Не удалось сохранить изменение: ${error.message}`);
        e.target.value = previousValue;
      } else if (booking) {
        booking[fieldName] = valueToSave;
      }
    });
  }

  const editModal = document.getElementById('editModal');
  const createModal = document.getElementById('createModal');
  document.getElementById('closeEditModal').onclick = () => editModal.style.display = 'none';
  document.getElementById('closeCreateModal').onclick = () => createModal.style.display = 'none';

  const btnEditIcon = document.getElementById('btnEditIcon');
  const btnSaveIcon = document.getElementById('btnSaveIcon');
  const btnDeleteIcon = document.getElementById('btnDeleteIcon');
  const fieldset = document.getElementById('mFieldset');

  if(btnEditIcon) {
    btnEditIcon.onclick = () => {
      fieldset.disabled = false;
      btnEditIcon.style.display = 'none';
      btnSaveIcon.style.display = 'flex';
    };
  }

  container.addEventListener('click', (e) => {
    const dotsBtn = e.target.closest('.btn-dots');
    if (dotsBtn) {
      const card = dotsBtn.closest('.slot-box');
      const data = JSON.parse(decodeURIComponent(card.dataset.info));
      currentEditBooking = data;
      editHourWasChanged = false;
      if (mRegistryFile) {
        mRegistryFile.value = '';
        mRegistryFile.disabled = !canEditRegistryForDate(data.slotDate);
      }
      if (mRegistryFileName) {
        mRegistryFileName.textContent = canEditRegistryForDate(data.slotDate) ? 'Выбрать новый реестр' : 'Редактирование реестра закрыто';
        mRegistryFileName.style.color = canEditRegistryForDate(data.slotDate) ? '#475569' : '#94a3b8';
      }
      if (mRegistryEditHint) {
        mRegistryEditHint.textContent = canEditRegistryForDate(data.slotDate)
          ? 'Реестр можно заменить до конца дня приезда.'
          : 'Срок изменения реестра истёк: разрешено только до конца дня приезда.';
      }
      
      fieldset.disabled = true;
      if(!isViewer) {
        btnEditIcon.style.display = 'flex';
        btnSaveIcon.style.display = 'none';
      }
      
      document.getElementById('mId').value = data.id;
      document.getElementById('mCompany').innerText = data.fullCompany;
      document.getElementById('mDoc').value = data.doc;
      document.getElementById('mOrderType').value = ['order', 'upd', 'etrn'].includes(data.oTypeRaw) ? data.oTypeRaw : 'order';
      document.getElementById('mComment').value = data.comment || '';
      
      isTkEditModal = data.is_tk;
      updateTkDot(tkEditDot, isTkEditModal);
      
      const fileLink = document.getElementById('mFileLink');
      if (data.registry_file_url) {
        fileLink.removeAttribute('href');
        fileLink.style.display = 'inline-flex';
        window.registryStorage.signedUrl(data.registry_file_url).then(url => {
          fileLink.href = url;
          fileLink.target = '_blank';
          fileLink.rel = 'noopener noreferrer';
        }).catch(() => { fileLink.style.display = 'none'; });
      } else {
        fileLink.style.display = 'none';
      }

      document.querySelectorAll('#mSupplyTypesGroup input').forEach(cb => {
        cb.checked = data.sTypesRaw.includes(cb.value);
      });

      const updateAvailableHours = () => {
        const mHourSelect = document.getElementById('mHour');
        const currentValue = mHourSelect.value;
        const currentSelected = currentValue !== '' && Number.isFinite(Number(currentValue))
          ? Number(currentValue)
          : Number(data.hour);
        const originalHour = Number(data.hour);
        mHourSelect.innerHTML = '';

        const selectedTypes = Array.from(document.querySelectorAll('#mSupplyTypesGroup input:checked')).map(cb => cb.value);
        const isImOnly = selectedTypes.length === 1 && selectedTypes[0] === 'orders_im';
        let hasSlots = false;

        const maxMain = settings.slots_per_hour || 5;
        const maxRes = settings.reserve_slots_per_hour || 3;

        for (let h = settings.slot_start_hour; h <= settings.slot_end_hour; h++) {
          const hourBookings = (bookings || []).filter(b => b.slot_hour === h);
          let mUsed = 0, rUsed = 0;
          
          hourBookings.forEach(b => {
            if (b.id === data.id) return; 
            const t = b.supply_types?.length ? b.supply_types : [b.supply_type];
            if (t.length === 1 && t[0] === 'orders_im') {
              if (rUsed < maxRes) rUsed++; else mUsed++;
            } else {
              mUsed++;
            }
          });

          let canMove = false;
          if (isImOnly) canMove = (rUsed < maxRes) || (mUsed < maxMain);
          else canMove = (mUsed < maxMain);

          // Всегда оставляем текущий слот доступным в форме редактирования.
          // Если лимит уже превышен, нельзя молча переносить запись в другой час.
          if (canMove || h === originalHour) {
            const currentLabel = h === originalHour && !canMove ? ' (текущий слот)' : '';
            mHourSelect.innerHTML += `<option value="${h}">${h}:00 - ${h+1}:00${currentLabel}</option>`;
            hasSlots = true;
          }
        }

        // На случай, если текущий час находится вне нового диапазона настроек,
        // всё равно показываем его как текущий, не выбирая другой автоматически.
        if (!Array.from(mHourSelect.options).some(opt => Number(opt.value) === originalHour)) {
          const currentOption = document.createElement('option');
          currentOption.value = String(originalHour);
          currentOption.textContent = `${originalHour}:00 - ${originalHour + 1}:00 (текущий слот)`;
          mHourSelect.insertBefore(currentOption, mHourSelect.firstChild);
          hasSlots = true;
        }

        if (!hasSlots) {
          mHourSelect.innerHTML = `<option value="" disabled selected>Нет свободных мест</option>`;
          if (btnSaveIcon) btnSaveIcon.style.display = 'none';
        } else {
          if (!fieldset.disabled && btnSaveIcon) btnSaveIcon.style.display = 'flex';
          if (Array.from(mHourSelect.options).some(opt => Number(opt.value) === currentSelected)) {
            mHourSelect.value = String(currentSelected);
          } else {
            // При изменении типов, если ранее выбранный час перестал подходить,
            // возвращаемся к исходному слоту, а не переносим запись произвольно.
            mHourSelect.value = String(originalHour);
          }
          editHourWasChanged = Number(mHourSelect.value) !== originalHour;
        }
      };

      const mHourSelect = document.getElementById('mHour');
      // Не наследуем час из предыдущей записи, открытой в этом же окне.
      mHourSelect.value = String(Number(data.hour));
      mHourSelect.onchange = () => {
        editHourWasChanged = Number(mHourSelect.value) !== Number(data.hour);
      };

      document.querySelectorAll('#mSupplyTypesGroup input').forEach(cb => {
        cb.onchange = updateAvailableHours;
      });

      updateAvailableHours();
      editModal.style.display = 'flex';
      return;
    }

    const emptySlot = e.target.closest('.sb-empty');
    if (emptySlot && !isViewer) {
      document.getElementById('cHour').value = emptySlot.dataset.hour;
      document.getElementById('createForm').reset();
      selectedSupplier = null; 
      
      if (cFileName) {
        cFileName.textContent = 'Загрузить реестр';
        cFileName.style.color = '';
      }

      isTkCreateModal = false;
      updateTkDot(tkCreateDot, false);

      if(emptySlot.classList.contains('res-empty')) {
         const imCb = document.querySelector('#cSupplyTypesGroup input[value="orders_im"]');
         if(imCb) imCb.checked = true;
      }
      createModal.style.display = 'flex';
    }
  });

  if (!isViewer) {
    if(btnSaveIcon) {
      btnSaveIcon.onclick = async () => {
        if (!confirm('Подтверждаете изменение?')) return;
        
        const selectedTypes = Array.from(document.querySelectorAll('#mSupplyTypesGroup input:checked')).map(cb => cb.value);
        if (selectedTypes.length === 0) return alert('Выберите хотя бы один тип поставки');
        if (!validateBookingTextLengths(
          document.getElementById('mDoc').value,
          document.getElementById('mComment').value
        )) return;
        
        const selectedHour = document.getElementById('mHour').value;
        if (!selectedHour) return alert('Невозможно сохранить: в выбранном часе нет свободных мест для этого типа поставки.');

        const payload = {
          order_number: document.getElementById('mDoc').value.trim(),
          supply_types: selectedTypes,
          is_tk: isTkEditModal,
          comment: document.getElementById('mComment').value.trim()
        };
        // Замена реестра/сохранение без изменения часа не трогает slot_hour в БД.
        if (editHourWasChanged && Number(selectedHour) !== Number(currentEditBooking?.hour)) {
          payload.slot_hour = Number(selectedHour);
        }
        // Always send a valid enum member; blank HTML select values must never reach PostgreSQL.
        payload.order_type = resolveOrderTypeForUpdate('mOrderType', currentEditBooking?.oTypeRaw);

        const replacementFile = mRegistryFile?.files?.[0];
        let uploadedRegistryPath = null;
        if (replacementFile) {
          if (!currentEditBooking || !canEditRegistryForDate(currentEditBooking.slotDate)) {
            return alert('Реестр можно изменить только до конца дня приезда.');
          }
          if (!currentEditBooking.profileId) return alert('Не удалось определить владельца записи. Обновите страницу.');
          const safeName = replacementFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
          const filePath = `${currentEditBooking.profileId}/${Date.now()}_${safeName}`;
          try {
            uploadedRegistryPath = await window.registryStorage.upload(replacementFile, filePath);
            payload.registry_file_url = uploadedRegistryPath;
          } catch (uploadError) {
            alert(`Не удалось загрузить реестр: ${uploadError.message || 'проверьте формат и размер файла'}`);
            return;
          }
        }

        btnSaveIcon.style.opacity = '0.5';
        btnSaveIcon.style.pointerEvents = 'none';

        const { error } = await sb.from('bookings').update(payload).eq('id', document.getElementById('mId').value);
        if (error) {
          if (uploadedRegistryPath) {
            await sb.storage.from('registries').remove([uploadedRegistryPath]);
          }
          alert('Ошибка обновления: ' + error.message);
          btnSaveIcon.style.opacity = '1';
          btnSaveIcon.style.pointerEvents = 'auto';
        } else {
          window.location.reload();
        }
      };
    }

    if(btnDeleteIcon) {
      btnDeleteIcon.onclick = async () => {
        if (!confirm('Удалить запись? Данное действие нельзя отменить.')) return;
        await sb.from('bookings').delete().eq('id', document.getElementById('mId').value);
        window.location.reload();
      };
    }

    if (document.getElementById('createForm')) {
      document.getElementById('createForm').onsubmit = async (e) => {
        e.preventDefault();
        
        if (!selectedSupplier) {
          const searchVal = document.getElementById('cSupplierSearch').value.trim().toLowerCase();
          const matches = allProfiles.filter(p => 
            (p.company_name && p.company_name.toLowerCase().includes(searchVal)) || 
            (p.inn && p.inn.toLowerCase().includes(searchVal))
          );
          if (matches.length === 1) selectedSupplier = matches[0];
          else if (matches.length > 1) return alert('Найдено несколько пользователей. Выберите из списка.');
          else return alert('Поставщик не найден.');
        }

        const selectedTypes = Array.from(document.querySelectorAll('#cSupplyTypesGroup input:checked')).map(cb => cb.value);
        if (selectedTypes.length === 0) return alert('Выберите хотя бы один тип поставки');
        if (!validateBookingTextLengths(
          document.getElementById('cDoc').value,
          document.getElementById('cComment').value
        )) return;

        const btn = document.getElementById('btnCreate');
        btn.innerText = 'Загрузка...'; btn.disabled = true;

        const fileInput = document.getElementById('cRegistryFile');
        const file = fileInput.files[0];
        let fileUrl = null;

        if (file) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
          const filePath = `${selectedSupplier.id}/${Date.now()}_${safeName}`;
          try {
            fileUrl = await window.registryStorage.upload(file, filePath);
          } catch (uploadError) {
            alert(`Ошибка загрузки файла: ${uploadError.message || 'проверьте формат и размер файла'}`);
            btn.innerText = 'Записать поставщика'; btn.disabled = false;
            return;
          }
        }

        const payload = {
          profile_id: selectedSupplier.id,
          slot_date: selectedDate,
          slot_hour: parseInt(document.getElementById('cHour').value),
          supply_types: selectedTypes,
          order_type: resolveOrderTypeForUpdate('cOrderType', 'order'),
          order_number: document.getElementById('cDoc').value.trim(),
          registry_file_url: fileUrl,
          is_tk: isTkCreateModal,
          comment: document.getElementById('cComment').value.trim(),
          status: 'active'
        };

        const { error } = await sb.from('bookings').insert([payload]);
        if (error) alert('Ошибка записи: ' + error.message);
        else window.location.reload();
      };
    }
  }
});
