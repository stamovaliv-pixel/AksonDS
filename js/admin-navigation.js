/* AKSon DockSlot — role-aware, compact administrative navigation. */
document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  const nav = document.querySelector('.header-nav');
  if (!sb || !nav) return;

  let authUser = null;
  try {
    const { data, error } = await sb.auth.getUser();
    if (error) throw error;
    authUser = data?.user || null;
  } catch (error) {
    console.warn('Не удалось проверить навигацию:', error);
    return;
  }
  if (!authUser) return;

  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('role, is_blocked')
    .eq('id', authUser.id)
    .single();
  if (profileError || !profile || profile.is_blocked) return;

  const create = (tag, className, html) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html) node.innerHTML = html;
    return node;
  };
  const icons = {
    desk: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="8" height="8" rx="1.5"></rect><rect x="13" y="3" width="8" height="5" rx="1.5"></rect><rect x="13" y="10" width="8" height="11" rx="1.5"></rect><rect x="3" y="13" width="8" height="8" rx="1.5"></rect></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>',
    tools: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="2.2"></circle><circle cx="17" cy="7" r="2.2"></circle><circle cx="12" cy="17" r="2.2"></circle></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M9.6 9a2.5 2.5 0 1 1 4.4 1.6c-.9 1-2 1.2-2 2.9M12 17.2v.1"></path></svg>',
    logout: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="m16 17 5-5-5-5M21 12H9"></path></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    analytics: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3v18h18M3 17l6-6 4 4 8-8"></path></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"></circle><path d="m19.4 15 .06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1 1.65 1.65 0 0 0 0 1.74Z"></path></svg>'
  };

  const existingBell = nav.querySelector('#akNotificationsBell');
  const existingTheme = nav.querySelector('[data-theme-toggle]');
  const existingLogout = nav.querySelector('#logoutBtn');
  const left = create('div', 'header-nav-left');
  const right = create('div', 'header-nav-right');
  nav.replaceChildren(left, right);

  if (existingBell) left.appendChild(existingBell);

  const themeButton = existingTheme || create('button', 'theme-toggle', '');
  themeButton.type = 'button';
  themeButton.dataset.themeToggle = '';
  const setThemeIcon = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeButton.innerHTML = dark
      ? '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path></svg>'
      : '<svg class="theme-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.463.402.807a6.5 6.5 0 0 0 8.268 8.268c.344-.215.829-.003.803.397Z"></path></svg>';
    const hint = dark ? 'Светлый режим' : 'Темный режим';
    themeButton.title = hint;
    themeButton.setAttribute('aria-label', hint);
  };
  setThemeIcon();
  left.appendChild(themeButton);

  const makeLink = (href, label, icon, activeKey) => {
    const link = create('a', 'nav-icon', icons[icon]);
    link.href = href;
    link.title = label;
    link.setAttribute('aria-label', label);
    link.dataset.navKey = activeKey || href;
    return link;
  };

  const logout = existingLogout || create('a', 'nav-icon', icons.logout);
  logout.href = '#';
  logout.id = 'logoutBtn';
  logout.className = 'nav-icon';
  logout.title = 'Выход';
  logout.setAttribute('aria-label', 'Выход');
  logout.innerHTML = icons.logout;
  if (!existingLogout) {
    logout.addEventListener('click', async (event) => {
      event.preventDefault();
      logout.setAttribute('aria-busy', 'true');
      const { error: signOutError } = await sb.auth.signOut();
      if (signOutError) {
        logout.removeAttribute('aria-busy');
        console.error('Не удалось выполнить выход:', signOutError);
        return;
      }
      window.location.replace('../index.html');
    });
  }

  const role = String(profile.role || '').toLowerCase();
  if (role === 'admin') {
    right.append(
      makeLink('admin_overview.html', 'Рабочий стол', 'desk', 'admin_overview.html'),
      makeLink('admin_calendar.html', 'Календарь', 'calendar', 'admin_calendar.html')
    );
    const tools = create('button', 'nav-icon admin-tools-trigger', icons.tools);
    tools.type = 'button';
    tools.title = 'Справочники и инструменты';
    tools.setAttribute('aria-label', 'Справочники и инструменты');
    tools.setAttribute('aria-haspopup', 'dialog');
    tools.setAttribute('aria-expanded', 'false');
    right.appendChild(tools);
    right.appendChild(makeLink('help.html', 'Помощь', 'help', 'help.html'));
    right.appendChild(logout);
    mountToolsModal(tools);
  } else if (['operator', 'viewer'].includes(role)) {
    right.append(
      makeLink('admin_calendar.html', 'Календарь', 'calendar', 'admin_calendar.html'),
      makeLink('help.html', 'Помощь', 'help', 'help.html'),
      logout
    );
  } else if (role === 'supplier') {
    right.append(
      makeLink('calendar.html', 'Календарь', 'calendar', 'calendar.html'),
      makeLink('dashboard.html', 'Личный кабинет', 'users', 'dashboard.html'),
      makeLink('help.html', 'Помощь', 'help', 'help.html'),
      logout
    );
  } else if (!logout.isConnected) {
    right.appendChild(logout);
  }

  const page = window.location.pathname.split('/').pop() || '';
  const activePage = page === 'admin_day.html' ? 'admin_calendar.html' : page;
  const toolsButton = right.querySelector('.admin-tools-trigger');
  if (toolsButton && ['suppliers.html', 'analytics.html', 'settings.html'].includes(activePage)) {
    toolsButton.classList.add('active');
    toolsButton.setAttribute('aria-pressed', 'true');
  }
  right.querySelectorAll('a.nav-icon[data-nav-key]').forEach((link) => {
    const active = link.dataset.navKey === activePage;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  function mountToolsModal(trigger) {
    const overlay = create('div', 'admin-tools-overlay');
    overlay.id = 'adminToolsOverlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="admin-tools-dialog" role="dialog" aria-modal="true" aria-labelledby="adminToolsTitle">
        <header class="admin-tools-head">
          <div><span class="admin-tools-kicker">Рабочее пространство</span><h2 id="adminToolsTitle">Справочники и инструменты</h2><p>Быстрый переход к административным разделам</p></div>
          <button type="button" class="admin-tools-close" aria-label="Закрыть" title="Закрыть"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg></button>
        </header>
        <div class="admin-tools-grid">
          <a class="admin-tools-card" href="suppliers.html"><span class="admin-tools-card-icon">${icons.users}</span><span><strong>Пользователи</strong><small>Учётные записи и поставщики</small></span><svg class="admin-tools-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg></a>
          <a class="admin-tools-card" href="analytics.html"><span class="admin-tools-card-icon">${icons.analytics}</span><span><strong>Аналитика</strong><small>Показатели и качество поставок</small></span><svg class="admin-tools-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg></a>
          <a class="admin-tools-card" href="settings.html"><span class="admin-tools-card-icon">${icons.settings}</span><span><strong>Настройки</strong><small>Слоты, расписание и параметры</small></span><svg class="admin-tools-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"></path></svg></a>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    const close = () => {
      overlay.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      window.setTimeout(() => { overlay.hidden = true; }, 160);
    };
    const open = () => {
      overlay.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      requestAnimationFrame(() => overlay.classList.add('is-open'));
      overlay.querySelector('.admin-tools-close')?.focus();
    };
    trigger.addEventListener('click', open);
    overlay.querySelector('.admin-tools-close')?.addEventListener('click', close);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !overlay.hidden) close(); });
  }
});
