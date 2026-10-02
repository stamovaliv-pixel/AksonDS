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

  // Пиктограммы для типов поставок 
  const typeIcons = {
    'orders_im': '📦',   // Заказы ИМ
    'return': '↩️',      // Возврат
    'mix': '🔀',         // МИКС
  };

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

  // Загрузка данных бронирований
  const { data: bookings } = await sb
    .from('bookings')
    .select('id, slot_hour, order_number, order_type, supply_type, supply_types, arrival_time, departure_time, gate_number, is_tk, comment, registry_file_url, profiles(company_name, inn)')
    .eq('slot_date', selectedDate)
    .eq('status', 'active');

  let allProfiles = [];
  let selectedSupplier = null;

  if (!isViewer) {
    // ОБНОВЛЕНО: Теперь поиск идет по ВСЕМ пользователям базы данных (убран фильтр .eq('role', 'supplier'))
    const { data: profilesData } = await sb.from('profiles').select('id, company_name, inn');
    if (profilesData) {
      allProfiles = profilesData;
    }

    // --- УМНЫЙ ПОИСК ПОСТАВЩИКА ---
    const searchInput = document.getElementById('cSupplierSearch');
    if (searchInput) {
      searchInput.removeAttribute('list'); 
      
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
          resultsContainer.innerHTML = '<div style="padding: 10px; color: #ef4444; font-size: 13px; text-align: center;">Пользователь не найден</div>';
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
  
  // 2. ОТРИСОВКА СЕТКИ СЛОТОВ
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
    const limitMain = settings.slots_per_hour || 5;
    const limitRes = settings.reserve_slots_per_hour || 3;

    // Функция создания занятой карточки
    const generateBookedCardHtml = (b, cssClass) => {
      const typesArr = b.supply_types?.length ? b.supply_types : [b.supply_type];
      
      const iconsHtml = typesArr.map(t => {
        const icon = typeIcons[t] || '🏷️';
        const title = supplyTypes[t] || t;
        return `<span title="${title}">${icon}</span>`;
      }).join(' ');

      const compName = b.profiles?.company_name || 'Неизвестно';
      const tkHtml = b.is_tk ? `<div class="tk-dot" title="Транспортная компания (ТК)"></div>` : ``;

      const dataStr = encodeURIComponent(JSON.stringify({
        id: b.id, hour: b.slot_hour, doc: b.order_number, 
        sTypesRaw: b.supply_types || [b.supply_type], oTypeRaw: b.order_type, 
        fullCompany: `${compName} (ИНН: ${b.profiles?.inn || ''})`,
        is_tk: b.is_tk, comment: b.comment, registry_file_url: b.registry_file_url
      }));

      return `
        <div class="slot-box ${cssClass}" data-info="${dataStr}">
          <div class="sb-header">
            <div class="sb-title" title="${compName}">${compName}</div>
            <button class="btn-dots">⋮</button>
          </div>
          <div class="sb-icons">
            <div style="display:flex; gap:4px; font-size:16px;">${iconsHtml}</div>
            ${tkHtml}
          </div>
          <div class="card-actions" data-id="${b.id}">
            <div class="inline-input-group"><label>Приб.</label><input type="time" class="inline-arr viewer-disable" value="${b.arrival_time ? b.arrival_time.substring(0,5) : ''}"></div>
            <div class="inline-input-group"><label>Убыл</label><input type="time" class="inline-dep viewer-disable" value="${b.departure_time ? b.departure_time.substring(0,5) : ''}"></div>
            <div class="inline-input-group"><label>Вор.</label><input type="text" class="inline-gate viewer-disable" value="${b.gate_number || ''}"></div>
          </div>
        </div>`;
    };

    // Отрисовка Основных слотов
    for(let i=0; i<limitMain; i++) {
      if (mainCards[i]) {
        cardsHtml += generateBookedCardHtml(mainCards[i], 'main-booked');
      } else {
        cardsHtml += `
          <div class="slot-box main-empty sb-empty ${isViewer ? 'viewer-hide' : ''}" data-hour="${hour}">
            <div class="sb-empty-text">+ Осн. слот<br><span style="font-size:11px; font-weight:normal;">Свободно</span></div>
          </div>`;
      }
    }

    // Отрисовка Резервных слотов
    for(let i=0; i<limitRes; i++) {
      if (reserveCards[i]) {
        cardsHtml += generateBookedCardHtml(reserveCards[i], 'res-booked');
      } else {
        cardsHtml += `
          <div class="slot-box res-empty sb-empty ${isViewer ? 'viewer-hide' : ''}" data-hour="${hour}">
            <div class="sb-empty-text">+ Резерв<br><span style="font-size:11px; font-weight:normal;">Только ИМ</span></div>
          </div>`;
      }
    }

    block.innerHTML = `
      <div class="hour-header">
        <span>${hour}:00 - ${hour+1}:00</span>
      </div>
      <div class="cards-grid">${cardsHtml}</div>
    `;
    container.appendChild(block);
  }

  // --- АВТОСОХРАНЕНИЕ ПРИБЫЛ/УБЫЛ ---
  if (!isViewer) {
    container.addEventListener('change', async (e) => {
      if (e.target.classList.contains('inline-gate') || e.target.classList.contains('inline-arr') || e.target.classList.contains('inline-dep')) {
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

  // --- ЛОГИКА КЛИКОВ ---
  const editModal = document.getElementById('editModal');
  const createModal = document.getElementById('createModal');
  document.getElementById('closeEditModal').onclick = () => editModal.style.display = 'none';
  document.getElementById('closeCreateModal').onclick = () => createModal.style.display = 'none';

  container.addEventListener('click', (e) => {
    // 1. Клик на "⋮" (Редактировать)
    const dotsBtn = e.target.closest('.btn-dots');
    if (dotsBtn) {
      const card = dotsBtn.closest('.slot-box');
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
        if (h === data.hour) canMove = true; 
        else if (isImOnly) canMove = (rUsed < (settings.reserve_slots_per_hour || 3)) || (mUsed < settings.slots_per_hour);
        else canMove = (mUsed < settings.slots_per_hour);

        if (canMove) {
          mHourSelect.innerHTML += `<option value="${h}" ${h === data.hour ? 'selected' : ''}>${h}:00 - ${h+1}:00</option>`;
        }
      }

      editModal.style.display = 'flex';
      return;
    }

    // 2. Клик на пустой слот
    const emptySlot = e.target.closest('.sb-empty');
    if (emptySlot && !isViewer) {
      document.getElementById('cHour').value = emptySlot.dataset.hour;
      document.getElementById('createForm').reset();
      selectedSupplier = null; 
      
      if(emptySlot.classList.contains('res-empty')) {
         const imCb = document.querySelector('#cSupplyTypesGroup input[value="orders_im"]');
         if(imCb) imCb.checked = true;
      }
      
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
      
      if (!selectedSupplier) {
        const searchVal = document.getElementById('cSupplierSearch').value.trim().toLowerCase();
        const matches = allProfiles.filter(p => 
          (p.company_name && p.company_name.toLowerCase().includes(searchVal)) || 
          (p.inn && p.inn.toLowerCase().includes(searchVal))
        );

        if (matches.length === 1) selectedSupplier = matches[0];
        else if (matches.length > 1) return alert('Найдено несколько поставщиков. Выберите из списка.');
        else return alert('Поставщик не найден.');
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
