document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  // Проверка прав администратора
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || profile.role !== 'admin') {
    alert('Доступ запрещен. Страница доступна только Администратору.');
    return window.location.href = 'admin_calendar.html';
  }

  document.getElementById('logoutBtn').onclick = async (e) => { 
    e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html'; 
  };

  // Глобальное состояние
  let currentSettings = {};
  let localSupplyTypes = [];

  // Генерация опций для выпадающих списков
  const generateOptions = (selectId, min, max, formatTime = false) => {
    const select = document.getElementById(selectId);
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
  generateOptions('edit_deadline', 1, 48, false);

  const dayNames = { 1:'Пн', 2:'Вт', 3:'Ср', 4:'Чт', 5:'Пт', 6:'Сб', 7:'Вс' };

  // Загрузка настроек
  const loadSettings = async () => {
    const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
    if (error) return alert('Ошибка загрузки настроек: ' + error.message);
    
    currentSettings = data;
    localSupplyTypes = JSON.parse(JSON.stringify(data.supply_types || []));

    // Установка значений для просмотра и редактирования
    document.getElementById('view_startHour').textContent = `${data.slot_start_hour}:00`;
    document.getElementById('edit_startHour').value = data.slot_start_hour;

    document.getElementById('view_endHour').textContent = `${data.slot_end_hour}:00`;
    document.getElementById('edit_endHour').value = data.slot_end_hour;

    document.getElementById('view_slotsPer').textContent = data.slots_per_hour;
    document.getElementById('edit_slotsPer').value = data.slots_per_hour;

    document.getElementById('view_deadline').textContent = data.booking_deadline_hours;
    document.getElementById('edit_deadline').value = data.booking_deadline_hours;

    // Дни недели
    const activeDaysText = data.available_days.map(d => dayNames[d]).join(', ');
    document.getElementById('view_days').textContent = activeDaysText || 'Нет активных дней';
    const checkboxes = document.querySelectorAll('#edit_days input[type="checkbox"]');
    checkboxes.forEach(cb => {
      cb.checked = data.available_days.includes(parseInt(cb.value));
    });

    renderSupplyTypes();
  };

  // --- УНИВЕРСАЛЬНАЯ ЛОГИКА ПЕРЕКЛЮЧЕНИЯ ПОЛЕЙ ---
  const toggleEdit = (fieldKey, isEditing) => {
    document.getElementById(`view_${fieldKey}`).style.display = isEditing ? 'none' : 'block';
    document.getElementById(`edit_${fieldKey}`).style.display = isEditing ? (fieldKey === 'days' ? 'flex' : 'block') : 'none';
    document.getElementById(`btnEdit_${fieldKey}`).style.display = isEditing ? 'none' : 'flex';
    document.getElementById(`btnSave_${fieldKey}`).style.display = isEditing ? 'flex' : 'none';
  };

  const saveField = async (fieldKey, dbColumn) => {
    let newValue;
    
    // Обработка особых полей (Дни недели)
    if (fieldKey === 'days') {
      newValue = Array.from(document.querySelectorAll('#edit_days input[type="checkbox"]:checked')).map(cb => parseInt(cb.value));
    } else {
      newValue = parseInt(document.getElementById(`edit_${fieldKey}`).value);
    }

    // Блокируем кнопку на время сохранения
    const btnSave = document.getElementById(`btnSave_${fieldKey}`);
    btnSave.style.opacity = '0.5';
    btnSave.style.pointerEvents = 'none';

    const { error } = await sb.from('app_settings').update({ [dbColumn]: newValue }).eq('id', 1);
    
    btnSave.style.opacity = '1';
    btnSave.style.pointerEvents = 'auto';

    if (error) {
      alert('Ошибка сохранения: ' + error.message);
    } else {
      currentSettings[dbColumn] = newValue;
      // Обновляем view
      if (fieldKey === 'days') {
        document.getElementById(`view_days`).textContent = newValue.map(d => dayNames[d]).join(', ') || 'Нет активных дней';
      } else {
        const isTime = fieldKey.includes('Hour');
        document.getElementById(`view_${fieldKey}`).textContent = isTime ? `${newValue}:00` : newValue;
      }
      toggleEdit(fieldKey, false);
    }
  };

  // Привязка кнопок для простых полей
  const simpleFields = [
    { key: 'startHour', db: 'slot_start_hour' },
    { key: 'endHour', db: 'slot_end_hour' },
    { key: 'slotsPer', db: 'slots_per_hour' },
    { key: 'deadline', db: 'booking_deadline_hours' },
    { key: 'days', db: 'available_days' }
  ];

  simpleFields.forEach(f => {
    document.getElementById(`btnEdit_${f.key}`).onclick = () => toggleEdit(f.key, true);
    document.getElementById(`btnSave_${f.key}`).onclick = () => saveField(f.key, f.db);
  });

  // --- ЛОГИКА ТИПОВ ПОСТАВОК ---
  let isEditingSupply = false;

  const renderSupplyTypes = () => {
    const list = document.getElementById('supplyTypesList');
    list.innerHTML = '';
    localSupplyTypes.forEach((st, index) => {
      const li = document.createElement('li');
      li.className = 'supply-item';
      li.innerHTML = `
        <span>${st.name}</span>
        <button class="btn-trash" data-index="${index}" style="display: ${isEditingSupply ? 'block' : 'none'};">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      `;
      list.appendChild(li);
    });
  };

  // Вкл/Выкл режима редактирования типов
  document.getElementById('btnEdit_supply').onclick = () => {
    isEditingSupply = true;
    document.getElementById('btnEdit_supply').style.display = 'none';
    document.getElementById('btnSave_supply').style.display = 'flex';
    document.getElementById('supplyAddRow').style.display = 'flex';
    renderSupplyTypes();
  };

  // Удаление из локального массива
  document.getElementById('supplyTypesList').addEventListener('click', (e) => {
    const trashBtn = e.target.closest('.btn-trash');
    if (trashBtn) {
      const index = trashBtn.dataset.index;
      localSupplyTypes.splice(index, 1);
      renderSupplyTypes();
    }
  });

  // Добавление в локальный массив
  document.getElementById('btnAddSupply').onclick = () => {
    const input = document.getElementById('newSupplyName');
    const name = input.value.trim();
    if (!name) return;
    const id = 'type_' + Math.random().toString(36).substr(2, 9);
    localSupplyTypes.push({ id, name });
    input.value = '';
    renderSupplyTypes();
  };

  // Сохранение в базу
  document.getElementById('btnSave_supply').onclick = async () => {
    const btn = document.getElementById('btnSave_supply');
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';

    const { error } = await sb.from('app_settings').update({ supply_types: localSupplyTypes }).eq('id', 1);
    
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';

    if (error) {
      alert('Ошибка сохранения: ' + error.message);
    } else {
      isEditingSupply = false;
      document.getElementById('btnEdit_supply').style.display = 'flex';
      document.getElementById('btnSave_supply').style.display = 'none';
      document.getElementById('supplyAddRow').style.display = 'none';
      renderSupplyTypes();
    }
  };

  loadSettings();
});
