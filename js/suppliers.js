document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb) return;
  const authProfile = await window.dockslotGetAuthProfile?.();
  const user = authProfile?.user;
  const profile = authProfile?.profile;
  if (!user) return window.location.href = '../index.html';

  if (authProfile?.error || !profile || profile.is_blocked || !['operator', 'admin', 'super_admin'].includes(profile.role)) {
    return window.location.href = 'calendar.html';
  }

  const isAdmin = ['admin', 'super_admin'].includes(profile.role);
  document.getElementById('logoutBtn').onclick = async (e) => {
    e.preventDefault();
    await sb.auth.signOut();
    window.location.href = '../index.html';
  };

  let allUsers = [];
  let favoriteIds = new Set();
  let favoritesOnly = false;
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
      (!favoritesOnly || favoriteIds.has(String(s.id))) &&
      (String(s.company_name || '').toLowerCase().includes(lowerFilter) ||
      String(s.inn || '').toLowerCase().includes(lowerFilter))
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

      let favorite = null;
      if (isAdmin) {
        favorite = document.createElement('button');
        favorite.type = 'button'; favorite.className = 'favorite-star-btn';
        favorite.dataset.favoriteSupplierId = String(s.id);
        window.DockSlotFavorites?.syncStar(favorite, favoriteIds.has(String(s.id)));
      }
      const info = document.createElement('div');
      info.className = 'sup-info';
      const company = makeText('div', 'sup-name', `${s.company_name || 'Без названия'} (ИНН: ${s.inn || 'Не указан'})`);
      const profileId = makeText('div', 'sup-details', `ID профиля: ${String(s.id).substring(0, 8)}...`);
      const createdAt = s.created_at ? new Date(s.created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'Нет данных';
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
      if (favorite) card.append(info, favorite, control);
      else card.append(info, control);
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

    allUsers = (data || []).filter(u => !['admin', 'super_admin', 'operator'].includes(u.role));
    try { favoriteIds = await window.DockSlotFavorites.load(sb, user.id); }
    catch (favoriteError) { console.error('Не удалось загрузить избранных поставщиков:', favoriteError); favoriteIds = new Set(); }
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

  document.getElementById('usersList').addEventListener('click', async e => {
    const star = e.target.closest('[data-favorite-supplier-id]');
    if (!star) return;
    if (!isAdmin) return;
    star.disabled = true;
    try {
      const active = await window.DockSlotFavorites.toggle(sb, user.id, star.dataset.favoriteSupplierId);
      favoriteIds = window.DockSlotFavorites.ids();
      window.DockSlotFavorites.syncStar(star, active);
    } catch (error) { alert(`Не удалось изменить избранное: ${error.message || 'ошибка базы данных'}`); }
    finally { star.disabled = false; }
  });

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

  if (isAdmin) {
    window.DockSlotFavorites?.createFilterButton(document.getElementById('favoritesFilterMount'), (active) => {
      favoritesOnly = active;
      renderUsers(document.getElementById('searchInput').value);
    });
  }
  await loadData();
});
