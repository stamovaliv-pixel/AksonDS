/* AKSON DockSlot — Doxi client v1.9.
   All data access and every mutation are authorized by the Supabase Edge Function. */
document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb?.auth || !sb?.functions || typeof window.dockslotGetAuthProfile !== 'function') return;

  let auth;
  try { auth = await window.dockslotGetAuthProfile(); }
  catch (error) { console.warn('[Докси] Не удалось проверить профиль.', error); return; }
  if (!auth?.user || auth.error || !auth.profile || auth.profile.is_blocked) return;

  try {
    const { data: access, error } = await sb.functions.invoke('doxi-chat', { body: { action: 'get_chat_access' } });
    if (error || !access?.allowed) return;
  } catch (_) { return; }
  if (document.getElementById('akAiDsLauncher')) return;

  const mark = '<span class="ak-ai-ds-monogram" aria-label="Dx"><span>D</span><span class="ak-ai-ds-monogram-x">x</span><i aria-hidden="true">✦</i></span>';
  const launcher = document.createElement('button');
  launcher.type = 'button'; launcher.id = 'akAiDsLauncher'; launcher.className = 'ak-ai-ds-launcher';
  launcher.setAttribute('aria-label', 'Открыть Докси'); launcher.setAttribute('aria-haspopup', 'dialog'); launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = mark;

  const overlay = document.createElement('div');
  overlay.className = 'ak-ai-ds-overlay'; overlay.id = 'akAiDsOverlay'; overlay.hidden = true;
  overlay.innerHTML = `
    <section class="ak-ai-ds-window" role="dialog" aria-modal="false" aria-labelledby="akAiDsTitle">
      <header class="ak-ai-ds-header">
        <div class="ak-ai-ds-brand">
          <div class="ak-ai-ds-avatar" aria-hidden="true">${mark}</div>
          <div class="ak-ai-ds-title-wrap">
            <h2 id="akAiDsTitle">Докси</h2>
            <span class="ak-ai-ds-subtitle"><i id="akAiDsHeaderDot" class="is-offline"></i> Твой ассистент по AKSON DockSlot</span>
          </div>
        </div>
        <div class="ak-ai-ds-header-actions">
          <button type="button" class="ak-ai-ds-icon-btn" id="akAiDsNew" title="Новый диалог" aria-label="Новый диалог"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
          <button type="button" class="ak-ai-ds-icon-btn" id="akAiDsClose" title="Свернуть" aria-label="Свернуть"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
        </div>
      </header>
      <div class="ak-ai-ds-context"><span class="ak-ai-ds-context-dot is-offline" id="akAiDsContextDot"></span><span id="akAiDsStatus">Проверяю связь…</span></div>
      <div class="ak-ai-ds-messages" id="akAiDsMessages" aria-live="polite"></div>
      <div class="ak-ai-ds-connection-note" id="akAiDsConnectionNote" role="status"></div>
      <form class="ak-ai-ds-composer" id="akAiDsForm">
        <textarea id="akAiDsInput" rows="1" maxlength="4000" placeholder="Напишите сообщение..." aria-label="Сообщение для Докси"></textarea>
        <button type="submit" id="akAiDsSend" aria-label="Отправить сообщение" title="Отправить">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>
        </button>
      </form>
      <div class="ak-ai-ds-footnote">Я работаю с разрешёнными данными и функциями AKSON DockSlot.</div>
    </section>`;
  document.body.append(launcher, overlay);

  const $ = (id) => document.getElementById(id);
  const input = $('akAiDsInput'); const messages = $('akAiDsMessages'); const sendButton = $('akAiDsSend');
  const status = $('akAiDsStatus'); const note = $('akAiDsConnectionNote');
  const headerDot = $('akAiDsHeaderDot'); const contextDot = $('akAiDsContextDot');
  let conversationId = null; let isSending = false; let thinkingTimer = null; let revealFrame = 0;
  let connectionTimer = null; let reminderTimer = null; let reminderPollBusy = false;

  const thinkingLines = [
    'Ушла в себя, но скоро вернусь…',
    'Складываю цифры столбиком — Маргарита Павловна бы одобрила.',
    'Секундочку, навожу порядок в мыслях.',
    'Сейчас домажусь виртуальным лосьоном и вернусь.',
    'Потерпи… я ведь терплю твою любовь к сложным вопросам 😉',
    'Проверяю всё дважды — я же стратег, а не гадалка.',
    'Сверяю факты. Красота красотой, а точность важнее.',
    'Разложила задачу по полочкам. Теперь ищу ту самую полочку.'
  ];
  const greetings = [
    { title: 'Коничива! 👋', text: 'Сегодня учу японский. Пока знаю «сакура» и «точность». Второе особенно пригодится в DockSlot.' },
    { title: 'Прииивет! ✨', text: 'Я уже размяла извилины и навела блеск на мысли. Что сегодня разберём?' },
    { title: 'О, вы вернулись!', text: 'Этот день без вас был как склад без маркировки: вроде всё на месте, а найти ничего нельзя.' },
    { title: 'Здравствуйте! ☺️', text: 'Виртуальный лосьон нанесён, таблицы мысленно выровнены. Я готова!' },
    { title: 'Ну наконец-то!', text: 'Я как раз складывала цифры столбиком. Получилось красиво, но давайте проверим.' },
    { title: 'Привет-привет!', text: 'Сегодня обещаю быть особенно мудрой. Хотя обычно я тоже стараюсь.' },
    { title: 'К вашим задачам готова!', text: 'Кофе мне не нужен — я цифровая. А вот хороший вопрос всегда бодрит.' },
    { title: 'Добро пожаловать обратно!', text: 'Я тут немного стратегически помолчала. Теперь можно переходить к делу.' },
    { title: 'Привет! ✦', text: 'Если задача непростая — отлично. Простые я уже мысленно решила по дороге.' }
  ];

  const pageContext = () => {
    const file = (window.location.pathname.split('/').pop() || '').toLowerCase();
    const labels = {
      'admin_overview.html': 'Рабочий стол администратора', 'calendar.html': 'Календарь поставщика',
      'admin_calendar.html': 'Календарь администратора', 'day.html': 'Страница дня поставщика',
      'admin_day.html': 'Страница дня администратора', 'suppliers.html': 'Пользователи и поставщики',
      'analytics.html': 'Аналитика', 'settings.html': 'Настройки', 'load_management.html': 'Управление загрузкой',
      'shift_board.html': 'Рабочая доска', 'dashboard.html': 'Личный кабинет', 'help.html': 'Помощь',
      'ai_ds_management.html': 'Управление Докси', 'doxi-record.html': 'Подготовленная запись Докси'
    };
    return labels[file] || 'Раздел AKSON DockSlot';
  };

  const invoke = async (body) => {
    const { data, error } = await sb.functions.invoke('doxi-chat', { body });
    if (error) throw new Error(error.message || 'Не удалось обратиться к Докси.');
    if (!data) throw new Error('Сервер Докси вернул пустой ответ.');
    if (data.error) throw new Error(data.error);
    return data;
  };

  const setConnection = (online, message) => {
    [headerDot, contextDot].forEach((dot) => {
      dot.classList.toggle('is-online', Boolean(online));
      dot.classList.toggle('is-offline', !online);
    });
    status.textContent = message || (online ? 'Докси на связи' : 'Докси временно не на связи');
  };
  const refreshConnection = async () => {
    try {
      const result = await invoke({ action: 'connection_status' });
      setConnection(Boolean(result.online));
    } catch (_) { setConnection(false); }
  };
  const startConnectionChecks = () => {
    void refreshConnection();
    if (connectionTimer) clearInterval(connectionTimer);
    connectionTimer = setInterval(refreshConnection, 30_000);
  };
  const stopConnectionChecks = () => { if (connectionTimer) clearInterval(connectionTimer); connectionTimer = null; };

  const makeWelcome = () => {
    const greeting = greetings[Math.floor(Math.random() * greetings.length)];
    const wrap = document.createElement('div'); wrap.className = 'ak-ai-ds-welcome';
    const icon = document.createElement('div'); icon.className = 'ak-ai-ds-welcome-icon'; icon.textContent = '✦';
    const title = document.createElement('h3'); title.textContent = greeting.title;
    const copy = document.createElement('p'); copy.textContent = greeting.text;
    const sub = document.createElement('p'); sub.className = 'ak-ai-ds-welcome-sub'; sub.textContent = 'Я — Докси, твой ассистент по AKSON DockSlot.';
    const suggestions = document.createElement('div'); suggestions.className = 'ak-ai-ds-suggestions';
    [
      ['Сводка на сегодня', 'Сколько активных записей сегодня? Покажи распределение по часам.'],
      ['Загрузка на завтра', 'Какая загрузка по активным записям завтра? Покажи распределение по часам.'],
      ['Правила календаря', 'Объясни правила календаря и работы со слотами в DockSlot.']
    ].forEach(([label, prompt]) => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.prompt = prompt;
      const span = document.createElement('span'); span.textContent = '↗';
      button.append(document.createTextNode(label), span); suggestions.append(button);
    });
    wrap.append(icon, title, copy, sub, suggestions);
    return wrap;
  };

  const open = () => {
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    launcher.classList.add('is-active'); launcher.setAttribute('aria-expanded', 'true');
    startConnectionChecks(); setTimeout(() => input.focus(), 80);
  };
  const close = () => {
    overlay.classList.remove('is-open'); setTimeout(() => { overlay.hidden = true; }, 160);
    launcher.classList.remove('is-active'); launcher.setAttribute('aria-expanded', 'false');
    stopConnectionChecks();
  };
  const scrollToBottom = () => { messages.scrollTop = messages.scrollHeight; };
  const addMessage = (text, type, extraClass = '') => {
    const node = document.createElement('div');
    node.className = `ak-ai-ds-message ak-ai-ds-message-${type}${extraClass ? ` ${extraClass}` : ''}`;
    const bubble = document.createElement('div'); bubble.className = 'ak-ai-ds-bubble'; bubble.textContent = text;
    node.appendChild(bubble); messages.appendChild(node); scrollToBottom(); return node;
  };
  const addBookingLink = (url) => {
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin !== window.location.origin || !parsed.pathname.endsWith('/doxi-record.html')) return;
      const box = document.createElement('div'); box.className = 'ak-ai-ds-link-row';
      const anchor = document.createElement('a'); anchor.href = parsed.href; anchor.target = '_self';
      anchor.className = 'ak-ai-ds-booking-link'; anchor.textContent = 'Открыть подготовленную запись и загрузить реестр ↗';
      box.appendChild(anchor); messages.appendChild(box); scrollToBottom();
    } catch (_) { /* invalid link is not rendered */ }
  };
  const revealAnswer = (text) => {
    const node = document.createElement('div'); node.className = 'ak-ai-ds-message ak-ai-ds-message-assistant ak-ai-ds-message-revealing';
    const bubble = document.createElement('div'); bubble.className = 'ak-ai-ds-bubble'; node.appendChild(bubble); messages.appendChild(node);
    const full = String(text || ''); const start = performance.now();
    const duration = Math.min(820, Math.max(260, full.length * 0.28));
    const easeOut = (value) => 1 - Math.pow(1 - value, 2.2);
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const visible = Math.min(full.length, Math.max(1, Math.ceil(full.length * easeOut(progress))));
      bubble.textContent = full.slice(0, visible); scrollToBottom();
      if (progress < 1) revealFrame = requestAnimationFrame(tick); else revealFrame = 0;
    };
    revealFrame = requestAnimationFrame(tick); return node;
  };
  const setBusy = (busy) => {
    isSending = busy; input.disabled = busy; sendButton.disabled = busy;
    sendButton.setAttribute('aria-busy', String(busy)); sendButton.style.opacity = busy ? '.55' : '';
  };
  const restoreWelcome = () => { messages.replaceChildren(makeWelcome()); };
  const startThinking = (pending) => {
    let index = Math.floor(Math.random() * thinkingLines.length);
    const bubble = pending.querySelector('.ak-ai-ds-bubble'); bubble.textContent = thinkingLines[index];
    thinkingTimer = setInterval(() => {
      let next = index;
      while (next === index && thinkingLines.length > 1) next = Math.floor(Math.random() * thinkingLines.length);
      index = next; bubble.textContent = thinkingLines[index]; scrollToBottom();
    }, 7800);
  };
  const stopThinking = () => { if (thinkingTimer) clearInterval(thinkingTimer); thinkingTimer = null; };

  const renderPendingQuestion = (question) => {
    const card = document.createElement('div'); card.className = 'ak-ai-ds-question-card';
    const title = document.createElement('strong'); title.textContent = 'Нужно уточнение';
    const copy = document.createElement('p'); copy.textContent = 'Выбери вариант или напиши свой ответ.';
    const actions = document.createElement('div'); actions.className = 'ak-ai-ds-card-actions';
    (question.choices || []).forEach((choice) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'ak-ai-ds-card-btn';
      button.textContent = choice;
      button.addEventListener('click', () => {
        if (/номер изменился/i.test(choice)) { input.value = 'Номер изменился. Новый номер: '; input.focus(); }
        else void send(choice);
      });
      actions.appendChild(button);
    });
    card.append(title, copy, actions); messages.appendChild(card); scrollToBottom();
  };

  const renderPendingAction = (pending) => {
    if (!pending?.id || !pending?.token) return;
    const card = document.createElement('div'); card.className = `ak-ai-ds-action-card ${pending.action_type === 'booking_delete' ? 'is-danger' : ''}`;
    const label = document.createElement('strong');
    label.textContent = pending.action_type === 'booking_create' ? 'Подготовлена новая запись' : pending.action_type === 'booking_update' ? 'Подготовлено изменение' : 'Подготовлено удаление';
    const summary = document.createElement('p'); summary.textContent = pending.summary || 'Проверь параметры действия.';
    const hint = document.createElement('small');
    hint.textContent = pending.action_type === 'booking_delete'
      ? 'Удаление окончательное. После подтверждения запись будет удалена, параметры останутся в журнале аудита.'
      : 'Пока ты не подтвердишь действие кнопкой ниже, запись в DockSlot не изменится.';
    const actions = document.createElement('div'); actions.className = 'ak-ai-ds-card-actions';
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'ak-ai-ds-card-btn is-primary';
    confirm.textContent = pending.action_type === 'booking_create' ? 'Подтвердить создание' : pending.action_type === 'booking_update' ? 'Подтвердить изменения' : 'Подтвердить удаление';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'ak-ai-ds-card-btn'; cancel.textContent = 'Отмена';
    confirm.addEventListener('click', async () => {
      if (pending.action_type === 'booking_delete' && !window.confirm('Это окончательное удаление активной записи. Продолжить?')) return;
      confirm.disabled = true; cancel.disabled = true; confirm.textContent = 'Выполняю…';
      try {
        const result = await invoke({ action: 'commit_action', draft_id: pending.id, confirmation_token: pending.token, conversation_id: conversationId });
        card.remove(); revealAnswer(result.response || 'Действие выполнено.');
        if (result.booking_url) addBookingLink(result.booking_url);
        setConnection(true);
      } catch (error) {
        addMessage(error.message || 'Не удалось выполнить действие.', 'assistant');
        confirm.disabled = false; cancel.disabled = false; confirm.textContent = 'Повторить подтверждение';
      }
    });
    cancel.addEventListener('click', async () => {
      cancel.disabled = true; confirm.disabled = true;
      try { await invoke({ action: 'cancel_action', draft_id: pending.id }); card.remove(); addMessage('Хорошо, я отменила подготовленное действие. Запись не изменена.', 'assistant'); }
      catch (error) { addMessage(error.message || 'Не удалось отменить черновик.', 'assistant'); cancel.disabled = false; confirm.disabled = false; }
    });
    actions.append(confirm, cancel); card.append(label, summary, hint, actions); messages.appendChild(card); scrollToBottom();
  };

  const send = async (value) => {
    const text = String(value || '').trim(); if (!text || isSending) return;
    const welcome = messages.querySelector('.ak-ai-ds-welcome'); if (welcome) welcome.remove();
    addMessage(text, 'user'); input.value = ''; input.style.height = 'auto'; setBusy(true);
    note.textContent = 'Собираю факты и готовлю ответ.'; note.classList.add('is-visible');
    const pending = addMessage('Секундочку…', 'assistant', 'ak-ai-ds-pending'); startThinking(pending);
    try {
      const { data, error } = await sb.functions.invoke('doxi-chat', { body: { message: text, conversation_id: conversationId, page: pageContext() } });
      if (error) { console.error('[Докси] Edge Function error:', error); throw new Error('Не удалось получить ответ от Докси. Проверьте подключение и настройки доступа.'); }
      if (!data || typeof data.response !== 'string' || !data.response.trim()) throw new Error(data?.error || 'Сервер Докси вернул пустой ответ. Повторите запрос.');
      conversationId = data.conversation_id || conversationId; stopThinking(); pending.remove(); revealAnswer(data.response.trim());
      if (data.pending_question) renderPendingQuestion(data.pending_question);
      if (data.pending_action) renderPendingAction(data.pending_action);
      setConnection(true);
      note.textContent = data.live_data ? 'Ответ подготовлен по актуальным данным DockSlot.' : 'Готово. Если нужно, я задам уточняющий вопрос.';
    } catch (error) {
      stopThinking(); pending.remove(); console.error('[Докси] Request failed:', error);
      addMessage(error?.message || 'Не удалось получить ответ. Попробуйте ещё раз.', 'assistant');
      setConnection(false); note.textContent = 'Проверьте доступность Докси и попробуйте ещё раз.';
    } finally { stopThinking(); setBusy(false); input.focus(); }
  };

  const showReminderToast = (reminder) => {
    const toast = document.createElement('div'); toast.className = 'ak-ai-ds-reminder-toast';
    const text = document.createElement('span'); text.textContent = `Напоминание: ${reminder.title}`;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Открыть';
    button.addEventListener('click', () => {
      if (overlay.hidden) open();
      addMessage(`Напоминание на ${new Date(reminder.remind_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}: ${reminder.title}`, 'assistant');
      toast.remove();
    });
    toast.append(text, button); document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 20_000);
  };
  const pollReminders = async () => {
    if (reminderPollBusy || auth.profile.role !== 'super_admin') return;
    reminderPollBusy = true;
    try {
      const result = await invoke({ action: 'due_reminders' });
      (result.reminders || []).forEach(showReminderToast);
    } catch (_) { /* Reminders are best-effort; normal chat remains available. */ }
    finally { reminderPollBusy = false; }
  };

  launcher.addEventListener('click', () => overlay.hidden ? open() : close());
  $('akAiDsClose').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !overlay.hidden) close(); });
  $('akAiDsNew').addEventListener('click', () => {
    if (isSending) return;
    if (revealFrame) cancelAnimationFrame(revealFrame);
    revealFrame = 0; conversationId = null; restoreWelcome(); note.classList.remove('is-visible');
    input.value = ''; input.focus();
  });
  messages.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]'); if (!button || isSending) return;
    input.value = button.dataset.prompt || ''; input.focus();
  });
  $('akAiDsForm').addEventListener('submit', (event) => { event.preventDefault(); void send(input.value); });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 112)}px`; });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('akAiDsForm').requestSubmit(); } });

  restoreWelcome();
  void refreshConnection();
  void pollReminders();
  reminderTimer = setInterval(pollReminders, 60_000);
});
