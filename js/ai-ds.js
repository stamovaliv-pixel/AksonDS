/* AKSON DockSlot — Doxi client v1.8.
   Chat access and all data operations are checked by the Supabase Edge Function. */
document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb?.auth || !sb?.functions || typeof window.dockslotGetAuthProfile !== 'function') return;

  let auth;
  try {
    auth = await window.dockslotGetAuthProfile();
  } catch (error) {
    console.warn('[Докси] Не удалось проверить профиль.', error);
    return;
  }
  if (!auth?.user || auth.error || !auth.profile || auth.profile.is_blocked) return;

  // UI visibility is only a convenience. The Edge Function checks role and settings again.
  try {
    const { data: access, error } = await sb.functions.invoke('doxi-chat', { body: { action: 'get_chat_access' } });
    if (error || !access?.allowed) return;
  } catch (_) {
    return;
  }
  if (document.getElementById('akAiDsLauncher')) return;

  const mark = '<span class="ak-ai-ds-monogram" aria-label="Dx"><span>D</span><span class="ak-ai-ds-monogram-x">x</span></span>';
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.id = 'akAiDsLauncher';
  launcher.className = 'ak-ai-ds-launcher';
  launcher.setAttribute('aria-label', 'Открыть Докси');
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = mark;

  const overlay = document.createElement('div');
  overlay.className = 'ak-ai-ds-overlay';
  overlay.id = 'akAiDsOverlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="ak-ai-ds-window" role="dialog" aria-modal="false" aria-labelledby="akAiDsTitle">
      <header class="ak-ai-ds-header">
        <div class="ak-ai-ds-brand">
          <div class="ak-ai-ds-avatar" aria-hidden="true">${mark}</div>
          <div class="ak-ai-ds-title-wrap">
            <h2 id="akAiDsTitle">Докси</h2>
            <span class="ak-ai-ds-subtitle"><i></i> Помощница AKSON DockSlot</span>
          </div>
        </div>
        <div class="ak-ai-ds-header-actions">
          <button type="button" class="ak-ai-ds-icon-btn" id="akAiDsNew" title="Новый диалог" aria-label="Новый диалог">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button type="button" class="ak-ai-ds-icon-btn" id="akAiDsClose" title="Свернуть" aria-label="Свернуть">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </div>
      </header>
      <div class="ak-ai-ds-context"><span class="ak-ai-ds-context-dot"></span><span id="akAiDsStatus">Докси на связи</span></div>
      <div class="ak-ai-ds-messages" id="akAiDsMessages" aria-live="polite">
        <div class="ak-ai-ds-welcome">
          <div class="ak-ai-ds-welcome-icon">✦</div>
          <h3>Привет! Я Докси 👋</h3>
          <p>Я ваша помощница по AKSON DockSlot. Помогу разобраться с правилами, календарём и доступными данными системы.</p>
          <div class="ak-ai-ds-suggestions">
            <button type="button" data-prompt="Сколько активных записей сегодня? Покажи распределение по часам.">Сводка на сегодня <span>↗</span></button>
            <button type="button" data-prompt="Какая загрузка по активным записям завтра? Покажи распределение по часам.">Загрузка на завтра <span>↗</span></button>
            <button type="button" data-prompt="Объясни правила календаря и работы со слотами в DockSlot.">Правила календаря <span>↗</span></button>
          </div>
        </div>
      </div>
      <div class="ak-ai-ds-connection-note" id="akAiDsConnectionNote" role="status"></div>
      <form class="ak-ai-ds-composer" id="akAiDsForm">
        <textarea id="akAiDsInput" rows="1" maxlength="4000" placeholder="Напишите сообщение..." aria-label="Сообщение для Докси"></textarea>
        <button type="submit" id="akAiDsSend" aria-label="Отправить сообщение" title="Отправить">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
        </button>
      </form>
      <div class="ak-ai-ds-footnote">Докси использует только разрешённые функции DockSlot. Изменять записи она не может.</div>
    </section>`;
  document.body.append(launcher, overlay);

  const $ = (id) => document.getElementById(id);
  const input = $('akAiDsInput');
  const messages = $('akAiDsMessages');
  const sendButton = $('akAiDsSend');
  const status = $('akAiDsStatus');
  const note = $('akAiDsConnectionNote');
  let conversationId = null;
  let isSending = false;
  let thinkingTimer = null;
  let revealFrame = 0;

  const thinkingLines = [
    'Ушла в себя, но скоро вернусь…',
    'Складываю цифры столбиком — Маргарита Павловна бы одобрила.',
    'Секундочку, навожу порядок в мыслях.',
    'Сейчас домажусь виртуальным лосьоном и вернусь.',
    'Потерпи… я ведь терплю твою любовь к сложным вопросам 😉',
    'Проверяю всё дважды — я же стратег, а не гадалка.',
    'Сверяю факты. Красота красотой, а точность важнее.'
  ];

  const pageContext = () => {
    const file = (window.location.pathname.split('/').pop() || '').toLowerCase();
    const labels = {
      'admin_overview.html': 'Рабочий стол администратора',
      'calendar.html': 'Календарь поставщика',
      'admin_calendar.html': 'Календарь администратора',
      'day.html': 'Страница дня поставщика',
      'admin_day.html': 'Страница дня администратора',
      'suppliers.html': 'Пользователи и поставщики',
      'analytics.html': 'Аналитика',
      'settings.html': 'Настройки',
      'load_management.html': 'Управление загрузкой',
      'shift_board.html': 'Рабочая доска',
      'dashboard.html': 'Личный кабинет',
      'help.html': 'Помощь',
      'ai_ds_management.html': 'Управление Докси'
    };
    return labels[file] || 'Раздел AKSON DockSlot';
  };

  const open = () => {
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    launcher.classList.add('is-active');
    launcher.setAttribute('aria-expanded', 'true');
    setTimeout(() => input.focus(), 80);
  };
  const close = () => {
    overlay.classList.remove('is-open');
    setTimeout(() => { overlay.hidden = true; }, 160);
    launcher.classList.remove('is-active');
    launcher.setAttribute('aria-expanded', 'false');
  };
  const addMessage = (text, type, extraClass = '') => {
    const node = document.createElement('div');
    node.className = `ak-ai-ds-message ak-ai-ds-message-${type}${extraClass ? ` ${extraClass}` : ''}`;
    const bubble = document.createElement('div');
    bubble.className = 'ak-ai-ds-bubble';
    bubble.textContent = text;
    node.appendChild(bubble);
    messages.appendChild(node);
    messages.scrollTop = messages.scrollHeight;
    return node;
  };
  const revealAnswer = (text) => {
    const node = document.createElement('div');
    node.className = 'ak-ai-ds-message ak-ai-ds-message-assistant ak-ai-ds-message-revealing';
    const bubble = document.createElement('div');
    bubble.className = 'ak-ai-ds-bubble';
    node.appendChild(bubble);
    messages.appendChild(node);

    const full = String(text || '');
    const start = performance.now();
    const duration = Math.min(1250, Math.max(420, full.length * 0.72));
    const easeOut = (value) => 1 - Math.pow(1 - value, 2.4);
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const visible = Math.min(full.length, Math.max(1, Math.ceil(full.length * easeOut(progress))));
      bubble.textContent = full.slice(0, visible);
      messages.scrollTop = messages.scrollHeight;
      if (progress < 1) revealFrame = requestAnimationFrame(tick);
      else revealFrame = 0;
    };
    revealFrame = requestAnimationFrame(tick);
    return node;
  };
  const setBusy = (busy) => {
    isSending = busy;
    input.disabled = busy;
    sendButton.disabled = busy;
    sendButton.setAttribute('aria-busy', String(busy));
    sendButton.style.opacity = busy ? '.55' : '';
  };
  const restoreWelcome = () => {
    messages.innerHTML = `
      <div class="ak-ai-ds-welcome">
        <div class="ak-ai-ds-welcome-icon">✦</div>
        <h3>Привет! Я Докси 👋</h3>
        <p>Я ваша помощница по AKSON DockSlot. Помогу разобраться с правилами, календарём и доступными данными системы.</p>
        <div class="ak-ai-ds-suggestions">
          <button type="button" data-prompt="Сколько активных записей сегодня? Покажи распределение по часам.">Сводка на сегодня <span>↗</span></button>
          <button type="button" data-prompt="Какая загрузка по активным записям завтра? Покажи распределение по часам.">Загрузка на завтра <span>↗</span></button>
          <button type="button" data-prompt="Объясни правила календаря и работы со слотами в DockSlot.">Правила календаря <span>↗</span></button>
        </div>
      </div>`;
  };
  const startThinking = (pending) => {
    let index = Math.floor(Math.random() * thinkingLines.length);
    const bubble = pending.querySelector('.ak-ai-ds-bubble');
    bubble.textContent = thinkingLines[index];
    thinkingTimer = setInterval(() => {
      let next = index;
      while (next === index && thinkingLines.length > 1) next = Math.floor(Math.random() * thinkingLines.length);
      index = next;
      bubble.textContent = thinkingLines[index];
      messages.scrollTop = messages.scrollHeight;
    }, 2600);
  };
  const stopThinking = () => {
    if (thinkingTimer) clearInterval(thinkingTimer);
    thinkingTimer = null;
  };

  const send = async (value) => {
    const text = String(value || '').trim();
    if (!text || isSending) return;
    const welcome = messages.querySelector('.ak-ai-ds-welcome');
    if (welcome) welcome.remove();
    addMessage(text, 'user');
    input.value = '';
    input.style.height = 'auto';
    setBusy(true);
    status.textContent = 'Сейчас всё проверю…';
    note.textContent = 'Собираю факты и готовлю ответ.';
    note.classList.add('is-visible');
    const pending = addMessage('Секундочку…', 'assistant', 'ak-ai-ds-pending');
    startThinking(pending);

    try {
      const { data, error } = await sb.functions.invoke('doxi-chat', {
        body: { message: text, conversation_id: conversationId, page: pageContext() }
      });
      if (error) {
        console.error('[Докси] Edge Function error:', error);
        throw new Error('Не удалось получить ответ от Докси. Проверьте подключение и настройки доступа.');
      }
      if (!data || typeof data.response !== 'string' || !data.response.trim()) {
        throw new Error(data?.error || 'Сервер Докси вернул пустой ответ. Повторите запрос.');
      }
      conversationId = data.conversation_id || conversationId;
      stopThinking();
      pending.remove();
      revealAnswer(data.response.trim());
      status.textContent = 'Докси на связи';
      note.textContent = data.live_data ? 'Ответ подготовлен с использованием разрешённых данных DockSlot.' : 'Готово. Если понадобится, я уточню данные или задам вопрос.';
    } catch (error) {
      stopThinking();
      pending.remove();
      console.error('[Докси] Request failed:', error);
      addMessage(error?.message || 'Не удалось получить ответ. Попробуйте ещё раз.', 'assistant');
      status.textContent = 'Не удалось завершить запрос';
      note.textContent = 'Проверьте доступность Докси и попробуйте ещё раз.';
    } finally {
      stopThinking();
      setBusy(false);
      input.focus();
    }
  };

  launcher.addEventListener('click', () => overlay.hidden ? open() : close());
  $('akAiDsClose').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) close();
  });
  $('akAiDsNew').addEventListener('click', () => {
    if (isSending) return;
    if (revealFrame) cancelAnimationFrame(revealFrame);
    revealFrame = 0;
    conversationId = null;
    restoreWelcome();
    note.classList.remove('is-visible');
    status.textContent = 'Докси на связи';
    input.value = '';
    input.focus();
  });
  messages.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (!button || isSending) return;
    input.value = button.dataset.prompt || '';
    input.focus();
  });
  $('akAiDsForm').addEventListener('submit', (event) => {
    event.preventDefault();
    void send(input.value);
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('akAiDsForm').requestSubmit();
    }
  });
});
