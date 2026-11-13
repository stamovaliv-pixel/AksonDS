/* AKSON DockSlot — Doxi AI agent client v1.6.
   Calls only the authenticated Supabase Edge Function. No model URL or proxy secret in browser. */
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
  if (String(auth.profile.role || '').toLowerCase() !== 'super_admin') return;
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
            <span class="ak-ai-ds-subtitle"><i></i> AI-помощник Akson DockSlot</span>
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
      <div class="ak-ai-ds-context"><span class="ak-ai-ds-context-dot"></span><span id="akAiDsStatus">Модель Qwen 3.5 9B · защищённое соединение</span></div>
      <div class="ak-ai-ds-messages" id="akAiDsMessages" aria-live="polite">
        <div class="ak-ai-ds-welcome">
          <div class="ak-ai-ds-welcome-icon">✦</div>
          <h3>Привет! Я Докси 👋</h3>
          <p>Помогаю с работой AKSON DockSlot. Пока у меня подключена языковая модель; доступ к живым данным записей добавим отдельными безопасными инструментами.</p>
          <div class="ak-ai-ds-suggestions">
            <button type="button" data-prompt="Объясни, как устроен календарь DockSlot и какие у него основные правила.">Как устроен календарь? <span>↗</span></button>
            <button type="button" data-prompt="Помоги разобраться с типичным сценарием работы с записью поставщика в DockSlot.">Работа с записями <span>↗</span></button>
            <button type="button" data-prompt="Какие данные и показатели стоит анализировать в DockSlot для контроля загрузки склада?">Анализ загрузки склада <span>↗</span></button>
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
      <div class="ak-ai-ds-footnote">Докси пока не читает записи напрямую. Проверяйте важные решения по данным системы.</div>
    </section>`;
  document.body.append(launcher, overlay);

  const $ = (id) => document.getElementById(id);
  const input = $('akAiDsInput');
  const messages = $('akAiDsMessages');
  const sendButton = $('akAiDsSend');
  const status = $('akAiDsStatus');
  const note = $('akAiDsConnectionNote');
  let conversation = [];
  let isSending = false;

  const pageContext = () => {
    const file = (window.location.pathname.split('/').pop() || '').toLowerCase();
    const labels = {
      'admin_overview.html': 'Рабочий стол администратора',
      'calendar.html': 'Календарь поставщика',
      'admin_calendar.html': 'Календарь администратора',
      'day.html': 'Страница дня поставщика',
      'admin_day.html': 'Страница дня администратора',
      'suppliers.html': 'Поставщики',
      'analytics.html': 'Аналитика',
      'settings.html': 'Настройки',
      'load_management.html': 'Управление загрузкой',
      'shift_board.html': 'Рабочая доска',
      'dashboard.html': 'Обзор',
      'help.html': 'Помощь'
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
        <p>Помогаю с работой AKSON DockSlot. Пока у меня подключена языковая модель; доступ к живым данным записей добавим отдельными безопасными инструментами.</p>
        <div class="ak-ai-ds-suggestions">
          <button type="button" data-prompt="Объясни, как устроен календарь DockSlot и какие у него основные правила.">Как устроен календарь? <span>↗</span></button>
          <button type="button" data-prompt="Помоги разобраться с типичным сценарием работы с записью поставщика в DockSlot.">Работа с записями <span>↗</span></button>
          <button type="button" data-prompt="Какие данные и показатели стоит анализировать в DockSlot для контроля загрузки склада?">Анализ загрузки склада <span>↗</span></button>
        </div>
      </div>`;
  };

  const send = async (value) => {
    const text = String(value || '').trim();
    if (!text || isSending) return;
    const welcome = messages.querySelector('.ak-ai-ds-welcome');
    if (welcome) welcome.remove();
    addMessage(text, 'user');
    conversation.push({ role: 'user', content: text });
    conversation = conversation.slice(-10);
    input.value = '';
    input.style.height = 'auto';
    setBusy(true);
    status.textContent = 'Докси формирует ответ…';
    note.textContent = 'Связь с домашней моделью активна. Ответ может занять несколько секунд.';
    note.classList.add('is-visible');
    const pending = addMessage('Докси думает…', 'assistant', 'ak-ai-ds-pending');

    try {
      const { data, error } = await sb.functions.invoke('doxi-chat', {
        body: {
          messages: conversation,
          page: pageContext()
        }
      });
      if (error) {
        console.error('[Докси] Edge Function error:', error);
        throw new Error('Не удалось получить ответ от Докси. Проверьте подключение и настройки сервера.');
      }
      if (!data || typeof data.response !== 'string' || !data.response.trim()) {
        throw new Error('Сервер Докси вернул пустой ответ. Повторите запрос.');
      }
      pending.remove();
      addMessage(data.response.trim(), 'assistant');
      conversation.push({ role: 'assistant', content: data.response.trim() });
      conversation = conversation.slice(-10);
      status.textContent = 'Qwen 3.5 9B · подключена';
      note.textContent = 'Докси подключена к домашней модели Qwen 3.5 9B.';
    } catch (error) {
      pending.remove();
      console.error('[Докси] Request failed:', error);
      addMessage(error?.message || 'Не удалось получить ответ. Попробуйте ещё раз.', 'assistant');
      status.textContent = 'Проблема соединения';
      note.textContent = 'Не удалось получить ответ. Проверьте, что домашний компьютер и Cloudflare Tunnel включены.';
    } finally {
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
    conversation = [];
    restoreWelcome();
    note.classList.remove('is-visible');
    status.textContent = 'Qwen 3.5 9B · защищённое соединение';
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
