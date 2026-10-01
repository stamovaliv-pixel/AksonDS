document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || (profile.role !== 'operator' && profile.role !== 'admin')) {
    return window.location.href = 'calendar.html';
  }

  // Запоминаем, является ли текущий пользователь администратором
  const isAdmin = profile.role === 'admin';

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

    const filtered = allUsers.filter(s => {
      const name = (s.company_name || '').toLowerCase();
      const inn = (s.inn || '').toLowerCase();
      return name.includes(lowerFilter) || inn.includes(lowerFilter);
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div style="text-align:center; padding:20px; color:#64748b;">Пользователи не найдены</div>';
      return;
    }

    filtered.forEach(s => {
      const card = document.createElement('div');
      card.className = `supplier-card ${s.is_blocked ? 'blocked' : ''}`;
      
      // Если это НЕ админ (т.е. оператор), добавляем атрибут disabled и подсказку
      const disabledAttr = isAdmin ? '' : 'disabled title="Изменять статус может только Администратор"';
      
      card.innerHTML = `
        <div class="sup-info">
          <div class="sup-name">${s.company_name || 'Без названия'} (ИНН: ${s.inn || 'Не указан'})</div>
          <div class="sup-details">ID профиля: ${s.id.substring(0, 8)}...</div>
          <div class="sup-details">Дата регистрации: ${s.created_at ? new Date(s.created_at).toLocaleDateString('ru-RU') : 'Нет данных'}</div>
        </div>
        <div class="block-control">
          <span class="block-label">Блок</span>
          <label class="switch">
            <input type="checkbox" class="toggle-block" data-id="${s.id}" ${s.is_blocked ? 'checked' : ''} ${disabledAttr}>
            <span class="slider"></span>
          </label>
        </div>
      `;
      list.appendChild(card);
    });
  };

  const loadData = async () => {
    const { data, error } = await sb.from('profiles').select('*');
    
    if (error) {
      document.getElementById('usersList').innerHTML = `<div style="text-align:center; color:#ef4444;">Ошибка БД: ${error.message}</div>`;
      return;
    }

    if (data) {
      allUsers = data.filter(u => u.role !== 'admin' && u.role !== 'operator');
      allUsers.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    
    renderUsers(document.getElementById('searchInput').value);
  };

  // Живой поиск при вводе текста
  document.getElementById('searchInput').addEventListener('input', (e) => {
    renderUsers(e.target.value);
  });
  
  // Поиск по нажатию на кнопку
  const performSearch = () => renderUsers(document.getElementById('searchInput').value);
  if (document.getElementById('searchBtn')) {
    document.getElementById('searchBtn').addEventListener('click', performSearch);
  }
  
  // Изменение статуса блокировки
  document.getElementById('usersList').addEventListener('change', async (e) => {
    if (e.target.classList.contains('toggle-block')) {
      
      // Дополнительная защита: если это каким-то чудом нажал оператор, блокируем
      if (!isAdmin) {
        e.preventDefault();
        e.target.checked = !e.target.checked;
        return alert('Изменять статус пользователей может только Администратор.');
      }

      const id = e.target.dataset.id;
      const newStatus = e.target.checked; 
      const card = e.target.closest('.supplier-card');
      
      const { error } = await sb.from('profiles').update({ is_blocked: newStatus }).eq('id', id);
      
      if (!error) {
        if (newStatus) card.classList.add('blocked');
        else card.classList.remove('blocked');
        
        const userIndex = allUsers.findIndex(u => u.id === id);
        if (userIndex !== -1) allUsers[userIndex].is_blocked = newStatus;
      } else {
        alert('Ошибка смены статуса: ' + error.message);
        e.target.checked = !newStatus; 
      }
    }
  });

  loadData();
});
