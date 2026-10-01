document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  // Проверка прав доступа к странице
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || (profile.role !== 'operator' && profile.role !== 'admin')) {
    return window.location.href = 'calendar.html';
  }

  document.getElementById('logoutBtn').onclick = async (e) => { 
    e.preventDefault(); 
    await sb.auth.signOut(); 
    window.location.href = '../index.html'; 
  };

  let allUsers = [];

  const renderUsers = (filterText = '') => {
    const list = document.getElementById('usersList');
    list.innerHTML = '';
    const lowerFilter = filterText.toLowerCase().trim();

    // Умный поиск с защитой от пустых (null) значений
    const filtered = allUsers.filter(s => {
      const name = (s.company_name || '').toLowerCase();
      const inn = (s.inn || '').toLowerCase();
      // Почта хранится в таблице profiles (если вы ее туда добавляли при регистрации),
      // иначе поиск по почте просто проигнорируется без ошибок.
      const email = (s.email || '').toLowerCase(); 
      
      return name.includes(lowerFilter) || inn.includes(lowerFilter) || email.includes(lowerFilter);
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b;">Пользователи не найдены</div>';
      return;
    }

    filtered.forEach(s => {
      const card = document.createElement('div');
      card.className = `supplier-card ${s.is_blocked ? 'blocked' : ''}`;
      card.innerHTML = `
        <div class="sup-info">
          <div class="sup-name">${s.company_name || 'Без названия'} (ИНН: ${s.inn || 'Не указан'})</div>
          <div class="sup-details">ID профиля: ${s.id.substring(0, 8)}...</div>
          <div class="sup-details">Дата регистрации: ${new Date(s.created_at).toLocaleDateString('ru-RU')}</div>
        </div>
        <button class="btn-toggle ${s.is_blocked ? 'btn-unblock' : 'btn-block'}" data-id="${s.id}" data-status="${s.is_blocked}">
          ${s.is_blocked ? 'Разблокировать' : 'Заблокировать'}
        </button>
      `;
      list.appendChild(card);
    });
  };

  const loadData = async () => {
    // Двойная защита: выгружаем только пользователей с ролью supplier
    const { data, error } = await sb.from('profiles')
      .select('*')
      .eq('role', 'supplier')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Ошибка загрузки:', error);
      document.getElementById('usersList').innerHTML = `<div style="text-align:center; color:#ef4444;">Ошибка: ${error.message}</div>`;
      return;
    }

    if (data) allUsers = data;
    renderUsers();
  };

  // Поиск на лету при вводе текста
  document.getElementById('searchInput').addEventListener('input', (e) => renderUsers(e.target.value));

  // Делегирование событий для кнопок блокировки
  document.getElementById('usersList').addEventListener('click', async (e) => {
    if (e.target.classList.contains('btn-toggle')) {
      const id = e.target.dataset.id;
      const currentStatus = e.target.dataset.status === 'true';
      const newStatus = !currentStatus;
      
      const confirmMsg = newStatus ? 'заблокировать' : 'разблокировать';
      if (confirm(`Вы уверены, что хотите ${confirmMsg} этого пользователя?`)) {
        e.target.innerText = 'Обработка...';
        
        const { error } = await sb.from('profiles').update({ is_blocked: newStatus }).eq('id', id);
        
        if (!error) {
          await loadData();
        } else {
          alert('Ошибка смены статуса: ' + error.message);
          e.target.innerText = currentStatus ? 'Разблокировать' : 'Заблокировать';
        }
      }
    }
  });

  loadData();
});
