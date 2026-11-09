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

  const PUSH_SW_PATH = '/sw.js';
  const PUSH_PUBLIC_KEY = String(window.AKSON_DOCKSLOT_PUSH?.publicKey || '').trim();

  let user = null;
  let userRole = '';
  let preferences = {};
  let draftPreferences = {};
  let inbox = [];
  let activeView = 'inbox';
  let realtimeChannel = null;
  let fallbackPoll = null;
  let toastTimer = null;
  const desktopNotificationIds = new Set();

  const defaultPreferences = () => {
    const result = {};
    [...COMMON_EVENTS, ...(['admin', 'super_admin'].includes(userRole) ? ADMIN_EVENTS : [])].forEach((event) => {
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
      // Share the same server-validated identity and DB profile used by navigation/page guards.
      const authProfile = await window.dockslotGetAuthProfile?.();
      if (!authProfile?.user || authProfile.error || !authProfile.profile || authProfile.profile.is_blocked) return;
      user = authProfile.user;
      userRole = String(authProfile.profile.role || '').toLowerCase();
      // Suppliers and view-only users have no notification preferences in this specification.
      if (!['admin', 'super_admin', 'operator'].includes(userRole)) return;

      mountBellAndModal();
      await Promise.all([loadPreferences(), loadInbox()]);
      setupRealtime();
      await refreshPushSettingsUI();

      // Due reminder notifications are processed by the verified active pg_cron job
      // (akson-dockslot-due-reminders). Do not poll the same RPC from every admin tab.
    } catch (error) {
      console.error('[DockSlot notifications] Initialization failed:', error);
    }
  };

  const mountBellAndModal = () => {
    if (document.getElementById('akNotificationsBell')) return;

    const bell = create('button', 'ak-notifications-bell');
    bell.type = 'button';
    bell.id = 'akNotificationsBell';
    bell.title = 'Уведомления';
    bell.setAttribute('aria-label', 'Уведомления');
    bell.setAttribute('aria-haspopup', 'dialog');
    bell.setAttribute('aria-expanded', 'false');
    bell.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg><span class="ak-notifications-badge" id="akNotificationsBadge" hidden></span>';

    // Keep the notification control floating above the page, independent of navigation and scroll.
    document.body.appendChild(bell);

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
    return new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
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
    $('akNotificationsSubtitle').textContent = ['admin', 'super_admin'].includes(userRole) ? 'Администратор · личные настройки' : 'Оператор · личные настройки';
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

    if (['admin', 'super_admin'].includes(userRole)) {
      const adminSection = create('section', 'ak-notifications-settings-section');
      adminSection.appendChild(create('h3', '', 'Дополнительные события администратора'));
      ADMIN_EVENTS.forEach((event) => adminSection.appendChild(buildPreferenceRow(event, false)));
      body.appendChild(adminSection);
    }

    const pushSection = create('section', 'ak-notifications-settings-section ak-push-section');
    pushSection.appendChild(create('h3', '', 'Системные уведомления Windows / браузера'));
    pushSection.appendChild(create('p', 'ak-push-settings-description', 'Разрешите уведомления на этом устройстве, чтобы получать выбранные события, даже когда ДокСлот открыт в другой вкладке или вы работаете на другом сайте.'));
    const pushStatus = create('div', 'ak-push-settings-status', 'Проверяем поддержку Push…');
    pushStatus.id = 'akPushSettingsStatus';
    pushSection.appendChild(pushStatus);
    const pushActions = create('div', 'ak-push-settings-actions');
    const enablePush = create('button', 'ak-notifications-primary-btn', 'Включить уведомления на этом устройстве');
    enablePush.type = 'button';
    enablePush.id = 'akPushEnableButton';
    enablePush.dataset.action = 'push-enable';
    pushActions.appendChild(enablePush);
    const disablePush = create('button', 'ak-notifications-secondary-btn', 'Отключить на этом устройстве');
    disablePush.type = 'button';
    disablePush.id = 'akPushDisableButton';
    disablePush.dataset.action = 'push-disable';
    disablePush.hidden = true;
    pushActions.appendChild(disablePush);
    const testPush = create('button', 'ak-notifications-secondary-btn', 'Проверить системное уведомление');
    testPush.type = 'button';
    testPush.id = 'akPushTestButton';
    testPush.dataset.action = 'push-test';
    testPush.hidden = true;
    pushActions.appendChild(testPush);
    pushSection.appendChild(pushActions);
    body.appendChild(pushSection);

    const save = create('button', 'ak-notifications-primary-btn', 'Сохранить настройки');
    save.type = 'button';
    save.dataset.action = 'save-settings';
    footer.appendChild(save);
    const cancel = create('button', 'ak-notifications-secondary-btn', 'Отмена');
    cancel.type = 'button';
    cancel.dataset.action = 'cancel-settings';
    footer.appendChild(cancel);
    refreshPushSettingsUI();
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
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'push-enable') { enablePushNotifications(); return; }
    if (action === 'push-disable') { disablePushNotifications(); return; }
    if (action === 'push-test') { runDesktopNotificationTest(); return; }
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
    [...COMMON_EVENTS, ...(['admin', 'super_admin'].includes(userRole) ? ADMIN_EVENTS : [])].forEach((event) => {
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

  const pushIsSupported = () => Boolean(
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );

  const base64UrlToUint8Array = (value) => {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const raw = atob(padded);
    const output = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
    return output;
  };

  const refreshPushSettingsUI = async () => {
    const status = $('akPushSettingsStatus');
    const enable = $('akPushEnableButton');
    const disable = $('akPushDisableButton');
    const test = $('akPushTestButton');
    if (!status || !enable || !disable) return;

    enable.disabled = false;
    disable.hidden = true;
    if (test) test.hidden = !('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator);

    if (!pushIsSupported()) {
      status.textContent = 'Этот браузер или соединение не поддерживает системные Push-уведомления. Откройте ДокСлот по HTTPS в актуальном Chrome или Edge.';
      enable.disabled = true;
      return;
    }
    if (!PUSH_PUBLIC_KEY || PUSH_PUBLIC_KEY.includes('PASTE_')) {
      status.textContent = 'Push ещё не настроен администратором сайта: необходимо указать публичный VAPID-ключ в js/push-config.js.';
      enable.disabled = true;
      return;
    }
    if (Notification.permission === 'denied') {
      status.textContent = 'Браузер заблокировал уведомления для ДокСлота. Разрешите их в настройках разрешений сайта, затем обновите страницу.';
      enable.textContent = 'Ожидает разрешения браузера';
      enable.disabled = true;
      return;
    }

    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        const { data, error } = await sb
          .from('push_subscriptions')
          .select('id')
          .eq('user_id', user.id)
          .eq('endpoint', subscription.endpoint)
          .maybeSingle();
        if (error) throw error;
        if (data) {
          status.textContent = 'Системные уведомления включены на этом устройстве. Уведомления будут приходить по выбранным событиям.';
          enable.textContent = 'Обновить подключение';
          disable.hidden = false;
          return;
        }
        status.textContent = 'В браузере есть Push-подписка, но она ещё не привязана к вашей учётной записи. Нажмите «Обновить подключение».';
        enable.textContent = 'Обновить подключение';
        return;
      }
      status.textContent = Notification.permission === 'granted'
        ? 'Разрешение браузера уже выдано. Нажмите кнопку, чтобы подключить это устройство.'
        : 'На этом устройстве системные уведомления пока не включены.';
      enable.textContent = 'Включить уведомления на этом устройстве';
    } catch (error) {
      console.warn('[DockSlot Push] Cannot read subscription state:', error);
      status.textContent = 'Не удалось проверить Push-подписку. Проверьте SQL-миграцию v2 и обновите страницу.';
    }
  };

  const getRootServiceWorkerRegistration = async () => {
    let registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) registration = await navigator.serviceWorker.register(PUSH_SW_PATH, { scope: '/', updateViaCache: 'none' });
    try { await registration.update(); } catch (_) { /* An update check is best-effort. */ }
    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    const ready = await navigator.serviceWorker.ready;
    return ready || registration;
  };

  const runDesktopNotificationTest = async () => {
    const button = $('akPushTestButton');
    if (button) { button.disabled = true; button.textContent = 'Проверка…'; }
    try {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) {
        throw new Error('Этот браузер не поддерживает системные уведомления через Service Worker.');
      }
      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error('Разрешите уведомления для сайта в настройках браузера и повторите проверку.');
      }
      const registration = await getRootServiceWorkerRegistration();
      if (!registration || !registration.active) throw new Error('Service Worker ещё не активирован. Обновите страницу и повторите проверку.');
      await registration.showNotification('Тестовое уведомление — Аксон ДокСлот', {
        body: 'Если этот баннер появился в правом нижнем углу Windows, браузер и Windows разрешают системные уведомления.',
        icon: '/assets/apple-touch-icon.png',
        badge: '/assets/apple-touch-icon.png',
        tag: `akson-dockslot-local-test-${Date.now()}`,
        renotify: true,
        requireInteraction: true,
        data: { url: '/app/dashboard.html', notificationId: 'local-test' }
      });
      setStatus('Тестовое уведомление передано Windows через Service Worker. Если баннер не появился, проверьте уведомления Chrome/Edge и Windows, а также режим «Не беспокоить».', false);
    } catch (error) {
      console.error('[DockSlot Push] Desktop test failed:', error);
      setStatus(error?.message || 'Не удалось показать тестовое системное уведомление.', true);
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Проверить системное уведомление'; }
      await refreshPushSettingsUI();
    }
  };

  const enablePushNotifications = async () => {
    const button = $('akPushEnableButton');
    if (button) { button.disabled = true; button.textContent = 'Подключение…'; }
    try {
      if (!pushIsSupported()) throw new Error('Для системных уведомлений нужен актуальный Chrome или Edge и HTTPS.');
      if (!PUSH_PUBLIC_KEY || PUSH_PUBLIC_KEY.includes('PASTE_')) throw new Error('Не указан публичный VAPID-ключ. Настройте js/push-config.js.');

      let permission = Notification.permission;
      if (permission === 'default') permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error(permission === 'denied'
          ? 'Уведомления заблокированы в браузере. Разрешите их в настройках сайта и повторите попытку.'
          : 'Разрешение на уведомления не выдано.');
      }

      const registration = await getRootServiceWorkerRegistration();
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const { data: existingSubscription, error: lookupError } = await sb
          .from('push_subscriptions')
          .select('id')
          .eq('user_id', user.id)
          .eq('endpoint', subscription.endpoint)
          .maybeSingle();
        if (lookupError) throw lookupError;
        // The server may have removed an expired endpoint after a 404/410 response.
        // Recreate the browser subscription instead of saving the same stale endpoint again.
        if (!existingSubscription) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(PUSH_PUBLIC_KEY)
        });
      }
      const serialized = subscription.toJSON();
      if (!serialized.keys?.p256dh || !serialized.keys?.auth) {
        throw new Error('Браузер не вернул ключи Push-подписки. Попробуйте обновить браузер.');
      }

      const { error } = await sb.from('push_subscriptions').upsert({
        user_id: user.id,
        endpoint: subscription.endpoint,
        p256dh: serialized.keys.p256dh,
        auth: serialized.keys.auth,
        user_agent: navigator.userAgent.slice(0, 500),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,endpoint' });
      if (error) throw error;

      await refreshPushSettingsUI();
      showToast('Системные уведомления включены на этом устройстве.');
    } catch (error) {
      console.error('[DockSlot Push] Enable failed:', error);
      setStatus(error?.message || 'Не удалось включить системные уведомления.', true);
      if (button) { button.disabled = false; button.textContent = 'Повторить подключение'; }
      await refreshPushSettingsUI();
    }
  };

  const disablePushNotifications = async () => {
    const button = $('akPushDisableButton');
    if (button) { button.disabled = true; button.textContent = 'Отключение…'; }
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = registration ? await registration.pushManager.getSubscription() : null;
      if (subscription) {
        const { error } = await sb.from('push_subscriptions')
          .delete()
          .eq('user_id', user.id)
          .eq('endpoint', subscription.endpoint);
        if (error) throw error;
        await subscription.unsubscribe();
      }
      await refreshPushSettingsUI();
      showToast('Системные уведомления отключены на этом устройстве.');
    } catch (error) {
      console.error('[DockSlot Push] Disable failed:', error);
      setStatus(error?.message || 'Не удалось отключить системные уведомления.', true);
      if (button) { button.disabled = false; button.textContent = 'Отключить на этом устройстве'; }
    }
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

  const showRealtimeDesktopNotification = async (row) => {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
    const id = String(row?.id || '');
    if (id && desktopNotificationIds.has(id)) return;
    if (id) {
      desktopNotificationIds.add(id);
      if (desktopNotificationIds.size > 150) desktopNotificationIds.clear();
    }
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const title = String(row?.title || 'Аксон ДокСлот').slice(0, 120);
      const body = String(row?.body || 'Появилось новое уведомление.').slice(0, 500);
      const parsedTimestamp = row?.created_at ? new Date(row.created_at).getTime() : Date.now();
      const notificationOptions = {
        body,
        icon: '/assets/apple-touch-icon.png',
        badge: '/assets/apple-touch-icon.png',
        tag: id ? `akson-dockslot-${id}` : `akson-dockslot-${Date.now()}`,
        renotify: false,
        timestamp: Number.isFinite(parsedTimestamp) ? parsedTimestamp : Date.now(),
        data: { url: '/app/dashboard.html', notificationId: id }
      };
      if (registration?.active) {
        await registration.showNotification(title, notificationOptions);
      } else {
        const fallback = new Notification(title, notificationOptions);
        fallback.onclick = () => { window.focus(); fallback.close(); };
      }
    } catch (error) {
      console.warn('[DockSlot Push] Realtime desktop notification fallback failed:', error);
    }
  };

  const handleRealtimePayload = (payload) => {
    const row = payload?.new;
    if (!row || String(row.user_id) !== String(user.id)) return;
    if (payload.eventType === 'INSERT') {
      if (!inbox.some((item) => String(item.id) === String(row.id))) inbox.unshift(row);
      inbox = inbox.slice(0, 100);
      // A live Realtime event is also shown through the OS notification API while any
      // DockSlot tab remains open. The stable tag avoids a second alert when Web Push
      // for the same notification arrives from the service worker.
      showRealtimeDesktopNotification(row);
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

  window.addEventListener('beforeunload', () => {
    if (realtimeChannel) sb.removeChannel(realtimeChannel);
    if (fallbackPoll) window.clearInterval(fallbackPoll);
  });

  init();
});
