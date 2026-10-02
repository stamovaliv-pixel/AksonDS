document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || !['admin', 'operator', 'viewer'].includes(profile.role)) {
    return window.location.href = 'calendar.html';
  }

  const isAdmin = profile.role === 'admin';
  const isViewer = profile.role === 'viewer';
  
  if (isViewer) document.body.classList.add('role-viewer');

  const pastToggle = document.getElementById('showPastBtn');
  if (isAdmin && pastToggle) {
    document.getElementById('adminPastToggleContainer').style.display = 'flex';
  }

  document.getElementById('logoutBtn').onclick = async (e) => {
    e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html';
  };

  const { data: settingsData } = await sb.from('app_settings').select('*').eq('id', 1).single();
  const settings = settingsData || {
    slot_start_hour: 9,
    slot_end_hour: 17,
    available_days: [1, 2, 3, 4, 5, 6, 7],
    supply_types: []
  };

  // Стили для неактивных дней в календаре
  const styleBlock = document.createElement('style');
  styleBlock.innerHTML = `
    .day-cell.inactive::before { display: block !important; }
    .day-cell.inactive { background-color: #f1f5f9 !important; opacity: 0.5 !important; cursor: pointer !important; pointer-events: auto !important; }
  `;
  document.head.appendChild(styleBlock);

  const getSupplyIcon = (id, name) => {
    const n = (name || '').toLowerCase();
    if (id === 'orders_im' || n.includes('им')) return '📦';
    if (id === 'return' || n.includes('возврат')) return '↩️';
    if (id === 'mix' || n.includes('микс')) return '🔀';
    if (n.includes('сток')) return '🏭';
    if (n.includes('кросс')) return '🚚';
    return '🏷️'; 
  };

  const filterSupplyType = document.getElementById('filterSupplyType');
  if (filterSupplyType && settings.supply_types) {
    filterSupplyType.innerHTML = '<option value="">Все типы</option>';
    settings.supply_types.forEach(st => {
      filterSupplyType.innerHTML += `<option value="${st.id}">${st.name}</option>`;
    });
  }

  const fillCheckboxes = (containerId) => {
    const el = document.getElementById(containerId);
    if (!el || !settings.supply_types) return;
    el.innerHTML = '';
    settings.supply_types.forEach(st => {
      const icon = getSupplyIcon(st.id, st.name);
      el.innerHTML += `<label style="display:flex; align-items:center; gap:4px; cursor:pointer; white-space:nowrap;"><input type="checkbox" value="${st.id}"> ${icon} ${st.name}</label>`;
    });
  };
  fillCheckboxes('mSupplyTypesGroup');

  const mHourSelect = document.getElementById('mHour');
  if (mHourSelect) {
    mHourSelect.innerHTML = '';
    for (let h = (settings.slot_start_hour ?? 9); h <= (settings.slot_end_hour ?? 17); h++) {
      mHourSelect.innerHTML += `<option value="${h}">${h}:00 - ${h+1}:00</option>`;
    }
  }

  const today = new Date(); 
  today.setHours(0,0,0,0);
  const maxActiveDate = new Date(today);
  maxActiveDate.setDate(today.getDate() + 29);

  const renderCalendar = async () => {
    const filterSupplier = document.getElementById('filterSupplier').value.trim();
    const filterDoc = document.getElementById('filterDoc').value.trim();
    const filterSupply = document.getElementById('filterSupplyType').value;
    const filterOrder = document.getElementById('filterOrderType').value;
    const showPast = isAdmin && pastToggle && pastToggle.checked;

    const isSearchActive = filterSupplier !== '' || filterDoc !== '' || filterSupply !== '' || filterOrder !== '';

    let query = sb.from('bookings').select('id, slot_date, slot_hour, order_number, order_type, supply_type, supply_types, is_tk, comment, registry_file_url, profiles!inner(company_name, inn)').eq('status', 'active');
    
    if (filterDoc) query = query.ilike('order_number', `%${filterDoc}%`);
    if (filterOrder) query = query.eq('order_type', filterOrder);
    if (filterSupplier) query = query.or(`company_name.ilike.%${filterSupplier}%,inn.ilike.%${filterSupplier}%`, { foreignTable: 'profiles' });
    
    if (filterSupply) {
      query = query.contains('supply_types', [filterSupply]);
    }

    const { data: bookings } = await query;
    const bookedDates = new Set((bookings || []).map(b => b.slot_date));

    // 1. ОТРИСОВКА СЕТКИ КАЛЕНДАРЯ
    const startDate = new Date(today);
    if (showPast) {
      startDate.setDate(today.getDate() - 30);
    } else {
      const diffToMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
      startDate.setDate(today.getDate() - diffToMonday);
    }

    const totalDays = showPast ? 60 : 35;
    const grid = document.getElementById('calendarGrid');
    if (grid) {
      grid.innerHTML = '';
      for (let i = 0; i < totalDays; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const isoDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        
        const isPastOrFuture = d < today || d > maxActiveDate;
        const jsDay = d.getDay();
        const dbDay = jsDay === 0 ? 7 : jsDay;
        const allowedDays = settings.available_days || [1,2,3,4,5,6,7];
        const isAllowedDay = allowedDays.includes(dbDay);
        
        if (isPastOrFuture || !isAllowedDay) cell.classList.add('inactive'); 
        if (bookedDates.has(isoDate)) cell.classList.add('booked'); 
        
        cell.innerHTML = `<div class="date-text">${d.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit'})}</div>`;
        cell.onclick = () => window.location.href = `admin_day.html?date=${isoDate}`;
        
        grid.appendChild(cell);
      }
    }

    // 2. ОТРИСОВКА БЛОКА "НАЙДЕННЫЕ ЗАПИСИ"
    const listContainer = document.getElementById('upcomingBookingsList');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    if (!isSearchActive) {
      for (let i = 0; i < 7; i++) {
        listContainer.innerHTML += `<div class="booking-item empty"><div style="color: #94a3b8; font-size: 13px; font-weight: 500;">Введите параметры поиска</div></div>`;
      }
      return; 
    }

    const upcoming = (bookings || []).filter(b => new Date(b.slot_date) >= today).sort((a, b) => new Date(a.slot_date) - new Date(b.slot_date) || a.slot_hour - b.slot_hour).slice(0, 14);

    if (upcoming.length === 0) {
      listContainer.innerHTML = `<div style="grid-column: 1 / -1; color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 20px;">По вашему запросу ничего не найдено.</div>`;
    } else {
      const dict = {}; 
      if (settings.supply_types) {
        settings.supply_types.forEach(st => dict[st.id] = st.name);
      }

      upcoming.forEach(b => {
        const typesArr = b.supply_types?.length ? b.supply_types : [b.supply_type];
        const iconsHtml = typesArr.map(t => {
          const name = dict[t] || t;
          return `<span title="${name}">${getSupplyIcon(t, name)}</span>`;
        }).join(' ');

        const item = document.createElement('div');
        item.className = 'booking-item';
        
        const dataStr = encodeURIComponent(JSON.stringify({
          id: b.id, date: b.slot_date, hour: b.slot_hour, doc: b.order_number, 
          sTypesRaw: b.supply_types || [b.supply_type], oTypeRaw: b.order_type, 
          is_tk: b.is_tk, comment: b.comment, registry_file_url: b.registry_file_url,
          fullCompany: `${b.profiles.company_name} (ИНН: ${b.profiles.inn})`
        }));
        
        const compName = b.profiles.company_name || 'Неизвестно';
        const dateFormatted = new Date(b.slot_date).toLocaleDateString('ru-RU');
        const timeFormatted = `${b.slot_hour}:00 - ${b.slot_hour + 1}:00`;
        
        item.innerHTML = `
          <div class="bi-company" title="${compName}">${compName}</div>
          <div class="bi-top">
            <span>${dateFormatted}</span>
            <span>${timeFormatted}</span>
          </div>
          <div class="bi-bottom">
            <div class="bi-icons">${iconsHtml}</div>
          </div>
        `;
        
        item.onclick = () => openEditModal(dataStr);
        listContainer.appendChild(item);
      });
    }
  };

  const editModal = document.getElementById('editModal');
  const closeEditModalBtn = document.getElementById('closeEditModal');
  if (closeEditModalBtn) closeEditModalBtn.onclick = () => editModal.style.display = 'none';

  function openEditModal(dataStr) {
    const data = JSON.parse(decodeURIComponent(dataStr));
    document.getElementById('mId').value = data.id;
    document.getElementById('mDate').value = data.date;
    document.getElementById('mHour').value = data.hour;
    document.getElementById('mDoc').value = data.doc;
    document.getElementById('mOrderType').value = data.oTypeRaw;
    document.getElementById('mCompany').innerText = data.fullCompany;
    document.getElementById('mIsTk').checked = data.is_tk || false;
    document.getElementById('mComment').value = data.comment || '';
    
    const fileLink = document.getElementById('mFileLink');
    if (fileLink) {
      if (data.registry_file_url) {
        fileLink.href = data.registry_file_url;
        fileLink.style.display = 'inline-block';
      } else {
        fileLink.style.display = 'none';
      }
    }

    document.querySelectorAll('#mSupplyTypesGroup input').forEach(cb => {
      cb.checked = data.sTypesRaw.includes(cb.value);
    });
    
    editModal.style.display = 'flex';
  }

  if (!isViewer) {
    const btnUpdate = document.getElementById('btnUpdate');
    if (btnUpdate) {
      btnUpdate.onclick = async () => {
        if (!confirm('Подтверждаете изменение записи?')) return;
        
        const selectedTypes = Array.from(document.querySelectorAll('#mSupplyTypesGroup input:checked')).map(cb => cb.value);
        if (selectedTypes.length === 0) return alert('Выберите хотя бы один тип поставки');

        const payload = {
          slot_date: document.getElementById('mDate').value,
          slot_hour: parseInt(document.getElementById('mHour').value),
          order_number: document.getElementById('mDoc').value.trim(),
          supply_types: selectedTypes,
          order_type: document.getElementById('mOrderType').value,
          is_tk: document.getElementById('mIsTk').checked,
          comment: document.getElementById('mComment').value.trim()
        };
        
        const { error } = await sb.from('bookings').update(payload).eq('id', document.getElementById('mId').value);
        if (error) alert('Ошибка обновления: ' + error.message);
        else { editModal.style.display = 'none'; renderCalendar(); }
      };
    }

    const btnDelete = document.getElementById('deleteBookingBtn');
    if (btnDelete) {
      btnDelete.onclick = async () => {
        if (!confirm('ВНИМАНИЕ! Вы точно хотите удалить эту запись поставщика?')) return;
        const { error } = await sb.from('bookings').delete().eq('id', document.getElementById('mId').value);
        if (error) alert('Ошибка удаления: ' + error.message);
        else { editModal.style.display = 'none'; renderCalendar(); }
      };
    }
  }

  const applyBtn = document.getElementById('applyFiltersBtn');
  const resetBtn = document.getElementById('resetFiltersBtn');
  if (applyBtn) applyBtn.onclick = renderCalendar;
  if (resetBtn) resetBtn.onclick = () => {
    document.getElementById('filterSupplier').value = '';
    document.getElementById('filterDoc').value = '';
    document.getElementById('filterSupplyType').value = '';
    document.getElementById('filterOrderType').value = '';
    renderCalendar();
  };
  if (pastToggle) pastToggle.onchange = renderCalendar;

  renderCalendar();
});
