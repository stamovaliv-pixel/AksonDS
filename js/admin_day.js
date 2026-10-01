document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const urlParams = new URLSearchParams(window.location.search);
  const selectedDate = urlParams.get('date');
  if (!selectedDate) return window.location.href = 'admin_calendar.html';

  const dateObj = new Date(selectedDate);
  document.getElementById('dateDisplay').innerText = dateObj.toLocaleDateString('ru-RU');

  // ЗАГРУЗКА ГЛОБАЛЬНЫХ НАСТРОЕК
  const { data: settings } = await sb.from('app_settings').select('*').eq('id', 1).single();
  if (!settings) return console.error("Ошибка загрузки настроек");

  // Динамические словари
  const supplyTypes = {};
  settings.supply_types.forEach(st => supplyTypes[st.id] = st.name);
  const orderTypes = { 'order': 'Заказ', 'upd': 'УПД', 'etrn': 'ЭТрН' };

  // Динамическое заполнение Select элементов в модальных окнах
  const fillSelects = (elementId) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = '';
    settings.supply_types.forEach(st => {
      const opt = document.createElement('option');
      opt.value = st.id;
      opt.textContent = st.name;
      el.appendChild(opt);
    });
  };
  fillSelects('mSupplyType');
  fillSelects('cSupplyType');

  // Динамическое заполнение часов слотов в окне редактирования
  const mHourSelect = document.getElementById('mHour');
  if (mHourSelect) {
    mHourSelect.innerHTML = '';
    for (let h = settings.slot_start_hour; h <= settings.slot_end_hour; h++) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = `${h}:00 - ${h+1}:00`;
      mHourSelect.appendChild(opt);
    }
  }

  // 1. Загружаем все бронирования
  const { data: bookings } = await sb
    .from('bookings')
    .select('id, slot_hour, order_number, order_type, supply_type, arrival_time, departure_time, gate_number, profiles(company_name, inn)')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  // 2. Загружаем список всех поставщиков
  let allProfiles = [];
  const { data: profilesData } = await sb.from('profiles').select('id, company_name, inn').eq('role', 'supplier');
  if (profilesData) {
    allProfiles = profilesData;
    const dataList = document.getElementById('suppliersList');
    profilesData.forEach(p => {
      const option = document.createElement('option');
      option.value = `${p.company_name} (ИНН: ${p.inn})`;
      dataList.appendChild(option);
    });
  }

  const container = document.getElementById('hoursContainer');
  container.innerHTML = '';
  
  // 3. Отрисовка сетки часов с использованием настроек
  for (let hour = settings.slot_start_hour; hour <= settings.slot_end_hour; hour++) {
    const hourBookings = (bookings || []).filter(b => b.slot_hour === hour);
    const block = document.createElement('div');
    block.className = 'hour-block';
    
    let cardsHtml = hourBookings.map(b => {
      const sType = supplyTypes[b.supply_type] || b.supply_type;
      const oType = orderTypes[b.order_type] || b.order_type;
      const compName = b.profiles?.company_name || 'Неизвестно';
      
      const arrTime = b.arrival_time ? b.arrival_time.substring(0,5) : '';
      const depTime = b.departure_time ? b.departure_time.substring(0,5) : '';
      const gate = b.gate_number || '';

      const dataStr = encodeURIComponent(JSON.stringify({
        id: b.id, hour: b.slot_hour, doc: b.order_number, sTypeRaw: b.supply_type, oTypeRaw: b.order_type,
        fullCompany: `${compName} (ИНН: ${b.profiles?.inn || ''})`
      }));

      return `
        <div class="booking-card" data-info="${dataStr}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <strong style="color:#1f2937; margin-bottom:4px;">${compName}</strong>
            <button class="btn-dots" title="Подробнее">⋮</button>
          </div>
          <div style="color:#64748b; font-size:13px;">${oType} №${b.order_number} • ${sType}</div>
          
          <div class="card-actions" data-id="${b.id}">
            <div class="inline-input-group">
              <label>Прибыл</label>
              <input type="time" class="inline-time inline-arr" value="${arrTime}">
            </div>
            <div class="inline-input-group">
              <label>Убыл</label>
              <input type="time" class="inline-time inline-dep" value="${depTime}">
            </div>
            <div class="inline-input-group">
              <label>Ворота</label>
              <input type="text" class="inline-gate" value="${gate}" placeholder="№">
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Используем лимит мест из настроек
    if (hourBookings.length < settings.slots_per_hour) {
      cardsHtml += `<div class="btn-add-slot" data-hour="${hour}">+ Добавить запись (${settings.slots_per_hour - hourBookings.length} мест)</div>`;
    }

    const occupancyColor = hourBookings.length === settings.slots_per_hour ? '#ef4444' : '#10b981';

    block.innerHTML = `
      <div class="hour-header">
        <span>${hour}:00 - ${hour+1}:00</span>
        <span style="font-size:14px; color:#64748b; font-weight:normal;">Занято: <strong style="color:${occupancyColor}">${hourBookings.length}/${settings.slots_per_hour}</strong></span>
      </div>
      <div class="cards-container">${cardsHtml}</div>
    `;
    container.appendChild(block);
  }

  // --- ЛОГИКА МГНОВЕННОГО СОХРАНЕНИЯ ---
  container.addEventListener('focusin', (e) => {
    if (e.target.classList.contains('inline-time') && !e.target.value) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      e.target.value = `${hh}:${mm}`;
      saveInlineField(e.target);
    }
  });

  container.addEventListener('change', (e) => {
    if (e.target.classList.contains('inline-gate') || e.target.classList.contains('inline-time')) {
      saveInlineField(e.target);
    }
  });

  async function saveInlineField(inputEl) {
    const cardActions = inputEl.closest('.card-actions');
    const id = cardActions.dataset.id;
    
    let fieldName = '';
    if (inputEl.classList.contains('inline-gate')) fieldName = 'gate_number';
    else if (inputEl.classList.contains('inline-arr')) fieldName = 'arrival_time';
    else if (inputEl.classList.contains('inline-dep')) fieldName = 'departure_time';

    let val = inputEl.value;
    if (inputEl.type === 'time' && val) val = val + ':00'; 

    inputEl.style.borderColor = '#3b82f6'; 
    
    const { error } = await sb.from('bookings').update({ [fieldName]: val || null }).eq('id', id);
    
    if (error) {
      inputEl.style.borderColor = '#ef4444';
      alert('Ошибка автосохранения: ' + error.message);
    } else {
      inputEl.style.borderColor = '#10b981';
      setTimeout(() => inputEl.style.borderColor = '#fca5a5', 1000);
    }
  }

  const editModal = document.getElementById('editModal');
  const createModal = document.getElementById('createModal');
  
  document.getElementById('closeEditModal').onclick = () => editModal.style.display = 'none';
  document.getElementById('closeCreateModal').onclick = () => createModal.style.display = 'none';

  container.addEventListener('click', (e) => {
    const dotsBtn = e.target.closest('.btn-dots');
    if (dotsBtn) {
      const card = dotsBtn.closest('.booking-card');
      const data = JSON.parse(decodeURIComponent(card.dataset.info));
      
      document.getElementById('mId').value = data.id;
      document.getElementById('mHour').value = data.hour;
      document.getElementById('mDoc').value = data.doc;
      
      const sType = document.getElementById('mSupplyType');
      if ([...sType.options].map(o => o.value).includes(data.sTypeRaw)) {
        sType.value = data.sTypeRaw;
      }
      
      document.getElementById('mOrderType').value = data.oTypeRaw;
      document.getElementById('mCompany').innerText = data.fullCompany;
      
      editModal.style.display = 'flex';
      return;
    }

    const addBtn = e.target.closest('.btn-add-slot');
    if (addBtn) {
      document.getElementById('cHour').value = addBtn.dataset.hour;
      document.getElementById('cSupplierSearch').value = '';
      document.getElementById('cDoc').value = '';
      createModal.style.display = 'flex';
    }
  });

  document.getElementById('btnUpdate').onclick = async () => {
    if (!confirm('Подтверждаете изменение записи?')) return;
    const id = document.getElementById('mId').value;
    const payload = {
      slot_hour: parseInt(document.getElementById('mHour').value),
      order_number: document.getElementById('mDoc').value.trim(),
      supply_type: document.getElementById('mSupplyType').value,
      order_type: document.getElementById('mOrderType').value
    };

    const { error } = await sb.from('bookings').update(payload).eq('id', id);
    if (error) alert('Ошибка обновления: ' + error.message);
    else window.location.reload();
  };

  document.getElementById('btnDelete').onclick = async () => {
    if (!confirm('ВНИМАНИЕ! Вы точно хотите удалить эту запись поставщика?')) return;
    const id = document.getElementById('mId').value;
    const { error } = await sb.from('bookings').delete().eq('id', id);
    if (error) alert('Ошибка удаления: ' + error.message);
    else window.location.reload();
  };

  document.getElementById('createForm').onsubmit = async (e) => {
    e.preventDefault();
    const searchVal = document.getElementById('cSupplierSearch').value.trim();
    
    const found = allProfiles.find(p => 
      `${p.company_name} (ИНН: ${p.inn})` === searchVal || 
      p.inn === searchVal || 
      p.company_name.toLowerCase() === searchVal.toLowerCase()
    );

    if (!found) return alert('Поставщик не найден. Выберите из списка.');

    const btn = document.getElementById('btnCreate');
    btn.disabled = true; btn.innerText = 'Запись...';

    const payload = {
      profile_id: found.id,
      slot_date: selectedDate,
      slot_hour: parseInt(document.getElementById('cHour').value),
      supply_type: document.getElementById('cSupplyType').value,
      order_type: document.getElementById('cOrderType').value,
      order_number: document.getElementById('cDoc').value.trim(),
      status: 'active'
    };

    const { error: insertError } = await sb.from('bookings').insert([payload]);

    if (insertError) {
      alert('Ошибка записи: ' + insertError.message);
      btn.disabled = false; btn.innerText = 'Записать поставщика';
    } else {
      window.location.reload();
    }
  };
});
