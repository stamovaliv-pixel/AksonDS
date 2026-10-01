document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

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

    // Универсальный поиск: ищет и по ИНН, и по названию, и по скопированным строкам
    const filtered = allUsers.filter(s => {
      const name = (s.company_name || '').toLowerCase();
      const inn = (s.inn || '').toLowerCase();
      
      const combined = `${name} (инн: ${inn}) ${inn}`;
      return combined.includes(lowerFilter);
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
          <div class="sup-details">Дата регистрации: ${s.created_at ? new Date(s.created_at).toLocaleDateString('ru-RU') : 'Нет данных'}</div>
        </div>
        <div class="block-control">
          <span class="block-label">Блок</span>
          <label class="switch">
            <input type="checkbox" class="toggle-block" data-id="${s.id}" ${s.is_blocked ? 'checked' : ''}>
            <span class="slider"></span>
          </label>
        </div>
      `;
      list.appendChild(card);
    });
  };

  const loadData = async () => {
    // Выгружаем ВСЕХ пользователей, чтобы обойти проблемы с регистрами и пустыми ролями
    const { data, error } = await sb.from('profiles').select('*');
    
    if (error) {
      document.getElementById('usersList').innerHTML = `<div style="text-align:center; color:#ef4444;">Ошибка БД: ${error.message}</div>`;
      return;
    }

    if (data) {
      // Отсекаем только сотрудников, все остальные считаются поставщиками
      allUsers = data.filter(u => u.role !== 'admin' && u.role !== 'operator');
      // Сортируем: новые сверху
      allUsers.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    
    renderUsers(document.getElementById('searchInput').value);
  };

  // МГНОВЕННЫЙ "ЖИВОЙ" ПОИСК при вводе текста
  document.getElementById('searchInput').addEventListener('input', (e) => {
    renderUsers(e.target.value);
  });
  
  // Дублирующий поиск по кнопке
  const performSearch = () => renderUsers(document.getElementById('searchInput').value);
  if (document.getElementById('searchBtn')) {
    document.getElementById('searchBtn').addEventListener('click', performSearch);
  }
  
  // Изменение статуса блокировки при переключении тумблера
  document.getElementById('usersList').addEventListener('change', async (e) => {
    if (e.target.classList.contains('toggle-block')) {
      const id = e.target.dataset.id;
      const newStatus = e.target.checked; 
      const card = e.target.closest('.supplier-card');
      
      const { error } = await sb.from('profiles').update({ is_blocked: newStatus }).eq('id', id);
      
      if (!error) {
        if (newStatus) {
          card.classList.add('blocked');
        } else {
          card.classList.remove('blocked');
        }
        // Обновляем состояние в локальном массиве, чтобы поиск его не сбросил
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
