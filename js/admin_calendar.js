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
  if (isAdmin) {
    document.getElementById('adminPastToggleContainer').style.display = 'flex';
  }

  document.getElementById('logoutBtn').onclick = async (e) => {
    e.preventDefault(); await sb.auth.signOut(); window.location.href = '../index.html';
  };

  const today = new Date(); 
  today.setHours(0,0,0,0);
  const maxActiveDate = new Date(today);
  maxActiveDate.setDate(today.getDate() + 29);

  const renderCalendar = async () => {
    const filterSupplier = document.getElementById('filterSupplier').value.trim();
    const filterDoc = document.getElementById('filterDoc').value.trim();
    const filterSupply = document.getElementById('filterSupplyType').value;
    const filterOrder = document.getElementById('filterOrderType').value;
    const showPast = isAdmin && pastToggle.checked;

    const isSearchActive = filterSupplier !== '' || filterDoc !== '' || filterSupply !== '' || filterOrder !== '';

    let query = sb.from('bookings')
      .select('id, slot_date, slot_hour, order_number, order_type, supply_type, profiles!inner(company_name, inn)')
      .eq('status', 'active');
    
    if (filterDoc) query = query.ilike('order_number', `%${filterDoc}%`);
    if (filterSupply) query = query.eq('supply_type', filterSupply);
    if (filterOrder) query = query.eq('order_type', filterOrder);
    if (filterSupplier) {
      query = query.or(`company_name.ilike.%${filterSupplier}%,inn.ilike.%${filterSupplier}%`, { foreignTable: 'profiles' });
    }

    const { data: bookings } = await query;
    const bookedDates = new Set((bookings || []).map(b => b.slot_date));

    // --- 1. Отрисовка сетки календаря ---
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
      
      const isPastOrFuture = d < today || d > maxActiveDate;
      if (isPastOrFuture) cell.classList.add('inactive'); 
      if (bookedDates.has(isoDate)) cell.classList.add('booked'); 
      
      cell.innerHTML = `<div class="date-text">${d.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit'})}</div>`;
      cell.onclick = () => window.location.href = `admin_day.html?date=${isoDate}`;
      grid.appendChild(cell);
    }

    // --- 2. Отрисовка списка "Найденные записи" ---
    const listContainer = document.getElementById('upcomingBookingsList');
    listContainer.innerHTML = '';
    
    // Показываем 14 пустых серых слотов если фильтр не применен
    if (!isSearchActive) {
      for (let i = 0; i < 14; i++) {
        listContainer.innerHTML += `
          <div class="booking-item empty">
            <div style="color: #94a3b8; font-size: 13px; font-weight: 500;">Нет данных</div>
          </div>
        `;
      }
      return; 
    }

    // Оставляем только записи от сегодня и в будущее (максимум 14)
    const upcoming = (bookings || [])
      .filter(b => new Date(b.slot_date) >= today)
      .sort((a, b) => new Date(a.slot_date) - new Date(b.slot_date) || a.slot_hour - b.slot_hour)
      .slice(0, 14);

    if (upcoming.length === 0) {
      listContainer.innerHTML = `<div style="grid-column: 1 / -1; color: var(--color-text-muted); font-size: 14px; text-align: center; padding: 20px;">По вашему запросу ничего не найдено.</div>`;
    } else {
      upcoming.forEach(b => {
        const dStr = new Date(b.slot_date).toLocaleDateString('ru-RU');
        const item = document.createElement('div');
        item.className = 'booking-item';
        
        const dataStr = encodeURIComponent(JSON.stringify({
          id: b.id, date: b.slot_date, hour: b.slot_hour, doc: b.order_number, 
          sTypeRaw: b.supply_type, oTypeRaw: b.order_type,
          fullCompany: `${b.profiles.company_name} (ИНН: ${b.profiles.inn})`
        }));
        
        const shortName = b.profiles.company_name.length > 18 ? b.profiles.company_name.substring(0,18) + '...' : b.profiles.company_name;
        
        item.innerHTML = `
          <div class="booking-date">${dStr}</div>
          <div style="font-size: 12px; color: var(--color-primary); font-weight: 600;">${shortName}</div>
          <div class="booking-time">${b.slot_hour}:00</div>
        `;
        
        item.onclick = () => openEditModal(dataStr);
        listContainer.appendChild(item);
      });
    }
  };

  // --- Логика Модального окна редактирования ---
  const editModal = document.getElementById('editModal');
  document.getElementById('closeEditModal').onclick = () => editModal.style.display = 'none';

  function openEditModal(dataStr) {
    const data = JSON.parse(decodeURIComponent(dataStr));
    document.getElementById('mId').value = data.id;
    document.getElementById('mDate').value = data.date;
    document.getElementById('mHour').value = data.hour;
    document.getElementById('mDoc').value = data.doc;
    document.getElementById('mSupplyType').value = data.sTypeRaw;
    document.getElementById('mOrderType').value = data.oTypeRaw;
    document.getElementById('mCompany').innerText = data.fullCompany;
    editModal.style.display = 'flex';
  }

  document.getElementById('btnUpdate').onclick = async () => {
    if (!confirm('Подтверждаете изменение записи?')) return;
    const id = document.getElementById('mId').value;
    const payload = {
      slot_date: document.getElementById('mDate').value,
      slot_hour: parseInt(document.getElementById('mHour').value),
      order_number: document.getElementById('mDoc').value.trim(),
      supply_type: document.getElementById('mSupplyType').value,
      order_type: document.getElementById('mOrderType').value
    };
    
    const { error } = await sb.from('bookings').update(payload).eq('id', id);
    if (error) alert('Ошибка обновления: ' + error.message);
    else { editModal.style.display = 'none'; renderCalendar(); }
  };

  document.getElementById('btnDelete').onclick = async () => {
    if (!confirm('ВНИМАНИЕ! Вы точно хотите удалить эту запись поставщика?')) return;
    const id = document.getElementById('mId').value;
    
    const { error } = await sb.from('bookings').delete().eq('id', id);
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
  pastToggle.onchange = renderCalendar;

  renderCalendar();
});
