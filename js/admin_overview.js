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
  let settings = { supply_types: [] };
  let bookings = [];
  let verifiedIds = new Set();
  let activeListKind = null;
  let notes = [];
  let reminders = [];
  let upcomingBookings = [];

  const businessDate = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };

  const addDays = (isoDate, amount) => {
    const date = new Date(`${isoDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
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
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError || !authData?.user) {
      window.location.href = '../index.html';
      return null;
    }
    const { data: profile, error } = await sb
      .from('profiles')
      .select('role, is_blocked')
      .eq('id', authData.user.id)
      .single();
    if (error || !profile || profile.is_blocked) {
      await sb.auth.signOut();
      window.location.href = '../index.html';
      return null;
    }
    if (profile.role !== 'admin') {
      window.location.href = ['operator', 'viewer'].includes(profile.role) ? 'admin_calendar.html' : 'calendar.html';
      return null;
    }
    currentUser = authData.user;
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

  const chooseDefaultDate = async () => {
    const tomorrow = addDays(businessDate(), 1);
    const { data, error } = await sb
      .from('bookings')
      .select('slot_date')
      .eq('status', 'active')
      .gte('slot_date', tomorrow)
      .order('slot_date', { ascending: true })
      .limit(1);
    if (error) throw error;
    return data?.[0]?.slot_date || '';
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
    if (kind === 'verified') return rows.filter((booking) => verifiedIds.has(String(booking.id)));
    if (kind === 'returns') return rows.filter(isReturnBooking);
    return rows;
  };

  const renderBookingList = () => {
    if (!activeListKind) return;
    const list = $('bookingList');
    list.replaceChildren();
    const titleByKind = {
      all: 'Все заявки',
      verified: 'Верифицированные заявки',
      returns: 'Заявки с типом поставки «Возврат»'
    };
    const rows = getListRows(activeListKind);
    $('listTitle').textContent = titleByKind[activeListKind];
    $('listSubtitle').textContent = `${formatDate($('dateFilter').value)} · ${rows.length} ${rows.length === 1 ? 'заявка' : 'заявок'}`;

    if (!rows.length) {
      list.appendChild(createElement('div', 'overview-empty', 'По выбранной дате и фильтрам заявок нет.'));
      return;
    }

    rows.forEach((booking) => {
      const profile = getBookingSupplier(booking);
      const verified = verifiedIds.has(String(booking.id));
      const row = createElement('div', 'overview-booking-row');
      const timeCell = createElement('div', 'overview-booking-main');
      timeCell.appendChild(createElement('strong', '', formatTime(booking.slot_hour)));
      timeCell.appendChild(createElement('span', '', formatDate(booking.slot_date)));

      const supplierCell = createElement('div', 'overview-booking-main');
      supplierCell.appendChild(createElement('strong', '', profile.company_name || 'Поставщик'));
      supplierCell.appendChild(createElement('span', '', `ИНН: ${profile.inn || '—'}`));

      const documentCell = createElement('div', 'overview-booking-main overview-booking-hide-mobile');
      documentCell.appendChild(createElement('strong', '', booking.order_number || 'Без номера'));
      documentCell.appendChild(createElement('span', '', getSupplyTypeLabel(booking)));

      const orderCell = createElement('div', 'overview-booking-meta overview-booking-hide-mobile', ({ order: 'Заказ', upd: 'УПД', etrn: 'ЭТрН' })[booking.order_type] || booking.order_type || '—');
      const verifyButton = createElement('button', `overview-verify-btn ${verified ? 'is-verified' : 'is-unverified'}`);
      verifyButton.type = 'button';
      verifyButton.dataset.verifyBooking = String(booking.id);
      verifyButton.title = verified ? 'Снять верификацию' : 'Отметить верифицированной';
      verifyButton.setAttribute('aria-label', verifyButton.title);
      addIconButton(verifyButton, verificationIcon(verified));

      row.append(timeCell, supplierCell, documentCell, orderCell, verifyButton);
      list.appendChild(row);
    });
  };

  const renderOverview = (options = {}) => {
    const rows = getFilteredBookings();
    $('totalCount').textContent = String(rows.length);
    $('verifiedCount').textContent = String(rows.filter((booking) => verifiedIds.has(String(booking.id))).length);
    $('returnCount').textContent = String(rows.filter(isReturnBooking).length);
    $('dateCaption').textContent = $('dateFilter').value
      ? `Данные на ${formatDate($('dateFilter').value)}`
      : 'Нет будущих дат с активными заявками';

    if (!options.keepState) {
      if (!$('dateFilter').value) {
        showState('На будущие даты активных заявок пока нет. Выберите дату вручную, чтобы посмотреть записи за другой день.');
      } else if (!bookings.length) {
        showState(`На ${formatDate($('dateFilter').value)} активных заявок нет.`);
      } else {
        showState('');
      }
    }
    if (activeListKind) renderBookingList();
  };

  const openList = (kind) => {
    activeListKind = kind;
    $('listPanel').hidden = false;
    renderBookingList();
    $('listPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const loadOverviewDate = async (date) => {
    $('applyBtn').disabled = true;
    $('dateFilter').disabled = true;
    try {
      await fetchBookingsForDate(date);
      renderOverview();
    } catch (error) {
      console.error('Ошибка загрузки обзора:', error);
      showState(`Не удалось загрузить заявки: ${error.message || 'неизвестная ошибка'}`, true);
      bookings = [];
      verifiedIds = new Set();
      renderOverview({ keepState: true });
    } finally {
      $('applyBtn').disabled = false;
      $('dateFilter').disabled = false;
    }
  };

  const exportCsv = () => {
    const rows = getFilteredBookings();
    if (!rows.length) {
      toast('Нет заявок для выгрузки по выбранным фильтрам.', true);
      return;
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
    anchor.download = `akson-dockslot-${$('dateFilter').value || 'all'}-bookings.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Подготовлено строк: ${rows.length}`);
  };

  const updateVerification = async (button) => {
    const bookingId = button.dataset.verifyBooking;
    if (!bookingId) return;
    const wasVerified = verifiedIds.has(String(bookingId));
    button.disabled = true;
    try {
      if (wasVerified) {
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
      renderOverview();
      toast(wasVerified ? 'Верификация снята.' : 'Заявка верифицирована.');
    } catch (error) {
      console.error('Ошибка изменения верификации:', error);
      toast(`Не удалось изменить верификацию: ${error.message || 'ошибка сохранения'}`, true);
      button.disabled = false;
    }
  };

  const renderUpcomingBookings = () => {
    const list = $('upcomingList');
    list.replaceChildren();
    const upcoming = upcomingBookings.filter(matchesCurrentFilters);
    if (!upcoming.length) {
      const message = upcomingBookings.length
        ? 'За ближайшие 7 дней нет заявок, соответствующих текущим фильтрам.'
        : 'На ближайшие 7 дней активных записей нет.';
      list.appendChild(createElement('div', 'overview-empty', message));
      return;
    }

    upcoming.forEach((booking) => {
      const profile = Array.isArray(booking.profiles) ? booking.profiles[0] : booking.profiles;
      const item = createElement('button', 'overview-upcoming-item');
      item.type = 'button';
      item.dataset.date = booking.slot_date;
      const dateCell = createElement('span', 'overview-upcoming-date');
      const [year, month, day] = String(booking.slot_date).split('-');
      dateCell.appendChild(createElement('strong', '', day || '—'));
      dateCell.appendChild(createElement('span', '', month ? `${month}.${year}` : ''));
      const info = createElement('span', 'overview-upcoming-info');
      info.appendChild(createElement('strong', '', profile?.company_name || 'Поставщик'));
      info.appendChild(createElement('span', '', `${formatTime(booking.slot_hour)} · ${getSupplyTypeLabel(booking)} · ${booking.order_number || 'Без номера'}`));
      item.append(dateCell, info);
      list.appendChild(item);
    });
  };

  const loadUpcomingBookings = async () => {
    const today = businessDate();
    const endDate = addDays(today, 7);
    const { data, error } = await sb
      .from('bookings')
      .select('id, slot_date, slot_hour, order_number, order_type, supply_type, supply_types, profiles!inner(company_name, inn)')
      .eq('status', 'active')
      .gte('slot_date', today)
      .lte('slot_date', endDate)
      .order('slot_date', { ascending: true })
      .order('slot_hour', { ascending: true });
    if (error) throw error;
    upcomingBookings = data || [];
    renderUpcomingBookings();
  };

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
      list.appendChild(createElement('div', 'overview-empty', 'Заметок пока нет. Добавьте первую заметку выше.'));
      return;
    }
    notes.forEach((note) => {
      const item = createElement('article', 'overview-personal-item');
      const content = createElement('div', 'overview-personal-content');
      content.appendChild(createElement('strong', '', note.title || 'Заметка без заголовка'));
      content.appendChild(createElement('p', '', note.content));
      content.appendChild(createElement('span', 'overview-personal-time', `Изменено: ${new Date(note.updated_at || note.created_at).toLocaleString('ru-RU')}`));
      const actions = createElement('div', 'overview-item-actions');
      const edit = createElement('button', 'overview-mini-btn', 'Изменить');
      edit.type = 'button'; edit.dataset.editNote = String(note.id);
      const remove = createElement('button', 'overview-mini-btn', 'Удалить');
      remove.type = 'button'; remove.dataset.deleteNote = String(note.id);
      actions.append(edit, remove);
      item.append(content, actions);
      list.appendChild(item);
    });
  };

  const resetNoteForm = () => {
    $('notesForm').reset();
    $('noteId').value = '';
    $('saveNoteBtn').textContent = 'Сохранить заметку';
    $('cancelNoteEdit').hidden = true;
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
    $('saveNoteBtn').textContent = 'Сохранить изменения';
    $('cancelNoteEdit').hidden = false;
    $('noteTitle').focus();
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
  };

  const renderReminders = () => {
    const list = $('remindersList');
    list.replaceChildren();
    if (!reminders.length) {
      list.appendChild(createElement('div', 'overview-empty', 'Напоминаний пока нет.'));
      return;
    }
    const now = Date.now();
    reminders.forEach((reminder) => {
      const reminderDate = new Date(reminder.remind_at).getTime();
      const isCompleted = Boolean(reminder.is_completed);
      const isOverdue = !isCompleted && Number.isFinite(reminderDate) && reminderDate < now;
      const item = createElement('article', `overview-personal-item overview-reminder-item ${isCompleted ? 'is-completed' : (isOverdue ? 'is-overdue' : 'is-upcoming')}`);
      const content = createElement('div', 'overview-personal-content');
      content.appendChild(createElement('strong', '', reminder.reminder_text));
      content.appendChild(createElement('span', 'overview-personal-time', new Date(reminder.remind_at).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })));
      content.appendChild(createElement('span', 'overview-reminder-state', isCompleted ? 'Выполнено' : (isOverdue ? 'Просрочено' : 'Предстоит')));
      const actions = createElement('div', 'overview-item-actions');
      const toggle = createElement('button', 'overview-mini-btn', isCompleted ? 'Вернуть' : 'Выполнено');
      toggle.type = 'button'; toggle.dataset.toggleReminder = String(reminder.id); toggle.dataset.completed = String(isCompleted);
      const remove = createElement('button', 'overview-mini-btn', 'Удалить');
      remove.type = 'button'; remove.dataset.deleteReminder = String(reminder.id);
      actions.append(toggle, remove);
      item.append(content, actions);
      list.appendChild(item);
    });
  };

  const saveReminder = async (event) => {
    event.preventDefault();
    const reminderText = $('reminderText').value.trim();
    const localValue = $('reminderAt').value;
    const remindDate = localValue ? new Date(localValue) : null;
    if (!reminderText || !remindDate || Number.isNaN(remindDate.getTime())) {
      return toast('Укажите текст и корректные дату и время напоминания.', true);
    }
    $('saveReminderBtn').disabled = true;
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
      activeListKind = null;
      $('listPanel').hidden = true;
      loadOverviewDate($('dateFilter').value);
    });
    $('dateFilter').addEventListener('change', () => {
      activeListKind = null;
      $('listPanel').hidden = true;
      loadOverviewDate($('dateFilter').value);
    });
    ['supplierFilter', 'docFilter', 'supplyFilter', 'orderFilter'].forEach((id) => {
      $(id).addEventListener(id.endsWith('Filter') && id !== 'supplyFilter' && id !== 'orderFilter' ? 'input' : 'change', () => {
        renderOverview();
        renderUpcomingBookings();
      });
    });
    $('resetBtn').addEventListener('click', async () => {
      $('supplierFilter').value = '';
      $('docFilter').value = '';
      $('supplyFilter').value = '';
      $('orderFilter').value = '';
      activeListKind = null;
      $('listPanel').hidden = true;
      try {
        const defaultDate = await chooseDefaultDate();
        $('dateFilter').value = defaultDate;
        await loadOverviewDate(defaultDate);
      } catch (error) {
        showState(`Не удалось определить ближайшую дату: ${error.message || 'ошибка'}`, true);
      }
    });
    $('exportBtn').addEventListener('click', exportCsv);
    $('closeList').addEventListener('click', () => {
      $('listPanel').hidden = true;
      activeListKind = null;
    });
    document.querySelectorAll('.overview-metric[data-kind]').forEach((metric) => {
      metric.addEventListener('click', () => openList(metric.dataset.kind));
    });
    $('bookingList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-verify-booking]');
      if (button) updateVerification(button);
    });
    $('upcomingList').addEventListener('click', (event) => {
      const item = event.target.closest('[data-date]');
      if (item?.dataset.date) window.location.href = `admin_day.html?date=${encodeURIComponent(item.dataset.date)}`;
    });

    $('notesForm').addEventListener('submit', saveNote);
    $('cancelNoteEdit').addEventListener('click', resetNoteForm);
    $('notesList').addEventListener('click', (event) => {
      const editButton = event.target.closest('[data-edit-note]');
      const deleteButton = event.target.closest('[data-delete-note]');
      if (editButton) editNote(editButton.dataset.editNote);
      if (deleteButton) deleteNote(deleteButton.dataset.deleteNote);
    });
    $('reminderForm').addEventListener('submit', saveReminder);
    $('remindersList').addEventListener('click', (event) => {
      const toggle = event.target.closest('[data-toggle-reminder]');
      const remove = event.target.closest('[data-delete-reminder]');
      if (toggle) toggleReminder(toggle.dataset.toggleReminder, toggle.dataset.completed === 'true');
      if (remove) deleteReminder(remove.dataset.deleteReminder);
    });

    try {
      const defaultDate = await chooseDefaultDate();
      $('dateFilter').value = defaultDate;
      await loadOverviewDate(defaultDate);
    } catch (error) {
      console.error('Не удалось определить стартовую дату обзора:', error);
      showState(`Не удалось определить ближайшую дату заявок: ${error.message || 'ошибка'}`, true);
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
      }),
      loadUpcomingBookings().catch((error) => {
        console.error('Не удалось загрузить ближайшие записи:', error);
        $('upcomingList').replaceChildren(createElement('div', 'overview-empty', `Не удалось загрузить ближайшие записи: ${error.message || ''}`));
      })
    ];
    await Promise.all(independentLoads);
  };

  initialize().catch((error) => {
    console.error('Критическая ошибка страницы «Обзор»:', error);
    showState(`Не удалось открыть обзор: ${error.message || 'неизвестная ошибка'}`, true);
  });
});
