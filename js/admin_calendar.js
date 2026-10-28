document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;
  const escapeHtml = window.escapeHtml;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  const { data: profile, error: profileError } = await sb.from('profiles').select('role, is_blocked').eq('id', user.id).single();
  if (profileError || !profile || profile.is_blocked || !['admin', 'operator', 'viewer'].includes(profile.role)) {
    return window.location.href = 'calendar.html';
  }

  const isAdmin = profile.role === 'admin';
  const isOperator = profile.role === 'operator';
  const isViewer = profile.role === 'viewer';
  const canViewPastBookings = isAdmin || isOperator || isViewer;
  
  if (isViewer) document.body.classList.add('role-viewer');

  const pastToggle = document.getElementById('showPastBtn');
  const pastToggleIcon = document.getElementById('showPastIcon');
  const exportRegistryButton = document.getElementById('exportRegistryBtn');
  const calendarGrid = document.getElementById('calendarGrid');
  const selectedExportDates = new Set();
  let dateSelectionMode = false;

  const syncPastToggleIcon = () => {
    if (!pastToggleIcon || !pastToggle) return;
    pastToggleIcon.classList.toggle('is-active', pastToggle.checked);
    pastToggleIcon.setAttribute('aria-pressed', String(pastToggle.checked));
  };
  const syncExportButton = () => {
    if (!exportRegistryButton) return;
    exportRegistryButton.classList.toggle('is-active', dateSelectionMode);
    exportRegistryButton.classList.toggle('is-pulsing', dateSelectionMode && selectedExportDates.size > 0);
    exportRegistryButton.setAttribute('aria-pressed', String(dateSelectionMode));
    exportRegistryButton.title = dateSelectionMode && selectedExportDates.size > 0
      ? 'Нажмите, чтобы скачать общий реестр выбранных дней'
      : 'Выгрузить общий реестр';
  };
  const syncSelectedDateCell = (date) => {
    if (!calendarGrid) return;
    const cell = [...calendarGrid.querySelectorAll('.day-cell')].find(item => item.dataset.date === date);
    if (!cell) return;
    const checked = selectedExportDates.has(date);
    cell.classList.toggle('selected-for-export', checked);
    const checkbox = cell.querySelector('.day-select-check');
    if (checkbox) checkbox.checked = checked;
    syncExportButton();
  };
  const setSelectedExportDate = (date, selected) => {
    if (selected) selectedExportDates.add(date);
    else selectedExportDates.delete(date);
    syncSelectedDateCell(date);
  };
  if (canViewPastBookings && pastToggle) {
    const pastToggleContainer = document.getElementById('adminPastToggleContainer');
    if (pastToggleContainer) pastToggleContainer.style.display = 'flex';
    syncPastToggleIcon();
  }

  document.getElementById('logoutBtn').onclick = async (e) => {
    e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html';
  };

  // Оптимизация: Кэширование настроек
  async function getSettings() {
    const cached = sessionStorage.getItem('app_settings');
    if (cached) return JSON.parse(cached);
    const { data } = await sb.from('app_settings').select('slot_start_hour, slot_end_hour, available_days, supply_types').eq('id', 1).single();
    if (data) sessionStorage.setItem('app_settings', JSON.stringify(data));
    return data || {};
  }
  
  const settingsData = await getSettings();
  const settings = {
    slot_start_hour: settingsData.slot_start_hour ?? 9,
    slot_end_hour: settingsData.slot_end_hour ?? 17,
    available_days: settingsData.available_days ?? [1, 2, 3, 4, 5, 6, 7],
    supply_types: settingsData.supply_types ?? []
  };

  const styleBlock = document.createElement('style');
  styleBlock.innerHTML = `
    .day-cell.inactive::before { display: block !important; }
    .day-cell.inactive { background-color: #f1f5f9 !important; opacity: 0.5 !important; cursor: pointer !important; pointer-events: auto !important; }
  `;
  document.head.appendChild(styleBlock);

  const getSupplyIcon = (id, name) => {
    const n = (name || '').toLowerCase();
    if (id === 'orders_im' || n.includes('им')) return '📦';
    if (id === 'return' || n.includes('возврат')) return '↩️';
    if (id === 'mix' || n.includes('микс')) return '🔀';
    if (n.includes('сток')) return '🏭';
    if (n.includes('кросс')) return '🚚';
    return '🏷️'; 
  };

  const filterSupplyType = document.getElementById('filterSupplyType');
  if (filterSupplyType && settings.supply_types) {
    filterSupplyType.replaceChildren();
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'Все типы';
    filterSupplyType.appendChild(allOption);
    settings.supply_types.forEach(st => {
      const option = document.createElement('option');
      option.value = String(st.id ?? '');
      option.textContent = String(st.name || '');
      filterSupplyType.appendChild(option);
    });
  }

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
      label.append(checkbox, document.createTextNode(` ${getSupplyIcon(checkbox.value, String(st.name || ''))} ${String(st.name || '')}`));
      el.appendChild(label);
    });
  };
  fillCheckboxes('mSupplyTypesGroup');

  const mHourSelect = document.getElementById('mHour');
  if (mHourSelect) {
    mHourSelect.innerHTML = '';
    for (let h = settings.slot_start_hour; h <= settings.slot_end_hour; h++) {
      mHourSelect.innerHTML += `<option value="${h}">${h}:00 - ${h+1}:00</option>`;
    }
  }

  const today = new Date();
  today.setHours(0,0,0,0);
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
  const normalizeSupplyTypeName = (value) => String(value || '').trim().toLocaleLowerCase('ru-RU');
  const isReturnSupplyType = (value) => {
    const type = (settings.supply_types || []).find(item => String(item.id ?? '') === String(value ?? ''));
    return String(value || '').toLowerCase() === 'return' || normalizeSupplyTypeName(type?.name || value).includes('возврат');
  };
  const extractVzuDocuments = (comment) => {
    const source = String(comment || '');
    const matcher = /(^|[^А-ЯЁа-яёA-Za-z0-9])(ВЗУ\s*[-–—:]?\s*(?:№\s*)?\d[\d -]*)/gi;
    const result = [];
    let match;
    while ((match = matcher.exec(source)) !== null) {
      const phrase = String(match[2] || '').replace(/[\s.,;:!?]+$/g, '').trim();
      const numberMatch = phrase.match(/ВЗУ\s*[-–—:]?\s*(?:№\s*)?([\d][\d -]*)/i);
      const documentNumber = numberMatch ? numberMatch[1].replace(/[\s-]+$/g, '').trim() : '';
      if (documentNumber) result.push(`ВЗУ - ${documentNumber}`);
      if (!match[0].length) matcher.lastIndex++;
    }
    return [...new Set(result)];
  };
  const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const formatCsvDate = (isoDate) => {
    const [year, month, day] = String(isoDate || '').split('-');
    return year && month && day ? `${day}.${month}.${year}` : String(isoDate || '');
  };

  async function exportConsolidatedRegistry() {
    if (!(isAdmin || isOperator)) return;
    const selectedDates = [...selectedExportDates].sort();
    if (!selectedDates.length) {
      alert('Сначала отметьте хотя бы один день в календаре.');
      return;
    }

    const filterSupplier = document.getElementById('filterSupplier')?.value.trim() || '';
    const filterDoc = document.getElementById('filterDoc')?.value.trim() || '';
    const filterSupply = document.getElementById('filterSupplyType')?.value || '';
    const filterOrder = document.getElementById('filterOrderType')?.value || '';

    let query = sb.from('bookings')
      .select('id, profile_id, slot_date, slot_hour, order_number, order_type, supply_type, supply_types, comment, profiles!inner(company_name, inn)')
      .eq('status', 'active')
      .in('slot_date', selectedDates);
    if (filterDoc) query = query.ilike('order_number', `%${filterDoc}%`);
    if (filterOrder) query = query.eq('order_type', filterOrder);
    if (filterSupplier) query = query.or(`company_name.ilike.%${filterSupplier}%,inn.ilike.%${filterSupplier}%`, { foreignTable: 'profiles' });
    if (filterSupply) query = query.contains('supply_types', JSON.stringify([filterSupply]));

    exportRegistryButton?.classList.add('is-exporting');
    if (exportRegistryButton) exportRegistryButton.disabled = true;
    try {
      const { data, error } = await query;
      if (error) throw error;
      const bookings = (data || []).slice().sort((a, b) =>
        String(a.slot_date).localeCompare(String(b.slot_date)) ||
        Number(a.slot_hour) - Number(b.slot_hour) ||
        String(Array.isArray(a.profiles) ? a.profiles[0]?.company_name : a.profiles?.company_name).localeCompare(
          String(Array.isArray(b.profiles) ? b.profiles[0]?.company_name : b.profiles?.company_name), 'ru'
        )
      );
      if (!bookings.length) {
        alert('За выбранные дни по текущим фильтрам записи не найдены.');
        return;
      }

      const returnFilterSelected = Boolean(filterSupply) && isReturnSupplyType(filterSupply);
      const rows = [[
        'Порядковый номер',
        'Наименование поставщика',
        'Дата слота',
        'Время слота',
        'Номер документа',
        'Комментарий'
      ]];
      bookings.forEach((booking, index) => {
        const profile = Array.isArray(booking.profiles) ? (booking.profiles[0] || {}) : (booking.profiles || {});
        const companyName = profile.company_name || '';
        const hour = Number(booking.slot_hour);
        const time = Number.isFinite(hour) ? `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00` : '';
        const bookingTypes = booking.supply_types?.length ? booking.supply_types : [booking.supply_type].filter(Boolean);
        const rowIsReturn = returnFilterSelected;
        const documentNumber = rowIsReturn
          ? extractVzuDocuments(booking.comment).join(', ')
          : String(booking.order_number || '');
        rows.push([
          index + 1,
          companyName,
          formatCsvDate(booking.slot_date),
          time,
          documentNumber,
          booking.comment || ''
        ]);
      });

      // Semicolon delimiters and UTF-8 BOM make the Cyrillic CSV open cleanly in Excel with Russian locale.
      const csvContent = '\uFEFF' + rows.map(row => row.map(csvEscape).join(';')).join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `obshchiy_reestr_${getBusinessTodayISODate()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      dateSelectionMode = false;
      selectedExportDates.clear();
      syncExportButton();
      renderCalendar();
    } catch (error) {
      alert(`Не удалось выгрузить общий реестр: ${error?.message || 'ошибка запроса'}`);
    } finally {
      exportRegistryButton?.classList.remove('is-exporting');
      if (exportRegistryButton) exportRegistryButton.disabled = false;
    }
  }

  let currentEditBooking = null;

  const mRegistryFile = document.getElementById('mRegistryFile');
  const mRegistryFileName = document.getElementById('mRegistryFileName');
  const mRegistryEditHint = document.getElementById('mRegistryEditHint');
  if (mRegistryFile && mRegistryFileName) {
    mRegistryFile.addEventListener('change', () => {
      mRegistryFileName.textContent = mRegistryFile.files?.[0]?.name || 'Выбрать новый реестр';
      mRegistryFileName.style.color = mRegistryFile.files?.length ? '#059669' : '#334155';
    });
  }
  const maxActiveDate = new Date(today);
  maxActiveDate.setDate(today.getDate() + 29);

  const renderCalendar = async () => {
    const filterSupplier = document.getElementById('filterSupplier').value.trim();
    const filterDoc = document.getElementById('filterDoc').value.trim();
    const filterSupply = document.getElementById('filterSupplyType').value;
    const filterOrder = document.getElementById('filterOrderType').value;
    const showPast = canViewPastBookings && pastToggle && pastToggle.checked;

    const isSearchActive = filterSupplier !== '' || filterDoc !== '' || filterSupply !== '' || filterOrder !== '';

    let query = sb.from('bookings').select('id, profile_id, slot_date, slot_hour, order_number, order_type, supply_type, supply_types, is_tk, comment, registry_file_url, profiles!inner(company_name, inn)').eq('status', 'active');
    
    if (filterDoc) query = query.ilike('order_number', `%${filterDoc}%`);
    if (filterOrder) query = query.eq('order_type', filterOrder);
    if (filterSupplier) query = query.or(`company_name.ilike.%${filterSupplier}%,inn.ilike.%${filterSupplier}%`, { foreignTable: 'profiles' });
    
    if (filterSupply) {
  query = query.contains('supply_types', JSON.stringify([filterSupply]));
}

    const { data: bookings } = await query;
    const bookingCountsByDate = new Map();
    (bookings || []).forEach((booking) => {
      const dateKey = String(booking.slot_date || '');
      if (!dateKey) return;
      bookingCountsByDate.set(dateKey, (bookingCountsByDate.get(dateKey) || 0) + 1);
    });
    const bookedDates = new Set(bookingCountsByDate.keys());

    const startDate = new Date(today);
    let totalDays = 35;
    if (showPast) {
      // Start with the earliest requested date (30 days before today), then align the first
      // calendar column to Monday so dates never shift under the wrong weekday header.
      const firstRequestedDate = new Date(today);
      firstRequestedDate.setDate(firstRequestedDate.getDate() - 30);
      const leadingDays = firstRequestedDate.getDay() === 0 ? 6 : firstRequestedDate.getDay() - 1;
      startDate.setTime(firstRequestedDate.getTime());
      startDate.setDate(startDate.getDate() - leadingDays);
      // Keep the former right edge (today + 29 days) and finish on Sunday so the grid has full weeks.
      totalDays = Math.ceil((60 + leadingDays) / 7) * 7;
    } else {
      const diffToMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
      startDate.setDate(today.getDate() - diffToMonday);
    }
    const grid = document.getElementById('calendarGrid');
    if (grid) {
      grid.classList.toggle('is-selecting', dateSelectionMode);
      grid.innerHTML = '';
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const isoDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        
        const isPastOrFuture = d < today || d > maxActiveDate;
        const jsDay = d.getDay();
        const dbDay = jsDay === 0 ? 7 : jsDay;
        const isAllowedDay = settings.available_days.includes(dbDay);
        
        if (isPastOrFuture || !isAllowedDay) cell.classList.add('inactive');
        const bookingCount = bookingCountsByDate.get(isoDate) || 0;
        if (bookingCount > 0) cell.classList.add('booked', 'has-booking-count');
        const countBadge = bookingCount > 0
          ? `<span class="day-count-badge" aria-label="Записей: ${bookingCount}" title="Записей: ${bookingCount}">${bookingCount > 99 ? '99+' : bookingCount}</span>`
          : '';
        cell.dataset.date = isoDate;
        cell.innerHTML = `<div class="date-text">${d.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit'})}</div>${countBadge}`;
        if (dateSelectionMode && (isAdmin || isOperator)) {
          const dateCheckbox = document.createElement('input');
          dateCheckbox.type = 'checkbox';
          dateCheckbox.className = 'day-select-check';
          dateCheckbox.checked = selectedExportDates.has(isoDate);
          dateCheckbox.setAttribute('aria-label', `Выбрать ${isoDate} для общего реестра`);
          dateCheckbox.title = 'Включить день в общий реестр';
          dateCheckbox.addEventListener('click', event => event.stopPropagation());
          dateCheckbox.addEventListener('change', event => {
            event.stopPropagation();
            setSelectedExportDate(isoDate, dateCheckbox.checked);
          });
          cell.appendChild(dateCheckbox);
          if (selectedExportDates.has(isoDate)) cell.classList.add('selected-for-export');
        }
        cell.onclick = () => {
          if (dateSelectionMode && (isAdmin || isOperator)) {
            setSelectedExportDate(isoDate, !selectedExportDates.has(isoDate));
          } else {
            window.location.href = `admin_day.html?date=${isoDate}`;
          }
        };
        
        grid.appendChild(cell);
      }
    }

    const listContainer = document.getElementById('upcomingBookingsList');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    if (!isSearchActive) {
      for (let i = 0; i < 7; i++) {
        listContainer.innerHTML += `<div class="booking-item empty"><div style="color: #94a3b8; font-size: 13px; font-weight: 500;">Введите параметры поиска</div></div>`;
      }
      return; 
    }

    const upcoming = (bookings || []).filter(b => new Date(b.slot_date) >= today).sort((a, b) => new Date(a.slot_date) - new Date(b.slot_date) || a.slot_hour - b.slot_hour).slice(0, 14);

    if (upcoming.length === 0) {
      listContainer.innerHTML = `<div style="grid-column: 1 / -1; color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 20px;">По вашему запросу ничего не найдено.</div>`;
    } else {
      const dict = {}; 
      if (settings.supply_types) {
        settings.supply_types.forEach(st => dict[st.id] = st.name);
      }

      upcoming.forEach(b => {
        const typesArr = b.supply_types?.length ? b.supply_types : [b.supply_type];
        const iconsHtml = typesArr.map(t => {
          const name = dict[t] || t;
          return `<span title="${escapeHtml(name)}">${getSupplyIcon(t, name)}</span>`;
        }).join(' ');

        const item = document.createElement('div');
        item.className = 'booking-item';
        
        const dataStr = encodeURIComponent(JSON.stringify({
          id: b.id, profileId: b.profile_id, date: b.slot_date, hour: b.slot_hour, doc: b.order_number,
          sTypesRaw: b.supply_types || [b.supply_type], oTypeRaw: b.order_type,
          is_tk: b.is_tk, comment: b.comment, registry_file_url: b.registry_file_url,
          fullCompany: `${b.profiles.company_name} (ИНН: ${b.profiles.inn})`
        }));
        
        const compName = b.profiles.company_name || 'Неизвестно';
        const dateFormatted = new Date(b.slot_date).toLocaleDateString('ru-RU');
        const timeFormatted = `${b.slot_hour}:00 - ${b.slot_hour + 1}:00`;
        
        item.innerHTML = `
          <div class="bi-company" title="${escapeHtml(compName)}">${escapeHtml(compName)}</div>
          <div class="bi-top">
            <span>${dateFormatted}</span>
            <span>${timeFormatted}</span>
          </div>
          <div class="bi-bottom">
            <div class="bi-icons">${iconsHtml}</div>
          </div>
        `;
        
        item.onclick = () => openEditModal(dataStr);
        listContainer.appendChild(item);
      });
    }
  };

  const editModal = document.getElementById('editModal');
  const closeEditModalBtn = document.getElementById('closeEditModal');
  if (closeEditModalBtn) closeEditModalBtn.onclick = () => editModal.style.display = 'none';

  function openEditModal(dataStr) {
    const data = JSON.parse(decodeURIComponent(dataStr));
    currentEditBooking = data;
    if (mRegistryFile) {
      mRegistryFile.value = '';
      mRegistryFile.disabled = !canEditRegistryForDate(data.date);
    }
    if (mRegistryFileName) {
      mRegistryFileName.textContent = canEditRegistryForDate(data.date) ? 'Выбрать новый реестр' : 'Редактирование реестра закрыто';
      mRegistryFileName.style.color = canEditRegistryForDate(data.date) ? '#334155' : '#94a3b8';
    }
    if (mRegistryEditHint) {
      mRegistryEditHint.textContent = canEditRegistryForDate(data.date)
        ? 'Реестр можно заменить до конца дня приезда.'
        : 'Срок изменения реестра истёк: разрешено только до конца дня приезда.';
    }
    document.getElementById('mId').value = data.id;
    document.getElementById('mDate').value = data.date;
    document.getElementById('mHour').value = data.hour;
    document.getElementById('mDoc').value = data.doc;
    document.getElementById('mOrderType').value = ['order', 'upd', 'etrn'].includes(data.oTypeRaw) ? data.oTypeRaw : 'order';
    document.getElementById('mCompany').innerText = data.fullCompany;
    document.getElementById('mIsTk').checked = data.is_tk || false;
    document.getElementById('mComment').value = data.comment || '';
    
    const fileLink = document.getElementById('mFileLink');
    if (fileLink) {
      if (data.registry_file_url) {
        fileLink.removeAttribute('href');
        fileLink.style.display = 'inline-block';
        window.registryStorage.signedUrl(data.registry_file_url).then(url => {
          fileLink.href = url;
          fileLink.target = '_blank';
          fileLink.rel = 'noopener noreferrer';
        }).catch(() => { fileLink.style.display = 'none'; });
      } else {
        fileLink.style.display = 'none';
      }
    }

    document.querySelectorAll('#mSupplyTypesGroup input').forEach(cb => {
      cb.checked = data.sTypesRaw.includes(cb.value);
    });
    
    editModal.style.display = 'flex';
  }

  if (!isViewer) {
    const btnUpdate = document.getElementById('btnUpdate');
    if (btnUpdate) {
      btnUpdate.onclick = async () => {
        if (!confirm('Подтверждаете изменение записи?')) return;
        
        const selectedTypes = Array.from(document.querySelectorAll('#mSupplyTypesGroup input:checked')).map(cb => cb.value);
        if (selectedTypes.length === 0) return alert('Выберите хотя бай один тип поставки');
        if (!validateBookingTextLengths(
          document.getElementById('mDoc').value,
          document.getElementById('mComment').value
        )) return;

        const payload = {
          slot_date: document.getElementById('mDate').value,
          slot_hour: parseInt(document.getElementById('mHour').value),
          order_number: document.getElementById('mDoc').value.trim(),
          supply_types: selectedTypes,
          is_tk: document.getElementById('mIsTk').checked,
          comment: document.getElementById('mComment').value.trim()
        };
        // Always send a valid enum member; blank HTML select values must never reach PostgreSQL.
        payload.order_type = resolveOrderTypeForUpdate('mOrderType', currentEditBooking?.oTypeRaw);

        const replacementFile = mRegistryFile?.files?.[0];
        let uploadedRegistryPath = null;
        if (replacementFile) {
          const targetDate = document.getElementById('mDate').value;
          if (!currentEditBooking || !canEditRegistryForDate(currentEditBooking.date) || !canEditRegistryForDate(targetDate)) {
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
        
        const { error } = await sb.from('bookings').update(payload).eq('id', document.getElementById('mId').value);
        if (error) {
          if (uploadedRegistryPath) await sb.storage.from('registries').remove([uploadedRegistryPath]);
          alert('Ошибка обновления: ' + error.message);
        } else { editModal.style.display = 'none'; renderCalendar(); }
      };
    }

    const btnDelete = document.getElementById('btnDelete');
    if (btnDelete) {
      btnDelete.onclick = async () => {
        if (!confirm('ВНИМАНИЕ! Вы точно хотите удалить эту запись поставщика?')) return;
        const { error } = await sb.from('bookings').delete().eq('id', document.getElementById('mId').value);
        if (error) alert('Ошибка удаления: ' + error.message);
        else { editModal.style.display = 'none'; renderCalendar(); }
      };
    }
  }

  const applyBtn = document.getElementById('applyFiltersBtn');
  const resetBtn = document.getElementById('resetFiltersBtn');
  if (applyBtn) applyBtn.onclick = renderCalendar;
  if (resetBtn) resetBtn.onclick = () => {
    document.getElementById('filterSupplier').value = '';
    document.getElementById('filterDoc').value = '';
    document.getElementById('filterSupplyType').value = '';
    document.getElementById('filterOrderType').value = '';
    renderCalendar();
  };
  if (pastToggle) pastToggle.onchange = () => {
    syncPastToggleIcon();
    renderCalendar();
  };
  if (pastToggleIcon && pastToggle && canViewPastBookings) {
    pastToggleIcon.onclick = () => {
      pastToggle.checked = !pastToggle.checked;
      pastToggle.dispatchEvent(new Event('change', { bubbles: true }));
    };
  }
  if (exportRegistryButton && (isAdmin || isOperator)) {
    exportRegistryButton.onclick = async () => {
      if (!dateSelectionMode) {
        dateSelectionMode = true;
        selectedExportDates.clear();
        syncExportButton();
        await renderCalendar();
        return;
      }
      if (selectedExportDates.size > 0) {
        await exportConsolidatedRegistry();
        return;
      }
      // Click again before selecting any date to leave selection mode.
      dateSelectionMode = false;
      selectedExportDates.clear();
      syncExportButton();
      await renderCalendar();
    };
  }

  syncExportButton();
  renderCalendar();
});
