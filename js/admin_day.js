document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const urlParams = new URLSearchParams(window.location.search);
  const selectedDate = urlParams.get('date');
  if (!selectedDate) return window.location.href = 'admin_calendar.html';

  const dateObj = new Date(selectedDate);
  document.getElementById('dateDisplay').innerText = dateObj.toLocaleDateString('ru-RU');

  // Инициализация роли
  const { data: { user } } = await sb.auth.getUser();
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  const isViewer = profile?.role === 'viewer';
  
  if (isViewer) {
    document.body.classList.add('role-viewer');
  }

  const { data: settings } = await sb.from('app_settings').select('*').eq('id', 1).single();
  const supplyTypes = {};
  settings.supply_types.forEach(st => supplyTypes[st.id] = st.name);
  const orderTypes = { 'order': 'Заказ', 'upd': 'УПД', 'etrn': 'ЭТрН' };

  // Отрисовка чекбоксов
  const fillCheckboxes = (containerId) => {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    settings.supply_types.forEach(st => {
      el.innerHTML += `<label style="display:flex; align-items:center; gap:4px; cursor:pointer;"><input type="checkbox" value="${st.id}"> ${st.name}</label>`;
    });
  };
  fillCheckboxes('mSupplyTypesGroup');
  fillCheckboxes('cSupplyTypesGroup');

  // 1. Загрузка данных бронирований
  const { data: bookings } = await sb
    .from('bookings')
    .select('id, slot_hour, order_number, order_type, supply_type, supply_types, arrival_time, departure_time, gate_number, is_tk, comment, registry_file_url, profiles(company_name, inn)')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  let allProfiles = [];
  let selectedSupplier = null; // Переменная для выбранного поставщика в умном поиске

  if (!isViewer) {
    const { data: profilesData } = await sb.from('profiles').select('id, company_name, inn').eq('role', 'supplier');
    if (profilesData) {
      allProfiles = profilesData;
    }

    // --- УМНЫЙ ПОИСК ПОСТАВЩИКА ---
    const searchInput = document.getElementById('cSupplierSearch');
    if (searchInput) {
      searchInput.removeAttribute('list'); // Отключаем стандартный datalist
      
      const resultsContainer = document.createElement('div');
      resultsContainer.style.cssText = 'position: absolute; background: #fff; border: 1px solid #cbd5e1; border-radius: 4px; max-height: 200px; overflow-y: auto; width: 100%; z-index: 99999; box-shadow: 0 4px 10px rgba(0,0,0,0.1); display: none; margin-top: 4px; left: 0; box-sizing: border-box;';
      
      const parent = searchInput.parentElement;
      parent.style.position = 'relative';
      parent.appendChild(resultsContainer);

      searchInput.addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        resultsContainer.innerHTML = '';
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
            item.innerHTML = `<strong style="color: #1e293b;">${p.company_name}</strong> <div style="color:#64748b; font-size:12px;">ИНН: ${p.inn}</div>`;
            
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
          resultsContainer.innerHTML = '<div style="padding: 10px; color: #ef4444; font-size: 13px; text-align: center;">Поставщик не найден</div>';
          resultsContainer.style.display = 'block';
        }
      });

      document.addEventListener('click', (e) => {
        if (e.target !== searchInput && e.target !== resultsContainer) {
          resultsContainer.style.display = 'none';
        }
      });
    }
  }

  const container = document.getElementById('hoursContainer');
  container.innerHTML = '';
  
  // 2. Отрисовка сетки
  for (let hour = settings.slot_start_hour; hour <= settings.slot_end_hour; hour++) {
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

    // Занятые резервные (Оранжевые)
    reserveCards.forEach(b => cardsHtml += generateCardHtml(b, 'reserve'));
    
    // Свободные резервные (Серые)
    const freeReserve = (settings.reserve_slots_per_hour || 3) - reserveCards.length;
    for(let i=0; i<freeReserve; i++) {
      cardsHtml += `
        <div class="booking-card ${isViewer ? 'viewer-hide' : ''}" style="border-left-color: #94a3b8; background: #f8fafc; border-color: #cbd5e1; cursor: pointer;" onclick="document.querySelector('.btn-add-slot[data-hour=\\'${hour}\\']').click()">
          <div style="color: #475569; font-weight: 600;">Резервный слот (Только Заказы ИМ)</div>
        </div>`;
    }

    // Занятые основные (Красные)
    mainCards.forEach(b => cardsHtml += generateCardHtml(b, 'main'));

    // Кнопка добавить (Свободные основные)
    const freeMain = settings.slots_per_hour - mainCards.length;
    if (freeMain > 0) {
      cardsHtml += `<div class="btn-add-slot viewer-hide" data-hour="${hour}" style="margin-top:10px;">+ Добавить запись (${freeMain} мест)</div>`;
    }

    const occupancyColor = mainCards.length === settings.slots_per_hour ? '#ef4444' : '#10b981';
    block.innerHTML = `
      <div class="hour-header">
        <span>${hour}:00 - ${hour+1}:00</span>
        <span style="font-size:14px; color:#64748b; font-weight:normal;">Занято осн.: <strong style="color:${occupancyColor}">${mainCards.length}/${settings.slots_per_hour}</strong></span>
      </div>
      <div class="cards-container">${cardsHtml}</div>
    `;
    container.appendChild(block);
  }

  function generateCardHtml(b, type) {
    const typesStr = b.supply_types?.length ? b.supply_types.map(t => supplyTypes[t] || t).join(', ') : (supplyTypes[b.supply_type] || b.supply_type);
    const oType = orderTypes[b.order_type] || b.order_type;
    const compName = b.profiles?.company_name || 'Неизвестно';
    
    const borderColor = type === 'reserve' ? '#f59e0b' : '#3b82f6';
    const bgColor = type === 'reserve' ? '#fffbeb' : '#f0f9ff';
    const borderOuter = type === 'reserve' ? '#fcd34d' : '#bfdbfe';

    const dataStr = encodeURIComponent(JSON.stringify({
      id: b.id, hour: b.slot_hour, doc: b.order_number, 
      sTypesRaw: b.supply_types || [b.supply_type], oTypeRaw: b.order_type, 
      fullCompany: `${compName} (ИНН: ${b.profiles?.inn || ''})`,
      is_tk: b.is_tk, comment: b.comment, registry_file_url: b.registry_file_url
    }));

    return `
      <div class="booking-card" data-info="${dataStr}" style="border-left-color: ${borderColor}; background: ${bgColor}; border-color: ${borderOuter};">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <strong style="color:#1f2937; margin-bottom:4px;">${compName}</strong>
          <button class="btn-dots" title="Подробнее">⋮</button>
        </div>
        <div style="color:#64748b; font-size:13px; margin-bottom: 5px;">${oType} №${b.order_number} • ${typesStr}</div>
        
        <div class="card-actions" data-id="${b.id}">
          <div class="inline-input-group">
            <label>Прибыл</label>
            <input type="time" class="inline-time inline-arr viewer-disable" value="${b.arrival_time ? b.arrival_time.substring(0,5) : ''}">
          </div>
          <div class="inline-input-group">
            <label>Убыл</label>
            <input type="time" class="inline-time inline-dep viewer-disable" value="${b.departure_time ? b.departure_time.substring(0,5) : ''}">
          </div>
          <div class="inline-input-group">
            <label>Ворота</label>
            <input type="text" class="inline-gate viewer-disable" value="${b.gate_number || ''}" placeholder="№">
          </div>
        </div>
      </div>`;
  }

  // --- АВТОСОХРАНЕНИЕ ПРИБЫЛ/УБЫЛ ---
  if (!isViewer) {
    container.addEventListener('change', async (e) => {
      if (e.target.classList.contains('inline-gate') || e.target.classList.contains('inline-time')) {
        const id = e.target.closest('.card-actions').dataset.id;
        let fieldName = e.target.classList.contains('inline-gate') ? 'gate_number' : (e.target.classList.contains('inline-arr') ? 'arrival_time' : 'departure_time');
        let val = e.target.value;
        if (e.target.type === 'time' && val) val = val + ':00'; 
        
        e.target.style.borderColor = '#3b82f6';
        const { error } = await sb.from('bookings').update({ [fieldName]: val || null }).eq('id', id);
        e.target.style.borderColor = error ? '#ef4444' : '#10b981';
      }
    });
  }

  // --- ЛОГИКА МОДАЛЬНЫХ ОКОН ---
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
      document.getElementById('mCompany').innerText = data.fullCompany;
      document.getElementById('mDoc').value = data.doc;
      document.getElementById('mOrderType').value = data.oTypeRaw;
      document.getElementById('mIsTk').checked = data.is_tk;
      document.getElementById('mComment').value = data.comment || '';
      
      const fileLink = document.getElementById('mFileLink');
      if (data.registry_file_url) {
        fileLink.href = data.registry_file_url;
        fileLink.style.display = 'inline-block';
      } else {
        fileLink.style.display = 'none';
      }

      document.querySelectorAll('#mSupplyTypesGroup input').forEach(cb => {
        cb.checked = data.sTypesRaw.includes(cb.value);
      });

      const mHourSelect = document.getElementById('mHour');
      mHourSelect.innerHTML = '';
      const isImOnly = data.sTypesRaw.length === 1 && data.sTypesRaw[0] === 'orders_im';

      for (let h = settings.slot_start_hour; h <= settings.slot_end_hour; h++) {
        const hourBookings = (bookings || []).filter(b => b.slot_hour === h);
        let mUsed = 0, rUsed = 0;
        
        hourBookings.forEach(b => {
          const t = b.supply_types?.length ? b.supply_types : [b.supply_type];
          if (t.length === 1 && t[0] === 'orders_im') {
            if (rUsed < (settings.reserve_slots_per_hour || 3)) rUsed++; else mUsed++;
          } else {
            mUsed++;
          }
        });

        let canMove = false;
        if (h === data.hour) {
          canMove = true; 
        } else if (isImOnly) {
          canMove = (rUsed < (settings.reserve_slots_per_hour || 3)) || (mUsed < settings.slots_per_hour);
        } else {
          canMove = (mUsed < settings.slots_per_hour);
        }

        if (canMove) {
          mHourSelect.innerHTML += `<option value="${h}" ${h === data.hour ? 'selected' : ''}>${h}:00 - ${h+1}:00</option>`;
        }
      }

      editModal.style.display = 'flex';
      return;
    }

    const addBtn = e.target.closest('.btn-add-slot');
    if (addBtn && !isViewer) {
      document.getElementById('cHour').value = addBtn.dataset.hour;
      document.getElementById('createForm').reset();
      selectedSupplier = null; // Сбрасываем выбранного поставщика при открытии окна
      createModal.style.display = 'flex';
    }
  });

  // --- ОБНОВЛЕНИЕ ЗАЯВКИ (АДМИН) ---
  if (!isViewer) {
    document.getElementById('btnUpdate').onclick = async () => {
      if (!confirm('Подтверждаете изменение?')) return;
      
      const selectedTypes = Array.from(document.querySelectorAll('#mSupplyTypesGroup input:checked')).map(cb => cb.value);
      if (selectedTypes.length === 0) return alert('Выберите хотя бы один тип поставки');

      const payload = {
        slot_hour: parseInt(document.getElementById('mHour').value),
        order_number: document.getElementById('mDoc').value.trim(),
        supply_types: selectedTypes,
        order_type: document.getElementById('mOrderType').value,
        is_tk: document.getElementById('mIsTk').checked,
        comment: document.getElementById('mComment').value.trim()
      };

      const { error } = await sb.from('bookings').update(payload).eq('id', document.getElementById('mId').value);
      if (error) alert('Ошибка обновления: ' + error.message);
      else window.location.reload();
    };

    document.getElementById('btnDelete').onclick = async () => {
      if (!confirm('Удалить запись?')) return;
      await sb.from('bookings').delete().eq('id', document.getElementById('mId').value);
      window.location.reload();
    };
  }

  // --- СОЗДАНИЕ ЗАЯВКИ (АДМИН) ---
  if (document.getElementById('createForm')) {
    document.getElementById('createForm').onsubmit = async (e) => {
      e.preventDefault();
      
      // Авто-подбор, если пользователь не кликнул по списку, а просто ввел текст
      if (!selectedSupplier) {
        const searchVal = document.getElementById('cSupplierSearch').value.trim().toLowerCase();
        const matches = allProfiles.filter(p => 
          (p.company_name && p.company_name.toLowerCase().includes(searchVal)) || 
          (p.inn && p.inn.toLowerCase().includes(searchVal))
        );

        if (matches.length === 1) {
          selectedSupplier = matches[0];
        } else if (matches.length > 1) {
          return alert('Найдено несколько поставщиков. Выберите конкретного из выпадающего списка под полем ввода.');
        } else {
          return alert('Поставщик не найден. Уточните запрос.');
        }
      }

      const selectedTypes = Array.from(document.querySelectorAll('#cSupplyTypesGroup input:checked')).map(cb => cb.value);
      if (selectedTypes.length === 0) return alert('Выберите хотя бы один тип поставки');

      const btn = document.getElementById('btnCreate');
      btn.innerText = 'Загрузка...'; btn.disabled = true;

      const fileInput = document.getElementById('cRegistryFile');
      const file = fileInput.files[0];
      let fileUrl = null;

      if (file) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${selectedSupplier.id}_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await sb.storage.from('registries').upload(fileName, file);
        if (uploadError) {
          alert('Ошибка загрузки файла');
          btn.innerText = 'Записать поставщика'; btn.disabled = false;
          return;
        }
        fileUrl = sb.storage.from('registries').getPublicUrl(fileName).data.publicUrl;
      }

      const payload = {
        profile_id: selectedSupplier.id,
        slot_date: selectedDate,
        slot_hour: parseInt(document.getElementById('cHour').value),
        supply_types: selectedTypes,
        order_type: document.getElementById('cOrderType').value,
        order_number: document.getElementById('cDoc').value.trim(),
        registry_file_url: fileUrl,
        is_tk: document.getElementById('cIsTk').checked,
        comment: document.getElementById('cComment').value.trim(),
        status: 'active'
      };

      const { error } = await sb.from('bookings').insert([payload]);
      if (error) alert('Ошибка записи: ' + error.message);
      else window.location.reload();
    };
  }
});
