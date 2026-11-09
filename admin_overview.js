document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) {
    window.location.href = '../index.html';
    return;
  }

  const $ = (id) => document.getElementById(id);
  const stateEl = $('overviewState');
  const toastEl = $('overviewToast');
  let toastTimer = null;
  let currentUser = null;
  let activeDetailBookingId = null;
  let verificationRealtimeChannels = [];
  let verificationRealtimeVersion = 0;
  let settings = { supply_types: [] };
  let bookings = [];
  let verifiedIds = new Set();
  let activeListKind = null;
  let notes = [];
  let reminders = [];
  let exportSelectionMode = false;
  let selectedExportKinds = new Set();
  let reminderCheckInterval = null;
  const sessionNotifiedReminders = new Set();
  const reminderNotificationStorageKey = () => `akson-dockslot-reminder-notified-${currentUser?.id || 'unknown'}`;

  const businessDate = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };

  const formatDate = (isoDate) => {
    if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate))) return '—';
    const [year, month, day] = String(isoDate).split('-');
    return `${day}.${month}.${year}`;
  };

  const formatTime = (hour) => {
    if (hour === null || hour === undefined || hour === '') return '—';
    return `${String(hour).padStart(2, '0')}:00`;
  };

  const showState = (message, isError = false) => {
    stateEl.textContent = message || '';
    stateEl.classList.toggle('is-visible', Boolean(message));
    stateEl.classList.toggle('is-error', Boolean(message) && isError);
  };

  const toast = (message, isError = false) => {
    toastEl.textContent = message;
    toastEl.classList.toggle('is-error', isError);
    toastEl.classList.add('is-visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove('is-visible'), 3200);
  };

  const createElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  };

  const addIconButton = (button, pathMarkup) => {
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${pathMarkup}</svg>`;
  };

  const getProfile = async () => {
    const authProfile = await window.dockslotGetAuthProfile?.();
    if (!authProfile?.user) {
      window.location.href = '../index.html';
      return null;
    }
    const profile = authProfile.profile;
    if (authProfile.error || !profile || profile.is_blocked) {
      await sb.auth.signOut();
      window.location.href = '../index.html';
      return null;
    }
    if (!['admin', 'super_admin'].includes(profile.role)) {
      window.location.href = ['operator', 'viewer'].includes(profile.role) ? 'admin_calendar.html' : 'calendar.html';
      return null;
    }
    currentUser = authProfile.user;
    return profile;
  };

  const loadSettings = async () => {
    const { data, error } = await sb.from('app_settings').select('supply_types').eq('id', 1).single();
    if (error) throw error;
    settings = data || { supply_types: [] };
    const select = $('supplyFilter');
    (settings.supply_types || []).forEach((item) => {
      const option = document.createElement('option');
      option.value = String(item.id);
      option.textContent = String(item.name || item.id);
      select.appendChild(option);
    });
  };

  // Рабочий стол по умолчанию показывает ближайший день с активными
  // записями, начиная с завтрашнего дня по бизнес-календарю РЦ (Europe/Moscow).
  // Считаем календарные дни через UTC, чтобы часовой пояс устройства
  // не сдвигал дату накануне/послезавтра.
  const addBusinessDays = (isoDate, amount) => {
    const date = new Date(`${isoDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  };

  const chooseDefaultDate = async () => {
    const firstSearchDate = addBusinessDays(businessDate(), 1);
    const { data, error } = await sb
      .from('bookings')
      .select('slot_date')
      .eq('status', 'active')
      .gte('slot_date', firstSearchDate)
      .order('slot_date', { ascending: true })
      .limit(1);
    if (error) throw error;
    return data?.[0]?.slot_date || '';
  };

  // Последняя выбранная дата рабочего стола хранится локально отдельно
  // для каждого пользователя и действует только в пределах текущего
  // московского календарного дня. Это не создаёт запросов к Supabase.
  const overviewDateStorageKey = () => `akson-dockslot-overview-date-${currentUser?.id || 'unknown'}`;

  const readOverviewDatePreference = (today) => {
    try {
      const raw = window.localStorage.getItem(overviewDateStorageKey());
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (saved?.businessDate !== today || typeof saved.selectedDate !== 'string') return null;
      if (saved.selectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(saved.selectedDate)) return null;
      return saved.selectedDate;
    } catch (error) {
      console.warn('Не удалось прочитать сохранённую дату рабочего стола:', error);
      return null;
    }
  };

  const saveOverviewDatePreference = (selectedDate) => {
    try {
      window.localStorage.setItem(overviewDateStorageKey(), JSON.stringify({
        businessDate: businessDate(),
        selectedDate: selectedDate || ''
      }));
    } catch (error) {
      // Недоступность localStorage не должна мешать работе рабочего стола.
      console.warn('Не удалось сохранить дату рабочего стола:', error);
    }
  };

  const getInitialOverviewDate = async () => {
    const today = businessDate();
    const savedDate = readOverviewDatePreference(today);
    if (savedDate !== null) return savedDate;
    const defaultDate = await chooseDefaultDate();
    saveOverviewDatePreference(defaultDate);
    return defaultDate;
  };

  const fetchBookingsForDate = async (date) => {
    if (!date) {
      bookings = [];
      verifiedIds = new Set();
      return;
    }
    const { data, error } = await sb
      .from('bookings')
      .select('id, profile_id, slot_date, slot_hour, order_number, order_type, supply_type, supply_types, is_tk, comment, registry_file_url, arrival_time, departure_time, gate_number, profiles!inner(company_name, inn)')
      .eq('status', 'active')
      .eq('slot_date', date)
      .order('slot_hour', { ascending: true });
    if (error) throw error;
    bookings = data || [];

    if (!bookings.length) {
      verifiedIds = new Set();
      return;
    }
    const { data: verificationRows, error: verificationError } = await sb
      .from('booking_verification')
      .select('booking_id, verified')
      .in('booking_id', bookings.map((booking) => booking.id));
    if (verificationError) throw verificationError;
    verifiedIds = new Set((verificationRows || [])
      .filter((item) => item.verified)
      .map((item) => String(item.booking_id)));
  };

  const getBookingSupplier = (booking) => {
    const profile = Array.isArray(booking.profiles) ? booking.profiles[0] : booking.profiles;
    return profile || {};
  };

  const getSupplyTypeValues = (booking) => {
    let values = Array.isArray(booking.supply_types) ? booking.supply_types : [];
    if (!values.length && Array.isArray(booking.supply_type)) values = booking.supply_type;
    if (!values.length && booking.supply_type !== null && booking.supply_type !== undefined && String(booking.supply_type).trim()) {
      values = [booking.supply_type];
    }
    return values.map((value) => {
      if (value && typeof value === 'object') return value.id ?? value.name ?? '';
      return value;
    }).map((value) => String(value ?? '').trim()).filter(Boolean);
  };

  const supplyTypeName = (value) => {
    const match = (settings.supply_types || []).find((item) => String(item.id) === String(value));
    return match?.name || String(value || '');
  };

  const getSupplyTypeLabel = (booking) => getSupplyTypeValues(booking).map(supplyTypeName).filter(Boolean).join(', ') || '—';

  const isReturnBooking = (booking) => getSupplyTypeValues(booking).some((value) => {
    const label = supplyTypeName(value).toLocaleLowerCase('ru-RU');
    return String(value).toLocaleLowerCase('ru-RU') === 'return' || label.includes('возврат');
  });

  const matchesCurrentFilters = (booking) => {
    const supplierFilter = $('supplierFilter').value.trim().toLocaleLowerCase('ru-RU');
    const docFilter = $('docFilter').value.trim().toLocaleLowerCase('ru-RU');
    const supplyFilter = $('supplyFilter').value;
    const orderFilter = $('orderFilter').value;
    const profile = getBookingSupplier(booking);
    const supplierText = `${profile.company_name || ''} ${profile.inn || ''}`.toLocaleLowerCase('ru-RU');
    const supplyMatches = !supplyFilter || getSupplyTypeValues(booking).some((value) => String(value) === supplyFilter);
    return (!supplierFilter || supplierText.includes(supplierFilter))
      && (!docFilter || String(booking.order_number || '').toLocaleLowerCase('ru-RU').includes(docFilter))
      && supplyMatches
      && (!orderFilter || booking.order_type === orderFilter);
  };

  const getFilteredBookings = () => bookings.filter(matchesCurrentFilters);

  const verificationIcon = (verified) => verified
    ? '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6m-11 1v6m-3-3 3 3 3-3"></path><path d="m9 15 2 2 4-4"></path>'
    : '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6M12 11v4m0 3h.01"></path>';

  const getListRows = (kind) => {
    const rows = getFilteredBookings();
    if (kind === 'unverified') return rows.filter((booking) => !verifiedIds.has(String(booking.id)));
    if (kind === 'returns') return rows.filter(isReturnBooking);
    return rows;
  };

  const orderTypeLabel = (type) => ({ order: 'Заказ', upd: 'УПД', etrn: 'ЭТрН' })[type] || type || '—';

  const renderBookingList = () => {
    if (!activeListKind) return;
    const list = $('bookingList');
    list.replaceChildren();
    const titleByKind = {
      all: 'Все записи',
      unverified: 'Неверифицированные записи',
      returns: 'Записи с типом поставки «Возврат»'
    };
    const rows = getListRows(activeListKind);
    $('listTitle').textContent = titleByKind[activeListKind];
    $('listSubtitle').textContent = `${formatDate($('dateFilter').value)} · ${rows.length} ${rows.length === 1 ? 'запись' : (rows.length > 1 && rows.length < 5 ? 'записи' : 'записей')}`;

    if (!rows.length) {
      list.appendChild(createElement('div', 'overview-empty', 'По выбранной дате и фильтрам записей нет.'));
      return;
    }

    rows.forEach((booking) => {
      const profile = getBookingSupplier(booking);
      const verified = verifiedIds.has(String(booking.id));
      const row = createElement('article', 'overview-booking-row');
      row.dataset.openBooking = String(booking.id);
      const hasArrival = Boolean(booking.arrival_time);
      const hasDeparture = Boolean(booking.departure_time);
      const arrivalIndicator = createElement('span', 'overview-arrival-indicator');
      let arrivalState = 'not-arrived';
      let arrivalHint = 'Не прибыл';
      if (hasArrival && hasDeparture) {
        arrivalState = 'completed';
        arrivalHint = 'Прибыл и убыл';
      } else if (hasArrival) {
        arrivalState = 'arrived';
        arrivalHint = 'Прибыл; ожидает отметки «Убыл»';
      } else if (hasDeparture) {
        arrivalState = 'partial';
        arrivalHint = 'Нет отметки «Прибыл»; отметка «Убыл» имеется';
      }
      row.classList.add(`has-arrival-state-${arrivalState}`);
      arrivalIndicator.title = arrivalHint;
      arrivalIndicator.setAttribute('aria-label', arrivalHint);
      arrivalIndicator.setAttribute('role', 'img');
      row.appendChild(arrivalIndicator);
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Открыть запись: ${profile.company_name || 'поставщик'}, ${formatDate(booking.slot_date)}, ${formatTime(booking.slot_hour)}`);
      row.title = 'Открыть подробности записи';

      const timeCell = createElement('div', 'overview-booking-main');
      timeCell.appendChild(createElement('strong', '', formatTime(booking.slot_hour)));
      timeCell.appendChild(createElement('span', '', formatDate(booking.slot_date)));

      const supplierCell = createElement('div', 'overview-booking-main');
      supplierCell.appendChild(createElement('strong', '', profile.company_name || 'Поставщик'));
      supplierCell.appendChild(createElement('span', '', `ИНН: ${profile.inn || '—'}`));

      const documentCell = createElement('div', 'overview-booking-main overview-booking-hide-mobile');
      documentCell.appendChild(createElement('strong', '', booking.order_number || 'Без номера'));
      documentCell.appendChild(createElement('span', '', `${orderTypeLabel(booking.order_type)} · ${getSupplyTypeLabel(booking)}`));

      const commentCell = createElement('div', 'overview-booking-comment overview-booking-hide-mobile', booking.comment || 'Комментарий не указан');
      commentCell.title = booking.comment || 'Комментарий не указан';

      const downloadButton = createElement('button', `overview-download-btn ${booking.registry_file_url ? 'has-file' : 'no-file'}`);
      downloadButton.type = 'button';
      downloadButton.disabled = !booking.registry_file_url;
      downloadButton.dataset.downloadRegistry = String(booking.id);
      downloadButton.title = booking.registry_file_url ? 'Скачать вложенный реестр' : 'Реестр не приложен';
      downloadButton.setAttribute('aria-label', downloadButton.title);
      addIconButton(downloadButton, '<path d="M14 2H6a2 2 0 0 0-2 2v16h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6M12 12v6m-3-3 3 3 3-3"></path>');

      const verifyButton = createElement('button', `overview-verify-btn ${verified ? 'is-verified' : 'is-unverified'}`);
      verifyButton.type = 'button';
      verifyButton.dataset.verifyBooking = String(booking.id);
      verifyButton.title = verified ? 'Снять верификацию' : 'Отметить запись верифицированной';
      verifyButton.setAttribute('aria-label', verifyButton.title);
      addIconButton(verifyButton, verificationIcon(verified));

      row.append(timeCell, supplierCell, documentCell, commentCell, downloadButton, verifyButton);
      list.appendChild(row);
    });
  };

  const setDetailText = (id, value) => {
    const node = $(id);
    if (node) node.textContent = value == null || value === '' ? '—' : String(value);
  };

  const openBookingDetails = (bookingId) => {
    activeDetailBookingId = String(bookingId);
    const booking = bookings.find((item) => String(item.id) === String(bookingId));
    if (!booking) return toast('Не удалось найти запись. Обновите список.', true);
    const profile = getBookingSupplier(booking);
    const hour = Number(booking.slot_hour);
    const slotTime = Number.isFinite(hour) ? `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00` : '—';
    setDetailText('detailSupplier', profile.company_name || 'Поставщик');
    setDetailText('detailInn', `ИНН: ${profile.inn || '—'}`);
    setDetailText('detailDate', formatDate(booking.slot_date));
    setDetailText('detailTime', slotTime);
    setDetailText('detailOrderType', orderTypeLabel(booking.order_type));
    setDetailText('detailOrderNumber', booking.order_number || 'Без номера');
    setDetailText('detailSupplyType', getSupplyTypeLabel(booking));
    setDetailText('detailArrival', booking.arrival_time ? String(booking.arrival_time).slice(0, 5) : '—');
    setDetailText('detailDeparture', booking.departure_time ? String(booking.departure_time).slice(0, 5) : '—');
    setDetailText('detailGate', booking.gate_number || '—');
    setDetailText('detailTk', booking.is_tk ? 'Да' : 'Нет');
    setDetailText('detailVerification', verifiedIds.has(String(booking.id)) ? 'Верифицирована' : 'Не верифицирована');
    setDetailText('detailComment', booking.comment || 'Комментарий не указан');
    $('detailOpenDay').href = `admin_day.html?date=${encodeURIComponent(booking.slot_date)}`;
    const registryButton = $('detailRegistryDownload');
    registryButton.disabled = !booking.registry_file_url;
    registryButton.dataset.downloadRegistry = String(booking.id);
    registryButton.title = booking.registry_file_url ? 'Скачать вложенный реестр' : 'Реестр не приложен';
    openDialog('bookingDetailsModal');
  };

  const downloadRegistry = async (bookingId, buttonElement = null) => {
    const booking = bookings.find((item) => String(item.id) === String(bookingId));
    if (!booking?.registry_file_url) return;
    const button = buttonElement || document.querySelector(`[data-download-registry="${CSS.escape(String(bookingId))}"]`);
    if (button) button.disabled = true;
    try {
      const storage = window.registryStorage;
      const path = storage?.normalizePath ? storage.normalizePath(booking.registry_file_url) : booking.registry_file_url;
      if (!path) throw new Error('Некорректный путь к реестру.');
      const { data, error } = await sb.storage.from('registries').createSignedUrl(path, 120, { download: true });
      if (error) throw error;
      if (!data?.signedUrl) throw new Error('Не удалось сформировать ссылку на скачивание.');
      const link = document.createElement('a');
      link.href = data.signedUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast('Ссылка на реестр подготовлена.');
    } catch (error) {
      console.error('Ошибка скачивания реестра:', error);
      toast(`Не удалось скачать реестр: ${error.message || 'ошибка хранилища'}`, true);
    } finally {
      if (button && button.isConnected) button.disabled = false;
    }
  };

  const renderOverview = (options = {}) => {
    const rows = getFilteredBookings();
    $('totalCount').textContent = String(rows.length);
    $('unverifiedCount').textContent = String(rows.filter((booking) => !verifiedIds.has(String(booking.id))).length);
    $('returnCount').textContent = String(rows.filter(isReturnBooking).length);
    $('dateCaption').textContent = $('dateFilter').value
      ? `Данные на ${formatDate($('dateFilter').value)}`
      : 'Нет будущих дат с активными записями';

    if (!options.keepState) {
      if (!$('dateFilter').value) {
        showState('На будущие даты активных записей пока нет. Выберите дату вручную, чтобы посмотреть записи за другой день.');
      } else if (!bookings.length) {
        showState(`На ${formatDate($('dateFilter').value)} активных записей нет.`);
      } else {
        showState('');
      }
    }
    if (activeListKind) renderBookingList();
  };

  const openList = (kind) => {
    const isSameVisibleList = activeListKind === kind && !$('listPanel').hidden;
    if (isSameVisibleList) {
      activeListKind = null;
      $('listPanel').hidden = true;
      document.querySelectorAll('.overview-metric[data-kind]').forEach((metric) => metric.setAttribute('aria-expanded', 'false'));
      return;
    }
    activeListKind = kind;
    $('listPanel').hidden = false;
    document.querySelectorAll('.overview-metric[data-kind]').forEach((metric) => metric.setAttribute('aria-expanded', String(metric.dataset.kind === kind)));
    renderBookingList();
    $('listPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const loadOverviewDate = async (date) => {
    $('applyBtn').disabled = true;
    $('dateFilter').disabled = true;
    try {
      await fetchBookingsForDate(date);
      await subscribeVerificationRealtime();
      renderOverview();
    } catch (error) {
      console.error('Ошибка загрузки обзора:', error);
      showState(`Не удалось загрузить записи: ${error.message || 'неизвестная ошибка'}`, true);
      bookings = [];
      verifiedIds = new Set();
      await subscribeVerificationRealtime();
      renderOverview({ keepState: true });
    } finally {
      $('applyBtn').disabled = false;
      $('dateFilter').disabled = false;
    }
  };

  const setExportSelectionMode = (enabled) => {
    exportSelectionMode = Boolean(enabled);
    if (!exportSelectionMode) selectedExportKinds.clear();
    $('overviewMetrics').classList.toggle('is-export-selecting', exportSelectionMode);
    $('exportBtn').classList.toggle('is-active', exportSelectionMode);
    $('exportBtn').classList.remove('is-pulsing');
    $('exportBtn').setAttribute('aria-pressed', String(exportSelectionMode));
    $('exportBtn').title = exportSelectionMode ? 'Выгрузить выбранные разделы' : 'Выбрать разделы для выгрузки';
    $('exportBtn').setAttribute('aria-label', $('exportBtn').title);
    document.querySelectorAll('.overview-export-choice').forEach((label) => { label.hidden = !exportSelectionMode; });
    document.querySelectorAll('[data-export-kind]').forEach((checkbox) => {
      checkbox.checked = false;
      checkbox.closest('.overview-metric-shell')?.classList.remove('is-selected');
    });
  };

  const updateExportSelectionState = () => {
    $('exportBtn').classList.toggle('is-pulsing', exportSelectionMode && selectedExportKinds.size > 0);
  };

  const exportCsv = (kinds) => {
    const filteredRows = getFilteredBookings();
    const selectedRows = new Map();
    if (kinds.has('all')) filteredRows.forEach((booking) => selectedRows.set(String(booking.id), booking));
    if (kinds.has('unverified')) filteredRows.filter((booking) => !verifiedIds.has(String(booking.id))).forEach((booking) => selectedRows.set(String(booking.id), booking));
    if (kinds.has('returns')) filteredRows.filter(isReturnBooking).forEach((booking) => selectedRows.set(String(booking.id), booking));

    const rows = [...selectedRows.values()].sort((a, b) => Number(a.slot_hour || 0) - Number(b.slot_hour || 0));
    if (!rows.length) {
      toast('В выбранных разделах нет записей для выгрузки.', true);
      return false;
    }

    const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const orderNames = { order: 'Заказ', upd: 'УПД', etrn: 'ЭТрН' };
    const headings = [
      '№', 'Дата', 'Время', 'Поставщик', 'ИНН', 'Номер документа', 'Тип документа',
      'Тип поставки', 'Верификация', 'Транспортная компания', 'Прибыл', 'Убыл',
      'Ворота', 'Комментарий', 'Ссылка на реестр'
    ];
    const lines = [headings.map(cell).join(';')];
    rows.forEach((booking, index) => {
      const profile = getBookingSupplier(booking);
      const values = [
        index + 1,
        formatDate(booking.slot_date),
        formatTime(booking.slot_hour),
        profile.company_name || '',
        profile.inn || '',
        booking.order_number || '',
        orderNames[booking.order_type] || booking.order_type || '',
        getSupplyTypeLabel(booking),
        verifiedIds.has(String(booking.id)) ? 'Да' : 'Нет',
        booking.is_tk ? 'Да' : 'Нет',
        booking.arrival_time || '',
        booking.departure_time || '',
        booking.gate_number || '',
        booking.comment || '',
        booking.registry_file_url || ''
      ];
      lines.push(values.map(cell).join(';'));
    });

    const blob = new Blob([`\ufeff${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `akson-dockslot-${$('dateFilter').value || 'all'}-registry.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Консолидированный реестр сформирован: ${rows.length} записей.`);
    return true;
  };

  const handleExportClick = () => {
    if (!exportSelectionMode) {
      setExportSelectionMode(true);
      toast('Выберите один или несколько дашбордов для выгрузки.');
      return;
    }
    if (!selectedExportKinds.size) {
      setExportSelectionMode(false);
      toast('Выбор выгрузки отменён.');
      return;
    }
    const completed = exportCsv(new Set(selectedExportKinds));
    if (completed) setExportSelectionMode(false);
  };

  const updateVerification = async (button) => {
    const bookingId = button.dataset.verifyBooking;
    if (!bookingId) return;
    const wasVerified = verifiedIds.has(String(bookingId));
    button.disabled = true;
    try {
      // Read the authoritative state first. If another administrator has already
      // changed it, refresh this view instead of applying a stale inverse action.
      const { data: currentRow, error: readError } = await sb
        .from('booking_verification')
        .select('verified')
        .eq('booking_id', bookingId)
        .maybeSingle();
      if (readError) throw readError;
      const serverVerified = Boolean(currentRow?.verified);
      if (serverVerified !== wasVerified) {
        if (serverVerified) verifiedIds.add(String(bookingId));
        else verifiedIds.delete(String(bookingId));
        renderOverview({ keepState: true });
        if (activeDetailBookingId === String(bookingId)) {
          setDetailText('detailVerification', serverVerified ? 'Верифицирована' : 'Не верифицирована');
        }
        toast('Другой администратор уже изменил статус. Обновили состояние записи.');
        return;
      }

      if (serverVerified) {
        const { error } = await sb.from('booking_verification').delete().eq('booking_id', bookingId);
        if (error) throw error;
        verifiedIds.delete(String(bookingId));
      } else {
        const { error } = await sb.from('booking_verification').upsert({
          booking_id: bookingId,
          verified: true,
          verified_by: currentUser.id,
          verified_at: new Date().toISOString()
        }, { onConflict: 'booking_id' });
        if (error) throw error;
        verifiedIds.add(String(bookingId));
      }
      renderOverview({ keepState: true });
      if (activeDetailBookingId === String(bookingId)) {
        setDetailText('detailVerification', verifiedIds.has(String(bookingId)) ? 'Верифицирована' : 'Не верифицирована');
      }
      toast(serverVerified ? 'Верификация снята.' : 'Запись верифицирована.');
    } catch (error) {
      console.error('Ошибка изменения верификации:', error);
      toast(`Не удалось изменить верификацию: ${error.message || 'ошибка сохранения'}`, true);
      button.disabled = false;
    }
  };

  const subscribeVerificationRealtime = async () => {
    if (!currentUser?.id) return;
    const subscriptionVersion = ++verificationRealtimeVersion;
    const previousChannels = verificationRealtimeChannels;
    verificationRealtimeChannels = [];
    if (previousChannels.length) {
      await Promise.all(previousChannels.map((channel) => sb.removeChannel(channel).catch((error) => {
        console.warn('Не удалось закрыть предыдущую Realtime-подписку:', error);
      })));
    }
    // A date change can start another load while old channels are being removed.
    if (subscriptionVersion !== verificationRealtimeVersion) return;

    const verificationIds = [...new Set((bookings || []).map((booking) => String(booking.id)))];
    const validVerificationIds = verificationIds.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    if (verificationIds.length !== validVerificationIds.length) {
      console.warn('Realtime верификации: обнаружены некорректные ID записей; часть подписок пропущена.');
    }
    if (!validVerificationIds.length) return;

    const handleVerificationChange = (payload) => {
      // DELETE payloads carry the previous row in `old`; `new` may be an empty object.
      const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
      const bookingId = row?.booking_id == null ? '' : String(row.booking_id);
      if (!bookingId || !bookings.some((booking) => String(booking.id) === bookingId)) return;
      const verified = payload.eventType !== 'DELETE' && payload.new?.verified === true;
      if (verified) verifiedIds.add(bookingId);
      else verifiedIds.delete(bookingId);
      renderOverview({ keepState: true });
      if (activeDetailBookingId === bookingId && $('bookingDetailsModal')?.open) {
        setDetailText('detailVerification', verified ? 'Верифицирована' : 'Не верифицирована');
      }
    };

    // Supabase Realtime `in` filters are limited to 100 values per subscription.
    for (let offset = 0; offset < validVerificationIds.length; offset += 100) {
      const chunk = validVerificationIds.slice(offset, offset + 100);
      const channel = sb
        .channel(`dockslot-verification-overview-${currentUser.id}-${subscriptionVersion}-${Math.floor(offset / 100)}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'booking_verification',
          filter: `booking_id=in.(${chunk.join(',')})`
        }, handleVerificationChange)
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn('Realtime верификации временно недоступен:', status);
          }
        });
      verificationRealtimeChannels.push(channel);
    }
  };

  window.addEventListener('pagehide', () => {
    verificationRealtimeChannels.forEach((channel) => sb.removeChannel(channel));
    verificationRealtimeChannels = [];
  }, { once: true });


  const loadNotes = async () => {
    const { data, error } = await sb
      .from('admin_personal_notes')
      .select('id, title, content, created_at, updated_at')
      .eq('admin_id', currentUser.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    notes = data || [];
    renderNotes();
  };

  const renderNotes = () => {
    const list = $('notesList');
    list.replaceChildren();
    if (!notes.length) {
      list.appendChild(createElement('div', 'overview-empty overview-sticker-empty', 'Здесь появятся ваши заметки. Нажмите «Добавить заметку».'));
      return;
    }
    notes.forEach((note) => {
      const item = createElement('article', 'overview-sticker overview-sticker--note');
      const head = createElement('div', 'overview-sticker-head');
      head.appendChild(createElement('strong', '', note.title || 'Заметка'));
      head.appendChild(createElement('span', '', new Date(note.updated_at || note.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })));
      const expand = createElement('button', 'overview-sticker-expand', note.content || '');
      expand.type = 'button';
      expand.dataset.expandNote = String(note.id);
      expand.setAttribute('aria-expanded', 'false');
      const hint = createElement('span', 'overview-sticker-hint', 'Нажмите, чтобы раскрыть');
      const actions = createElement('div', 'overview-sticker-actions');
      const edit = createElement('button', 'overview-sticker-action', 'Изменить');
      edit.type = 'button'; edit.dataset.editNote = String(note.id);
      const remove = createElement('button', 'overview-sticker-action', 'Удалить');
      remove.type = 'button'; remove.dataset.deleteNote = String(note.id);
      actions.append(edit, remove);
      item.append(head, expand, hint, actions);
      list.appendChild(item);
    });
  };

  const resetNoteForm = () => {
    $('notesForm').reset();
    $('noteId').value = '';
    $('noteModalTitle').textContent = 'Новая заметка';
    $('saveNoteBtn').textContent = 'Сохранить заметку';
  };

  const openDialog = (dialogId) => {
    const dialog = $(dialogId);
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };

  const closeDialog = (dialogId) => {
    const dialog = $(dialogId);
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  };

  const saveNote = async (event) => {
    event.preventDefault();
    const title = $('noteTitle').value.trim();
    const content = $('noteContent').value.trim();
    if (!content) return toast('Введите текст заметки.', true);
    const noteId = $('noteId').value;
    $('saveNoteBtn').disabled = true;
    try {
      const payload = { admin_id: currentUser.id, title, content, updated_at: new Date().toISOString() };
      let query;
      if (noteId) {
        query = sb.from('admin_personal_notes').update(payload).eq('id', noteId).eq('admin_id', currentUser.id);
      } else {
        query = sb.from('admin_personal_notes').insert(payload);
      }
      const { error } = await query;
      if (error) throw error;
      resetNoteForm();
      closeDialog('noteModal');
      await loadNotes();
      toast(noteId ? 'Заметка обновлена.' : 'Заметка сохранена.');
    } catch (error) {
      console.error('Ошибка сохранения заметки:', error);
      toast(`Не удалось сохранить заметку: ${error.message || 'ошибка базы данных'}`, true);
    } finally {
      $('saveNoteBtn').disabled = false;
    }
  };

  const editNote = (noteId) => {
    const note = notes.find((item) => String(item.id) === String(noteId));
    if (!note) return;
    $('noteId').value = String(note.id);
    $('noteTitle').value = note.title || '';
    $('noteContent').value = note.content || '';
    $('noteModalTitle').textContent = 'Изменить заметку';
    $('saveNoteBtn').textContent = 'Сохранить изменения';
    openDialog('noteModal');
    window.setTimeout(() => $('noteTitle').focus(), 50);
  };

  const deleteNote = async (noteId) => {
    if (!window.confirm('Удалить эту заметку?')) return;
    try {
      const { error } = await sb.from('admin_personal_notes').delete().eq('id', noteId).eq('admin_id', currentUser.id);
      if (error) throw error;
      notes = notes.filter((note) => String(note.id) !== String(noteId));
      renderNotes();
      if ($('noteId').value === String(noteId)) resetNoteForm();
      toast('Заметка удалена.');
    } catch (error) {
      console.error('Ошибка удаления заметки:', error);
      toast(`Не удалось удалить заметку: ${error.message || 'ошибка базы данных'}`, true);
    }
  };

  const getNotifiedReminderMap = () => {
    try {
      const raw = localStorage.getItem(reminderNotificationStorageKey());
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  };

  const saveNotifiedReminderMap = (map) => {
    try { localStorage.setItem(reminderNotificationStorageKey(), JSON.stringify(map)); }
    catch (error) { console.warn('Не удалось сохранить отметки уведомлений:', error); }
  };

  const showDueReminderDialog = (dueItems) => {
    const content = $('dueReminderContent');
    content.replaceChildren();
    dueItems.forEach((reminder) => {
      const item = createElement('div', 'overview-due-item');
      item.appendChild(createElement('strong', '', new Date(reminder.remind_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })));
      item.appendChild(createElement('div', '', reminder.reminder_text || 'Напоминание'));
      content.appendChild(item);
    });
    openDialog('dueReminderModal');
  };

  const processDueReminders = () => {
    if (!currentUser || !reminders.length) return;
    const notified = getNotifiedReminderMap();
    const now = Date.now();
    const due = reminders.filter((reminder) => {
      const timestamp = new Date(reminder.remind_at).getTime();
      const notificationKey = `${reminder.id}:${reminder.remind_at}`;
      return !reminder.is_completed && Number.isFinite(timestamp) && timestamp <= now
        && notified[String(reminder.id)] !== reminder.remind_at
        && !sessionNotifiedReminders.has(notificationKey);
    });
    if (!due.length) return;

    due.forEach((reminder) => {
      notified[String(reminder.id)] = reminder.remind_at;
      sessionNotifiedReminders.add(`${reminder.id}:${reminder.remind_at}`);
    });
    saveNotifiedReminderMap(notified);
    renderReminders();

    let notificationFailed = false;
    if ('Notification' in window && Notification.permission === 'granted') {
      due.forEach((reminder) => {
        try {
          const notification = new Notification('Аксон ДокСлот — напоминание', {
            body: reminder.reminder_text || 'Наступило время напоминания.',
            tag: `akson-dockslot-reminder-${reminder.id}`,
            icon: '../assets/apple-touch-icon.png'
          });
          notification.onclick = () => { window.focus(); notification.close(); };
        } catch (error) {
          console.warn('Не удалось показать системное уведомление:', error);
          notificationFailed = true;
        }
      });
    } else {
      notificationFailed = true;
    }

    if (notificationFailed) showDueReminderDialog(due);
    else toast(due.length === 1 ? 'Сработало напоминание.' : `Сработало напоминаний: ${due.length}.`);
  };

  const requestReminderNotificationPermission = async () => {
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    try { await Notification.requestPermission(); }
    catch (error) { console.warn('Запрос разрешения на уведомления не выполнен:', error); }
  };

  const loadReminders = async () => {
    const { data, error } = await sb
      .from('admin_personal_reminders')
      .select('id, reminder_text, remind_at, is_completed, created_at, updated_at')
      .eq('admin_id', currentUser.id)
      .order('is_completed', { ascending: true })
      .order('remind_at', { ascending: true });
    if (error) throw error;
    reminders = data || [];
    renderReminders();
    processDueReminders();
  };

  const renderReminders = () => {
    const list = $('remindersList');
    list.replaceChildren();
    if (!reminders.length) {
      list.appendChild(createElement('div', 'overview-empty overview-sticker-empty', 'Здесь появятся ваши напоминания. Нажмите «Добавить напоминание».'));
      return;
    }
    const now = Date.now();
    reminders.forEach((reminder) => {
      const reminderDate = new Date(reminder.remind_at).getTime();
      const isCompleted = Boolean(reminder.is_completed);
      const isOverdue = !isCompleted && Number.isFinite(reminderDate) && reminderDate < now;
      const statusClass = isCompleted ? 'is-completed' : (isOverdue ? 'is-overdue' : 'is-upcoming');
      const item = createElement('article', `overview-sticker overview-sticker--reminder ${statusClass}`);
      const head = createElement('div', 'overview-sticker-head');
      head.appendChild(createElement('strong', '', isCompleted ? 'Выполнено' : (isOverdue ? 'Просрочено' : 'Напоминание')));
      head.appendChild(createElement('span', '', new Date(reminder.remind_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })));
      const expand = createElement('button', 'overview-sticker-expand', reminder.reminder_text || '');
      expand.type = 'button';
      expand.dataset.expandReminder = String(reminder.id);
      expand.setAttribute('aria-expanded', 'false');
      const hint = createElement('span', 'overview-sticker-hint', 'Нажмите, чтобы раскрыть');
      const actions = createElement('div', 'overview-sticker-actions');
      const toggle = createElement('button', 'overview-sticker-action', isCompleted ? 'Вернуть' : 'Выполнено');
      toggle.type = 'button'; toggle.dataset.toggleReminder = String(reminder.id); toggle.dataset.completed = String(isCompleted);
      const remove = createElement('button', 'overview-sticker-action', 'Удалить');
      remove.type = 'button'; remove.dataset.deleteReminder = String(reminder.id);
      actions.append(toggle, remove);
      item.append(head, expand, hint, actions);
      list.appendChild(item);
    });
  };

  const saveReminder = async (event) => {
    event.preventDefault();
    const reminderText = $('reminderText').value.trim();
    const localValue = $('reminderAt').value;
    // datetime-local не содержит часовой зоны: трактуем введённое время как московское.
    const remindDate = localValue ? new Date(`${localValue}:00+03:00`) : null;
    if (!reminderText || !remindDate || Number.isNaN(remindDate.getTime())) {
      return toast('Укажите текст и корректные дату и время напоминания.', true);
    }
    $('saveReminderBtn').disabled = true;
    await requestReminderNotificationPermission();
    try {
      const { error } = await sb.from('admin_personal_reminders').insert({
        admin_id: currentUser.id,
        reminder_text: reminderText,
        remind_at: remindDate.toISOString(),
        is_completed: false,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;
      $('reminderForm').reset();
      closeDialog('reminderModal');
      await loadReminders();
      toast('Напоминание добавлено.');
    } catch (error) {
      console.error('Ошибка создания напоминания:', error);
      toast(`Не удалось добавить напоминание: ${error.message || 'ошибка базы данных'}`, true);
    } finally {
      $('saveReminderBtn').disabled = false;
    }
  };

  const toggleReminder = async (reminderId, completed) => {
    try {
      const { error } = await sb.from('admin_personal_reminders')
        .update({ is_completed: !completed, updated_at: new Date().toISOString() })
        .eq('id', reminderId)
        .eq('admin_id', currentUser.id);
      if (error) throw error;
      reminders = reminders.map((item) => String(item.id) === String(reminderId) ? { ...item, is_completed: !completed } : item);
      renderReminders();
      toast(!completed ? 'Напоминание отмечено выполненным.' : 'Напоминание возвращено в работу.');
    } catch (error) {
      console.error('Ошибка изменения напоминания:', error);
      toast(`Не удалось изменить напоминание: ${error.message || 'ошибка базы данных'}`, true);
    }
  };

  const deleteReminder = async (reminderId) => {
    if (!window.confirm('Удалить это напоминание?')) return;
    try {
      const { error } = await sb.from('admin_personal_reminders').delete().eq('id', reminderId).eq('admin_id', currentUser.id);
      if (error) throw error;
      reminders = reminders.filter((item) => String(item.id) !== String(reminderId));
      renderReminders();
      toast('Напоминание удалено.');
    } catch (error) {
      console.error('Ошибка удаления напоминания:', error);
      toast(`Не удалось удалить напоминание: ${error.message || 'ошибка базы данных'}`, true);
    }
  };

  const initialize = async () => {
    const profile = await getProfile();
    if (!profile) return;
    $('logoutBtn').addEventListener('click', async (event) => {
      event.preventDefault();
      await sb.auth.signOut();
      window.location.href = '../index.html';
    });

    try {
      await loadSettings();
    } catch (error) {
      console.error('Не удалось загрузить справочник типов поставки:', error);
      showState('Не удалось загрузить справочник типов поставки. Проверьте подключение к Supabase.', true);
    }

    $('applyBtn').addEventListener('click', () => {
      setExportSelectionMode(false);
      activeListKind = null;
      $('listPanel').hidden = true;
      document.querySelectorAll('.overview-metric[data-kind]').forEach((metric) => metric.setAttribute('aria-expanded', 'false'));
      loadOverviewDate($('dateFilter').value);
    });
    $('dateFilter').addEventListener('change', () => {
      saveOverviewDatePreference($('dateFilter').value);
      setExportSelectionMode(false);
      activeListKind = null;
      $('listPanel').hidden = true;
      document.querySelectorAll('.overview-metric[data-kind]').forEach((metric) => metric.setAttribute('aria-expanded', 'false'));
      loadOverviewDate($('dateFilter').value);
    });
    ['supplierFilter', 'docFilter', 'supplyFilter', 'orderFilter'].forEach((id) => {
      $(id).addEventListener(id.endsWith('Filter') && id !== 'supplyFilter' && id !== 'orderFilter' ? 'input' : 'change', () => {
        renderOverview();
      });
    });
    $('resetBtn').addEventListener('click', async () => {
      setExportSelectionMode(false);
      $('supplierFilter').value = '';
      $('docFilter').value = '';
      $('supplyFilter').value = '';
      $('orderFilter').value = '';
      activeListKind = null;
      $('listPanel').hidden = true;
      document.querySelectorAll('.overview-metric[data-kind]').forEach((metric) => metric.setAttribute('aria-expanded', 'false'));
      try {
        const defaultDate = await chooseDefaultDate();
        $('dateFilter').value = defaultDate;
        saveOverviewDatePreference(defaultDate);
        await loadOverviewDate(defaultDate);
      } catch (error) {
        showState(`Не удалось определить ближайшую дату: ${error.message || 'ошибка'}`, true);
      }
    });
    $('exportBtn').addEventListener('click', handleExportClick);
    $('overviewMetrics').addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-export-kind]');
      if (!checkbox) return;
      if (checkbox.checked) selectedExportKinds.add(checkbox.dataset.exportKind);
      else selectedExportKinds.delete(checkbox.dataset.exportKind);
      checkbox.closest('.overview-metric-shell')?.classList.toggle('is-selected', checkbox.checked);
      updateExportSelectionState();
    });
    $('closeList').addEventListener('click', () => {
      $('listPanel').hidden = true;
      activeListKind = null;
      document.querySelectorAll('.overview-metric[data-kind]').forEach((metric) => metric.setAttribute('aria-expanded', 'false'));
    });
    document.querySelectorAll('.overview-metric[data-kind]').forEach((metric) => {
      metric.addEventListener('click', () => openList(metric.dataset.kind));
    });
    $('bookingList').addEventListener('click', (event) => {
      const verifyButton = event.target.closest('[data-verify-booking]');
      if (verifyButton) {
        event.stopPropagation();
        updateVerification(verifyButton);
        return;
      }
      const downloadButton = event.target.closest('[data-download-registry]');
      if (downloadButton) {
        event.stopPropagation();
        if (!downloadButton.disabled) downloadRegistry(downloadButton.dataset.downloadRegistry, downloadButton);
        return;
      }
      const row = event.target.closest('[data-open-booking]');
      if (row) openBookingDetails(row.dataset.openBooking);
    });
    $('bookingList').addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key) || event.target.closest('button')) return;
      const row = event.target.closest('[data-open-booking]');
      if (!row) return;
      event.preventDefault();
      openBookingDetails(row.dataset.openBooking);
    });
    $('detailRegistryDownload').addEventListener('click', (event) => {
      const button = event.currentTarget;
      if (!button.disabled) downloadRegistry(button.dataset.downloadRegistry, button);
    });

    $('addNoteBtn').addEventListener('click', () => { resetNoteForm(); openDialog('noteModal'); });
    $('notesForm').addEventListener('submit', saveNote);
    $('addReminderBtn').addEventListener('click', () => openDialog('reminderModal'));
    $('reminderForm').addEventListener('submit', saveReminder);
    document.querySelectorAll('[data-close-dialog]').forEach((button) => {
      button.addEventListener('click', () => {
        const dialogId = button.dataset.closeDialog;
        closeDialog(dialogId);
        if (dialogId === 'noteModal') resetNoteForm();
        if (dialogId === 'reminderModal') $('reminderForm').reset();
      });
    });
    $('noteModal').addEventListener('close', resetNoteForm);
    $('reminderModal').addEventListener('close', () => $('reminderForm').reset());
    ['noteModal', 'reminderModal', 'bookingDetailsModal', 'dueReminderModal'].forEach((dialogId) => {
      $(dialogId).addEventListener('click', (event) => { if (event.target === $(dialogId)) closeDialog(dialogId); });
    });
    $('notesList').addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit-note]');
      const deleteButton = event.target.closest('[data-delete-note]');
      const expandButton = event.target.closest('[data-expand-note]');
      if (editButton) editNote(editButton.dataset.editNote);
      if (deleteButton) deleteNote(deleteButton.dataset.deleteNote);
      if (expandButton) {
        const card = expandButton.closest('.overview-sticker');
        const expanded = card.classList.toggle('is-expanded');
        expandButton.setAttribute('aria-expanded', String(expanded));
        const hint = card.querySelector('.overview-sticker-hint');
        if (hint) hint.textContent = expanded ? 'Нажмите, чтобы свернуть' : 'Нажмите, чтобы раскрыть';
      }
    });
    $('remindersList').addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-toggle-reminder]');
      const remove = event.target.closest('[data-delete-reminder]');
      const expandButton = event.target.closest('[data-expand-reminder]');
      if (toggle) toggleReminder(toggle.dataset.toggleReminder, toggle.dataset.completed === 'true');
      if (remove) deleteReminder(remove.dataset.deleteReminder);
      if (expandButton) {
        const card = expandButton.closest('.overview-sticker');
        const expanded = card.classList.toggle('is-expanded');
        expandButton.setAttribute('aria-expanded', String(expanded));
        const hint = card.querySelector('.overview-sticker-hint');
        if (hint) hint.textContent = expanded ? 'Нажмите, чтобы свернуть' : 'Нажмите, чтобы раскрыть';
      }
    });

    try {
      const defaultDate = await getInitialOverviewDate();
      $('dateFilter').value = defaultDate;
      await loadOverviewDate(defaultDate);
    } catch (error) {
      console.error('Не удалось определить стартовую дату обзора:', error);
      showState(`Не удалось определить ближайшую дату записей: ${error.message || 'ошибка'}`, true);
      bookings = [];
      verifiedIds = new Set();
      renderOverview({ keepState: true });
    }

    const independentLoads = [
      loadNotes().catch((error) => {
        console.error('Не удалось загрузить личные заметки:', error);
        $('notesList').replaceChildren(createElement('div', 'overview-empty', `Не удалось загрузить заметки. Проверьте SQL-миграцию: ${error.message || ''}`));
      }),
      loadReminders().catch((error) => {
        console.error('Не удалось загрузить напоминания:', error);
        $('remindersList').replaceChildren(createElement('div', 'overview-empty', `Не удалось загрузить напоминания. Проверьте SQL-миграцию: ${error.message || ''}`));
      })
    ];
    await Promise.all(independentLoads);
    processDueReminders();
    if (reminderCheckInterval) window.clearInterval(reminderCheckInterval);
    reminderCheckInterval = window.setInterval(processDueReminders, 15000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) processDueReminders(); });
  };

  initialize().catch((error) => {
    console.error('Критическая ошибка страницы «Обзор»:', error);
    showState(`Не удалось открыть обзор: ${error.message || 'неизвестная ошибка'}`, true);
  });
});
