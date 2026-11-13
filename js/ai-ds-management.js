/* AKSON DockSlot — Doxi management v1.8.
   Only super_admin can read global history and change assistant permissions/style. */
document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('doxiAdminRoot');
  const sb = window.supabaseClient;
  if (!root || !sb?.auth || !sb?.functions || typeof window.dockslotGetAuthProfile !== 'function') return;

  const $ = (id) => document.getElementById(id);
  const statusText = $('doxiStatusText');
  const statusHint = $('doxiStatusHint');
  const statusDot = $('doxiStatusDot');
  const enabledInput = $('doxiEnabled');
  const liveDataInput = $('doxiLiveDataEnabled');
  const detailsInput = $('doxiBookingDetailsEnabled');
  const styleInput = $('doxiAssistantStyle');
  const roleInputs = [...document.querySelectorAll('#doxiAllowedRoles input[type="checkbox"]')];
  const saveButton = $('doxiSaveBtn');
  const testButton = $('doxiTestBtn');
  const saveMeta = $('doxiSaveMeta');
  const testResult = $('doxiTestResult');
  const toast = $('doxiToast');
  const modelName = $('doxiModelName');
  const modelDetails = $('doxiModelDetails');
  const historyOpen = $('doxiHistoryOpen');
  const historyOverlay = $('doxiHistoryOverlay');
  const historyClose = $('doxiHistoryClose');
  const historyList = $('doxiHistoryList');
  const historySearch = $('doxiHistorySearch');
  const historyMore = $('doxiHistoryMore');
  const historyTranscript = $('doxiHistoryTranscript');

  let saved = null;
  let busy = false;
  let toastTimer = null;
  let historyOffset = 0;
  let historyTotal = 0;
  let historyHasMore = false;
  let historyItems = [];
  let selectedConversationId = null;
  let messageOffset = 0;
  let messageHasMore = false;
  let historyQuery = '';

  const showToast = (message, isError = false) => {
    toast.textContent = message;
    toast.classList.toggle('is-error', isError);
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
  };

  const setStatus = (kind, title, hint) => {
    statusText.textContent = title;
    statusHint.textContent = hint;
    statusDot.classList.toggle('is-online', kind === 'online');
    statusDot.classList.toggle('is-offline', kind === 'offline');
  };

  const invoke = async (body) => {
    const { data, error } = await sb.functions.invoke('doxi-chat', { body });
    if (error) throw new Error(error.message || 'Не удалось обратиться к серверу Докси.');
    if (!data) throw new Error('Сервер Докси вернул пустой ответ.');
    if (data.error) throw new Error(data.error);
    return data;
  };

  const selectedRoles = () => roleInputs.filter((input) => input.checked).map((input) => input.value);
  const applyRoles = (roles) => roleInputs.forEach((input) => {
    input.checked = input.value === 'super_admin' || roles.includes(input.value);
  });
  const captureSettings = () => ({
    enabled: enabledInput.checked,
    live_data_enabled: liveDataInput.checked,
    booking_details_enabled: detailsInput.checked,
    assistant_style: styleInput.value,
    allowed_roles: selectedRoles().sort(),
  });
  const normalizedRoles = (roles) => [...(roles || [])].sort();
  const hasChanges = () => {
    if (!saved) return false;
    const current = captureSettings();
    return current.enabled !== Boolean(saved.enabled)
      || current.live_data_enabled !== Boolean(saved.live_data_enabled)
      || current.booking_details_enabled !== Boolean(saved.booking_details_enabled)
      || current.assistant_style !== (saved.assistant_style || 'delicate')
      || JSON.stringify(current.allowed_roles) !== JSON.stringify(normalizedRoles(saved.allowed_roles));
  };
  const updateSaveState = () => {
    if (!saved || busy) { saveButton.disabled = true; return; }
    const changed = hasChanges();
    saveButton.disabled = !changed;
    saveMeta.textContent = changed ? 'Есть несохранённые изменения.' : 'Настройки сохранены.';
  };

  const setFormFromSettings = (settings) => {
    saved = settings;
    enabledInput.checked = Boolean(saved.enabled);
    liveDataInput.checked = Boolean(saved.live_data_enabled);
    detailsInput.checked = Boolean(saved.booking_details_enabled);
    styleInput.value = saved.assistant_style || 'delicate';
    applyRoles(saved.allowed_roles || ['super_admin']);
    if (modelName) modelName.textContent = saved.model || 'Модель подключена';
    if (modelDetails) modelDetails.textContent = saved.deployment || 'Технические сведения доступны только Super Admin.';
    const active = Boolean(saved.enabled);
    setStatus(active ? 'online' : 'offline', active ? 'Докси активна' : 'Докси отключена', active
      ? 'Чат доступен выбранным ролям. Чтение данных: ' + (saved.live_data_enabled ? 'включено.' : 'выключено.')
      : 'Глобальный переключатель отключает ответы помощницы.');
    saveMeta.textContent = 'Настройки загружены.';
    saveButton.disabled = true;
    testButton.disabled = false;
  };

  const loadSettings = async () => {
    setStatus('pending', 'Загружаю настройки…', 'Получаем защищённую конфигурацию из Supabase.');
    try {
      const result = await invoke({ action: 'admin_get_settings' });
      setFormFromSettings(result.settings);
    } catch (error) {
      saved = null;
      setStatus('offline', 'Не удалось загрузить настройки', error.message);
      saveMeta.textContent = 'Проверьте SQL-миграцию v1.8 и публикацию Edge Function.';
      saveButton.disabled = true;
      testButton.disabled = true;
      showToast(error.message, true);
    }
  };

  try {
    const auth = await window.dockslotGetAuthProfile();
    if (!auth?.user) {
      window.location.replace('../index.html');
      return;
    }
    if (auth.error || !auth.profile || auth.profile.is_blocked || String(auth.profile.role || '').toLowerCase() !== 'super_admin') {
      window.location.replace('admin_overview.html');
      return;
    }
    root.hidden = false;
  } catch (error) {
    console.warn('[Докси] Не удалось подтвердить доступ к странице управления.', error);
    window.location.replace('../index.html');
    return;
  }

  [enabledInput, liveDataInput, detailsInput, styleInput, ...roleInputs].forEach((control) => {
    control.addEventListener('change', updateSaveState);
  });

  saveButton.addEventListener('click', async () => {
    if (!saved || busy) return;
    busy = true;
    saveButton.disabled = true;
    testButton.disabled = true;
    saveButton.textContent = 'Сохраняю…';
    try {
      const result = await invoke({ action: 'admin_update_settings', ...captureSettings() });
      setFormFromSettings(result.settings);
      saveMeta.textContent = 'Сохранено ' + new Date(result.settings.updated_at || Date.now()).toLocaleString('ru-RU');
      showToast('Настройки Докси сохранены.');
    } catch (error) {
      showToast(error.message, true);
      saveMeta.textContent = 'Не удалось сохранить настройки.';
    } finally {
      busy = false;
      saveButton.textContent = 'Сохранить настройки';
      testButton.disabled = false;
      updateSaveState();
    }
  });

  testButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    testButton.disabled = true;
    saveButton.disabled = true;
    testButton.textContent = 'Проверяю…';
    testResult.classList.remove('is-ok', 'is-error');
    testResult.lastElementChild.textContent = 'Отправляю короткий контрольный запрос…';
    try {
      const result = await invoke({ action: 'admin_health_check' });
      testResult.classList.add('is-ok');
      testResult.lastElementChild.textContent = `Соединение работает. Ответ: «${String(result.response || 'готова').slice(0, 100)}». Время: ${Number(result.elapsed_ms || 0)} мс.`;
      showToast('Связь с Докси проверена успешно.');
      setStatus(Boolean(saved?.enabled) ? 'online' : 'offline', Boolean(saved?.enabled) ? 'Докси активна' : 'Докси отключена', `Соединение проверено. Чтение данных ${saved?.live_data_enabled ? 'включено.' : 'выключено.'}`);
    } catch (error) {
      testResult.classList.add('is-error');
      testResult.lastElementChild.textContent = error.message;
      showToast(error.message, true);
      setStatus('offline', 'Нет связи с Докси', error.message);
    } finally {
      busy = false;
      testButton.textContent = 'Проверить соединение';
      testButton.disabled = false;
      updateSaveState();
    }
  });

  // ---------- Global conversation history (server verifies super_admin again) ----------
  const formatDate = (value) => {
    if (!value) return 'Дата не указана';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Дата не указана' : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  };
  const createEmpty = (text) => {
    const el = document.createElement('div');
    el.className = 'doxi-history-empty';
    el.textContent = text;
    return el;
  };
  const filteredHistory = () => {
    const query = historyQuery.trim().toLocaleLowerCase('ru-RU');
    if (!query) return historyItems;
    return historyItems.filter((item) => [item.user_name, item.title, item.preview].some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(query)));
  };
  const renderHistoryList = () => {
    historyList.replaceChildren();
    const items = filteredHistory();
    if (!items.length) {
      historyList.append(createEmpty(historyItems.length ? 'По вашему запросу ничего не найдено.' : 'Пока нет сохранённых диалогов.'));
    } else {
      items.forEach((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'doxi-history-item' + (item.id === selectedConversationId ? ' is-active' : '');
        button.dataset.conversationId = item.id;
        const top = document.createElement('span'); top.className = 'doxi-history-item-top';
        const user = document.createElement('strong'); user.textContent = item.user_name || 'Пользователь DockSlot';
        const date = document.createElement('time'); date.textContent = formatDate(item.last_activity_at);
        top.append(user, date);
        const title = document.createElement('span'); title.className = 'doxi-history-item-title'; title.textContent = item.title || 'Диалог с Докси';
        const preview = document.createElement('span'); preview.className = 'doxi-history-item-preview'; preview.textContent = item.preview || 'Нет текста';
        const meta = document.createElement('span'); meta.className = 'doxi-history-item-meta'; meta.textContent = `${Number(item.message_count || 0)} сообщ.`;
        button.append(top, title, preview, meta);
        historyList.append(button);
      });
    }
    historyMore.hidden = !historyHasMore;
  };
  const appendMessageCard = (row, where = 'append') => {
    const card = document.createElement('article');
    card.className = `doxi-history-message ${row.role === 'user' ? 'is-user' : 'is-assistant'}`;
    const top = document.createElement('div'); top.className = 'doxi-history-message-top';
    const role = document.createElement('strong'); role.textContent = row.role === 'user' ? 'Пользователь' : 'Докси';
    const date = document.createElement('time'); date.textContent = formatDate(row.created_at);
    top.append(role, date);
    const content = document.createElement('p'); content.textContent = row.content || '';
    const meta = document.createElement('small'); meta.textContent = row.page ? `Раздел: ${row.page}` : '';
    card.append(top, content, meta);
    if (where === 'prepend') historyTranscript.insertBefore(card, historyTranscript.querySelector('.doxi-history-message') || null);
    else historyTranscript.append(card);
  };
  const loadConversation = async (conversationId, older = false) => {
    if (!conversationId) return;
    if (!older) {
      selectedConversationId = conversationId;
      messageOffset = 0;
      messageHasMore = false;
      historyTranscript.replaceChildren(createEmpty('Загружаю переписку…'));
      renderHistoryList();
    }
    try {
      const result = await invoke({ action: 'admin_get_history', conversation_id: conversationId, offset: older ? messageOffset : 0 });
      const headerExists = Boolean(historyTranscript.querySelector('.doxi-history-transcript-heading'));
      if (!headerExists) {
        historyTranscript.replaceChildren();
        const heading = document.createElement('header'); heading.className = 'doxi-history-transcript-heading';
        const title = document.createElement('h3'); title.textContent = result.conversation.user_name || 'Пользователь DockSlot';
        const subtitle = document.createElement('p'); subtitle.textContent = `${result.conversation.title || 'Диалог с Докси'} · ${formatDate(result.conversation.created_at)}`;
        heading.append(title, subtitle);
        historyTranscript.append(heading);
      }
      const olderButton = historyTranscript.querySelector('.doxi-history-older-btn');
      if (olderButton) olderButton.remove();
      (older ? [...result.messages].reverse() : result.messages).forEach((row) => appendMessageCard(row, older ? 'prepend' : 'append'));
      messageOffset = result.next_offset || (messageOffset + result.messages.length);
      messageHasMore = Boolean(result.has_more);
      if (messageHasMore) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'doxi-history-older-btn';
        button.textContent = 'Загрузить более ранние сообщения';
        button.addEventListener('click', () => void loadConversation(conversationId, true));
        historyTranscript.insertBefore(button, historyTranscript.firstChild?.nextSibling || null);
      }
      if (!older) historyTranscript.scrollTop = historyTranscript.scrollHeight;
    } catch (error) {
      if (!older) historyTranscript.replaceChildren(createEmpty(error.message));
      else showToast(error.message, true);
    }
  };
  const loadHistory = async (reset = false) => {
    if (reset) {
      historyOffset = 0;
      historyTotal = 0;
      historyHasMore = false;
      historyItems = [];
      historyList.replaceChildren(createEmpty('Загружаю историю…'));
    }
    try {
      const result = await invoke({ action: 'admin_list_history', offset: historyOffset });
      historyItems = historyItems.concat(result.conversations || []);
      historyTotal = Number(result.total || 0);
      historyOffset = Number(result.next_offset || historyItems.length);
      historyHasMore = Boolean(result.has_more);
      renderHistoryList();
      if (!historyItems.length) historyList.replaceChildren(createEmpty('Пока нет сохранённых диалогов.'));
    } catch (error) {
      historyList.replaceChildren(createEmpty(error.message));
      showToast(error.message, true);
    }
  };
  const openHistory = () => {
    historyOverlay.hidden = false;
    document.body.classList.add('doxi-history-open');
    historyQuery = '';
    historySearch.value = '';
    selectedConversationId = null;
    historyTranscript.replaceChildren(createEmpty('Выберите диалог слева, чтобы просмотреть переписку.'));
    void loadHistory(true);
    setTimeout(() => historySearch.focus(), 50);
  };
  const closeHistory = () => {
    historyOverlay.hidden = true;
    document.body.classList.remove('doxi-history-open');
    historyOpen.focus();
  };

  historyOpen.addEventListener('click', openHistory);
  historyClose.addEventListener('click', closeHistory);
  historyOverlay.addEventListener('click', (event) => { if (event.target === historyOverlay) closeHistory(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !historyOverlay.hidden) closeHistory(); });
  historySearch.addEventListener('input', () => { historyQuery = historySearch.value || ''; renderHistoryList(); });
  historyMore.addEventListener('click', () => { historyMore.disabled = true; void loadHistory(false).finally(() => { historyMore.disabled = false; }); });
  historyList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-conversation-id]');
    if (!button) return;
    void loadConversation(button.dataset.conversationId, false);
  });

  await loadSettings();
});
