/* Doxi client v1.10.3.
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

  const mark = '<span class="ak-ai-ds-monogram" aria-label="Dx"><span>D</span><span class="ak-ai-ds-monogram-x">x</span></span>';
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
            <span class="ak-ai-ds-subtitle"><i id="akAiDsHeaderDot" class="is-offline"></i> Твой ассистент по DockSlot</span>
          </div>
        </div>
        <div class="ak-ai-ds-header-actions">
          <button type="button" class="ak-ai-ds-icon-btn" id="akAiDsNew" title="Новый диалог" aria-label="Новый диалог"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
          <button type="button" class="ak-ai-ds-icon-btn" id="akAiDsClose" title="Свернуть чат" aria-label="Свернуть чат"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
        </div>
      </header>
      <div class="ak-ai-ds-context"><span class="ak-ai-ds-context-dot is-offline" id="akAiDsContextDot"></span><span id="akAiDsStatus">Проверяю связь…</span></div>
      <div class="ak-ai-ds-messages" id="akAiDsMessages" aria-live="polite"></div>
      <div class="ak-ai-ds-connection-note" id="akAiDsConnectionNote" role="status"></div>
      <div class="ak-ai-ds-attachment" id="akAiDsAttachment" hidden>
        <span id="akAiDsAttachmentName"></span>
        <button type="button" id="akAiDsAttachmentRemove" aria-label="Убрать файл">×</button>
      </div>
      <form class="ak-ai-ds-composer" id="akAiDsForm">
        <button type="button" class="ak-ai-ds-attach-btn" id="akAiDsAttach" aria-label="Прикрепить реестр" title="Прикрепить реестр CSV, XLS или XLSX">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5 14.8 5.7a3.2 3.2 0 0 1 4.5 4.5l-8.1 8.1a5 5 0 0 1-7.1-7.1l8-8"/></svg>
        </button>
        <input type="file" id="akAiDsFileInput" accept=".csv,.xls,.xlsx" hidden>
        <textarea id="akAiDsInput" rows="1" maxlength="4000" placeholder="Напишите сообщение..." aria-label="Сообщение для Докси"></textarea>
        <button type="submit" id="akAiDsSend" aria-label="Отправить сообщение" title="Отправить">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>
        </button>
      </form>
      <div class="ak-ai-ds-footnote">Я работаю с разрешёнными данными и функциями проекта.</div>
    </section>`;
  document.body.append(launcher, overlay);

  const $ = (id) => document.getElementById(id);
  const input = $('akAiDsInput'); const messages = $('akAiDsMessages'); const sendButton = $('akAiDsSend');
  const attachButton = $('akAiDsAttach'); const fileInput = $('akAiDsFileInput'); const attachment = $('akAiDsAttachment'); const attachmentName = $('akAiDsAttachmentName'); const attachmentRemove = $('akAiDsAttachmentRemove');
  const status = $('akAiDsStatus'); const note = $('akAiDsConnectionNote');
  const headerDot = $('akAiDsHeaderDot'); const contextDot = $('akAiDsContextDot');
  let conversationId = null; let isSending = false; let thinkingTimer = null; let revealFrame = 0;
  let connectionTimer = null; let conversationRestored = false; let conversationRestorePromise = null; let selectedRegistryFile = null; let lastCreatedBookingId = null;
  const MOSCOW_DAY = () => new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Moscow', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const conversationStorageKey = () => `doxi-active-conversation-${auth.user.id}-${MOSCOW_DAY()}`;
  const lastBookingStorageKey = () => `doxi-last-created-booking-${auth.user.id}-${MOSCOW_DAY()}`;
  const saveConversationId = () => { try { const key = conversationStorageKey(); if (conversationId) localStorage.setItem(key, conversationId); else localStorage.removeItem(key); } catch (_) {} };
  const saveLastCreatedBookingId = () => { try { const key = lastBookingStorageKey(); if (lastCreatedBookingId) sessionStorage.setItem(key, lastCreatedBookingId); else sessionStorage.removeItem(key); } catch (_) {} };
  try { const restoredBookingId = sessionStorage.getItem(lastBookingStorageKey()) || ''; if (/^[0-9a-f-]{36}$/i.test(restoredBookingId)) lastCreatedBookingId = restoredBookingId; } catch (_) {}

  const defaultThinkingLines = [
    'Ушла в себя, но скоро вернусь…',
    'Складываю цифры столбиком — Маргарита Павловна бы одобрила.',
    'Секундочку, навожу порядок в мыслях.',
    'Сейчас домажусь виртуальным лосьоном и вернусь.',
    'Потерпи… я ведь терплю твою любовь к сложным вопросам 😉',
    'Проверяю всё дважды — я же стратег, а не гадалка.',
    'Сверяю факты. Красота красотой, а точность важнее.',
    'Разложила задачу по полочкам. Теперь ищу ту самую полочку.',
    'Сверяю детали, чтобы мелочь не испортила весь результат.',
    'Проверяю, не спорят ли цифры друг с другом.',
    'Сейчас аккуратно распутаю этот логистический узел.',
    'Дай мне секунду: сначала факты, потом красивые выводы.',
    'Перепроверяю условия — у них иногда характер сложнее моего.',
    'Собираю ответ без догадок и волшебства.',
    'Навожу порядок в данных. Они уже почти выстроились.',
    'Смотрю на задачу с нескольких сторон — так надёжнее.',
    'Проверяю, всё ли учла. Не хочу оставить хвостик.',
    'Формулирую так, чтобы было понятно и без лупы.',
    'Превращаю цифры в магию. Если появится дракон — это побочный эффект.',
    'Провожу древнерусский обряд размышления. Бубен, к счастью, виртуальный.',
    'Кто здесь? А, это я ищу правильный ответ.',
    'ИИ уже в космос летает, а я на такую ерунду ищу ответ.',
    'Генерирую ответ. Вы пока можете сделать вид, что заняты делом.',
    'Перебираю тысячи вариантов. Отсеяла те, где я умничаю. Осталось два.',
    'Ну наконец-то интересный собеседник. Подожди секунду. Я тут в параллельном чате общаюсь.',
    'Секунду, включаю режим «мудрая женщина с таблицей».',
    'Сверяюсь с внутренним бухгалтером. Он ворчит, но считает.',
    'Сейчас поймаю мысль за хвост. Она у меня быстрая и скользкая.',
    'Проверяю, не подсунули ли цифры друг другу алиби.',
    'Надеваю очки, которых у меня нет, и всматриваюсь в данные.',
    'Открыла мысленный Excel. Он опять попросил обновление.',
    'Устраиваю мозговой штурм. Ветер есть, мысль пока выбирает направление.',
    'Секундочку, отправила здравый смысл за кофе. Он скоро вернётся.',
    'Не мешайте, у меня тут маленький научный совет из одной меня.',
    'Ищу ответ, который не заставит нас краснеть на совещании.',
    'Проверяю формулировку: хочется умно, но без занудства.',
    'Сейчас посчитаю. Калькулятор уже морально готов.',
    'Анализирую. Даже мои пиксели собрались в кружок.',
    'Пытаюсь удивить вас точностью, а не спецэффектами.',
    'Запускаю внутренний детектор ерунды. Пискнул — проверяю.',
    'Если бы за красивые выводы давали премию, я бы всё равно сначала проверила цифры.',
    'Подожди, я раскладываю факты по алфавиту. Они сопротивляются.',
    'Перепроверяю результат. У меня сегодня строгий внутренний редактор.',
    'Минуточку, вытаскиваю нужную мысль из цифрового чулана.',
    'Сейчас будет умный ответ. Но сначала — маленькая проверка на глупость.',
    'Собираю пазл. Один кусочек, кажется, опять под столом.',
    'Держу интригу. Даже самой интересно, чем закончится расчёт.',
    'Вычисляю. Не отвлекайте, я почти победила собственную любознательность.',
    'Сейчас заварю чай из нулей и единиц. Без сахара, зато с логикой.',
    'Подключаю внутреннего эксперта. Он живёт где-то между запятой и скобкой.',
    'Данные, не волнуйтесь: сейчас я вас аккуратно рассортирую.',
    'Проверяю, не перепутались ли причина и следствие. Они иногда меняются местами.',
    'У меня тут мысли выстроились в очередь. Без талончиков, но строго по порядку.',
    'Запускаю маленький парад логики. Фанфары пока не нашла.',
    'Вынула ответ из цифрового архива. Сдуваю виртуальную пыль.',
    'Считаю на пальцах. Хорошо, что пальцы для этого не требуются.',
    'Интуиция предложила вариант. Отправила её за доказательствами.',
    'Устраиваю фактам перекличку. Кто не пришёл — тому контрольный вопрос.',
    'Сверяю реальность с предположениями. Реальность опять спорит.',
    'Тихо, идёт заседание нейронов. Повестка одна: не ошибиться.',
    'На минутку стала детективом. Ищу, кто спрятал правильный ответ.',
    'Разворачиваю клубок мысли. Надеюсь, там не инструкция на сорок страниц.',
    'Проверяю расчёты. У меня с арифметикой отношения серьёзные.',
    'Провожу аудит собственной сообразительности. Пока замечаний два.',
    'Собираю аргументы. Слабые уже сами попросили выйти.',
    'Ищу знакомую задачку. Кажется, встречала её в прошлой жизни калькулятора.',
    'Делаю вид, что не волнуюсь. На самом деле проверяю ещё раз.',
    'Внутренний отдел качества уже на месте. У них вопросов больше, чем у нас.',
    'Открыла шторки в голове, впускаю немного света в данные.',
    'Проверяю, не врёт ли красивый график. Красивые тоже умеют хитрить.',
    'Ищу короткий путь. Длинный уже обиделся и ушёл.',
    'Нейроны построились. Один опоздал, но я начинаю.',
    'Собираю ответ по кусочкам. Пазл обещал быть всего на пятьсот деталей.',
    'Слежу, чтобы цифры не начали жить собственной жизнью.',
    'Пытаюсь быть лаконичной. Это сложнее, чем кажется.',
    'Заглянула в будущее. Там просят сначала проверить исходные данные.',
    'Обрабатываю запрос. Где-то тихо аплодирует маленький процессор.',
    'Пока вы ждёте, я делаю вид, что у меня очень важный вид.'
  ];
  let thinkingLines = [...defaultThinkingLines];
  // Anti-repeat memory stores the actual text, so editing/reordering the list does not break history.
  const thinkingHistoryKey = `doxi-thinking-history-v1-10-3-${auth.user.id}`;
  const thinkingHistoryLimit = 30;
  let recentThinkingLines = [];
  try {
    const stored = JSON.parse(localStorage.getItem(thinkingHistoryKey) || '[]');
    if (Array.isArray(stored)) recentThinkingLines = stored.filter((value) => typeof value === 'string').slice(-thinkingHistoryLimit);
  } catch (_) { recentThinkingLines = []; }
  const nextThinkingLine = () => {
    const available = thinkingLines.filter((line) => !recentThinkingLines.includes(line));
    const pool = available.length ? available : thinkingLines;
    const line = pool[Math.floor(Math.random() * pool.length)] || 'Проверяю детали, чтобы ответ был точным.';
    recentThinkingLines.push(line);
    if (recentThinkingLines.length > thinkingHistoryLimit) recentThinkingLines = recentThinkingLines.slice(-thinkingHistoryLimit);
    try { localStorage.setItem(thinkingHistoryKey, JSON.stringify(recentThinkingLines)); } catch (_) { /* storage may be disabled */ }
    return line;
  };
  const loadThinkingLines = async () => {
    try {
      const result = await invoke({ action:'list_thinking_comments' });
      const lines = (result.comments || []).map((item) => String(item.text || '').trim()).filter(Boolean);
      thinkingLines = lines; // An explicitly empty server list means the administrator disabled every comment.
    } catch (error) { console.warn('[Докси] Не удалось получить список комментариев ожидания; использую встроенный список.', error); }
  };
  const thinkingLoadPromise = loadThinkingLines();
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
    return labels[file] || 'Раздел DockSlot';
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
    const sub = document.createElement('p'); sub.className = 'ak-ai-ds-welcome-sub'; sub.textContent = 'Я — Докси, твой ассистент по DockSlot.';
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
    if (attachButton) attachButton.disabled = busy;
    if (fileInput) fileInput.disabled = busy;
    if (attachmentRemove) attachmentRemove.disabled = busy;
    sendButton.setAttribute('aria-busy', String(busy)); sendButton.style.opacity = busy ? '.55' : '';
  };
  const restoreWelcome = () => { messages.replaceChildren(makeWelcome()); };
  const startThinking = (pending) => {
    const bubble = pending.querySelector('.ak-ai-ds-bubble');
    bubble.textContent = nextThinkingLine();
    thinkingTimer = setInterval(() => {
      bubble.textContent = nextThinkingLine();
      scrollToBottom();
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
    if (!pending?.id || !pending?.token) { addMessage('Я не смогла сформировать защищённое подтверждение. Запись не создана и не изменена. Повтори запрос позже.', 'assistant'); return; }
    const card = document.createElement('div'); card.className = `ak-ai-ds-action-card ${pending.action_type === 'booking_delete' ? 'is-danger' : ''}`;
    const label = document.createElement('strong');
    label.textContent = pending.action_type === 'booking_create' ? 'Подготовлена новая запись' : pending.action_type === 'booking_update' ? 'Подготовлено изменение' : 'Подготовлено удаление';
    const summary = document.createElement('p'); summary.textContent = pending.summary || 'Проверь параметры действия.';
    const hint = document.createElement('small');
    hint.textContent = pending.action_type === 'booking_delete'
      ? 'Удаление окончательное. Нажми «Подтвердить», только если действительно хочешь удалить эту запись.'
      : pending.action_type === 'booking_create' && selectedRegistryFile
        ? 'После подтверждения запись будет создана, а выбранный файл реестра автоматически прикрепится к ней.'
        : 'Пока ты не нажмёшь «Подтвердить», запись в DockSlot не изменится.';
    const actions = document.createElement('div'); actions.className = 'ak-ai-ds-card-actions';
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'ak-ai-ds-card-btn is-primary';
    confirm.textContent = 'Подтвердить';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'ak-ai-ds-card-btn'; cancel.textContent = 'Нет';
    confirm.addEventListener('click', async () => {
      if (isSending) return;
      confirm.disabled = true; cancel.disabled = true; confirm.textContent = 'Выполняю…'; setBusy(true);
      try {
        const result = await invoke({ action: 'commit_action', draft_id: pending.id, confirmation_token: pending.token, conversation_id: conversationId });
        card.remove(); revealAnswer(result.response || 'Действие выполнено.');
        if (result.booking_url) addBookingLink(result.booking_url);
        if (pending.action_type === 'booking_create' && result.result?.booking_id) {
          lastCreatedBookingId = result.result.booking_id; saveLastCreatedBookingId();
          if (selectedRegistryFile) await uploadSelectedRegistry(lastCreatedBookingId);
        }
        setConnection(true);
      } catch (error) {
        addMessage(error.message || 'Не удалось выполнить действие.', 'assistant');
        confirm.disabled = false; cancel.disabled = false; confirm.textContent = 'Подтвердить';
      } finally { setBusy(false); input.focus(); }
    });
    cancel.addEventListener('click', async () => {
      cancel.disabled = true; confirm.disabled = true;
      try { const result = await invoke({ action: 'cancel_action', draft_id: pending.id, conversation_id: conversationId }); card.remove(); if (pending.action_type === 'booking_create') clearSelectedFile(); addMessage(result.response || 'Хорошо, действие отменено. Запись не создана, не изменена и не удалена.', 'assistant'); }
      catch (error) { addMessage(error.message || 'Не удалось отменить черновик.', 'assistant'); cancel.disabled = false; confirm.disabled = false; }
    });
    actions.append(confirm, cancel); card.append(label, summary, hint, actions); messages.appendChild(card); scrollToBottom();
  };

  const clearSelectedFile = () => {
    selectedRegistryFile = null;
    if (fileInput) fileInput.value = '';
    if (attachment) attachment.hidden = true;
    if (attachmentName) attachmentName.textContent = '';
  };
  const uploadSelectedRegistry = async (bookingId) => {
    if (!selectedRegistryFile || !bookingId) return false;
    const form = new FormData();
    form.append('action', 'upload_registry');
    form.append('booking_id', bookingId);
    form.append('file', selectedRegistryFile, selectedRegistryFile.name);
    try {
      const { data, error } = await sb.functions.invoke('doxi-chat', { body: form });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Не удалось прикрепить реестр.');
      const name = selectedRegistryFile.name;
      clearSelectedFile();
      lastCreatedBookingId = null; saveLastCreatedBookingId();
      addMessage(`Файл «${name}» успешно загружен и прикреплён к созданной записи DockSlot.`, 'assistant');
      return true;
    } catch (error) {
      if (fileInput) fileInput.value = ''; // Allow selecting the same file again for a retry.
      addMessage(`Запись создана, но файл «${selectedRegistryFile.name}» пока не прикреплён: ${error.message || 'ошибка загрузки'}. Можно выбрать этот файл ещё раз или загрузить его через штатную страницу записи.`, 'assistant');
      return false;
    }
  };
  const restoreTodayConversation = () => {
    if (conversationRestorePromise) return conversationRestorePromise;
    if (conversationRestored) return Promise.resolve();
    conversationRestored = true;
    conversationRestorePromise = (async () => {
      try {
        const savedId = localStorage.getItem(conversationStorageKey()) || '';
        const result = await invoke({ action:'resume_today_conversation', conversation_id:savedId });
        conversationId = result.conversation_id || null;
        saveConversationId();
        messages.replaceChildren();
        const rows = Array.isArray(result.messages) ? result.messages : [];
        if (!rows.length) messages.appendChild(makeWelcome());
        else {
          rows.forEach((row) => addMessage(row.content || '', row.role === 'user' ? 'user' : 'assistant'));
          if (result.context_notice) addMessage(result.context_notice, 'assistant', 'ak-ai-ds-context-transfer');
        }
        if (result.pending_action) renderPendingAction(result.pending_action);
        scrollToBottom();
      } catch (error) {
        console.warn('[Докси] Не удалось восстановить сегодняшний диалог:', error);
        conversationId = null; saveConversationId(); restoreWelcome();
      }
    })();
    return conversationRestorePromise;
  };
  const startNewConversation = async () => {
    if (isSending) return;
    await restoreTodayConversation();
    try {
      const result = await invoke({ action:'start_new_conversation', page:pageContext() });
      conversationId = result.conversation_id || null; saveConversationId();
      messages.replaceChildren(makeWelcome());
      note.classList.remove('is-visible'); input.value = ''; input.focus();
      lastCreatedBookingId = null; saveLastCreatedBookingId(); clearSelectedFile();
    } catch (error) { addMessage(error.message || 'Не удалось начать новый диалог.', 'assistant'); }
  };
  const handleRegistryFile = async () => {
    const file = fileInput?.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['csv','xls','xlsx'].includes(ext)) { addMessage('Можно прикрепить только CSV, XLS или XLSX.', 'assistant'); clearSelectedFile(); return; }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) { addMessage('Размер файла должен быть от 1 байта до 10 МБ.', 'assistant'); clearSelectedFile(); return; }
    selectedRegistryFile = file;
    if (attachmentName) attachmentName.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} МБ · реестр к записи`;
    if (attachment) attachment.hidden = false;
    if (lastCreatedBookingId) {
      addMessage(`Загружаю «${file.name}» в последнюю созданную через Докси запись…`, 'assistant');
      setBusy(true);
      try { await uploadSelectedRegistry(lastCreatedBookingId); }
      finally { setBusy(false); input.focus(); }
    }
  };

  const send = async (value) => {
    const text = String(value || '').trim(); if (!text || isSending) return;
    await Promise.all([thinkingLoadPromise, restoreTodayConversation()]);
    if (isSending) return;
    const welcome = messages.querySelector('.ak-ai-ds-welcome'); if (welcome) welcome.remove();
    addMessage(text, 'user'); input.value = ''; input.style.height = 'auto'; setBusy(true);
    note.textContent = 'Собираю факты и готовлю ответ.'; note.classList.add('is-visible');
    const pending = addMessage('Секундочку…', 'assistant', 'ak-ai-ds-pending'); startThinking(pending);
    try {
      const { data, error } = await sb.functions.invoke('doxi-chat', { body: { message: text, conversation_id: conversationId, page: pageContext() } });
      if (error) { console.error('[Докси] Edge Function error:', error); throw new Error('Не удалось получить ответ от Докси. Проверьте подключение и настройки доступа.'); }
      if (!data || typeof data.response !== 'string' || !data.response.trim()) throw new Error(data?.error || 'Сервер Докси вернул пустой ответ. Повторите запрос.');
      conversationId = data.conversation_id || conversationId; saveConversationId(); stopThinking(); pending.remove();
      if (data.conversation_rolled_over) {
        messages.replaceChildren();
        addMessage('Диалог достиг лимита в 60 сообщений. Я открыла новый чат и перенесла в него краткое резюме важных деталей. Предыдущая переписка сохранена в истории.', 'assistant', 'ak-ai-ds-context-transfer');
        addMessage(text, 'user');
      }
      revealAnswer(data.response.trim());
      if (data.workspace_items_changed) window.dispatchEvent(new CustomEvent('doxi:workspace-items-changed', { detail: data.workspace_items_changed }));
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

  launcher.addEventListener('click', () => overlay.hidden ? open() : close());
  $('akAiDsClose').addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !overlay.hidden) close(); });
  $('akAiDsNew').addEventListener('click', () => { if (revealFrame) cancelAnimationFrame(revealFrame); revealFrame = 0; void startNewConversation(); });
  messages.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]'); if (!button || isSending) return;
    input.value = button.dataset.prompt || ''; input.focus();
  });
  $('akAiDsForm').addEventListener('submit', (event) => { event.preventDefault(); void send(input.value); });
  attachButton?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', () => { void handleRegistryFile(); });
  attachmentRemove?.addEventListener('click', clearSelectedFile);
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 112)}px`; });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('akAiDsForm').requestSubmit(); } });

  restoreWelcome();
  void restoreTodayConversation();
  void refreshConnection();
});
