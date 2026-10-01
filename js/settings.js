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
  generateOptions('edit_deadline', 1, 48, false);

  const dayNames = { 1:'Пн', 2:'Вт', 3:'Ср', 4:'Чт', 5:'Пт', 6:'Сб', 7:'Вс' };

  // Загрузка настроек с защитой от ошибок
  const loadSettings = async () => {
    try {
      const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
      
      if (error || !data) {
        document.querySelectorAll('.setting-value, .days-view').forEach(el => el.textContent = '⚠️ Ошибка БД');
        console.error('Ошибка БД:', error);
        return alert('База данных не вернула настройки. Убедитесь, что вы выполнили SQL-запрос для создания таблицы app_settings!');
      }
      
      currentSettings = data;
      localSupplyTypes = JSON.parse(JSON.stringify(data.supply_types || []));

      // Защита от null с помощью ?? (значения по умолчанию)
      const sHour = data.slot_start_hour ?? 9;
      document.getElementById('view_startHour').textContent = `${sHour}:00`;
      document.getElementById('edit_startHour').value = sHour;

      const eHour = data.slot_end_hour ?? 17;
      document.getElementById('view_endHour').textContent = `${eHour}:00`;
      document.getElementById('edit_endHour').value = eHour;

      const sPer = data.slots_per_hour ?? 5;
      document.getElementById('view_slotsPer').textContent = sPer;
      document.getElementById('edit_slotsPer').value = sPer;

      const dLine = data.booking_deadline_hours ?? 1;
      document.getElementById('view_deadline').textContent = dLine;
      document.getElementById('edit_deadline').value = dLine;

      const daysArr = data.available_days || [1, 2, 3, 4, 5];
      const activeDaysText = daysArr.map(d => dayNames[d]).join(', ');
      document.getElementById('view_days').textContent = activeDaysText || 'Нет активных дней';
      
      const checkboxes = document.querySelectorAll('#edit_days input[type="checkbox"]');
      checkboxes.forEach(cb => {
        cb.checked = daysArr.includes(parseInt(cb.value));
      });

      renderSupplyTypes();
    } catch (err) {
      console.error('Критическая ошибка скрипта:', err);
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
    { key: 'deadline', db: 'booking_deadline_hours' },
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
        isEditingSupply = false;
        document.getElementById('btnEdit_supply').style.display = 'flex';
        btnSaveSupply.style.display = 'none';
        document.getElementById('supplyAddRow').style.display = 'none';
        renderSupplyTypes();
      }
    };
  }

  loadSettings();
});
