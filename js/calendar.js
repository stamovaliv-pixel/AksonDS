document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    window.location.href = '../index.html';
    return;
  }

  // ОПТИМИЗАЦИЯ: Кэширование глобальных настроек
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
  if (!settings || Object.keys(settings).length === 0) return console.error('Не удалось загрузить настройки');

  // Принудительно показываем цветные полоски даже для неактивных дней
  const styleBlock = document.createElement('style');
  styleBlock.innerHTML = `
    .day-cell.inactive::before { display: block !important; }
    .day-cell.inactive { background-color: #f1f5f9 !important; opacity: 0.5 !important; cursor: not-allowed !important; pointer-events: none !important; }
    .day-cell.inactive.booked { pointer-events: auto !important; cursor: pointer !important; }
  `;
  document.head.appendChild(styleBlock);

  const calendarGrid = document.getElementById('calendarGrid');
  const upcomingList = document.getElementById('upcomingBookingsList');
  
  const modal = document.getElementById('bookingDetailsModal');
  const closeBtn = document.getElementById('closeDetailsModalBtn');
  const trashBtn = document.getElementById('deleteBookingBtn');
  const editBookingBtn = document.getElementById('editBookingBtn');
  const editModal = document.getElementById('calendarEditModal');
  const editForm = document.getElementById('calendarBookingForm');
  const editCloseBtn = document.getElementById('closeCalendarEditModalBtn');
  const calRegistryFile = document.getElementById('calRegistryFile');
  const calFileName = document.getElementById('calFileName');
  const calRegistryEditHint = document.getElementById('calRegistryEditHint');
  const calTkWrapper = document.getElementById('calTkWrapper');
  const calTkDot = document.getElementById('calTkDot');
  let currentBooking = null;
  let calendarIsTk = false;
  let currentRegistryPath = null;

  const businessTodayISO = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };
  const canEditRegistry = (dateString) => String(dateString || '') >= businessTodayISO();
  const formatIsoDate = (iso) => {
    const parts = String(iso || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return String(iso || '');
    return new Date(parts[0], parts[1] - 1, parts[2], 12).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const orderTypes = { order: 'Заказ', upd: 'УПД', etrn: 'ЭТрН' };
  const supplyTypeNames = {};
  (settings.supply_types || []).forEach(st => { supplyTypeNames[st.id] = st.name; });
  const getSupplyLabel = (booking) => {
    const ids = Array.isArray(booking.supply_types) && booking.supply_types.length ? booking.supply_types : [booking.supply_type].filter(Boolean);
    return ids.map(id => supplyTypeNames[id] || id).join(', ') || '—';
  };
  const setCalendarTk = (value) => {
    calendarIsTk = !!value;
    if (calTkDot) calTkDot.className = calendarIsTk ? 'tk-dot-modal active' : 'tk-dot-modal inactive';
    if (calTkWrapper) calTkWrapper.setAttribute('aria-pressed', calendarIsTk ? 'true' : 'false');
  };

  if (closeBtn) closeBtn.onclick = () => modal.style.display = 'none';
  if (editCloseBtn) editCloseBtn.onclick = () => editModal.style.display = 'none';
  window.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
    if (e.target === editModal) editModal.style.display = 'none';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modal) modal.style.display = 'none';
      if (editModal) editModal.style.display = 'none';
    }
  });

  // Render configurable supply-type options in the calendar's edit modal.
  const calTypesGroup = document.getElementById('calSupplyTypesGroup');
  if (calTypesGroup) {
    calTypesGroup.replaceChildren();
    (settings.supply_types || []).forEach(st => {
      const label = document.createElement('label');
      label.style.cssText = 'display:flex;align-items:center;gap:7px;cursor:pointer;white-space:normal;';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = String(st.id); cb.style.cssText = 'width:16px;height:16px;';
      label.append(cb, document.createTextNode(`${String(st.name || st.id)}`));
      calTypesGroup.appendChild(label);
    });
  }
  if (calTkWrapper) {
    calTkWrapper.addEventListener('click', () => setCalendarTk(!calendarIsTk));
    calTkWrapper.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCalendarTk(!calendarIsTk); }
    });
  }
  if (calRegistryFile && calFileName) calRegistryFile.addEventListener('change', () => {
    const file = calRegistryFile.files && calRegistryFile.files[0];
    calFileName.textContent = file ? file.name : (currentRegistryPath ? 'Файл прикреплён (нажмите, чтобы заменить)' : 'Загрузить реестр');
    calFileName.style.color = file ? '#10b981' : (currentRegistryPath ? '#10b981' : '#475569');
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const isoToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const countTo = new Date(today);
  countTo.setDate(countTo.getDate() + 35);
  const countToIso = `${countTo.getFullYear()}-${String(countTo.getMonth() + 1).padStart(2, '0')}-${String(countTo.getDate()).padStart(2, '0')}`;
  const [{ data: userBookings, error: bookingsError }, { data: bookingCounts, error: countsError }] = await Promise.all([
    sb.from('bookings')
      .select('id, slot_date, slot_hour, supply_type, supply_types, order_type, order_number, profile_id, registry_file_url, comment, is_tk, status')
      .eq('profile_id', user.id).eq('status', 'active').gte('slot_date', isoToday)
      .order('slot_date', { ascending: true }).order('slot_hour', { ascending: true }),
    sb.rpc('get_calendar_booking_counts', { p_from: isoToday, p_to: countToIso })
  ]);
  if (bookingsError || countsError) {
    console.error('Ошибка загрузки календаря:', bookingsError || countsError);
    alert('Не удалось загрузить доступность календаря. Обновите страницу.');
    return;
  }
  const bookedDates = new Set();
  userBookings.forEach(b => bookedDates.add(b.slot_date));

  const dateCapacities = {};
  (bookingCounts || []).forEach(row => { dateCapacities[row.slot_date] = Number(row.booking_count || 0); });

  const supplyTypes = {};
  if (settings.supply_types) {
    settings.supply_types.forEach(st => supplyTypes[st.id] = st.name);
  }

  if (upcomingList) {
    upcomingList.innerHTML = '';
    if (userBookings.length === 0) {
      upcomingList.innerHTML = '<div style="grid-column: 1 / -1; color: var(--color-text-muted); font-size: 14px;">У вас пока нет активных слотов.</div>';
    } else {
      const nextSeven = userBookings.slice(0, 7);
      nextSeven.forEach(booking => {
        const dateStr = formatIsoDate(booking.slot_date);
        const timeStr = `${booking.slot_hour}:00 - ${booking.slot_hour + 1}:00`;
        
        const supplyName = supplyTypes[booking.supply_type] || booking.supply_type;
        const orderName = orderTypes[booking.order_type] || booking.order_type;
        const orderNum = booking.order_number;
        
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'booking-item';
        item.title = 'Нажмите для просмотра и редактирования записи';
        item.setAttribute('aria-label', `Открыть запись ${dateStr}, ${timeStr}`);
        item.innerHTML = `<div class="booking-date">${dateStr}</div><div class="booking-time">${timeStr}</div><div class="booking-item-action">Подробнее</div>`;
        item.addEventListener('click', () => openBookingDetails(booking));
        upcomingList.appendChild(item);
      });
    }
  }

  function openBookingDetails(booking) {
    currentBooking = booking;
    const dateStr = formatIsoDate(booking.slot_date);
    const timeStr = `${booking.slot_hour}:00 - ${booking.slot_hour + 1}:00`;
    document.getElementById('modalDate').textContent = dateStr;
    document.getElementById('modalTime').textContent = timeStr;
    document.getElementById('modalType').textContent = getSupplyLabel(booking);
    document.getElementById('modalDoc').textContent = `${orderTypes[booking.order_type] || booking.order_type || 'Документ'} №${booking.order_number || '—'}`;
    document.getElementById('modalTk').textContent = booking.is_tk ? 'Да' : 'Нет';
    document.getElementById('modalComment').textContent = booking.comment || 'Нет комментария';
    const fileLink = document.getElementById('modalFileLink');
    if (fileLink) {
      fileLink.style.display = booking.registry_file_url ? 'inline-block' : 'none';
      fileLink.removeAttribute('href');
      if (booking.registry_file_url && window.registryStorage) {
        window.registryStorage.signedUrl(booking.registry_file_url).then(url => {
          if (currentBooking?.id === booking.id) { fileLink.href = url; fileLink.target = '_blank'; fileLink.rel = 'noopener noreferrer'; }
        }).catch(err => { console.error('Не удалось подготовить ссылку на реестр:', err); fileLink.style.display = 'none'; });
      }
    }
    if (editBookingBtn) {
      const allowed = canEditRegistry(booking.slot_date);
      editBookingBtn.style.display = allowed ? 'inline-flex' : 'none';
      editBookingBtn.disabled = !allowed;
      editBookingBtn.onclick = () => { modal.style.display = 'none'; openBookingEdit(booking); };
    }
    if (trashBtn) {
      trashBtn.onclick = async () => {
        if (!confirm(`Вы уверены, что хотите отменить запись на ${dateStr} (${timeStr})?`)) return;
        trashBtn.disabled = true;
        const { error } = await sb.from('bookings').delete().eq('id', booking.id).eq('profile_id', user.id);
        if (error) { alert('Ошибка при отмене: ' + error.message); trashBtn.disabled = false; }
        else window.location.reload();
      };
    }
    modal.style.display = 'flex';
  }

  function openBookingEdit(booking) {
    if (!canEditRegistry(booking.slot_date)) {
      alert('Редактирование реестра доступно до конца дня приезда.');
      return;
    }
    currentBooking = booking;
    currentRegistryPath = booking.registry_file_url || null;
    document.getElementById('calBookingModalTitle').textContent = 'Редактирование записи';
    document.getElementById('calOrderType').value = ['order', 'upd', 'etrn'].includes(booking.order_type) ? booking.order_type : 'order';
    document.getElementById('calOrderNumber').value = booking.order_number || '';
    document.getElementById('calBookingComment').value = booking.comment || '';
    document.querySelectorAll('#calSupplyTypesGroup input[type="checkbox"]').forEach(cb => {
      const selected = Array.isArray(booking.supply_types) && booking.supply_types.length ? booking.supply_types : [booking.supply_type].filter(Boolean);
      cb.checked = selected.includes(cb.value);
    });
    setCalendarTk(booking.is_tk);
    if (calRegistryFile) calRegistryFile.value = '';
    if (calFileName) {
      calFileName.textContent = currentRegistryPath ? 'Файл прикреплён (нажмите, чтобы заменить)' : 'Загрузить реестр';
      calFileName.style.color = currentRegistryPath ? '#10b981' : '#475569';
    }
    if (calRegistryEditHint) calRegistryEditHint.style.display = 'block';
    document.getElementById('calendarEditModal').style.display = 'flex';
  }

  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const booking = currentBooking;
      if (!booking || !booking.id || booking.profile_id !== user.id) {
        alert('Не удалось подтвердить владельца записи. Обновите страницу.');
        return;
      }
      if (!canEditRegistry(booking.slot_date)) {
        alert('Реестр можно изменить только до конца дня приезда.');
        return;
      }
      const selectedTypes = Array.from(document.querySelectorAll('#calSupplyTypesGroup input[type="checkbox"]:checked')).map(cb => cb.value);
      if (!selectedTypes.length) { alert('Выберите хотя бы один тип поставки.'); return; }
      const orderType = document.getElementById('calOrderType').value;
      if (!['order', 'upd', 'etrn'].includes(orderType)) { alert('Выберите допустимый тип документа.'); return; }
      const btn = document.getElementById('calSubmitBookingBtn');
      btn.disabled = true; btn.textContent = 'Сохранение...';
      let finalFilePath = currentRegistryPath;
      const file = calRegistryFile?.files?.[0];
      try {
        if (file) {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
          finalFilePath = await window.registryStorage.upload(file, `${user.id}/${Date.now()}_${safeName}`);
        }
        const payload = {
          supply_types: selectedTypes,
          order_type: orderType,
          order_number: document.getElementById('calOrderNumber').value.trim(),
          registry_file_url: finalFilePath,
          is_tk: calendarIsTk,
          comment: document.getElementById('calBookingComment').value.trim()
        };
        const { error } = await sb.from('bookings').update(payload).eq('id', booking.id).eq('profile_id', user.id).eq('status', 'active');
        if (error) throw error;
        editModal.style.display = 'none';
        window.location.reload();
      } catch (error) {
        console.error('Ошибка редактирования записи из календаря:', error);
        alert('Не удалось сохранить изменения: ' + (error.message || 'неизвестная ошибка'));
      } finally {
        btn.disabled = false; btn.textContent = 'Сохранить изменения';
      }
    });
  }

  if (calendarGrid) {
    calendarGrid.innerHTML = ''; 
    const diffToMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - diffToMonday);

    const endActiveDate = new Date(today);
    endActiveDate.setDate(today.getDate() + 29);
    const currentRealHour = new Date().getHours();
    const startHour = settings.slot_start_hour ?? 9;
    const endHour = settings.slot_end_hour ?? 17;
    const slotsPerHour = settings.slots_per_hour ?? 5;
    const maxCapacityPerDay = (endHour - startHour + 1) * slotsPerHour;

    for (let i = 0; i < 35; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      d.setHours(0, 0, 0, 0);

      const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayCell = document.createElement('div');
      
      let isActive = d >= today && d <= endActiveDate;
      const excludedDates = Array.isArray(settings.booking_excluded_dates) ? settings.booking_excluded_dates : [];
      const isExcludedDate = excludedDates.includes(isoDate);
      if (isExcludedDate) isActive = false;
      
      const jsDay = d.getDay();
      const dbDay = jsDay === 0 ? 7 : jsDay;
      if (settings.available_days && !settings.available_days.includes(dbDay)) {
        isActive = false; 
      }
      
      let isFull = (dateCapacities[isoDate] || 0) >= maxCapacityPerDay;
      if (isoDate === isoToday && currentRealHour >= endHour) isFull = true;

      let isClickable = false;

      if (!isActive) {
        dayCell.className = 'day-cell inactive';
      } else if (bookedDates.has(isoDate)) {
        dayCell.className = 'day-cell booked';
        isClickable = true;
      } else if (isFull) {
        dayCell.className = 'day-cell inactive';
      } else {
        dayCell.className = 'day-cell';
        isClickable = true;
      }

      if ((jsDay === 0 || jsDay === 6) && isActive && !isFull) {
        dayCell.style.backgroundColor = '#f8fafc';
      }

      dayCell.innerHTML = `<div class="date-text">${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}</div>`;
      if (isExcludedDate) {
        dayCell.title = 'Запись на эту дату закрыта администратором';
        dayCell.setAttribute('aria-label', `${d.toLocaleDateString('ru-RU')}: запись закрыта администратором`);
        dayCell.classList.add('date-excluded');
      }

      if (isClickable || bookedDates.has(isoDate)) {
        dayCell.addEventListener('click', () => {
          window.location.href = `day.html?date=${isoDate}`;
        });
      }

      calendarGrid.appendChild(dayCell);
    }
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
      e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html';
    });
  }
});
