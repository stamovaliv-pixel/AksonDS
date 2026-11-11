/* Аксон ДокСлот — оперативная доска смены с перетаскиванием карточек между воротами. */
document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  const sb = window.supabaseClient;
  const $ = (id) => document.getElementById(id);
  const allowedRoles = ['operator', 'admin', 'super_admin', 'viewer'];
  const orderTypes = { order: 'Заказ', upd: 'УПД', etrn: 'ЭТрН' };
  const pageMessage = $('shiftPageMessage');
  const toast = $('shiftToast');

  if (!sb) {
    showPageError('Не удалось подключиться к Supabase. Обновите страницу.');
    return;
  }

  let toastTimer = null;
  let bookings = [];
  let supplyTypes = {};
  let selectedBookingId = null;
  let selectedDate = getMoscowTodayISO();
  let todayISO = selectedDate;
  let startHour = 9;
  let endHour = 16;
  let currentRole = '';
  let currentUser = null;
  let dragDropRoles = ['super_admin'];
  let dragSettingsLoaded = false;
  let hasLoadedBookings = false;
  let isRefreshing = false;
  let activeRefreshDate = null;
  let refreshSequence = 0;
  let dragBookingId = null;
  let panelError = '';

  function showPageError(message) {
    if (!pageMessage) return;
    pageMessage.textContent = String(message || 'Не удалось выполнить операцию.');
    pageMessage.hidden = false;
  }

  function clearPageError() {
    if (!pageMessage) return;
    pageMessage.textContent = '';
    pageMessage.hidden = true;
  }

  function showToast(message, isError = false) {
    if (!toast) return;
    toast.textContent = String(message || '');
    toast.classList.toggle('is-error', Boolean(isError));
    toast.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3600);
  }

  function getMoscowTodayISO() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function getMoscowHour() {
    const value = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow', hour: '2-digit', hourCycle: 'h23'
    }).format(new Date());
    return Number(value);
  }

  function getMoscowTimeLabel() {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(new Date());
  }

  function formatRussianDate(dateISO) {
    const date = new Date(`${dateISO}T12:00:00+03:00`);
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }).format(date);
  }

  function shiftDateByDays(dateISO, amount) {
    const [year, month, day] = String(dateISO).split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + amount, 12));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function getDateBounds() {
    return { min: shiftDateByDays(todayISO, -30), max: shiftDateByDays(todayISO, 29) };
  }

  function normalizeGate(value) {
    return String(value ?? '').trim().toLocaleLowerCase('ru-RU');
  }

  function displayGate(value) {
    return String(value ?? '').trim();
  }

  function getBookingCompany(booking) {
    const profile = Array.isArray(booking?.profiles) ? booking.profiles[0] : booking?.profiles;
    return String(profile?.company_name || 'Неизвестно');
  }

  function getBookingInn(booking) {
    const profile = Array.isArray(booking?.profiles) ? booking.profiles[0] : booking?.profiles;
    return String(profile?.inn || '—');
  }

  function getBookingTypes(booking) {
    const raw = Array.isArray(booking?.supply_types) && booking.supply_types.length
      ? booking.supply_types
      : (booking?.supply_type ? [booking.supply_type] : []);
    return raw.map(type => supplyTypes[type] || String(type)).filter(Boolean);
  }

  function getBookingStatus(booking) {
    const arrived = Boolean(booking?.arrival_time);
    const departed = Boolean(booking?.departure_time);
    if (departed && !arrived) return { key: 'departed-missing', label: 'Убыл · Нет прибытия', group: 'departed' };
    if (departed) return { key: 'departed', label: 'Убыл', group: 'departed' };
    if (arrived) return { key: 'arrived', label: 'На территории', group: 'arrived' };
    const isLate = selectedDate === todayISO && getMoscowHour() > Number(booking?.slot_hour);
    if (isLate) return { key: 'late', label: 'Опаздывает', group: 'late' };
    return { key: 'expected', label: 'Ожидается', group: 'expected' };
  }

  function isDragAllowed() {
    return currentRole === 'super_admin' || (currentRole !== 'viewer' && dragDropRoles.includes(currentRole));
  }

  function isEditable() {
    return ['operator', 'admin', 'super_admin'].includes(currentRole);
  }

  function setCurrentDateLabels() {
    $('shiftDateSubtitle').textContent = formatRussianDate(selectedDate);
    $('shiftDateCaption').textContent = selectedDate === todayISO ? 'Сегодня · оперативная доска смены РЦ' : 'Выбранный день · оперативная доска смены РЦ';
    $('shiftDateInput').value = selectedDate;
    const bounds = getDateBounds();
    $('shiftDateInput').min = bounds.min;
    $('shiftDateInput').max = bounds.max;
    $('shiftYesterday').disabled = shiftDateByDays(selectedDate, -1) < bounds.min;
    $('shiftTomorrow').disabled = shiftDateByDays(selectedDate, 1) > bounds.max;
    $('shiftToday').classList.toggle('is-current', selectedDate === todayISO);
  }

  function setUpdatedAt() {
    $('shiftUpdatedAt').textContent = `Обновлено ${getMoscowTimeLabel()} МСК`;
  }

  function renderSummary() {
    const counts = { expected: 0, arrived: 0, departed: 0, late: 0 };
    bookings.forEach(booking => { counts[getBookingStatus(booking).group] += 1; });
    $('countExpected').textContent = String(counts.expected);
    $('countArrived').textContent = String(counts.arrived);
    $('countDeparted').textContent = String(counts.departed);
    $('countLate').textContent = String(counts.late);
    $('lateTabCount').textContent = String(counts.late);
    $('shiftLateSubtitle').textContent = `${counts.late} ${counts.late === 1 ? 'поставка' : (counts.late > 1 && counts.late < 5 ? 'поставки' : 'поставок')}`;
  }

  function createBookingCard(booking, options = {}) {
    const { mobile = false, enableDrag = false } = options;
    const status = getBookingStatus(booking);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `shift-booking-card status-${status.key}`;
    card.dataset.bookingId = String(booking.id);
    card.setAttribute('aria-label', `${getBookingCompany(booking)}, заказ ${booking.order_number || 'без номера'}, ${status.label}`);
    const canDragHere = enableDrag && isDragAllowed() && !window.matchMedia('(max-width: 767px)').matches;
    card.draggable = Boolean(canDragHere);
    if (canDragHere) card.title = 'Перетащите карточку в колонку нужных ворот';

    const top = document.createElement('span');
    top.className = 'shift-card-top';
    const company = document.createElement('span');
    company.className = 'shift-card-company';
    company.textContent = getBookingCompany(booking);
    top.append(company);
    if (canDragHere) {
      const handle = document.createElement('span');
      handle.className = 'shift-drag-handle';
      handle.textContent = '⠿';
      handle.setAttribute('aria-hidden', 'true');
      top.append(handle);
    }
    card.append(top);

    const order = document.createElement('span');
    order.className = 'shift-card-order';
    order.textContent = `Заказ №${booking.order_number || '—'}`;
    card.append(order);

    const meta = document.createElement('span');
    meta.className = 'shift-card-meta';
    const types = getBookingTypes(booking);
    if (types.length) addMeta(meta, types.join(', '));
    if (booking.is_tk) addMeta(meta, 'ТК');
    addMeta(meta, booking.registry_file_url ? 'Реестр: есть' : 'Реестр: нет');
    card.append(meta);

    if (mobile) {
      const gate = document.createElement('span');
      gate.className = 'shift-card-gate-mobile';
      gate.textContent = displayGate(booking.gate_number) || 'Без ворот';
      top.append(gate);
    }

    const statusText = document.createElement('span');
    statusText.className = 'shift-card-status';
    const statusLabel = document.createElement('span');
    statusLabel.className = 'shift-card-status-text';
    statusLabel.textContent = status.label;
    statusText.append(statusLabel);
    card.append(statusText);
    return card;
  }

  function addMeta(container, text) {
    const item = document.createElement('span');
    item.textContent = text;
    container.append(item);
  }

  function getGateColumns() {
    const gates = new Map();
    bookings.forEach(booking => {
      const value = displayGate(booking.gate_number);
      const key = normalizeGate(value);
      if (key && !gates.has(key)) {
        gates.set(key, value);
      }
    });
    const columns = [...gates.entries()].map(([key, value]) => ({ key, value, label: value }));
    columns.sort((a, b) => a.label.localeCompare(b.label, 'ru-RU', { numeric: true, sensitivity: 'base' }));
    // Отдельная служебная колонка позволяет и увидеть записи без ворот, и снять
    // назначение перетаскиванием даже тогда, когда все ворота уже распределены.
    columns.push({ key: '', value: null, label: 'Без ворот' });
    return columns;
  }

  function createGridCell(gate, hour) {
    const cell = document.createElement('div');
    cell.className = 'shift-grid-cell shift-door-cell';
    cell.dataset.gateKey = gate.key;
    cell.dataset.gateValue = gate.value || '';
    // Подсказку для колонки «Без ворот» показываем один раз, а не в каждой строке.
    if (!gate.key && hour === startHour) {
      const note = document.createElement('div');
      note.className = 'shift-no-gate-note';
      const hasAssignedGates = bookings.some(b => normalizeGate(b.gate_number));
      const hasUnassignedBookings = bookings.some(b => !normalizeGate(b.gate_number));
      note.textContent = !hasAssignedGates ? 'Ворота ещё не назначены' : (hasUnassignedBookings ? 'Есть записи без ворот' : 'Перетащите сюда, чтобы снять назначение');
      cell.append(note);
    }
    return cell;
  }

  function renderDesktopGrid() {
    const grid = $('shiftGrid');
    grid.replaceChildren();
    const gates = getGateColumns();
    grid.style.setProperty('--door-count', String(gates.length));
    grid.style.minWidth = `${72 + gates.length * 205}px`;

    const header = document.createElement('div');
    header.className = 'shift-grid-header';
    const hourHeader = document.createElement('div');
    hourHeader.className = 'shift-grid-header-cell';
    hourHeader.textContent = 'Час';
    header.append(hourHeader);
    gates.forEach(gate => {
      const cell = document.createElement('div');
      cell.className = 'shift-grid-header-cell';
      cell.textContent = gate.label;
      header.append(cell);
    });
    grid.append(header);

    for (let hour = startHour; hour <= endHour; hour += 1) {
      const row = document.createElement('div');
      row.className = 'shift-grid-row';
      const hourCell = document.createElement('div');
      hourCell.className = 'shift-grid-hour';
      hourCell.textContent = `${String(hour).padStart(2, '0')}:00`;
      row.append(hourCell);
      gates.forEach(gate => {
        const cell = createGridCell(gate, hour);
        const hourBookings = bookings
          .filter(booking => Number(booking.slot_hour) === hour && normalizeGate(booking.gate_number) === gate.key)
          .sort((a, b) => String(a.order_number || '').localeCompare(String(b.order_number || ''), 'ru-RU', { numeric: true }));
        hourBookings.forEach(booking => cell.append(createBookingCard(booking, { enableDrag: true })));
        row.append(cell);
      });
      grid.append(row);
    }
  }

  function renderMobileHours() {
    const container = $('shiftMobileHours');
    container.replaceChildren();
    const byHour = new Map();
    bookings.forEach(booking => {
      const hour = Number(booking.slot_hour);
      if (hour < startHour || hour > endHour) return;
      if (!byHour.has(hour)) byHour.set(hour, []);
      byHour.get(hour).push(booking);
    });
    [...byHour.keys()].sort((a, b) => a - b).forEach(hour => {
      const section = document.createElement('section');
      section.className = 'shift-mobile-hour';
      const title = document.createElement('div');
      title.className = 'shift-mobile-hour-title';
      title.textContent = `${String(hour).padStart(2, '0')}:00`;
      section.append(title);
      const list = document.createElement('div');
      list.className = 'shift-mobile-hour-cards';
      byHour.get(hour).sort((a, b) => String(a.order_number || '').localeCompare(String(b.order_number || ''), 'ru-RU', { numeric: true }))
        .forEach(booking => list.append(createBookingCard(booking, { mobile: true })));
      section.append(list);
      container.append(section);
    });
  }

  function renderOutsideHours() {
    const outside = bookings.filter(booking => Number(booking.slot_hour) < startHour || Number(booking.slot_hour) > endHour);
    $('shiftOutsideHours').hidden = outside.length === 0;
    const list = $('shiftOutsideHoursCards');
    list.replaceChildren();
    outside.forEach(booking => {
      const card = createBookingCard(booking);
      card.draggable = false;
      const meta = document.createElement('span');
      meta.className = 'shift-card-meta';
      meta.textContent = `Час записи: ${booking.slot_hour}:00`;
      card.append(meta);
      list.append(card);
    });
  }

  function renderLateList() {
    const late = bookings.filter(booking => getBookingStatus(booking).group === 'late');
    const list = $('shiftLateList');
    list.replaceChildren();
    late.forEach(booking => {
      const card = createBookingCard(booking, { mobile: true });
      const gate = document.createElement('span');
      gate.className = 'shift-card-meta';
      gate.textContent = `Ворота: ${displayGate(booking.gate_number) || 'не назначены'} · Запись на ${String(booking.slot_hour).padStart(2, '0')}:00`;
      card.append(gate);
      list.append(card);
    });
    $('shiftLateEmpty').hidden = late.length > 0;
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value == null || value === '' ? '—' : String(value);
  }

  function renderPanel() {
    const booking = bookings.find(row => String(row.id) === String(selectedBookingId));
    const panelContent = $('shiftPanelContent');
    const panelEmpty = $('shiftPanelEmpty');
    if (!booking) {
      selectedBookingId = null;
      panelContent.hidden = true;
      panelContent.replaceChildren();
      panelEmpty.hidden = false;
      return;
    }

    panelEmpty.hidden = true;
    panelContent.hidden = false;
    panelContent.innerHTML = `
      <div class="shift-panel-heading"><div><h3 id="panelCompany"></h3><p class="shift-panel-subtitle" id="panelOrder"></p></div><button type="button" class="shift-panel-close" id="panelClose" aria-label="Закрыть детали">×</button></div>
      <div class="shift-panel-status" id="panelStatus"></div>
      <div class="shift-detail-grid">
        <div class="shift-detail-item"><span class="shift-detail-label">ИНН</span><span class="shift-detail-value" id="panelInn"></span></div>
        <div class="shift-detail-item"><span class="shift-detail-label">Тип документа</span><span class="shift-detail-value" id="panelOrderType"></span></div>
        <div class="shift-detail-item"><span class="shift-detail-label">Типы поставки</span><span class="shift-detail-value" id="panelSupplyTypes"></span></div>
        <div class="shift-detail-item"><span class="shift-detail-label">Транспортная компания</span><span class="shift-detail-value" id="panelTk"></span></div>
        <div class="shift-detail-item full"><span class="shift-detail-label">Реестр</span><span class="shift-detail-value" id="panelRegistry"></span></div>
      </div>
      <div class="shift-comment" id="panelComment"></div>
      <div class="shift-panel-divider"></div>
      <h4 class="shift-panel-section-title">Оперативные отметки</h4>
      <div class="shift-edit-grid">
        <label class="shift-edit-field">Прибытие<input type="time" id="panelArrival" step="60"></label>
        <label class="shift-edit-field">Убытие<input type="time" id="panelDeparture" step="60"></label>
        <label class="shift-edit-field full">Ворота<input type="text" id="panelGate" maxlength="40" autocomplete="off" placeholder="Например, 1"></label>
      </div>
      <div class="shift-panel-actions"><button type="button" class="shift-save-button" id="panelSave">Сохранить отметки</button><a class="shift-open-day" id="panelOpenDay">Открыть день →</a></div>
      <div class="shift-panel-error" id="panelError" role="alert" aria-live="polite"></div>`;

    setText('panelCompany', getBookingCompany(booking));
    setText('panelOrder', `Заказ №${booking.order_number || '—'} · Час ${String(booking.slot_hour).padStart(2, '0')}:00`);
    setText('panelInn', getBookingInn(booking));
    setText('panelOrderType', orderTypes[booking.order_type] || booking.order_type || '—');
    setText('panelSupplyTypes', getBookingTypes(booking).join(', ') || '—');
    setText('panelTk', booking.is_tk ? 'Да' : 'Нет');
    setText('panelComment', booking.comment || 'Комментарий отсутствует');
    const status = getBookingStatus(booking);
    $('panelStatus').textContent = status.label;
    $('panelStatus').className = `shift-panel-status status-${status.key}`;
    $('panelArrival').value = booking.arrival_time ? String(booking.arrival_time).slice(0, 5) : '';
    $('panelDeparture').value = booking.departure_time ? String(booking.departure_time).slice(0, 5) : '';
    $('panelGate').value = displayGate(booking.gate_number);
    $('panelOpenDay').href = `admin_day.html?date=${encodeURIComponent(selectedDate)}`;
    $('panelClose').addEventListener('click', () => { selectedBookingId = null; renderPanel(); });

    const canEdit = isEditable();
    ['panelArrival', 'panelDeparture', 'panelGate'].forEach(id => { $(id).disabled = !canEdit; });
    $('panelSave').hidden = !canEdit;
    $('panelSave').addEventListener('click', savePanelChanges);
    $('panelError').textContent = panelError;

    const registry = $('panelRegistry');
    registry.replaceChildren();
    if (booking.registry_file_url) {
      registry.append(document.createTextNode('Есть · '));
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = 'Подготавливаем ссылку…';
      link.setAttribute('aria-disabled', 'true');
      link.addEventListener('click', event => {
        if (link.getAttribute('aria-disabled') === 'true') event.preventDefault();
      });
      registry.append(link);
      // Получаем подписанную ссылку заранее: к моменту клика обычный переход
      // откроет файл без блокировки всплывающего окна браузером.
      window.registryStorage.signedUrl(booking.registry_file_url).then(url => {
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Открыть реестр';
        link.removeAttribute('aria-disabled');
      }).catch(error => {
        link.textContent = 'Не удалось открыть';
        showToast(`Не удалось открыть реестр: ${error.message || 'ошибка Storage'}`, true);
      });
    } else {
      registry.textContent = 'Нет';
    }
  }

  function renderAll({ preservePanel = false } = {}) {
    setCurrentDateLabels();
    renderSummary();
    const empty = bookings.length === 0;
    $('shiftEmptyState').hidden = !empty;
    $('shiftBoardLayout').hidden = empty;
    $('shiftSettingsTrigger').hidden = currentRole !== 'super_admin';
    if (!empty) {
      renderDesktopGrid();
      renderMobileHours();
      renderOutsideHours();
      renderLateList();
      if (!preservePanel) renderPanel();
      const hasAssignedGates = bookings.some(booking => normalizeGate(booking.gate_number));
      $('shiftBoardHint').textContent = !hasAssignedGates
        ? 'Ворота ещё не назначены'
        : (isDragAllowed()
          ? 'Перетаскивание меняет только ворота — час записи остаётся прежним'
          : 'Карточки сгруппированы по часу записи и воротам');
    } else {
      $('shiftLateList').replaceChildren();
      $('shiftLateEmpty').hidden = false;
      $('shiftPanelContent').hidden = true;
    }
  }

  function updateTimeBasedStatuses() {
    if (!hasLoadedBookings) return;
    renderSummary();
    document.querySelectorAll('.shift-booking-card[data-booking-id]').forEach(card => {
      const booking = bookings.find(row => String(row.id) === card.dataset.bookingId);
      if (!booking) return;
      const status = getBookingStatus(booking);
      card.classList.remove('status-expected', 'status-arrived', 'status-late', 'status-departed', 'status-departed-missing');
      card.classList.add(`status-${status.key}`);
      const label = card.querySelector('.shift-card-status-text');
      if (label) label.textContent = status.label;
      card.setAttribute('aria-label', `${getBookingCompany(booking)}, заказ ${booking.order_number || 'без номера'}, ${status.label}`);
    });
    if (selectedBookingId) {
      const status = getBookingStatus(bookings.find(row => String(row.id) === String(selectedBookingId)) || {});
      const panelStatus = $('panelStatus');
      if (panelStatus) {
        panelStatus.textContent = status.label;
        panelStatus.className = `shift-panel-status status-${status.key}`;
      }
    }
  }

  function checkGateConflict(bookingId, proposedGate, proposedDeparture) {
    const normalizedGate = normalizeGate(proposedGate);
    if (!normalizedGate || proposedDeparture) return null;
    return bookings.find(row =>
      String(row.id) !== String(bookingId) &&
      normalizeGate(row.gate_number) === normalizedGate &&
      !row.departure_time
    ) || null;
  }

  function gateConflictMessage(gate) {
    return `Ворота ${gate} уже заняты другой поставкой. После указания времени убытия ворота освободятся.`;
  }

  function timeForDatabase(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return null;
    return /^\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
  }

  async function updateBooking(booking, payload) {
    const nextGate = Object.prototype.hasOwnProperty.call(payload, 'gate_number') ? displayGate(payload.gate_number) : displayGate(booking.gate_number);
    const nextDeparture = Object.prototype.hasOwnProperty.call(payload, 'departure_time') ? payload.departure_time : booking.departure_time;
    if (nextGate && !nextDeparture) {
      const conflict = checkGateConflict(booking.id, nextGate, nextDeparture);
      if (conflict) throw new Error(gateConflictMessage(nextGate));
    }
    const { data, error } = await sb.from('bookings')
      .update(payload)
      .eq('id', booking.id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error('Изменение не подтверждено базой данных. Проверьте права UPDATE/SELECT для этой записи.');
    Object.assign(booking, payload);
    panelError = '';
    return booking;
  }

  async function savePanelChanges() {
    const booking = bookings.find(row => String(row.id) === String(selectedBookingId));
    if (!booking || !isEditable()) return;
    const button = $('panelSave');
    const payload = {
      arrival_time: timeForDatabase($('panelArrival').value),
      departure_time: timeForDatabase($('panelDeparture').value),
      gate_number: displayGate($('panelGate').value) || null
    };
    button.disabled = true;
    button.textContent = 'Сохраняем…';
    try {
      await updateBooking(booking, payload);
      panelError = '';
      showToast('Оперативные отметки сохранены.');
      renderAll();
      setUpdatedAt();
    } catch (error) {
      panelError = error.message || 'Не удалось сохранить изменения.';
      // До ответа базы локальные значения не считаются сохранёнными:
      // при отказе возвращаем исходные отметки из последней загруженной записи.
      $('panelArrival').value = booking.arrival_time ? String(booking.arrival_time).slice(0, 5) : '';
      $('panelDeparture').value = booking.departure_time ? String(booking.departure_time).slice(0, 5) : '';
      $('panelGate').value = displayGate(booking.gate_number);
      const message = $('panelError');
      if (message) message.textContent = panelError;
      showToast(panelError, true);
      button.disabled = false;
      button.textContent = 'Сохранить отметки';
    }
  }

  async function assignGate(bookingId, gateValue) {
    const booking = bookings.find(row => String(row.id) === String(bookingId));
    if (!booking || !isDragAllowed()) return;
    const newGate = displayGate(gateValue) || null;
    const oldGate = displayGate(booking.gate_number);
    if (normalizeGate(newGate) === normalizeGate(oldGate)) return;
    const conflict = checkGateConflict(booking.id, newGate, booking.departure_time);
    if (conflict) {
      showToast(gateConflictMessage(newGate), true);
      return;
    }
    try {
      await updateBooking(booking, { gate_number: newGate });
      showToast(newGate ? `Поставка назначена на ворота ${newGate}.` : 'Ворота для поставки сняты.');
      renderAll();
      setUpdatedAt();
    } catch (error) {
      showToast(error.message || 'Не удалось изменить ворота.', true);
    }
  }

  function setupDragAndDrop() {
    const grid = $('shiftGrid');
    grid.addEventListener('dragstart', event => {
      const card = event.target.closest('.shift-booking-card[data-booking-id]');
      if (!card || !isDragAllowed() || window.matchMedia('(max-width: 767px)').matches) {
        event.preventDefault();
        return;
      }
      dragBookingId = card.dataset.bookingId;
      card.classList.add('is-dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragBookingId);
      }
    });
    grid.addEventListener('dragend', () => {
      dragBookingId = null;
      grid.querySelectorAll('.is-dragging').forEach(node => node.classList.remove('is-dragging'));
      grid.querySelectorAll('.is-drop-target,.is-drop-invalid').forEach(node => node.classList.remove('is-drop-target', 'is-drop-invalid'));
    });
    grid.addEventListener('dragover', event => {
      const cell = event.target.closest('.shift-door-cell');
      if (!cell || !dragBookingId || !isDragAllowed()) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      grid.querySelectorAll('.is-drop-target,.is-drop-invalid').forEach(node => node.classList.remove('is-drop-target', 'is-drop-invalid'));
      const gate = cell.dataset.gateValue || null;
      const booking = bookings.find(row => String(row.id) === dragBookingId);
      const conflict = booking ? checkGateConflict(booking.id, gate, booking.departure_time) : null;
      cell.classList.add(conflict ? 'is-drop-invalid' : 'is-drop-target');
    });
    grid.addEventListener('dragleave', event => {
      const cell = event.target.closest('.shift-door-cell');
      if (cell && !cell.contains(event.relatedTarget)) cell.classList.remove('is-drop-target', 'is-drop-invalid');
    });
    grid.addEventListener('drop', async event => {
      const cell = event.target.closest('.shift-door-cell');
      if (!cell || !dragBookingId || !isDragAllowed()) return;
      event.preventDefault();
      const id = dragBookingId;
      const gate = cell.dataset.gateValue || null;
      dragBookingId = null;
      cell.classList.remove('is-drop-target', 'is-drop-invalid');
      grid.querySelectorAll('.is-dragging').forEach(node => node.classList.remove('is-dragging'));
      await assignGate(id, gate);
    });
  }

  function selectBookingFromClick(event) {
    const card = event.target.closest('.shift-booking-card[data-booking-id]');
    if (!card) return;
    selectedBookingId = card.dataset.bookingId;
    panelError = '';
    renderPanel();
    const panel = $('shiftDetailPanel');
    if (window.matchMedia('(max-width: 1099px)').matches && panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  async function loadDay({ silent = false } = {}) {
    const requestDate = selectedDate;
    if (isRefreshing && activeRefreshDate === requestDate) return;
    isRefreshing = true;
    activeRefreshDate = requestDate;
    const requestId = ++refreshSequence;
    try {
      const { data, error } = await sb.from('bookings')
        .select('id, profile_id, slot_date, slot_hour, order_number, order_type, supply_type, supply_types, arrival_time, departure_time, gate_number, is_tk, comment, registry_file_url, status, profiles(company_name, inn)')
        .eq('slot_date', requestDate)
        .eq('status', 'active')
        .order('slot_hour', { ascending: true });
      if (error) throw error;
      if (requestId !== refreshSequence || requestDate !== selectedDate) return;
      bookings = Array.isArray(data) ? data : [];
      hasLoadedBookings = true;
      if (selectedBookingId && !bookings.some(row => String(row.id) === String(selectedBookingId))) selectedBookingId = null;
      const focusedPanelField = ['panelArrival', 'panelDeparture', 'panelGate'].includes(document.activeElement?.id);
      clearPageError();
      setUpdatedAt();
      renderAll({ preservePanel: focusedPanelField && Boolean(selectedBookingId) });
    } catch (error) {
      if (requestId !== refreshSequence || requestDate !== selectedDate) return;
      console.error('Shift board refresh failed:', error);
      if (hasLoadedBookings) {
        showPageError('Не удалось обновить. Показаны последние успешно загруженные данные.');
      } else if (!silent) {
        showPageError(`Не удалось загрузить записи: ${error.message || 'ошибка Supabase'}`);
      } else {
        showPageError('Не удалось обновить.');
      }
    } finally {
      if (requestId === refreshSequence) {
        isRefreshing = false;
        activeRefreshDate = null;
      }
    }
  }

  async function loadShiftSettings() {
    const { data, error } = await sb.from('app_settings')
      .select('slot_start_hour, slot_end_hour, supply_types')
      .eq('id', 1)
      .single();
    if (error) throw error;
    if (!data) throw new Error('В app_settings не найдены настройки РЦ.');
    startHour = Number(data.slot_start_hour ?? 9);
    endHour = Number(data.slot_end_hour ?? 16);
    if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || endHour > 23 || startHour > endHour) {
      throw new Error('В app_settings указаны некорректные часы смены.');
    }
    supplyTypes = {};
    (Array.isArray(data.supply_types) ? data.supply_types : []).forEach(item => {
      if (item?.id != null) supplyTypes[item.id] = item.name || String(item.id);
    });
  }

  async function loadDragDropSettings() {
    if (currentRole === 'super_admin') $('shiftSettingsTrigger').hidden = false;
    const { data, error } = await sb.from('shift_board_settings')
      .select('drag_drop_roles')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) {
      dragDropRoles = ['super_admin'];
      dragSettingsLoaded = false;
      if (currentRole === 'super_admin') {
        $('shiftSettingsMessage').textContent = 'Не найдена настройка доступа. Выполните SQL-файл из патча.';
      }
      return;
    }
    dragDropRoles = Array.isArray(data.drag_drop_roles) ? [...new Set(data.drag_drop_roles)] : ['super_admin'];
    if (!dragDropRoles.includes('super_admin')) dragDropRoles.push('super_admin');
    dragSettingsLoaded = true;
  }

  function setupSettingsPanel() {
    const trigger = $('shiftSettingsTrigger');
    trigger.addEventListener('click', () => {
      // Панель находится в области доски; сначала вернёмся на эту вкладку,
      // чтобы настройки не открывались внутри скрытого таб-панеля.
      $('shiftBoardTab').click();
      $('shiftSettingsPanel').hidden = false;
      $('dragRoleOperator').checked = dragDropRoles.includes('operator');
      $('dragRoleAdmin').checked = dragDropRoles.includes('admin');
      $('shiftSettingsMessage').textContent = dragSettingsLoaded ? '' : 'Проверьте установку SQL-настройки доступа.';
    });
    $('shiftSettingsClose').addEventListener('click', () => { $('shiftSettingsPanel').hidden = true; });
    $('shiftSettingsSave').addEventListener('click', async () => {
      if (currentRole !== 'super_admin') return;
      const roles = ['super_admin'];
      if ($('dragRoleOperator').checked) roles.push('operator');
      if ($('dragRoleAdmin').checked) roles.push('admin');
      const button = $('shiftSettingsSave');
      button.disabled = true;
      button.textContent = 'Сохраняем…';
      $('shiftSettingsMessage').textContent = '';
      try {
        const { data, error } = await sb.from('shift_board_settings')
          .update({ drag_drop_roles: roles, updated_at: new Date().toISOString(), updated_by: currentUser.id })
          .eq('id', 1)
          .select('id')
          .maybeSingle();
        if (error) throw error;
        if (!data?.id) throw new Error('Настройка не обновлена. Проверьте права UPDATE в таблице shift_board_settings.');
        dragDropRoles = roles;
        dragSettingsLoaded = true;
        $('shiftSettingsMessage').textContent = 'Настройки доступа сохранены.';
        $('shiftSettingsMessage').style.color = '#43866b';
        $('shiftSettingsPanel').hidden = true;
        renderAll();
        showToast('Доступ к перетаскиванию обновлён.');
      } catch (error) {
        $('shiftSettingsMessage').textContent = error.message || 'Не удалось сохранить доступ.';
        $('shiftSettingsMessage').style.color = '#bf4545';
      } finally {
        button.disabled = false;
        button.textContent = 'Сохранить доступ';
      }
    });
  }

  function setupTabs() {
    const boardTab = $('shiftBoardTab');
    const lateTab = $('shiftLateTab');
    boardTab.addEventListener('click', () => {
      boardTab.classList.add('is-active');
      boardTab.setAttribute('aria-selected', 'true');
      lateTab.classList.remove('is-active');
      lateTab.setAttribute('aria-selected', 'false');
      $('shiftBoardTabPanel').hidden = false;
      $('shiftLateTabPanel').hidden = true;
    });
    lateTab.addEventListener('click', () => {
      lateTab.classList.add('is-active');
      lateTab.setAttribute('aria-selected', 'true');
      boardTab.classList.remove('is-active');
      boardTab.setAttribute('aria-selected', 'false');
      $('shiftBoardTabPanel').hidden = true;
      $('shiftLateTabPanel').hidden = false;
    });
  }

  async function changeDate(nextDate) {
    const { min, max } = getDateBounds();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(nextDate)) || nextDate < min || nextDate > max) {
      showToast('Можно открыть период от 30 дней назад до 29 дней вперёд.', true);
      setCurrentDateLabels();
      return;
    }
    if (nextDate === selectedDate) return;
    selectedDate = nextDate;
    selectedBookingId = null;
    bookings = [];
    hasLoadedBookings = false;
    panelError = '';
    clearPageError();
    $('shiftBoardTab').classList.add('is-active');
    $('shiftBoardTab').setAttribute('aria-selected', 'true');
    $('shiftLateTab').classList.remove('is-active');
    $('shiftLateTab').setAttribute('aria-selected', 'false');
    $('shiftBoardTabPanel').hidden = false;
    $('shiftLateTabPanel').hidden = true;
    $('shiftEmptyState').hidden = true;
    $('shiftBoardLayout').hidden = true;
    setCurrentDateLabels();
    await loadDay();
  }

  function setupDateControls() {
    $('shiftYesterday').addEventListener('click', () => changeDate(shiftDateByDays(selectedDate, -1)));
    $('shiftTomorrow').addEventListener('click', () => changeDate(shiftDateByDays(selectedDate, 1)));
    $('shiftToday').addEventListener('click', () => changeDate(todayISO));
    $('shiftDateInput').addEventListener('change', event => changeDate(event.target.value));
  }

  // Доступ к доске определяется проверенным профилем, а не значением из localStorage.
  const authProfile = await window.dockslotGetAuthProfile?.();
  currentUser = authProfile?.user || null;
  const profile = authProfile?.profile || null;
  if (!currentUser) {
    window.location.replace('../index.html');
    return;
  }
  if (authProfile?.error || !profile || profile.is_blocked || !allowedRoles.includes(String(profile.role || '').toLowerCase())) {
    window.location.replace('../index.html');
    return;
  }
  currentRole = String(profile.role).toLowerCase();
  if (currentRole === 'viewer') document.body.classList.add('role-viewer');

  todayISO = getMoscowTodayISO();
  selectedDate = todayISO;
  setupTabs();
  setupDateControls();
  setupDragAndDrop();
  setupSettingsPanel();
  $('shiftGrid').addEventListener('click', selectBookingFromClick);
  $('shiftMobileHours').addEventListener('click', selectBookingFromClick);
  $('shiftLateList').addEventListener('click', selectBookingFromClick);
  $('shiftOutsideHoursCards').addEventListener('click', selectBookingFromClick);

  try {
    await loadShiftSettings();
    await loadDragDropSettings();
    setCurrentDateLabels();
    await loadDay();
  } catch (error) {
    console.error('Shift board initialization failed:', error);
    showPageError(`Не удалось открыть рабочий стол: ${error.message || 'ошибка загрузки настроек РЦ'}`);
    return;
  }

  // Данные тихо обновляются только при видимой вкладке. Последние загруженные строки
  // сохраняются в памяти при временной ошибке сети или Supabase.
  setInterval(() => {
    todayISO = getMoscowTodayISO();
    if (!document.hidden) loadDay({ silent: true });
    updateTimeBasedStatuses();
    setCurrentDateLabels();
  }, 60000);

  // Опоздание пересчитывается по московскому часу независимо от сетевого обновления.
  setInterval(() => {
    todayISO = getMoscowTodayISO();
    updateTimeBasedStatuses();
    setCurrentDateLabels();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      todayISO = getMoscowTodayISO();
      loadDay({ silent: true });
      updateTimeBasedStatuses();
      setCurrentDateLabels();
    }
  });
});
