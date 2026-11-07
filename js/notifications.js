/* AKSon DockSlot — personal role-aware notifications, powered by Supabase Realtime. */
document.addEventListener('DOMContentLoaded', () => {
  const sb = window.supabaseClient;
  if (!sb || !sb.auth) return;

  const COMMON_EVENTS = [
    { key: 'booking_created', label: 'Создание записи' },
    { key: 'booking_updated', label: 'Редактирование записи' },
    { key: 'booking_deleted', label: 'Удаление записи' },
    { key: 'registry_changed', label: 'Изменение вложенного реестра' }
  ];
  const ADMIN_EVENTS = [
    { key: 'arrival_recorded', label: 'Запись о прибытии' },
    { key: 'gate_assigned', label: 'Запись о назначении ворот' },
    { key: 'departure_recorded', label: 'Запись об убытии' },
    { key: 'reminders', label: 'Напоминания' }
  ];

  let user = null;
  let userRole = '';
  let preferences = {};
  let draftPreferences = {};
  let inbox = [];
  let activeView = 'inbox';
  let realtimeChannel = null;
  let fallbackPoll = null;
  let reminderPoll = null;
  let toastTimer = null;

  const defaultPreferences = () => {
    const result = {};
    [...COMMON_EVENTS, ...(userRole === 'admin' ? ADMIN_EVENTS : [])].forEach((event) => {
      result[event.key] = { enabled: false, ...(COMMON_EVENTS.some((item) => item.key === event.key) ? { scope: 'all' } : {}) };
    });
    return result;
  };

  const clone = (value) => JSON.parse(JSON.stringify(value || {}));
  const $ = (id) => document.getElementById(id);
  const create = (tag, className, textValue) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (textValue !== undefined && textValue !== null) node.textContent = String(textValue);
    return node;
  };

  const init = async () => {
    try {
      const { data: authData, error: authError } = await sb.auth.getUser();
      if (authError || !authData?.user) return;
      user = authData.user;

      const { data: profile, error: profileError } = await sb
        .from('profiles')
        .select('role, is_blocked')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError || !profile || profile.is_blocked) return;

      userRole = String(profile.role || '').toLowerCase();
      // Suppliers and view-only users have no notification preferences in this specification.
      if (!['admin', 'operator'].includes(userRole)) return;

      mountBellAndModal();
      await Promise.all([loadPreferences(), loadInbox()]);
      setupRealtime();

      if (userRole === 'admin') {
        processDueReminders();
        reminderPoll = window.setInterval(processDueReminders, 15000);
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) processDueReminders();
        });
      }
    } catch (error) {
      console.error('[DockSlot notifications] Initialization failed:', error);
    }
  };

  const mountBellAndModal = () => {
    const nav = document.querySelector('.header-nav');
    if (!nav) return;

    const bell = create('button', 'ak-notifications-bell');
    bell.type = 'button';
    bell.id = 'akNotificationsBell';
    bell.title = 'Уведомления';
    bell.setAttribute('aria-label', 'Уведомления');
    bell.setAttribute('aria-haspopup', 'dialog');
    bell.setAttribute('aria-expanded', 'false');
    bell.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg><span class="ak-notifications-badge" id="akNotificationsBadge" hidden></span>';

    const anchor = nav.querySelector('a[href="settings.html"], a#logoutBtn, button#logoutBtn');
    if (anchor) nav.insertBefore(bell, anchor);
    else nav.appendChild(bell);

    const overlay = create('div', 'ak-notifications-overlay');
    overlay.id = 'akNotificationsOverlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <section class="ak-notifications-dialog" role="dialog" aria-modal="true" aria-labelledby="akNotificationsTitle">
        <header class="ak-notifications-head">
          <div class="ak-notifications-heading">
            <h2 id="akNotificationsTitle">Уведомления</h2>
            <p id="akNotificationsSubtitle">Личные уведомления по выбранным событиям</p>
          </div>
          <div class="ak-notifications-head-actions">
            <button type="button" class="ak-notifications-icon-btn" id="akNotificationsSettings" title="Настройки уведомлений" aria-label="Настройки уведомлений">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"></path><path d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.5 2.5l-.2-.1a1.7 1.7 0 0 0-1.8.4h-.1a1.7 1.7 0 0 0-1 1.5v.2a1.8 1.8 0 1 1-3.6 0v-.2a1.7 1.7 0 0 0-1-1.5h-.1a1.7 1.7 0 0 0-1.8-.4l-.2.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.7 1.7 0 0 0-.4-1.8v-.1a1.7 1.7 0 0 0-1.5-1h-.2a1.8 1.8 0 1 1 0-3.6h.2a1.7 1.7 0 0 0 1.5-1v-.1a1.7 1.7 0 0 0 .4-1.8l-.1-.2a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.7 1.7 0 0 0 1.8-.4h.1a1.7 1.7 0 0 0 1-1.5v-.2a1.8 1.8 0 1 1 3.6 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8.4l.2-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.2a1.7 1.7 0 0 0 .4 1.8v.1a1.7 1.7 0 0 0 1.5 1h.2a1.8 1.8 0 1 1 0 3.6h-.2a1.7 1.7 0 0 0-1.5 1v.1a1.7 1.7 0 0 0-.4 1.8Z"></path></svg>
            </button>
            <button type="button" class="ak-notifications-icon-btn ak-notifications-close" id="akNotificationsClose" title="Закрыть" aria-label="Закрыть">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>
            </button>
          </div>
        </header>
        <div class="ak-notifications-status" id="akNotificationsStatus" role="status" aria-live="polite" hidden></div>
        <div class="ak-notifications-body" id="akNotificationsBody"></div>
        <footer class="ak-notifications-footer" id="akNotificationsFooter"></footer>
      </section>`;
    document.body.appendChild(overlay);

    bell.addEventListener('click', openModal);
    $('akNotificationsClose').addEventListener('click', closeModal);
    $('akNotificationsSettings').addEventListener('click', () => {
      if (activeView === 'settings') setView('inbox');
      else setView('settings');
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeModal();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !overlay.hidden) closeModal();
    });
    $('akNotificationsBody').addEventListener('click', handleBodyClick);
    $('akNotificationsBody').addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const item = event.target.closest('[data-notification-id]');
      if (!item) return;
      event.preventDefault();
      markNotificationRead(item.dataset.notificationId);
    });
    $('akNotificationsFooter').addEventListener('click', handleFooterClick);
  };

  const openModal = () => {
    const overlay = $('akNotificationsOverlay');
    if (!overlay) return;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    document.body.classList.add('ak-notifications-lock');
    $('akNotificationsBell')?.setAttribute('aria-expanded', 'true');
    setView('inbox');
  };

  const closeModal = () => {
    const overlay = $('akNotificationsOverlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    window.setTimeout(() => { overlay.hidden = true; }, 180);
    document.body.classList.remove('ak-notifications-lock');
    $('akNotificationsBell')?.setAttribute('aria-expanded', 'false');
  };

  const setStatus = (message, isError = false) => {
    const node = $('akNotificationsStatus');
    if (!node) return;
    node.textContent = message || '';
    node.hidden = !message;
    node.classList.toggle('is-error', Boolean(message) && isError);
  };

  const loadPreferences = async () => {
    const { data, error } = await sb
      .from('notification_preferences')
      .select('preferences')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      console.error('[DockSlot notifications] Cannot load preferences:', error);
      setStatus('Не удалось загрузить настройки. Проверьте, что SQL-миграция уведомлений установлена.', true);
      preferences = defaultPreferences();
      return;
    }
    preferences = { ...defaultPreferences(), ...(data?.preferences || {}) };
  };

  const loadInbox = async () => {
    const { data, error } = await sb
      .from('app_notifications')
      .select('id, event_type, title, body, related_booking_id, booking_date, metadata, created_at, read_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error('[DockSlot notifications] Cannot load inbox:', error);
      setStatus('Не удалось загрузить уведомления. Проверьте SQL-миграцию и политики доступа.', true);
      inbox = [];
      updateBadge();
      if (activeView === 'inbox') renderInbox();
      return;
    }
    inbox = data || [];
    updateBadge();
    if (activeView === 'inbox') renderInbox();
  };

  const updateBadge = () => {
    const badge = $('akNotificationsBadge');
    if (!badge) return;
    const unread = inbox.filter((item) => !item.read_at).length;
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    $('akNotificationsBell')?.setAttribute('aria-label', unread ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления');
  };

  const formatDateTime = (value) => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  };

  const renderInbox = () => {
    const body = $('akNotificationsBody');
    const footer = $('akNotificationsFooter');
    if (!body || !footer) return;
    body.replaceChildren();
    footer.replaceChildren();
    $('akNotificationsTitle').textContent = 'Уведомления';
    $('akNotificationsSubtitle').textContent = 'Личные уведомления по выбранным событиям';
    $('akNotificationsSettings').title = 'Настройки уведомлений';
    $('akNotificationsSettings').setAttribute('aria-label', 'Настройки уведомлений');
    $('akNotificationsSettings').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z"></path><path d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.5 2.5l-.2-.1a1.7 1.7 0 0 0-1.8.4h-.1a1.7 1.7 0 0 0-1 1.5v.2a1.8 1.8 0 1 1-3.6 0v-.2a1.7 1.7 0 0 0-1-1.5h-.1a1.7 1.7 0 0 0-1.8-.4l-.2.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.7 1.7 0 0 0-.4-1.8v-.1a1.7 1.7 0 0 0-1.5-1h-.2a1.8 1.8 0 1 1 0-3.6h.2a1.7 1.7 0 0 0 1.5-1v-.1a1.7 1.7 0 0 0-.4-1.8l-.1-.2a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.7 1.7 0 0 0 1.8-.4h.1a1.7 1.7 0 0 0 1-1.5v-.2a1.8 1.8 0 1 1 3.6 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.8.4l.2-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.2a1.7 1.7 0 0 0 .4 1.8v.1a1.7 1.7 0 0 0 1.5 1h.2a1.8 1.8 0 1 1 0 3.6h-.2a1.7 1.7 0 0 0-1.5 1v.1a1.7 1.7 0 0 0-.4 1.8Z"></path></svg>';
    if (!inbox.length) {
      const empty = create('div', 'ak-notifications-empty');
      empty.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 7a12 12 0 0 0-12 12c0 13-5 13-5 17h34c0-4-5-4-5-17A12 12 0 0 0 24 7Z"></path><path d="M20 41h8"></path></svg>';
      empty.appendChild(create('strong', '', 'Пока нет уведомлений'));
      empty.appendChild(create('span', '', 'Здесь появятся события, которые вы выбрали в настройках.'));
      body.appendChild(empty);
    } else {
      const list = create('div', 'ak-notifications-list');
      list.setAttribute('role', 'list');
      inbox.forEach((item) => {
        const row = create('article', `ak-notification-item${item.read_at ? '' : ' is-unread'}`);
        row.setAttribute('role', 'listitem');
        const dot = create('span', 'ak-notification-dot');
        dot.setAttribute('aria-hidden', 'true');
        const copy = create('div', 'ak-notification-copy');
        const heading = create('div', 'ak-notification-item-title');
        heading.appendChild(create('strong', '', item.title || 'Уведомление'));
        heading.appendChild(create('time', '', formatDateTime(item.created_at)));
        copy.appendChild(heading);
        copy.appendChild(create('p', '', item.body || ''));
        row.append(dot, copy);
        if (!item.read_at) row.appendChild(create('span', 'ak-notification-new', 'Новое'));
        row.dataset.notificationId = String(item.id);
        row.tabIndex = 0;
        row.setAttribute('role', 'button');
        row.setAttribute('aria-label', `${item.title || 'Уведомление'}. ${item.read_at ? 'Прочитано' : 'Новое'}`);
        list.appendChild(row);
      });
      body.appendChild(list);
    }

    const unread = inbox.some((item) => !item.read_at);
    const readAll = create('button', 'ak-notifications-primary-btn', 'Прочитать все');
    readAll.type = 'button';
    readAll.dataset.action = 'read-all';
    readAll.disabled = !unread;
    footer.appendChild(readAll);
  };

  const renderSettings = () => {
    const body = $('akNotificationsBody');
    const footer = $('akNotificationsFooter');
    if (!body || !footer) return;
    body.replaceChildren();
    footer.replaceChildren();
    $('akNotificationsTitle').textContent = 'Настройки уведомлений';
    $('akNotificationsSubtitle').textContent = userRole === 'admin' ? 'Администратор · личные настройки' : 'Оператор · личные настройки';
    $('akNotificationsSettings').title = 'Вернуться к уведомлениям';
    $('akNotificationsSettings').setAttribute('aria-label', 'Вернуться к уведомлениям');
    $('akNotificationsSettings').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7 7-7-7 7-7"></path></svg>';    setStatus('Настройки действуют только для вашей учетной записи.', false);

    draftPreferences = { ...defaultPreferences(), ...clone(preferences) };
    const intro = create('p', 'ak-notifications-settings-intro', 'Отметьте события, о которых хотите получать уведомления. Для событий по записям можно выбрать все даты или только завтра.');
    body.appendChild(intro);

    const section = create('section', 'ak-notifications-settings-section');
    section.appendChild(create('h3', '', 'События по записям'));
    COMMON_EVENTS.forEach((event) => section.appendChild(buildPreferenceRow(event, true)));
    body.appendChild(section);

    if (userRole === 'admin') {
      const adminSection = create('section', 'ak-notifications-settings-section');
      adminSection.appendChild(create('h3', '', 'Дополнительные события администратора'));
      ADMIN_EVENTS.forEach((event) => adminSection.appendChild(buildPreferenceRow(event, false)));
      body.appendChild(adminSection);
    }

    const save = create('button', 'ak-notifications-primary-btn', 'Сохранить настройки');
    save.type = 'button';
    save.dataset.action = 'save-settings';
    footer.appendChild(save);
    const cancel = create('button', 'ak-notifications-secondary-btn', 'Отмена');
    cancel.type = 'button';
    cancel.dataset.action = 'cancel-settings';
    footer.appendChild(cancel);
  };

  const buildPreferenceRow = (event, hasScope) => {
    const row = create('div', 'ak-notification-pref-row');
    const item = draftPreferences[event.key] || { enabled: false, ...(hasScope ? { scope: 'all' } : {}) };
    const title = create('div', 'ak-notification-pref-title', event.label);
    const controls = create('div', 'ak-notification-pref-controls');
    const checkLabel = create('label', 'ak-notification-switch');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(item.enabled);
    checkbox.setAttribute('aria-label', `Получать уведомления: ${event.label}`);
    checkbox.dataset.prefKey = event.key;
    checkbox.dataset.prefControl = 'enabled';
    const track = create('span', 'ak-notification-switch-track');
    checkLabel.append(checkbox, track);
    controls.appendChild(checkLabel);

    if (hasScope) {
      const select = document.createElement('select');
      select.className = 'ak-notification-scope';
      select.setAttribute('aria-label', `Период уведомлений: ${event.label}`);
      select.dataset.prefKey = event.key;
      select.dataset.prefControl = 'scope';
      select.add(new Option('Все записи', 'all'));
      select.add(new Option('Только на завтра', 'tomorrow'));
      select.value = item.scope === 'tomorrow' ? 'tomorrow' : 'all';
      select.disabled = !checkbox.checked;
      controls.appendChild(select);
    }
    row.append(title, controls);
    row.addEventListener('change', (eventObject) => {
      const target = eventObject.target;
      if (target.dataset.prefControl === 'enabled') {
        draftPreferences[event.key].enabled = target.checked;
        const scopeSelect = row.querySelector('.ak-notification-scope');
        if (scopeSelect) scopeSelect.disabled = !target.checked;
      }
      if (target.dataset.prefControl === 'scope') draftPreferences[event.key].scope = target.value;
    });
    return row;
  };

  const handleBodyClick = (event) => {
    const item = event.target.closest('[data-notification-id]');
    if (item) markNotificationRead(item.dataset.notificationId);
  };

  const handleFooterClick = (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'read-all') markAllRead();
    if (action === 'save-settings') savePreferences();
    if (action === 'cancel-settings') setView('inbox');
  };

  const setView = (view) => {
    activeView = view;
    setStatus('', false);
    if (view === 'settings') renderSettings();
    else renderInbox();
  };

  const markNotificationRead = async (id) => {
    const item = inbox.find((entry) => String(entry.id) === String(id));
    if (!item || item.read_at) return;
    const readAt = new Date().toISOString();
    const { error } = await sb.from('app_notifications').update({ read_at: readAt }).eq('id', id).eq('user_id', user.id);
    if (error) {
      setStatus('Не удалось отметить уведомление как прочитанное.', true);
      return;
    }
    item.read_at = readAt;
    updateBadge();
    if (activeView === 'inbox') renderInbox();
  };

  const markAllRead = async () => {
    const readAt = new Date().toISOString();
    const { error } = await sb.from('app_notifications').update({ read_at: readAt }).eq('user_id', user.id).is('read_at', null);
    if (error) {
      setStatus('Не удалось отметить уведомления как прочитанные.', true);
      return;
    }
    inbox.forEach((item) => { if (!item.read_at) item.read_at = readAt; });
    updateBadge();
    renderInbox();
  };

  const savePreferences = async () => {
    const button = $('akNotificationsFooter')?.querySelector('[data-action="save-settings"]');
    if (button) { button.disabled = true; button.textContent = 'Сохранение…'; }
    const payload = {};
    [...COMMON_EVENTS, ...(userRole === 'admin' ? ADMIN_EVENTS : [])].forEach((event) => {
      const source = draftPreferences[event.key] || {};
      payload[event.key] = { enabled: Boolean(source.enabled) };
      if (COMMON_EVENTS.some((item) => item.key === event.key)) payload[event.key].scope = source.scope === 'tomorrow' ? 'tomorrow' : 'all';
    });
    const { error } = await sb.from('notification_preferences').upsert({
      user_id: user.id,
      preferences: payload,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) {
      console.error('[DockSlot notifications] Cannot save preferences:', error);
      setStatus('Не удалось сохранить настройки. Проверьте SQL-миграцию и права доступа.', true);
      if (button) { button.disabled = false; button.textContent = 'Сохранить настройки'; }
      return;
    }
    preferences = payload;
    setView('inbox');
    showToast('Настройки уведомлений сохранены.');
  };

  const showToast = (message) => {
    let toast = $('akNotificationsToast');
    if (!toast) {
      toast = create('div', 'ak-notifications-toast');
      toast.id = 'akNotificationsToast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('is-visible');
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  };

  const handleRealtimePayload = (payload) => {
    const row = payload?.new;
    if (!row || String(row.user_id) !== String(user.id)) return;
    if (payload.eventType === 'INSERT') {
      if (!inbox.some((item) => String(item.id) === String(row.id))) inbox.unshift(row);
      inbox = inbox.slice(0, 100);
    } else if (payload.eventType === 'UPDATE') {
      const index = inbox.findIndex((item) => String(item.id) === String(row.id));
      if (index >= 0) inbox[index] = { ...inbox[index], ...row };
    }
    updateBadge();
    if (activeView === 'inbox' && $('akNotificationsOverlay') && !$('akNotificationsOverlay').hidden) renderInbox();
  };

  const setupRealtime = () => {
    if (typeof sb.channel !== 'function') {
      startFallbackPolling();
      return;
    }
    realtimeChannel = sb.channel(`dockslot-notifications-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'app_notifications', filter: `user_id=eq.${user.id}`
      }, handleRealtimePayload)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'app_notifications', filter: `user_id=eq.${user.id}`
      }, handleRealtimePayload)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          stopFallbackPolling();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          startFallbackPolling();
        }
      });
  };

  const startFallbackPolling = () => {
    if (fallbackPoll) return;
    fallbackPoll = window.setInterval(loadInbox, 30000);
  };
  const stopFallbackPolling = () => {
    if (!fallbackPoll) return;
    window.clearInterval(fallbackPoll);
    fallbackPoll = null;
  };

  const processDueReminders = async () => {
    if (userRole !== 'admin') return;
    const { error } = await sb.rpc('akson_process_due_reminder_notifications');
    if (error) {
      // pg_cron can process reminders independently; this call is the active-tab fallback.
      console.warn('[DockSlot notifications] Reminder processing fallback:', error.message || error);
    }
  };

  window.addEventListener('beforeunload', () => {
    if (realtimeChannel) sb.removeChannel(realtimeChannel);
    if (fallbackPoll) window.clearInterval(fallbackPoll);
    if (reminderPoll) window.clearInterval(reminderPoll);
  });

  init();
});
