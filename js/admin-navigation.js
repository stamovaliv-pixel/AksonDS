/* AKSon DockSlot — stable role-aware navigation and five-dot tools popover. */
document.addEventListener('DOMContentLoaded', () => {
  const sb = window.supabaseClient;
  const nav = document.querySelector('.app-header > .header-nav, .header-nav');
  if (!nav) return;

  const appHeader = nav.closest('.app-header');
  const create = (tag, className, html) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html) node.innerHTML = html;
    return node;
  };
  const icons = {
    desk: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="8" height="8" rx="1.5"></rect><rect x="13" y="3" width="8" height="5" rx="1.5"></rect><rect x="13" y="10" width="8" height="11" rx="1.5"></rect><rect x="3" y="13" width="8" height="8" rx="1.5"></rect></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path></svg>',
    tools: '<svg class="tools-five-dots" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="3.9" r="1.75"></circle><circle cx="19.1" cy="9.2" r="1.75"></circle><circle cx="16.4" cy="17.4" r="1.75"></circle><circle cx="7.6" cy="17.4" r="1.75"></circle><circle cx="4.9" cy="9.2" r="1.75"></circle></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path></svg>',
    analytics: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3v18h18M3 17l6-6 4 4 8-8"></path></svg>',
    load: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 3v18h18"></path><path d="M7 14l4-4 3 3 6-7"></path><path d="M16 6h4v4"></path></svg>',
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3"></circle><path d="m19.4 15 .06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1 1.65 1.65 0 0 0 0 1.74Z"></path></svg>',
    help: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M9.6 9a2.5 2.5 0 1 1 4.4 1.6c-.9 1-2 1.2-2 2.9M12 17.2v.1"></path></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"></path></svg>',
    moon: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.463.402.807a6.5 6.5 0 0 0 8.268 8.268c.344-.215.829-.003.803.397Z"></path></svg>',
    logout: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="m16 17 5-5-5-5M21 12H9"></path></svg>'
  };

  // Move all existing controls into a stable shell immediately. Do not wait for Supabase
  // before removing the legacy row of scattered links — that delay caused the nav flash.
  const existingTheme = nav.querySelector('[data-theme-toggle]') || appHeader?.querySelector('[data-theme-toggle]');
  const themeButton = existingTheme || create('button', 'theme-toggle', '');
  themeButton.type = 'button';
  themeButton.dataset.themeToggle = '';
  themeButton.classList.add('dockslot-theme-anchor');
  const syncStandaloneThemeIcon = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    themeButton.innerHTML = dark
      ? icons.sun
      : icons.moon;
    const label = dark ? 'Светлый режим' : 'Темный режим';
    themeButton.title = label;
    themeButton.setAttribute('aria-label', label);
  };
  syncStandaloneThemeIcon();
  if (!themeButton.dataset.themeBound) {
    themeButton.dataset.themeBound = 'true';
    themeButton.addEventListener('click', () => {
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = dark ? 'light' : 'dark';
      if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else document.documentElement.removeAttribute('data-theme');
      try { localStorage.setItem('akson-dockslot-theme', next); } catch (_) { /* storage may be unavailable */ }
      syncStandaloneThemeIcon();
    });
  }
  // Admins get the theme switch inside the tools submenu. Other roles keep the
  // existing standalone control so their theme functionality is unchanged.
  themeButton.remove();
  const existingLogout = nav.querySelector('#logoutBtn') || appHeader?.querySelector('#logoutBtn');
  const right = create('div', 'header-nav-right');
  nav.replaceChildren(right);
  if (appHeader) appHeader.append(themeButton);
  else nav.append(themeButton);

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
      if (!sb) return;
      logout.setAttribute('aria-busy', 'true');
      const { error } = await sb.auth.signOut();
      if (error) {
        logout.removeAttribute('aria-busy');
        console.error('Не удалось выполнить выход:', error);
        return;
      }
      window.location.replace('../index.html');
    });
  }

  // A compact, stable fallback row is present while the profile role is confirmed.
  right.append(makeLink('admin_calendar.html', 'Календарь', 'calendar', 'admin_calendar.html'), logout);
  nav.classList.add('is-ready');
  appHeader?.classList.add('nav-ready');

  const activePage = () => {
    const page = window.location.pathname.split('/').pop() || '';
    return page === 'admin_day.html' ? 'admin_calendar.html' : page;
  };
  const decorateActive = (menuTrigger = null) => {
    const page = activePage();
    right.querySelectorAll('a.nav-icon[data-nav-key]').forEach((link) => {
      const active = link.dataset.navKey === page;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (menuTrigger) {
      const inTools = ['suppliers.html', 'analytics.html', 'settings.html', 'help.html', ...(normalized === 'super_admin' ? ['load_management.html'] : [])].includes(page);
      menuTrigger.classList.toggle('active', inTools);
      menuTrigger.setAttribute('aria-pressed', String(inTools));
    }
  };

  const mountToolsPopover = (role) => {
    const wrapper = create('div', 'admin-tools-menu');
    const trigger = create('button', 'nav-icon admin-tools-trigger', icons.tools);
    trigger.type = 'button';
    trigger.title = 'Справочники и инструменты';
    trigger.setAttribute('aria-label', 'Справочники и инструменты');
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-expanded', 'false');
    const popover = create('div', 'admin-tools-popover');
    popover.setAttribute('role', 'menu');
    popover.setAttribute('aria-label', 'Справочники и инструменты');

    const items = [
      { href: 'suppliers.html', label: 'Пользователи', detail: 'Учётные записи и поставщики', icon: 'users' },
      { href: 'analytics.html', label: 'Аналитика', detail: 'Показатели и качество поставок', icon: 'analytics' },
      { href: 'load_management.html', label: 'Управление нагрузкой', detail: 'Прогноз и лимиты по дням и часам', icon: 'load' },
      { href: 'settings.html', label: 'Настройки', detail: 'Слоты, расписание и параметры', icon: 'settings' },
      { type: 'theme', label: 'Темный режим', detail: 'Переключить оформление приложения' },
      { href: 'help.html', label: 'Помощь', detail: 'Инструкции по работе с ДокСлотом', icon: 'help' }
    ];
    const visibleItems = items.filter((item) => item.href !== 'load_management.html' || role === 'super_admin');
    visibleItems.forEach((item, index) => {
      const isThemeItem = item.type === 'theme';
      const link = create(isThemeItem ? 'button' : 'a', `admin-tools-item${isThemeItem ? ' admin-tools-theme-item' : ''}`);
      if (isThemeItem) {
        link.type = 'button';
        link.setAttribute('aria-pressed', String(document.documentElement.getAttribute('data-theme') === 'dark'));
      } else {
        link.href = item.href;
      }
      link.setAttribute('role', 'menuitem');
      link.style.setProperty('--item-index', String(index));
      link.innerHTML = `<span class="admin-tools-item-icon">${isThemeItem ? '' : icons[item.icon]}</span><span class="admin-tools-item-copy"><strong>${item.label}</strong><small>${item.detail}</small></span><span class="admin-tools-item-dot" aria-hidden="true"></span>`;
      popover.appendChild(link);

      if (isThemeItem) {
        const syncThemeItem = () => {
          const dark = document.documentElement.getAttribute('data-theme') === 'dark';
          link.querySelector('.admin-tools-item-icon').innerHTML = dark ? icons.sun : icons.moon;
          link.querySelector('.admin-tools-item-copy strong').textContent = dark ? 'Светлый режим' : 'Темный режим';
          link.querySelector('.admin-tools-item-copy small').textContent = 'Переключить оформление приложения';
          link.setAttribute('aria-pressed', String(dark));
          link.title = dark ? 'Переключить на светлый режим' : 'Переключить на темный режим';
          link.setAttribute('aria-label', link.title);
        };
        syncThemeItem();
        link.addEventListener('click', () => {
          const dark = document.documentElement.getAttribute('data-theme') === 'dark';
          const next = dark ? 'light' : 'dark';
          if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
          else document.documentElement.removeAttribute('data-theme');
          try { localStorage.setItem('akson-dockslot-theme', next); } catch (_) { /* storage may be unavailable */ }
          syncThemeItem();
        });
      }
    });
    wrapper.append(trigger, popover);

    const setExpanded = (expanded) => {
      trigger.setAttribute('aria-expanded', String(Boolean(expanded)));
      wrapper.classList.toggle('is-open', Boolean(expanded));
    };
    wrapper.addEventListener('mouseenter', () => trigger.setAttribute('aria-expanded', 'true'));
    wrapper.addEventListener('mouseleave', () => {
      trigger.setAttribute('aria-expanded', 'false');
      wrapper.classList.remove('is-open');
    });
    wrapper.addEventListener('focusin', () => trigger.setAttribute('aria-expanded', 'true'));
    wrapper.addEventListener('focusout', (event) => {
      if (!wrapper.contains(event.relatedTarget)) {
        trigger.setAttribute('aria-expanded', 'false');
        wrapper.classList.remove('is-open');
      }
    });
    trigger.addEventListener('click', () => {
      const supportsHover = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
      if (supportsHover) return; // Desktop opens on hover; click remains a touch fallback.
      setExpanded(trigger.getAttribute('aria-expanded') !== 'true');
    });
    document.addEventListener('pointerdown', (event) => {
      if (!wrapper.contains(event.target)) setExpanded(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        setExpanded(false);
        trigger.blur();
      }
    });
    return { wrapper, trigger };
  };

  const renderRole = (role) => {
    const normalized = String(role || '').toLowerCase();
    right.replaceChildren();
    if (['admin', 'super_admin'].includes(normalized)) {
      themeButton.remove();
      const menu = mountToolsPopover(normalized);
      right.append(
        makeLink('admin_overview.html', 'Рабочий стол', 'desk', 'admin_overview.html'),
        makeLink('admin_calendar.html', 'Календарь', 'calendar', 'admin_calendar.html'),
        menu.wrapper,
        logout
      );
      decorateActive(menu.trigger);
    } else if (['operator', 'viewer'].includes(normalized)) {
      if (appHeader) appHeader.append(themeButton);
      else nav.append(themeButton);
      right.append(
        makeLink('admin_calendar.html', 'Календарь', 'calendar', 'admin_calendar.html'),
        ...(['operator'].includes(normalized) ? [makeLink('load_management.html', 'Управление нагрузкой', 'load', 'load_management.html')] : []),
        makeLink('help.html', 'Помощь', 'help', 'help.html'),
        logout
      );
      decorateActive();
    } else {
      if (appHeader) appHeader.append(themeButton);
      else nav.append(themeButton);
      right.append(makeLink('admin_calendar.html', 'Календарь', 'calendar', 'admin_calendar.html'), logout);
      decorateActive();
    }
  };

  if (!sb) return;
  (async () => {
    try {
      const authProfile = await window.dockslotGetAuthProfile?.();
      if (!authProfile?.user) return;

      const roleCacheKey = `akson-dockslot-nav-role:${authProfile.user.id}`;
      let cachedRole = null;
      try { cachedRole = sessionStorage.getItem(roleCacheKey); } catch (_) { /* storage unavailable */ }
      if (['admin', 'super_admin', 'operator', 'viewer'].includes(cachedRole)) renderRole(cachedRole);

      // The shared helper confirms the current JWT and reads the profile once per page.
      // Cached role affects presentation only; page guards and RLS remain authoritative.
      const profile = authProfile.profile;
      if (authProfile.error || !profile || profile.is_blocked) return;
      const role = String(profile.role || '').toLowerCase();
      try { sessionStorage.setItem(roleCacheKey, role); } catch (_) { /* storage unavailable */ }
      renderRole(role);
    } catch (error) {
      console.warn('Не удалось подтвердить роль для навигации:', error);
    }
  })();
});
