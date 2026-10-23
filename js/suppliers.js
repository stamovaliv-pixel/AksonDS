document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return window.location.href = '../index.html';

  const { data: profile, error: profileError } = await sb.from('profiles').select('role, is_blocked').eq('id', user.id).single();
  if (profileError || !profile || profile.is_blocked || !['operator', 'admin'].includes(profile.role)) {
    return window.location.href = 'calendar.html';
  }

  const isAdmin = profile.role === 'admin';
  document.getElementById('logoutBtn').onclick = async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = '../index.html';
  };

  let allUsers = [];
  const makeText = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value == null ? '' : String(value);
    return node;
  };

  const renderUsers = (filterText = '') => {
    const list = document.getElementById('usersList');
    list.replaceChildren();
    const lowerFilter = String(filterText).toLowerCase().trim();
    const filtered = allUsers.filter(s =>
      String(s.company_name || '').toLowerCase().includes(lowerFilter) ||
      String(s.inn || '').toLowerCase().includes(lowerFilter)
    );

    if (filtered.length === 0) {
      const empty = makeText('div', '', 'Пользователи не найдены');
      empty.style.cssText = 'text-align:center; padding:20px; color:#64748b;';
      list.appendChild(empty);
      return;
    }

    filtered.forEach(s => {
      const card = document.createElement('div');
      card.className = `supplier-card ${s.is_blocked ? 'blocked' : ''}`;

      const info = document.createElement('div');
      info.className = 'sup-info';
      const company = makeText('div', 'sup-name', `${s.company_name || 'Без названия'} (ИНН: ${s.inn || 'Не указан'})`);
      const profileId = makeText('div', 'sup-details', `ID профиля: ${String(s.id).substring(0, 8)}...`);
      const createdAt = s.created_at ? new Date(s.created_at).toLocaleDateString('ru-RU') : 'Нет данных';
      const registered = makeText('div', 'sup-details', `Дата регистрации: ${createdAt}`);
      info.append(company, profileId, registered);

      const control = document.createElement('div');
      control.className = 'block-control';
      control.appendChild(makeText('span', 'block-label', 'Блок'));
      const label = document.createElement('label');
      label.className = 'switch';
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'toggle-block';
      toggle.dataset.id = String(s.id);
      toggle.checked = Boolean(s.is_blocked);
      if (!isAdmin) {
        toggle.disabled = true;
        toggle.title = 'Изменять статус может только Администратор';
      }
      const slider = document.createElement('span');
      slider.className = 'slider';
      label.append(toggle, slider);
      control.appendChild(label);
      card.append(info, control);
      list.appendChild(card);
    });
  };

  const loadData = async () => {
    const list = document.getElementById('usersList');
    const { data, error } = await sb.from('profiles')
      .select('id, company_name, inn, created_at, role, is_blocked');

    if (error) {
      list.replaceChildren();
      const errorNode = makeText('div', '', `Ошибка загрузки данных: ${error.message}`);
      errorNode.style.cssText = 'text-align:center; color:#ef4444;';
      list.appendChild(errorNode);
      return;
    }

    allUsers = (data || []).filter(u => !['admin', 'operator'].includes(u.role));
    allUsers.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    renderUsers(document.getElementById('searchInput').value);
  };

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  const debouncedRender = debounce(val => renderUsers(val), 300);
  document.getElementById('searchInput').addEventListener('input', e => debouncedRender(e.target.value));
  const performSearch = () => renderUsers(document.getElementById('searchInput').value);
  document.getElementById('searchBtn')?.addEventListener('click', performSearch);

  document.getElementById('usersList').addEventListener('change', async e => {
    if (!e.target.classList.contains('toggle-block')) return;
    if (!isAdmin) {
      e.target.checked = !e.target.checked;
      alert('Изменять статус пользователей может только Администратор.');
      return;
    }

    const id = e.target.dataset.id;
    const newStatus = e.target.checked;
    const card = e.target.closest('.supplier-card');
    e.target.disabled = true;
    const { error } = await sb.from('profiles').update({ is_blocked: newStatus }).eq('id', id);
    e.target.disabled = false;

    if (!error) {
      card.classList.toggle('blocked', newStatus);
      const userIndex = allUsers.findIndex(u => u.id === id);
      if (userIndex !== -1) allUsers[userIndex].is_blocked = newStatus;
    } else {
      e.target.checked = !newStatus;
      alert(`Ошибка смены статуса: ${error.message}`);
    }
  });

  await loadData();
});
