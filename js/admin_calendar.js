document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || (profile.role !== 'operator' && profile.role !== 'admin')) {
    return window.location.href = 'calendar.html'; // Отбрасываем обычных поставщиков
  }

  const isAdmin = profile.role === 'admin';
  const pastToggle = document.getElementById('showPastBtn');
  if (isAdmin) {
    document.getElementById('adminPastToggleContainer').style.display = 'flex';
  }

  document.getElementById('logoutBtn').onclick = async () => {
    await sb.auth.signOut(); window.location.href = '../index.html';
  };

  const renderCalendar = async () => {
    const filterSupplier = document.getElementById('filterSupplier').value.trim();
    const filterDoc = document.getElementById('filterDoc').value.trim();
    const showPast = isAdmin && pastToggle.checked;

    let query = sb.from('bookings').select('slot_date, order_number, profiles!inner(company_name, inn)').eq('status', 'active');
    
    if (filterDoc) query = query.ilike('order_number', `%${filterDoc}%`);
    if (filterSupplier) {
      query = query.or(`company_name.ilike.%${filterSupplier}%,inn.ilike.%${filterSupplier}%`, { foreignTable: 'profiles' });
    }

    const { data: bookings } = await query;
    const bookedDates = new Set((bookings || []).map(b => b.slot_date));

    const today = new Date(); today.setHours(0,0,0,0);
    const startDate = new Date(today);
    
    // Если УТЗ включил прошлые дни, начинаем на 30 дней раньше
    if (showPast) {
      startDate.setDate(today.getDate() - 30);
    } else {
      const diffToMonday = today.getDay() === 0 ? 6 : today.getDay() - 1;
      startDate.setDate(today.getDate() - diffToMonday);
    }

    const totalDays = showPast ? 60 : 35; // Рисуем сетку
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const isoDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      
      const cell = document.createElement('div');
      cell.className = 'day-cell';
      if (bookedDates.has(isoDate)) cell.classList.add('has-bookings');
      
      cell.innerHTML = `<div style="font-weight:700; font-size:16px;">${d.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit'})}</div>`;
      cell.onclick = () => window.location.href = `admin_day.html?date=${isoDate}`;
      grid.appendChild(cell);
    }
  };

  document.getElementById('applyFiltersBtn').onclick = renderCalendar;
  document.getElementById('resetFiltersBtn').onclick = () => {
    document.getElementById('filterSupplier').value = '';
    document.getElementById('filterDoc').value = '';
    renderCalendar();
  };
  pastToggle.onchange = renderCalendar;

  renderCalendar();
});