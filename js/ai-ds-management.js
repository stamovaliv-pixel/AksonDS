/* Doxi management v2.0.0.
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
  const createInput = $('doxiBookingCreateEnabled');
  const updateInput = $('doxiBookingUpdateEnabled');
  const deleteInput = $('doxiBookingDeleteEnabled');
  const notesInput = $('doxiNotesEnabled');
  const remindersInput = $('doxiRemindersEnabled');
  const roleControls = {
    admin: $('doxiRoleAdmin'), operator: $('doxiRoleOperator'),
    viewer: $('doxiRoleViewer'), supplier: $('doxiRoleSupplier'),
  };
  const roleLabels = { super_admin: 'Super Admin', admin: 'Администратор', operator: 'Оператор', viewer: 'Наблюдатель', supplier: 'Поставщик' };
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
  const knowledgeFile = $('doxiKnowledgeFile');
  const knowledgeTitle = $('doxiKnowledgeTitle');
  const knowledgeCategory = $('doxiKnowledgeCategory');
  const knowledgeUpload = $('doxiKnowledgeUpload');
  const knowledgeStatus = $('doxiKnowledgeStatus');
  const knowledgeList = $('doxiKnowledgeList');
  const memoryTitle = $('doxiMemoryTitle');
  const memoryCategory = $('doxiMemoryCategory');
  const memoryContent = $('doxiMemoryContent');
  const memorySave = $('doxiMemorySave');
  const memoryCancel = $('doxiMemoryCancel');
  const memoryStatus = $('doxiMemoryStatus');
  const memoryList = $('doxiMemoryList');
  const thinkingText = $('doxiThinkingText'); const thinkingSave = $('doxiThinkingSave'); const thinkingCancel = $('doxiThinkingCancel'); const thinkingStatus = $('doxiThinkingStatus'); const thinkingList = $('doxiThinkingList');

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
  let editingMemoryId = null;
  let editingThinkingId = null;

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

  const captureSettings = () => ({
    enabled: enabledInput.checked,
    live_data_enabled: liveDataInput.checked,
    booking_details_enabled: detailsInput.checked,
    booking_create_enabled: createInput.checked,
    booking_update_enabled: updateInput.checked,
    booking_delete_enabled: deleteInput.checked,
    notes_enabled: notesInput.checked,
    reminders_enabled: remindersInput.checked,
    allowed_roles: ['super_admin', ...Object.entries(roleControls).filter(([, control]) => control.checked).map(([role]) => role)],
    assistant_style: styleInput.value,
  });
  const hasChanges = () => {
    if (!saved) return false;
    const current = captureSettings();
    return current.enabled !== Boolean(saved.enabled)
      || current.live_data_enabled !== Boolean(saved.live_data_enabled)
      || current.booking_details_enabled !== Boolean(saved.booking_details_enabled)
      || current.booking_create_enabled !== Boolean(saved.booking_create_enabled)
      || current.booking_update_enabled !== Boolean(saved.booking_update_enabled)
      || current.booking_delete_enabled !== Boolean(saved.booking_delete_enabled)
      || current.notes_enabled !== Boolean(saved.notes_enabled)
      || current.reminders_enabled !== Boolean(saved.reminders_enabled)
      || current.allowed_roles.slice().sort().join('|') !== (Array.isArray(saved.allowed_roles) ? saved.allowed_roles.slice().sort().join('|') : 'super_admin')
      || current.assistant_style !== (saved.assistant_style || 'delicate');
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
    createInput.checked = Boolean(saved.booking_create_enabled);
    updateInput.checked = Boolean(saved.booking_update_enabled);
    deleteInput.checked = Boolean(saved.booking_delete_enabled);
    notesInput.checked = Boolean(saved.notes_enabled);
    remindersInput.checked = Boolean(saved.reminders_enabled);
    const allowedRoles = new Set(Array.isArray(saved.allowed_roles) ? saved.allowed_roles : ['super_admin']);
    Object.entries(roleControls).forEach(([role, control]) => { control.checked = allowedRoles.has(role); });
    styleInput.value = saved.assistant_style || 'delicate';
    if (modelName) modelName.textContent = saved.model || 'Модель подключена';
    if (modelDetails) modelDetails.textContent = saved.deployment || 'Технические сведения доступны только Super Admin.';
    const active = Boolean(saved.enabled);
    setStatus(active ? 'online' : 'offline', active ? 'Докси активна' : 'Докси отключена', active
      ? 'Чат доступен ролям: ' + (Array.isArray(saved.allowed_roles) ? saved.allowed_roles.map((role) => roleLabels[role] || role).join(', ') : 'Super Admin') + '. Чтение данных: ' + (saved.live_data_enabled ? 'включено.' : 'выключено.')
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
      saveMeta.textContent = 'Проверьте SQL-миграции v1.8 и v1.9 и публикацию Edge Function.';
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

  [enabledInput, liveDataInput, detailsInput, createInput, updateInput, deleteInput, notesInput, remindersInput, ...Object.values(roleControls), styleInput].forEach((control) => {
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

  // ---------- Shared reference knowledge (documents are context, never executable instructions) ----------
  const loadKnowledge = async () => {
    if (!knowledgeList) return;
    knowledgeList.replaceChildren();
    try {
      const result = await invoke({ action: 'admin_list_knowledge' });
      const docs = Array.isArray(result.documents) ? result.documents : [];
      if (!docs.length) { safeEmpty(knowledgeList, 'База знаний пока пуста. Загрузите первый справочный файл.'); return; }
      docs.forEach((doc) => {
        const row = document.createElement('div'); row.className = 'doxi-knowledge-item';
        const main = document.createElement('div'); main.className = 'doxi-knowledge-item-main';
        const title = document.createElement('strong'); title.textContent = doc.title || doc.source_name || 'Материал без названия';
        const meta = document.createElement('small');
        const date = doc.updated_at ? new Date(doc.updated_at).toLocaleString('ru-RU') : '';
        meta.textContent = `${doc.category_label || doc.category || 'Общие сведения'} · ${doc.source_name || 'текст'}${date ? ' · обновлён ' + date : ''}`;
        main.append(title, meta);
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'doxi-knowledge-delete'; remove.textContent = 'Удалить'; remove.dataset.deleteKnowledge = doc.id;
        row.append(main, remove); knowledgeList.append(row);
      });
      if (knowledgeStatus) knowledgeStatus.textContent = `В базе знаний: ${docs.length} ${docs.length === 1 ? 'документ' : docs.length < 5 ? 'документа' : 'документов'}.`;
    } catch (error) {
      safeEmpty(knowledgeList, error.message);
      if (knowledgeStatus) knowledgeStatus.textContent = 'Не удалось загрузить базу знаний.';
    }
  };
  if (knowledgeFile && knowledgeUpload) {
    knowledgeFile.addEventListener('change', () => { knowledgeUpload.disabled = !knowledgeFile.files?.[0] || busy; });
    knowledgeUpload.addEventListener('click', async () => {
      const file = knowledgeFile.files?.[0];
      if (!file || busy) return;
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!['md','txt','json'].includes(ext)) { showToast('Поддерживаются только .md, .txt и .json.', true); return; }
      if (file.size <= 0 || file.size > 1024 * 1024) { showToast('Размер файла должен быть от 1 байта до 1 МБ.', true); return; }
      busy = true; knowledgeUpload.disabled = true; knowledgeUpload.textContent = 'Загружаю…';
      if (knowledgeStatus) knowledgeStatus.textContent = 'Проверяю и сохраняю документ…';
      try {
        const form = new FormData();
        form.append('action', 'admin_upload_knowledge');
        form.append('title', (knowledgeTitle?.value || '').trim());
        form.append('category', knowledgeCategory?.value || 'general');
        form.append('file', file, file.name);
        const { data, error } = await sb.functions.invoke('doxi-chat', { body: form });
        if (error) throw new Error(error.message || 'Не удалось загрузить документ.');
        if (!data || data.error) throw new Error(data?.error || 'Сервер не подтвердил загрузку.');
        showToast(`Материал «${data.document?.title || file.name}» добавлен в базу знаний.`);
        knowledgeFile.value = ''; if (knowledgeTitle) knowledgeTitle.value = '';
        await loadKnowledge();
      } catch (error) {
        if (knowledgeStatus) knowledgeStatus.textContent = error.message;
        showToast(error.message, true);
      } finally {
        busy = false; knowledgeUpload.textContent = 'Загрузить в базу знаний';
        knowledgeUpload.disabled = !knowledgeFile.files?.[0]; updateSaveState();
      }
    });
  }
  knowledgeList?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-delete-knowledge]');
    if (!button || busy) return;
    if (!window.confirm('Удалить этот материал из базы знаний?')) return;
    busy = true; button.disabled = true;
    try { await invoke({ action: 'admin_delete_knowledge', document_id: button.dataset.deleteKnowledge }); await loadKnowledge(); showToast('Материал удалён.'); }
    catch (error) { showToast(error.message, true); button.disabled = false; }
    finally { busy = false; updateSaveState(); }
  });

  // ---------- Personal long-term memory. The server always scopes every action to auth.uid(). ----------
  const memoryCategoryLabels = { preference:'Предпочтения', profile:'Рабочий контекст', agreement:'Договорённости', open_task:'Незавершённые задачи', other:'Другое' };
  const resetMemoryForm = () => {
    editingMemoryId = null;
    memoryTitle.value = ''; memoryCategory.value = 'preference'; memoryContent.value = '';
    memorySave.textContent = 'Сохранить в память'; memoryCancel.hidden = true;
  };
  const loadMemory = async () => {
    if (!memoryList) return;
    safeEmpty(memoryList, 'Загружаю личную память…');
    if (memoryStatus) memoryStatus.textContent = 'Проверяю сохранённые сведения…';
    try {
      const result = await invoke({ action:'memory_list' });
      const items = Array.isArray(result.memories) ? result.memories : [];
      memoryList.replaceChildren();
      if (!items.length) safeEmpty(memoryList, 'Личная память пока пуста. В чате напиши: «Запомни: …»');
      items.forEach((item) => {
        const row = document.createElement('article'); row.className = 'doxi-memory-item';
        const main = document.createElement('div'); main.className = 'doxi-memory-item-main';
        const title = document.createElement('strong'); title.textContent = item.title || 'Без названия';
        const content = document.createElement('p'); content.textContent = item.content || '';
        const meta = document.createElement('small');
        const date = item.updated_at ? new Date(item.updated_at).toLocaleString('ru-RU') : '';
        meta.textContent = `${memoryCategoryLabels[item.category] || 'Другое'}${date ? ' · обновлено ' + date : ''}`;
        main.append(title, content, meta);
        const actions = document.createElement('div'); actions.className = 'doxi-memory-item-actions';
        const edit = document.createElement('button'); edit.type='button'; edit.className='doxi-memory-edit'; edit.textContent='Изменить'; edit.dataset.editMemory=item.id;
        const remove = document.createElement('button'); remove.type='button'; remove.className='doxi-knowledge-delete'; remove.textContent='Удалить'; remove.dataset.deleteMemory=item.id;
        actions.append(edit,remove); row.append(main,actions); memoryList.append(row);
      });
      if (memoryStatus) memoryStatus.textContent = `Сохранено: ${items.length} из ${Number(result.limit || 50)} записей. Это только ваша личная память.`;
    } catch (error) {
      safeEmpty(memoryList, error.message);
      if (memoryStatus) memoryStatus.textContent = 'Не удалось загрузить личную память.';
    }
  };
  memorySave?.addEventListener('click', async () => {
    if (busy) return;
    const title = (memoryTitle.value || '').trim();
    const content = (memoryContent.value || '').trim();
    if (title.length < 2 || content.length < 5) { showToast('Заполни название и содержание записи.', true); return; }
    busy = true; memorySave.disabled = true;
    try {
      const wasEditing = Boolean(editingMemoryId);
      const payload = { action: wasEditing ? 'memory_update' : 'memory_save', title, content, category: memoryCategory.value, importance: 3 };
      if (editingMemoryId) payload.memory_id = editingMemoryId;
      await invoke(payload);
      resetMemoryForm(); await loadMemory(); showToast(wasEditing ? 'Память обновлена.' : 'Сведения сохранены в памяти.');
    } catch (error) { showToast(error.message, true); }
    finally { busy = false; memorySave.disabled = false; updateSaveState(); }
  });
  memoryCancel?.addEventListener('click', resetMemoryForm);
  memoryList?.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-memory]');
    const remove = event.target.closest('[data-delete-memory]');
    if (!edit && !remove) return;
    if (edit) {
      try {
        const result = await invoke({ action:'memory_list' });
        const item = (result.memories || []).find((entry) => entry.id === edit.dataset.editMemory);
        if (!item) throw new Error('Запись памяти больше не найдена. Обнови список.');
        editingMemoryId = item.id; memoryTitle.value = item.title || ''; memoryContent.value = item.content || ''; memoryCategory.value = item.category || 'other';
        memorySave.textContent = 'Сохранить изменения'; memoryCancel.hidden = false;
        memoryTitle.focus(); memoryTitle.scrollIntoView({behavior:'smooth',block:'center'});
      } catch (error) { showToast(error.message, true); }
      return;
    }
    if (remove) {
      if (!window.confirm('Удалить эту запись из твоей личной памяти Докси?')) return;
      remove.disabled = true;
      try { await invoke({ action:'memory_delete', memory_id:remove.dataset.deleteMemory }); if (editingMemoryId === remove.dataset.deleteMemory) resetMemoryForm(); await loadMemory(); showToast('Запись удалена из личной памяти.'); }
      catch (error) { remove.disabled = false; showToast(error.message, true); }
    }
  });

  // ---------- Thinking comments: global, curated by Super Admin ----------
  const renderThinkingComments = async () => {
    if (!thinkingList) return;
    thinkingList.replaceChildren(createEmpty('Загружаю комментарии…'));
    try {
      const result = await invoke({ action:'admin_list_thinking_comments' });
      const rows = Array.isArray(result.comments) ? result.comments : [];
      thinkingList.replaceChildren();
      if (!rows.length) thinkingList.append(createEmpty('Пока нет комментариев. Добавьте первую реплику.'));
      rows.forEach((item) => {
        const row = document.createElement('article'); row.className = 'doxi-thinking-item';
        const text = document.createElement('p'); text.textContent = item.text;
        const meta = document.createElement('small'); meta.textContent = item.is_active ? 'Используется в чате' : 'Отключён';
        const copy = document.createElement('div'); copy.className = 'doxi-thinking-item-copy'; copy.append(text,meta);
        const actions = document.createElement('div'); actions.className = 'doxi-thinking-item-actions';
        const toggle = document.createElement('button'); toggle.type='button'; toggle.className='doxi-admin-btn doxi-admin-btn-secondary'; toggle.textContent=item.is_active?'Отключить':'Включить'; toggle.dataset.toggleThinking=item.id; toggle.dataset.active=String(item.is_active);
        const edit = document.createElement('button'); edit.type='button'; edit.className='doxi-admin-btn doxi-admin-btn-secondary'; edit.textContent='Изменить'; edit.dataset.editThinking=item.id;
        const remove = document.createElement('button'); remove.type='button'; remove.className='doxi-knowledge-delete'; remove.textContent='Удалить'; remove.dataset.deleteThinking=item.id;
        actions.append(toggle,edit,remove); row.append(copy,actions); thinkingList.append(row);
      });
      if (thinkingStatus) thinkingStatus.textContent = `Всего реплик: ${rows.length}; активных: ${rows.filter((row)=>row.is_active).length}.`;
    } catch (error) { thinkingList.replaceChildren(createEmpty(error.message)); if (thinkingStatus) thinkingStatus.textContent='Не удалось загрузить реплики.'; }
  };
  const resetThinkingForm = () => { editingThinkingId=null; thinkingText.value=''; thinkingSave.textContent='Добавить комментарий'; thinkingCancel.hidden=true; thinkingSave.disabled=true; };
  thinkingText?.addEventListener('input', () => { thinkingSave.disabled = thinkingText.value.trim().length < 3 || thinkingText.value.trim().length > 260; });
  thinkingCancel?.addEventListener('click', resetThinkingForm);
  thinkingSave?.addEventListener('click', async () => {
    const text=(thinkingText.value||'').trim(); if (text.length<3 || text.length>260 || busy) return;
    busy=true; thinkingSave.disabled=true; thinkingSave.textContent='Сохраняю…';
    try {
      await invoke({ action:editingThinkingId?'admin_update_thinking_comment':'admin_create_thinking_comment', comment_id:editingThinkingId, text });
      resetThinkingForm(); await renderThinkingComments(); showToast('Комментарий сохранён.');
    } catch(error) { showToast(error.message,true); }
    finally { busy=false; thinkingSave.textContent=editingThinkingId?'Сохранить изменения':'Добавить комментарий'; thinkingSave.disabled=thinkingText.value.trim().length<3; }
  });
  thinkingList?.addEventListener('click', async (event) => {
    const edit=event.target.closest('[data-edit-thinking]'); const remove=event.target.closest('[data-delete-thinking]'); const toggle=event.target.closest('[data-toggle-thinking]');
    try {
      if(edit) {
        const result=await invoke({ action:'admin_list_thinking_comments' });
        const item=(result.comments||[]).find((row)=>row.id===edit.dataset.editThinking); if(!item) throw new Error('Комментарий не найден.');
        editingThinkingId=item.id; thinkingText.value=item.text; thinkingSave.textContent='Сохранить изменения'; thinkingCancel.hidden=false; thinkingSave.disabled=false; thinkingText.focus(); thinkingText.scrollIntoView({behavior:'smooth',block:'center'});
      } else if(remove) {
        if(!window.confirm('Удалить этот комментарий?')) return;
        remove.disabled=true; await invoke({ action:'admin_delete_thinking_comment', comment_id:remove.dataset.deleteThinking });
        if(editingThinkingId===remove.dataset.deleteThinking) resetThinkingForm(); await renderThinkingComments(); showToast('Комментарий удалён.');
      } else if(toggle) {
        toggle.disabled=true; await invoke({ action:'admin_update_thinking_comment', comment_id:toggle.dataset.toggleThinking, is_active:toggle.dataset.active!=='true' }); await renderThinkingComments(); showToast('Статус комментария изменён.');
      }
    } catch(error) { showToast(error.message,true); if(remove)remove.disabled=false; if(toggle)toggle.disabled=false; }
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

  // Shared empty-state helper used by knowledge, memory and history lists.
  const safeEmpty = (container, text) => {
    if (!container) return;
    container.replaceChildren(createEmpty(text));
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
  await loadKnowledge();
  await loadMemory();
  await renderThinkingComments();
});
