/* AKSON DockSlot — Doxi management page v1.7.
   The page is fail-closed and all settings operations are server-authorized. */
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
  const saveButton = $('doxiSaveBtn');
  const testButton = $('doxiTestBtn');
  const saveMeta = $('doxiSaveMeta');
  const testResult = $('doxiTestResult');
  const toast = $('doxiToast');

  let saved = null;
  let busy = false;
  let toastTimer = null;

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
    if (error) {
      const message = error.message || 'Не удалось обратиться к серверу Докси.';
      throw new Error(message);
    }
    if (!data) throw new Error('Сервер Докси вернул пустой ответ.');
    if (data.error) throw new Error(data.error);
    return data;
  };

  const updateSaveState = () => {
    if (!saved || busy) { saveButton.disabled = true; return; }
    const changed = enabledInput.checked !== Boolean(saved.enabled) || liveDataInput.checked !== Boolean(saved.live_data_enabled);
    saveButton.disabled = !changed;
    saveMeta.textContent = changed ? 'Есть несохранённые изменения.' : 'Настройки сохранены.';
  };

  const loadSettings = async () => {
    setStatus('pending', 'Загружаю настройки…', 'Получаем защищённую конфигурацию из Supabase.');
    try {
      const result = await invoke({ action: 'admin_get_settings' });
      saved = result.settings;
      enabledInput.checked = Boolean(saved.enabled);
      liveDataInput.checked = Boolean(saved.live_data_enabled);
      const active = Boolean(saved.enabled);
      setStatus(active ? 'online' : 'offline', active ? 'Докси активна' : 'Докси отключена', active
        ? 'Чат разрешён. Доступ к данным: ' + (saved.live_data_enabled ? 'включён.' : 'выключен.')
        : 'Глобальный переключатель отключает ответы помощницы.');
      saveMeta.textContent = 'Настройки загружены.';
      saveButton.disabled = true;
      testButton.disabled = false;
    } catch (error) {
      saved = null;
      setStatus('offline', 'Не удалось загрузить настройки', error.message);
      saveMeta.textContent = 'Проверьте SQL-миграцию v1.7 и публикацию Edge Function.';
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

  enabledInput.addEventListener('change', updateSaveState);
  liveDataInput.addEventListener('change', updateSaveState);

  saveButton.addEventListener('click', async () => {
    if (!saved || busy) return;
    busy = true;
    saveButton.disabled = true;
    testButton.disabled = true;
    saveButton.textContent = 'Сохраняю…';
    try {
      const result = await invoke({
        action: 'admin_update_settings',
        enabled: enabledInput.checked,
        live_data_enabled: liveDataInput.checked,
      });
      saved = result.settings;
      enabledInput.checked = Boolean(saved.enabled);
      liveDataInput.checked = Boolean(saved.live_data_enabled);
      const active = Boolean(saved.enabled);
      setStatus(active ? 'online' : 'offline', active ? 'Докси активна' : 'Докси отключена', active
        ? 'Чат разрешён. Доступ к данным: ' + (saved.live_data_enabled ? 'включён.' : 'выключен.')
        : 'Глобальный переключатель отключает ответы помощницы.');
      saveMeta.textContent = 'Сохранено ' + new Date(saved.updated_at || Date.now()).toLocaleString('ru-RU');
      showToast('Настройки Докси сохранены.');
    } catch (error) {
      showToast(error.message, true);
      saveMeta.textContent = 'Не удалось сохранить настройки.';
    } finally {
      busy = false;
      saveButton.textContent = 'Сохранить настройки';
      saveButton.disabled = false;
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
    testResult.lastElementChild.textContent = 'Отправляю короткий тестовый запрос в Qwen 3.5 9B…';
    try {
      const result = await invoke({ action: 'admin_health_check' });
      testResult.classList.add('is-ok');
      testResult.lastElementChild.textContent = `Соединение работает. Ответ модели: «${String(result.response || 'готова').slice(0, 100)}». Время: ${Number(result.elapsed_ms || 0)} мс.`;
      showToast('Связь с Ollama проверена успешно.');
      setStatus(Boolean(saved?.enabled) ? 'online' : 'offline', Boolean(saved?.enabled) ? 'Докси активна' : 'Докси отключена', `Модель отвечает. ${saved?.live_data_enabled ? 'Чтение живых данных включено.' : 'Чтение живых данных выключено.'}`);
    } catch (error) {
      testResult.classList.add('is-error');
      testResult.lastElementChild.textContent = error.message;
      showToast(error.message, true);
      setStatus('offline', 'Нет связи с моделью', error.message);
    } finally {
      busy = false;
      testButton.textContent = 'Проверить соединение';
      testButton.disabled = false;
      updateSaveState();
    }
  });

  await loadSettings();
});
