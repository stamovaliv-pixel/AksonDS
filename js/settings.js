document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  const { data: profile, error: profileError } = await sb.from('profiles').select('role, is_blocked').eq('id', user.id).single();
  if (profileError || !profile || profile.is_blocked || profile.role !== 'admin') {
    alert('Доступ запрещен. Страница доступна только Администратору.');
    return window.location.href = 'admin_calendar.html';
  }

  document.getElementById('logoutBtn').onclick = async (e) => { 
    e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html'; 
  };

  let currentSettings = {};
  let localSupplyTypes = [];

  const generateOptions = (selectId, min, max, formatTime = false) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = '';
    for (let i = min; i <= max; i++) {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = formatTime ? `${i}:00` : i;
      select.appendChild(opt);
    }
  };

  generateOptions('edit_startHour', 0, 23, true);
  generateOptions('edit_endHour', 0, 23, true);
  generateOptions('edit_slotsPer', 1, 12, false);
  generateOptions('edit_reserveSlots', 0, 12, false); 
  generateOptions('edit_deadline', 1, 48, false);
  generateOptions('edit_returnDeadline', 0, 30, false);

  const dayNames = { 1:'Пн', 2:'Вт', 3:'Ср', 4:'Чт', 5:'Пт', 6:'Сб', 7:'Вс' };

  // v4.1 excluded dates are administered only from this admin-only page and are
  // independently enforced by the PostgreSQL booking trigger.
  let currentExcludedDates = [];
  let draftExcludedDates = [];
  let exceptionsMonth = new Date();
  exceptionsMonth.setDate(1);
  exceptionsMonth.setHours(12, 0, 0, 0);

  const businessTodayISO = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  };

  const parseISODateLocal = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const toISODateLocal = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const formatExceptionDate = (iso) => {
    const date = parseISODateLocal(iso);
    return date ? date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : String(iso);
  };

  const renderExcludedDateSummary = () => {
    const container = document.getElementById('view_excludedDates');
    if (!container) return;
    container.replaceChildren();
    if (!currentExcludedDates.length) {
      const empty = document.createElement('span');
      empty.className = 'exception-empty';
      empty.textContent = 'Нет дат-исключений. Запись доступна по обычным правилам.';
      container.appendChild(empty);
      return;
    }
    currentExcludedDates.forEach(date => {
      const chip = document.createElement('span');
      chip.className = 'exception-chip';
      chip.textContent = formatExceptionDate(date);
      container.appendChild(chip);
    });
  };

  const renderDraftExcludedDates = () => {
    const container = document.getElementById('exceptionsSelectedDates');
    if (!container) return;
    container.replaceChildren();
    const sorted = [...new Set(draftExcludedDates)].filter(date => date >= businessTodayISO()).sort();
    draftExcludedDates = sorted;
    if (!sorted.length) {
      const empty = document.createElement('span');
      empty.className = 'exception-empty';
      empty.textContent = 'Даты не выбраны';
      container.appendChild(empty);
      return;
    }
    sorted.forEach(iso => {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = `${formatExceptionDate(iso)} ×`;
      remove.title = `Убрать исключение ${formatExceptionDate(iso)}`;
      remove.addEventListener('click', () => {
        draftExcludedDates = draftExcludedDates.filter(date => date !== iso);
        renderExceptionsCalendar();
      });
      container.appendChild(remove);
    });
  };

  const renderExceptionsCalendar = () => {
    const grid = document.getElementById('exceptionsCalendarGrid');
    const title = document.getElementById('exceptionsMonthTitle');
    if (!grid || !title) return;
    title.textContent = exceptionsMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    grid.replaceChildren();

    const first = new Date(exceptionsMonth.getFullYear(), exceptionsMonth.getMonth(), 1, 12);
    const firstWeekdayMondayFirst = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(exceptionsMonth.getFullYear(), exceptionsMonth.getMonth() + 1, 0).getDate();
    for (let i = 0; i < firstWeekdayMondayFirst; i++) {
      const blank = document.createElement('span');
      blank.setAttribute('aria-hidden', 'true');
      grid.appendChild(blank);
    }

    const today = businessTodayISO();
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(exceptionsMonth.getFullYear(), exceptionsMonth.getMonth(), day, 12);
      const iso = toISODateLocal(date);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'exception-date-btn';
      button.textContent = String(day);
      button.setAttribute('aria-label', formatExceptionDate(iso));
      const selected = draftExcludedDates.includes(iso);
      if (selected) {
        button.classList.add('selected');
        button.setAttribute('aria-pressed', 'true');
      } else {
        button.setAttribute('aria-pressed', 'false');
      }
      if (iso === today) button.classList.add('today');
      button.disabled = iso < today;
      button.title = iso < today ? 'Прошедшую дату нельзя добавить в исключения' : formatExceptionDate(iso);
      button.addEventListener('click', () => {
        if (draftExcludedDates.includes(iso)) draftExcludedDates = draftExcludedDates.filter(date => date !== iso);
        else draftExcludedDates.push(iso);
        renderExceptionsCalendar();
      });
      grid.appendChild(button);
    }
    renderDraftExcludedDates();
  };

  const openExceptionsModal = () => {
    draftExcludedDates = [...currentExcludedDates];
    const today = parseISODateLocal(businessTodayISO()) || new Date();
    exceptionsMonth = new Date(today.getFullYear(), today.getMonth(), 1, 12);
    renderExceptionsCalendar();
    const modal = document.getElementById('dateExceptionsModal');
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('closeDateExceptions')?.focus();
  };

  const closeExceptionsModal = () => {
    const modal = document.getElementById('dateExceptionsModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    document.getElementById('btnManageExcludedDates')?.focus();
  };

  const bindExcludedDateModal = () => {
    document.getElementById('btnManageExcludedDates')?.addEventListener('click', openExceptionsModal);
    document.getElementById('closeDateExceptions')?.addEventListener('click', closeExceptionsModal);
    document.getElementById('cancelDateExceptions')?.addEventListener('click', closeExceptionsModal);
    document.getElementById('exceptionsPrevMonth')?.addEventListener('click', () => {
      exceptionsMonth = new Date(exceptionsMonth.getFullYear(), exceptionsMonth.getMonth() - 1, 1, 12);
      renderExceptionsCalendar();
    });
    document.getElementById('exceptionsNextMonth')?.addEventListener('click', () => {
      exceptionsMonth = new Date(exceptionsMonth.getFullYear(), exceptionsMonth.getMonth() + 1, 1, 12);
      renderExceptionsCalendar();
    });
    document.getElementById('clearExcludedDates')?.addEventListener('click', () => {
      draftExcludedDates = [];
      renderExceptionsCalendar();
    });
    document.getElementById('dateExceptionsModal')?.addEventListener('click', (event) => {
      if (event.target.id === 'dateExceptionsModal') closeExceptionsModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.getElementById('dateExceptionsModal')?.getAttribute('aria-hidden') === 'false') closeExceptionsModal();
    });
    document.getElementById('saveDateExceptions')?.addEventListener('click', async () => {
      const save = document.getElementById('saveDateExceptions');
      const today = businessTodayISO();
      const values = [...new Set(draftExcludedDates)].filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today).sort();
      save.disabled = true;
      save.textContent = 'Сохранение...';
      const { error } = await sb.from('app_settings').update({ booking_excluded_dates: values }).eq('id', 1);
      save.disabled = false;
      save.textContent = 'Сохранить';
      if (error) {
        console.error('Не удалось сохранить даты-исключения:', error);
        alert('Не удалось сохранить исключения дат. Проверьте, что SQL v4.1 уже применён. ' + error.message);
        return;
      }
      currentExcludedDates = values;
      currentSettings.booking_excluded_dates = values;
      sessionStorage.removeItem('app_settings');
      renderExcludedDateSummary();
      closeExceptionsModal();
      alert('Даты-исключения сохранены. Новые бронирования на выбранные даты запрещены на стороне базы.');
    });
  };

  bindExcludedDateModal();

  const loadSettings = async () => {
    try {
      const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
      
      if (error || !data) {
        document.querySelectorAll('.setting-value, .days-view').forEach(el => el.textContent = '⚠️ Ошибка БД');
        return alert('База данных не вернула настройки.');
      }
      
      currentSettings = data;
      localSupplyTypes = JSON.parse(JSON.stringify(data.supply_types || []));
      const todayISO = businessTodayISO();
      const storedExcludedDates = Array.isArray(data.booking_excluded_dates) ? data.booking_excluded_dates : [];
      currentExcludedDates = [...new Set(storedExcludedDates.map(String))]
        .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= todayISO)
        .sort();
      renderExcludedDateSummary();
      // Opportunistic cleanup: if Cron is not enabled, an admin opening Settings still removes expired values.
      if (currentExcludedDates.length !== storedExcludedDates.length || currentExcludedDates.some((date, index) => date !== storedExcludedDates[index])) {
        const { error: cleanupError } = await sb.from('app_settings').update({ booking_excluded_dates: currentExcludedDates }).eq('id', 1);
        if (cleanupError) console.warn('Автоочистка прошедших дат не выполнена; проверьте наличие SQL v4.1/pg_cron.', cleanupError);
        else sessionStorage.removeItem('app_settings');
      }

      const sHour = data.slot_start_hour ?? 9;
      document.getElementById('view_startHour').textContent = `${sHour}:00`;
      document.getElementById('edit_startHour').value = sHour;

      const eHour = data.slot_end_hour ?? 17;
      document.getElementById('view_endHour').textContent = `${eHour}:00`;
      document.getElementById('edit_endHour').value = eHour;

      const sPer = data.slots_per_hour ?? 5;
      document.getElementById('view_slotsPer').textContent = sPer;
      document.getElementById('edit_slotsPer').value = sPer;

      const rPer = data.reserve_slots_per_hour ?? 3;
      document.getElementById('view_reserveSlots').textContent = rPer;
      document.getElementById('edit_reserveSlots').value = rPer;

      const dLine = data.booking_deadline_hours ?? 1;
      document.getElementById('view_deadline').textContent = dLine;
      document.getElementById('edit_deadline').value = dLine;

      const rDeadline = data.return_deadline_days ?? 0;
      document.getElementById('view_returnDeadline').textContent = rDeadline;
      document.getElementById('edit_returnDeadline').value = rDeadline;

      const daysArr = data.available_days || [1, 2, 3, 4, 5];
      const activeDaysText = daysArr.map(d => dayNames[d]).join(', ');
      document.getElementById('view_days').textContent = activeDaysText || 'Нет активных дней';
      
      const checkboxes = document.querySelectorAll('#edit_days input[type="checkbox"]');
      checkboxes.forEach(cb => { cb.checked = daysArr.includes(parseInt(cb.value)); });

      if (data.registry_template_url) {
        const link = document.getElementById('view_templateLink');
        if (link) {
          link.removeAttribute('href');
          link.style.display = 'inline-flex';
          document.getElementById('view_noTemplate').style.display = 'none';
          window.registryStorage.signedUrl(data.registry_template_url).then(url => {
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          }).catch(() => {
            link.style.display = 'none';
            document.getElementById('view_noTemplate').style.display = 'block';
          });
        }
      }

      renderSupplyTypes();
    } catch (err) {
      console.error(err);
      document.querySelectorAll('.setting-value, .days-view').forEach(el => el.textContent = '⚠️ Ошибка скрипта');
    }
  };

  const toggleEdit = (fieldKey, isEditing) => {
    document.getElementById(`view_${fieldKey}`).style.display = isEditing ? 'none' : 'block';
    document.getElementById(`edit_${fieldKey}`).style.display = isEditing ? (fieldKey === 'days' ? 'flex' : 'block') : 'none';
    document.getElementById(`btnEdit_${fieldKey}`).style.display = isEditing ? 'none' : 'flex';
    document.getElementById(`btnSave_${fieldKey}`).style.display = isEditing ? 'flex' : 'none';
  };

  const saveField = async (fieldKey, dbColumn) => {
    let newValue;
    if (fieldKey === 'days') {
      newValue = Array.from(document.querySelectorAll('#edit_days input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
    } else {
      newValue = parseInt(document.getElementById(`edit_${fieldKey}`).value);
    }

    const btnSave = document.getElementById(`btnSave_${fieldKey}`);
    btnSave.style.opacity = '0.5';
    btnSave.style.pointerEvents = 'none';

    const { error } = await sb.from('app_settings').update({ [dbColumn]: newValue }).eq('id', 1);
    
    btnSave.style.opacity = '1';
    btnSave.style.pointerEvents = 'auto';

    if (error) {
      alert('Ошибка сохранения: ' + error.message);
    } else {
      // ОПТИМИЗАЦИЯ: Сброс кэша при сохранении настроек
      sessionStorage.removeItem('app_settings');

      currentSettings[dbColumn] = newValue;
      if (fieldKey === 'days') {
        document.getElementById(`view_days`).textContent = newValue.map(d => dayNames[d]).join(', ') || 'Нет активных дней';
      } else {
        const isTime = fieldKey.includes('Hour');
        document.getElementById(`view_${fieldKey}`).textContent = isTime ? `${newValue}:00` : newValue;
      }
      toggleEdit(fieldKey, false);
    }
  };

  const simpleFields = [
    { key: 'startHour', db: 'slot_start_hour' },
    { key: 'endHour', db: 'slot_end_hour' },
    { key: 'slotsPer', db: 'slots_per_hour' },
    { key: 'reserveSlots', db: 'reserve_slots_per_hour' }, 
    { key: 'deadline', db: 'booking_deadline_hours' },
    { key: 'returnDeadline', db: 'return_deadline_days' },
    { key: 'days', db: 'available_days' }
  ];

  simpleFields.forEach(f => {
    const editBtn = document.getElementById(`btnEdit_${f.key}`);
    const saveBtn = document.getElementById(`btnSave_${f.key}`);
    if (editBtn) editBtn.onclick = () => toggleEdit(f.key, true);
    if (saveBtn) saveBtn.onclick = () => saveField(f.key, f.db);
  });

  let isEditingSupply = false;

  const renderSupplyTypes = () => {
    const list = document.getElementById('supplyTypesList');
    if (!list) return;
    list.replaceChildren();
    localSupplyTypes.forEach((st, index) => {
      const li = document.createElement('li');
      li.className = 'supply-item';
      const name = document.createElement('span');
      name.textContent = String(st.name || '');
      const button = document.createElement('button');
      button.className = 'btn-trash';
      button.dataset.index = String(index);
      button.type = 'button';
      button.style.display = isEditingSupply ? 'block' : 'none';
      button.setAttribute('aria-label', 'Удалить тип поставки');
      // Внутри только статическая SVG-разметка, данных пользователя здесь нет.
      button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
      li.append(name, button);
      list.appendChild(li);
    });
  };

  const btnEditSupply = document.getElementById('btnEdit_supply');
  if (btnEditSupply) {
    btnEditSupply.onclick = () => {
      isEditingSupply = true;
      btnEditSupply.style.display = 'none';
      document.getElementById('btnSave_supply').style.display = 'flex';
      document.getElementById('supplyAddRow').style.display = 'flex';
      renderSupplyTypes();
    };
  }

  const supplyTypesList = document.getElementById('supplyTypesList');
  if (supplyTypesList) {
    supplyTypesList.addEventListener('click', (e) => {
      const trashBtn = e.target.closest('.btn-trash');
      if (trashBtn) {
        const index = trashBtn.dataset.index;
        localSupplyTypes.splice(index, 1);
        renderSupplyTypes();
      }
    });
  }

  const btnAddSupply = document.getElementById('btnAddSupply');
  if (btnAddSupply) {
    btnAddSupply.onclick = () => {
      const input = document.getElementById('newSupplyName');
      const name = input.value.trim();
      if (!name) return;
      const id = 'type_' + Math.random().toString(36).substr(2, 9);
      localSupplyTypes.push({ id, name });
      input.value = '';
      renderSupplyTypes();
    };
  }

  const btnSaveSupply = document.getElementById('btnSave_supply');
  if (btnSaveSupply) {
    btnSaveSupply.onclick = async () => {
      btnSaveSupply.style.opacity = '0.5';
      btnSaveSupply.style.pointerEvents = 'none';

      const { error } = await sb.from('app_settings').update({ supply_types: localSupplyTypes }).eq('id', 1);
      
      btnSaveSupply.style.opacity = '1';
      btnSaveSupply.style.pointerEvents = 'auto';

      if (error) {
        alert('Ошибка сохранения: ' + error.message);
      } else {
        // ОПТИМИЗАЦИЯ: Сброс кэша при сохранении типов
        sessionStorage.removeItem('app_settings');

        isEditingSupply = false;
        document.getElementById('btnEdit_supply').style.display = 'flex';
        btnSaveSupply.style.display = 'none';
        document.getElementById('supplyAddRow').style.display = 'none';
        renderSupplyTypes();
      }
    };
  }

  const templateInput = document.getElementById('templateFileInput');
  const btnUploadTemplate = document.getElementById('btnUploadTemplate');
  
  if (btnUploadTemplate) {
    btnUploadTemplate.onclick = async () => {
      const file = templateInput.files[0];
      if (!file) return alert('Пожалуйста, выберите файл шаблона');
      
      btnUploadTemplate.innerText = 'Загрузка...';
      btnUploadTemplate.disabled = true;
      
      const fileExt = file.name.split('.').pop();
      const fileName = `template_${Date.now()}.${fileExt}`;
      
      let templatePath;
      try {
        templatePath = await window.registryStorage.upload(file, `templates/${fileName}`);
      } catch (uploadError) {
        alert(`Ошибка загрузки файла: ${uploadError.message || 'проверьте формат и размер файла'}`);
      }
      
      if (templatePath) {
        const { error: dbError } = await sb.from('app_settings').update({ registry_template_url: templatePath }).eq('id', 1);
        
        if (dbError) {
          alert('Ошибка сохранения в БД: ' + dbError.message);
        } else {
          // ОПТИМИЗАЦИЯ: Сброс кэша при обновлении шаблона
          sessionStorage.removeItem('app_settings');
          alert('Шаблон успешно обновлен!');
          window.location.reload(); 
        }
      }
      btnUploadTemplate.innerText = 'Обновить шаблон';
      btnUploadTemplate.disabled = false;
    };
  }

  loadSettings();
});
