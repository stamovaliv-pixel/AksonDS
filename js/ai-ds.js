/* AKSON DockSlot — AI DS floating assistant UI prototype.
   UI only: no network calls, no secrets, and no fake model responses. */
document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.supabaseClient;
  if (!sb?.auth || typeof window.dockslotGetAuthProfile !== 'function') return;

  let profile;
  try {
    const auth = await window.dockslotGetAuthProfile();
    if (!auth?.user || auth.error || !auth.profile || auth.profile.is_blocked) return;
    profile = auth.profile;
  } catch (error) {
    console.warn('[AI DS] Could not validate profile:', error);
    return;
  }

  // First rollout is intentionally limited to Super Admin.
  if (String(profile.role || '').toLowerCase() !== 'super_admin') return;
  if (document.getElementById('akAiDsLauncher')) return;

  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.id = 'akAiDsLauncher';
  launcher.className = 'ak-ai-ds-launcher';
  launcher.setAttribute('aria-label', 'Открыть Докси');
  launcher.setAttribute('aria-haspopup', 'dialog');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.innerHTML = '<span class="ak-ai-ds-monogram" aria-hidden="true"><span>D</span><span class="ak-ai-ds-monogram-x">x</span></span>'; 

  const overlay = document.createElement('div');
  overlay.className = 'ak-ai-ds-overlay';
  overlay.id = 'akAiDsOverlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="ak-ai-ds-window" role="dialog" aria-modal="false" aria-labelledby="akAiDsTitle">
      <header class="ak-ai-ds-header">
        <div class="ak-ai-ds-brand">
          <div class="ak-ai-ds-avatar" aria-hidden="true"><span class="ak-ai-ds-monogram"><span>D</span><span class="ak-ai-ds-monogram-x">x</span></span></div>
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
      <div class="ak-ai-ds-context"><span class="ak-ai-ds-context-dot"></span> Контекст: текущая страница DockSlot</div>
      <div class="ak-ai-ds-messages" id="akAiDsMessages" aria-live="polite">
        <div class="ak-ai-ds-welcome">
          <div class="ak-ai-ds-welcome-icon">✦</div>
          <h3>Привет! Я Докси 👋</h3>
          <p>Помогу разобраться с записями, загрузкой склада, поставщиками и работой DockSlot.</p>
          <div class="ak-ai-ds-suggestions">
            <button type="button" data-prompt="Покажи текущую загрузку склада и объясни, где есть риски.">Анализ загрузки склада <span>↗</span></button>
            <button type="button" data-prompt="Какие записи на сегодня требуют внимания?">Записи, требующие внимания <span>↗</span></button>
            <button type="button" data-prompt="Помоги разобраться с проблемой в работе DockSlot.">Помощь по DockSlot <span>↗</span></button>
          </div>
        </div>
      </div>
      <div class="ak-ai-ds-connection-note" id="akAiDsConnectionNote">
        <span aria-hidden="true">ⓘ</span> Подключение к локальной модели пока не настроено. Сейчас можно проверить интерфейс.
      </div>
      <form class="ak-ai-ds-composer" id="akAiDsForm">
        <textarea id="akAiDsInput" rows="1" maxlength="4000" placeholder="Напишите сообщение..." aria-label="Сообщение для AI DS"></textarea>
        <button type="submit" id="akAiDsSend" aria-label="Отправить сообщение" title="Отправить">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
        </button>
      </form>
      <div class="ak-ai-ds-footnote">AI может ошибаться. Проверяйте важные решения по данным системы.</div>
    </section>`;
  document.body.append(launcher, overlay);

  const $ = (id) => document.getElementById(id);
  const input = $('akAiDsInput');
  const messages = $('akAiDsMessages');

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
  const addMessage = (text, type) => {
    const node = document.createElement('div');
    node.className = `ak-ai-ds-message ak-ai-ds-message-${type}`;
    const bubble = document.createElement('div');
    bubble.className = 'ak-ai-ds-bubble';
    bubble.textContent = text;
    node.appendChild(bubble);
    messages.appendChild(node);
    messages.scrollTop = messages.scrollHeight;
  };
  const send = (value) => {
    const text = String(value || '').trim();
    if (!text) return;
    const welcome = messages.querySelector('.ak-ai-ds-welcome');
    if (welcome) welcome.remove();
    addMessage(text, 'user');
    $('akAiDsConnectionNote').classList.add('is-visible');
    input.value = '';
    input.style.height = 'auto';
  };

  launcher.addEventListener('click', () => overlay.hidden ? open() : close());
  $('akAiDsClose').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) close();
  });
  $('akAiDsNew').addEventListener('click', () => {
    messages.innerHTML = '';
    const welcome = document.createElement('div');
    welcome.className = 'ak-ai-ds-welcome';
    welcome.innerHTML = '<div class="ak-ai-ds-welcome-icon">✦</div><h3>Привет! Я Докси 👋</h3><p>Задайте вопрос по работе DockSlot или выберите пример запроса.</p><div class="ak-ai-ds-suggestions"><button type="button" data-prompt="Покажи текущую загрузку склада и объясни, где есть риски.">Анализ загрузки склада <span>↗</span></button><button type="button" data-prompt="Какие записи на сегодня требуют внимания?">Записи, требующие внимания <span>↗</span></button><button type="button" data-prompt="Помоги разобраться с проблемой в работе DockSlot.">Помощь по DockSlot <span>↗</span></button></div>';
    messages.appendChild(welcome);
    $('akAiDsConnectionNote').classList.remove('is-visible');
    input.value = '';
    input.focus();
  });
  messages.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (!button) return;
    input.value = button.dataset.prompt || '';
    input.focus();
  });
  $('akAiDsForm').addEventListener('submit', (event) => {
    event.preventDefault();
    send(input.value);
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
