document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || (profile.role !== 'operator' && profile.role !== 'admin')) {
    return window.location.href = 'calendar.html';
  }

  const isAdmin = profile.role === 'admin';
  const pastToggle = document.getElementById('showPastBtn');
  if (isAdmin && pastToggle) {
    document.getElementById('adminPastToggleContainer').style.display = 'flex';
  }

  document.getElementById('logoutBtn').onclick = async (e) => {
    e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html';
  };

  // ЗАГРУЗКА ГЛОБАЛЬНЫХ НАСТРОЕК
  const { data: settings } = await sb.from('app_settings').select('*').eq('id', 1).single();

  // Внедряем стили для неактивных дней (Они серые, но КЛИКАБЕЛЬНЫЕ для админа/оператора)
  const styleBlock = document.createElement('style');
  styleBlock.innerHTML = `
    .day-cell.inactive::before { display: none !important; }
    .day-cell.inactive { background-color: #f1f5f9 !important; opacity: 0.6 !important; cursor: pointer !important; }
    .day-cell.inactive.booked::before { display: block !important; background-color: #ef4444 !important; }
  `;
  document.head.appendChild(styleBlock);

  const fillSelects = (elementId) => {
    const el = document.getElementById(elementId);
    if (!el || !settings) return;
    el.innerHTML = elementId === 'filterSupplyType' ? '<option value="">Все типы</option>' : '';
    settings.supply_types.forEach(st => {
      const opt = document.createElement('option');
      opt.value = st.id;
      opt.textContent = st.name;
      el.appendChild(opt);
    });
  };
  
  fillSelects('filterSupplyType');
  fillSelects('mSupplyType');

  const mHourSelect = document.getElementById('mHour');
  if (mHourSelect && settings) {
    mHourSelect.innerHTML = '';
    for (let h = settings.slot_start_hour; h <= settings.slot_end_hour; h++) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = `${h}:00 - ${h+1}:00`;
      mHourSelect.appendChild(opt);
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

    let query = sb.from('bookings').select('id, slot_date, slot_hour, order_number, order_type, supply_type, profiles!inner(company_name, inn)').eq('status', 'active');
    
    if (filterDoc) query = query.ilike('order_number', `%${filterDoc}%`);
    if (filterSupply) query = query.eq('supply_type', filterSupply);
    if (filterOrder) query = query.eq('order_type', filterOrder);
    if (filterSupplier) query = query.or(`company_name.ilike.%${filterSupplier}%,inn.ilike.%${filterSupplier}%`, { foreignTable: 'profiles' });

    const { data: bookings } = await query;
    const bookedDates = new Set((bookings || []).map(b => b.slot_date));

    const startDate = new Date(today);
    if (showPast) {
      startDate.setDate(today.getDate() - 30);
    } else {
      const diffToMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
      startDate.setDate(today.getDate() - diffToMonday);
    }

    const totalDays = showPast ? 60 : 35;
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const isoDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      
      const cell = document.createElement('div');
      cell.className = 'day-cell';
      
      // Проверка доступности дня
      const isPastOrFuture = d < today || d > maxActiveDate;
      const jsDay = d.getDay();
      const dbDay = jsDay === 0 ? 7 : jsDay;
      const isAllowedDay = settings.available_days ? settings.available_days.includes(dbDay) : true;
      
      if (isPastOrFuture || !isAllowedDay) cell.classList.add('inactive'); 
      if (bookedDates.has(isoDate)) cell.classList.add('booked'); 
      
      cell.innerHTML = `<div class="date-text">${d.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit'})}</div>`;
      
      // БЛОКИРОВКА КЛИКА УБРАНА. Админ может провалиться в любой день:
      cell.onclick = () => window.location.href = `admin_day.html?date=${isoDate}`;
      
      grid.appendChild(cell);
    }

    const listContainer = document.getElementById('upcomingBookingsList');
    listContainer.innerHTML = '';
    
    if (!isSearchActive) {
      for (let i = 0; i < 14; i++) {
        listContainer.innerHTML += `<div class="booking-item empty"><div style="color: #94a3b8; font-size: 13px; font-weight: 500;">Нет данных</div></div>`;
      }
      return; 
    }

    const upcoming = (bookings || []).filter(b => new Date(b.slot_date) >= today).sort((a, b) => new Date(a.slot_date) - new Date(b.slot_date) || a.slot_hour - b.slot_hour).slice(0, 14);

    if (upcoming.length === 0) {
      listContainer.innerHTML = `<div style="grid-column: 1 / -1; color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 20px;">По вашему запросу ничего не найдено.</div>`;
    } else {
      upcoming.forEach(b => {
        const item = document.createElement('div');
        item.className = 'booking-item';
        const dataStr = encodeURIComponent(JSON.stringify({
          id: b.id, date: b.slot_date, hour: b.slot_hour, doc: b.order_number, sTypeRaw: b.supply_type, oTypeRaw: b.order_type, fullCompany: `${b.profiles.company_name} (ИНН: ${b.profiles.inn})`
        }));
        const shortName = b.profiles.company_name.length > 18 ? b.profiles.company_name.substring(0,18) + '...' : b.profiles.company_name;
        item.innerHTML = `<div class="booking-date">${new Date(b.slot_date).toLocaleDateString('ru-RU')}</div><div style="font-size: 12px; color: var(--color-primary); font-weight: 600;">${shortName}</div><div class="booking-time">${b.slot_hour}:00</div>`;
        item.onclick = () => openEditModal(dataStr);
        listContainer.appendChild(item);
      });
    }
  };

  const editModal = document.getElementById('editModal');
  document.getElementById('closeEditModal').onclick = () => editModal.style.display = 'none';

  function openEditModal(dataStr) {
    const data = JSON.parse(decodeURIComponent(dataStr));
    document.getElementById('mId').value = data.id;
    document.getElementById('mDate').value = data.date;
    document.getElementById('mHour').value = data.hour;
    document.getElementById('mDoc').value = data.doc;
    
    const sType = document.getElementById('mSupplyType');
    if ([...sType.options].map(o => o.value).includes(data.sTypeRaw)) sType.value = data.sTypeRaw;
    
    document.getElementById('mOrderType').value = data.oTypeRaw;
    document.getElementById('mCompany').innerText = data.fullCompany;
    editModal.style.display = 'flex';
  }

  document.getElementById('btnUpdate').onclick = async () => {
    if (!confirm('Подтверждаете изменение записи?')) return;
    const payload = {
      slot_date: document.getElementById('mDate').value,
      slot_hour: parseInt(document.getElementById('mHour').value),
      order_number: document.getElementById('mDoc').value.trim(),
      supply_type: document.getElementById('mSupplyType').value,
      order_type: document.getElementById('mOrderType').value
    };
    const { error } = await sb.from('bookings').update(payload).eq('id', document.getElementById('mId').value);
    if (error) alert('Ошибка обновления: ' + error.message);
    else { editModal.style.display = 'none'; renderCalendar(); }
  };

  document.getElementById('btnDelete').onclick = async () => {
    if (!confirm('ВНИМАНИЕ! Вы точно хотите удалить эту запись поставщика?')) return;
    const { error } = await sb.from('bookings').delete().eq('id', document.getElementById('mId').value);
    if (error) alert('Ошибка удаления: ' + error.message);
    else { editModal.style.display = 'none'; renderCalendar(); }
  };

  document.getElementById('applyFiltersBtn').onclick = renderCalendar;
  document.getElementById('resetFiltersBtn').onclick = () => {
    document.getElementById('filterSupplier').value = '';
    document.getElementById('filterDoc').value = '';
    document.getElementById('filterSupplyType').value = '';
    document.getElementById('filterOrderType').value = '';
    renderCalendar();
  };
  if (pastToggle) pastToggle.onchange = renderCalendar;

  renderCalendar();
});
