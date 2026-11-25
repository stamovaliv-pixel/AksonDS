/* DockSlot Messenger v1.15 — stable instant tail-follow, measured composer sizing, reactions hidden. */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const sb = window.supabaseClient;
  if (!sb?.auth) return;
  const $ = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const roleLabels = {
    admin: 'УТЗ',
    operator: 'РЦ',
    super_admin: 'Администратор'
  };
  const allowedExtensions = new Set(['jpg','jpeg','png','gif','webp','heic','heif','pdf','doc','docx','xls','xlsx','csv']);
  const mimeByExtension = {
    jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', gif:'image/gif', webp:'image/webp', heic:'image/heic', heif:'image/heif',
    pdf:'application/pdf', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv:'text/csv'
  };
  const icons = {
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.4a8.5 8.5 0 0 1-8.7 8.1 9.5 9.5 0 0 1-3.8-.8L3 20l1.4-4.3a7.8 7.8 0 0 1-1.1-4.3A8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 8.5 8.4Z"/><path d="M8 11.5h.1m3.9 0h.1m3.9 0h.1"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>',
    send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 3-7.2 18-3.6-7.2L3 10.2 21 3Z"/><path d="M10.2 13.8 15 9"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
    attach: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 12.5 14.8 5.7a3.2 3.2 0 0 1 4.5 4.5l-8.8 8.9a5 5 0 0 1-7.1-7.1l8.5-8.5"/></svg>',
    group: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M2.8 20v-1.4A5.3 5.3 0 0 1 8.1 13h1.8a5.3 5.3 0 0 1 5.3 5.3V20M16 5.2a3.2 3.2 0 0 1 0 6.2m1.2 2a4.9 4.9 0 0 1 4 4.8V20"/></svg>',
    direct: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.2a7.8 7.8 0 0 1-8 7.8 8.7 8.7 0 0 1-3.3-.7L4 20l1.4-4.1A7.5 7.5 0 0 1 4 11.2 7.8 7.8 0 0 1 12 3.5a7.8 7.8 0 0 1 8 7.7Z"/><path d="M9 11.5h6"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.8c0 5.1-8.8 11-8.8 11s-8.8-5.9-8.8-11A4.8 4.8 0 0 1 12 6.1a4.8 4.8 0 0 1 8.8 2.7Z"/></svg>'
  };

  let user = null, role = '', settings = null;
  let userRows = [], usersById = new Map(), conversations = [], participants = [];
  let messages = [], reads = [], attachments = [], signedFiles = new Map();
  let lastMessageByConversation = new Map(), bookingsById = new Map();
  let unreadByConversation = new Map(), bookingUnread = [], bookingLinks = [];
  let selectedConversationId = null, selectedBooking = null;
  let selectedFiles = [], selectedMessageIds = new Set(), selectedRecipientIds = new Set();
  let forwardingSelectionMode = false;
  let pickerBookings = [], pickerMode = '', presetGroupTitle = null, editingMessageId = null;
  let bookingDiscussionContext = null, bookingDiscussPopover = null, bookingDiscussPopoverCleanup = null;
  let hasOlderMessages = false, olderMessagesLoading = false;
  let chatSearchTimer = null, chatSearchRows = [];
  let realtimeChannel = null, pollTimer = null, bookingObserver = null;
  let isOpen = false, isSending = false, loading = false;
  let refreshDebounceTimer = null, queuedRefreshThread = false, queuedForceThreadBottom = false;
  let messageLoadSequence = 0, bottomScrollFrame = 0, composerResizeFrame = 0;
  let followMessageTail = true, messageTailObserver = null, observedTailMessage = null;

  const getConversation = (id) => conversations.find((row) => row.id === id) || null;
  const getParticipants = (conversationId) => participants.filter((row) => row.conversation_id === conversationId);
  const getOtherUser = (conversationId) => {
    const row = getParticipants(conversationId).find((item) => item.user_id !== user?.id);
    return row ? usersById.get(row.user_id) || { user_id: row.user_id, display_name: 'Сотрудник DockSlot', role: '' } : null;
  };
  const displayName = (id) => {
    const row = usersById.get(id);
    const companyName = String(row?.company_name || '').trim();
    if (companyName) return companyName;
    if (String(id) === String(user?.id)) return String(user.user_metadata?.full_name || user.user_metadata?.name || 'Вы');
    return row?.display_name || 'Сотрудник DockSlot';
  };
  const fmtTime = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ru-RU', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Moscow' }).format(date) : '';
  };
  const fmtDate = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Moscow' }).format(date) : '';
  };
  const fmtDateTime = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'Europe/Moscow' }).format(date) : '—';
  };
  const fmtBytes = (bytes) => bytes < 1024*1024 ? `${Math.max(1,Math.round(bytes/1024))} КБ` : `${(bytes/1024/1024).toFixed(1)} МБ`;
  const bookingLabel = (booking) => {
    if (!booking) return 'Запись слота';
    const company = booking.profiles?.company_name || booking.company_name || 'Поставщик';
    const date = booking.slot_date ? booking.slot_date.split('-').reverse().join('.') : '';
    const hour = Number.isFinite(Number(booking.slot_hour)) ? `${String(booking.slot_hour).padStart(2,'0')}:00` : '';
    return `${company} · ${date}${hour ? ` · ${hour}` : ''}`;
  };
  const conversationLabel = (conversation) => {
    if (!conversation) return 'Переписка';
    if (conversation.kind === 'general') return 'Общий чат';
    if (conversation.kind === 'direct') { const other = getOtherUser(conversation.id); return other ? displayName(other.user_id) : 'Личный диалог'; }
    if (conversation.kind === 'group') {
      const memberRoles = getParticipants(conversation.id).map((p) => usersById.get(p.user_id)?.role).filter(Boolean);
      if (memberRoles.length && memberRoles.every((memberRole) => memberRole === 'admin')) return 'УТЗ';
      if (memberRoles.length && memberRoles.every((memberRole) => memberRole === 'operator')) return 'РЦ';
    }
    return conversation.title || getParticipants(conversation.id).filter((p) => p.user_id !== user?.id).map((p) => displayName(p.user_id)).join(', ') || 'Групповой чат';
  };
  const toast = (message, isError = false) => {
    const node = $('akChatToast');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', Boolean(isError));
    node.classList.add('is-visible');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => node.classList.remove('is-visible'), 3600);
  };
  const newId = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const safeFileName = (name) => String(name || 'file').normalize('NFKC').replace(/[^\p{L}\p{N}._-]+/gu,'_').slice(0,120) || 'file';
  const sixMonthsAgo = () => {
    const date = new Date(), day = date.getUTCDate();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth()-6);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth()+1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day,lastDay));
    return date.toISOString();
  };
  const getFileMeta = (file) => {
    const ext = String(file.name.split('.').pop() || '').toLowerCase();
    const reportedMime=String(file.type||'').toLowerCase();
    const mime = (!reportedMime || reportedMime==='application/octet-stream') ? (mimeByExtension[ext]||reportedMime) : reportedMime;
    return { ext, mime };
  };
  const validateFile = (file) => {
    const { ext, mime } = getFileMeta(file);
    if (!allowedExtensions.has(ext)) throw new Error(`Формат файла «${file.name}» не поддерживается.`);
    if (!mime) throw new Error(`Не удалось определить тип файла «${file.name}».`);
    const maxBytes = (Number(settings?.max_attachment_size_mb) || 20) * 1024 * 1024;
    if (file.size <= 0 || file.size > maxBytes) throw new Error(`Файл «${file.name}» превышает лимит ${Math.round(maxBytes/1024/1024)} МБ.`);
    return { ext, mime };
  };

  const init = async (retry = 0) => {
    try {
      const authProfile = await window.dockslotGetAuthProfile?.();
      if (!authProfile?.user || authProfile.error || !authProfile.profile || authProfile.profile.is_blocked) return;
      user = authProfile.user;
      role = String(authProfile.profile.role || '').toLowerCase();
      if (!['admin','operator','super_admin'].includes(role)) return;
      const { data: access, error: accessError } = await sb.rpc('dockslot_chat_self_enabled');
      if (accessError) {
        console.warn('[DockSlot chat] Access check temporarily failed; retrying without exposing the widget.', accessError.message || accessError);
        if (retry < 2) window.setTimeout(() => void init(retry + 1), 1500 * (retry + 1));
        return;
      }
      if (access !== true) return;
      const { data: config, error: settingsError } = await sb.from('dockslot_chat_settings').select('*').eq('id',1).maybeSingle();
      if (settingsError || !config) {
        console.warn('[DockSlot chat] Settings temporarily unavailable.', settingsError?.message || 'No settings row');
        if (retry < 2) window.setTimeout(() => void init(retry + 1), 1500 * (retry + 1));
        return;
      }
      settings = config;
      mountChat();
      await refreshData(true);
      if (!user) return;
      setupRealtime();
      startPolling();
      watchBookingCards();
    } catch (error) { console.error('[DockSlot chat] Initialization failed:', error); }
  };

  const mountChat = () => {
    if ($('akChatFab')) return;
    const fab = document.createElement('button');
    fab.type = 'button'; fab.id = 'akChatFab'; fab.className = 'ak-chat-fab';
    fab.title = 'Командный чат'; fab.setAttribute('aria-label','Открыть командный чат');
    fab.setAttribute('aria-haspopup','dialog'); fab.setAttribute('aria-expanded','false');
    fab.innerHTML = `${icons.chat}<span class="ak-chat-fab-badge" id="akChatUnreadBadge" hidden></span>`;
    document.body.appendChild(fab);

    const overlay = document.createElement('div');
    overlay.className = 'ak-chat-overlay'; overlay.id = 'akChatOverlay'; overlay.hidden = true;
    overlay.innerHTML = `
      <section class="ak-chat-window" role="dialog" aria-modal="true" aria-labelledby="akChatTitle">
        <aside class="ak-chat-sidebar">
          <header class="ak-chat-sidebar-head"><div class="ak-chat-brand-mark">${icons.chat}</div><div><h2 id="akChatTitle">DockSlot <span>Команда</span></h2><p>Рабочие сообщения</p></div><button type="button" class="ak-chat-icon-btn ak-chat-mobile-close" id="akChatMobileClose" aria-label="Закрыть">${icons.close}</button></header>
          <div class="ak-chat-sidebar-tabs"><button type="button" class="is-active" data-chat-filter="all">Все</button><button type="button" data-chat-filter="direct">Личные</button><button type="button" data-chat-filter="group">Группы</button></div>
          <div class="ak-chat-conversation-list" id="akChatConversationList" aria-label="Список чатов"></div>
          <button type="button" class="ak-chat-new-direct" id="akChatNewDirect">${icons.direct}<span>Новое сообщение</span><b>＋</b></button>
          <div class="ak-chat-sidebar-foot"><span class="ak-chat-online-dot"></span> Вы вошли как <strong>${escapeHtml(roleLabels[role] || role)}</strong></div>
        </aside>
        <section class="ak-chat-thread">
          <header class="ak-chat-thread-head"><div class="ak-chat-thread-avatar" id="akChatThreadAvatar">${icons.group}</div><div class="ak-chat-thread-title"><strong id="akChatThreadName">Общий чат</strong><span id="akChatThreadMeta">Все сотрудники с доступом к мессенджеру</span></div><button type="button" class="ak-chat-icon-btn ak-chat-search-toggle" id="akChatSearchToggle" aria-label="Поиск по сообщениям" title="Поиск по сообщениям">${icons.search}</button><button type="button" class="ak-chat-icon-btn" id="akChatClose" aria-label="Закрыть чат">${icons.close}</button></header>
          <div class="ak-chat-search-panel" id="akChatSearchPanel" hidden><div class="ak-chat-search-input-wrap"><input id="akChatSearchInput" type="search" placeholder="Найти сообщение в этой переписке…" autocomplete="off"><button type="button" id="akChatSearchClear" aria-label="Закрыть поиск">×</button></div><div class="ak-chat-search-results" id="akChatSearchResults" hidden></div></div>
          <div class="ak-chat-notice" id="akChatNotice" hidden></div>
          <div class="ak-chat-message-list" id="akChatMessageList" aria-live="polite"><div class="ak-chat-loading">Загружаем переписку…</div></div>
          <div class="ak-chat-forward-selection-bar" id="akChatForwardSelectionBar" hidden>
            <span id="akChatForwardSelectionCount">Выбрано: 0</span>
            <button type="button" class="is-quiet" id="akChatForwardCancel">Отмена</button>
            <button type="button" id="akChatForwardContinue" disabled>Выбрать получателей</button>
          </div>
          <div class="ak-chat-edit-panel" id="akChatEditPanel" hidden><span>Редактирование сообщения</span><button type="button" id="akChatEditCancel">Отменить</button><button type="button" id="akChatEditSave">Сохранить</button></div>
          <div class="ak-chat-composer-wrap">
            <div class="ak-chat-attachment-row" id="akChatBookingRow" hidden><span>▧</span><strong id="akChatBookingLabel"></strong><button type="button" id="akChatBookingRemove" aria-label="Убрать привязку">×</button></div>
            <div class="ak-chat-files-row" id="akChatFilesRow" hidden></div>
            <div class="ak-chat-composer">
              <button type="button" class="ak-chat-attach-btn" id="akChatFileButton" title="Прикрепить фото или документ" aria-label="Прикрепить фото или документ">${icons.attach}</button>
              <input type="file" id="akChatFileInput" hidden multiple accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv">
              <button type="button" class="ak-chat-attach-btn is-booking" id="akChatBookingButton" title="Привязать запись слота" aria-label="Привязать запись слота">▧</button>
              <textarea id="akChatInput" rows="1" maxlength="${Number(settings.max_message_chars)||2000}" placeholder="Напишите сообщение…"></textarea>
              <div class="ak-chat-send-wrap"><span id="akChatCharCount">0/${Number(settings.max_message_chars)||2000}</span><button type="button" class="ak-chat-send-btn" id="akChatSend" aria-label="Отправить сообщение">${icons.send}</button></div>
            </div>
            <div class="ak-chat-composer-hint">Enter — отправить · Shift + Enter — новая строка</div>
          </div>
        </section>
        <div class="ak-chat-picker" id="akChatPicker" hidden>
          <div class="ak-chat-picker-head"><strong id="akChatPickerTitle">Выберите сотрудников</strong><button type="button" id="akChatPickerClose" aria-label="Закрыть">×</button></div>
          <input id="akChatPickerSearch" type="search" placeholder="Поиск по компании, сотруднику или роли…">
          <section class="ak-chat-picker-groups" id="akChatPickerGroupsSection">
            <div class="ak-chat-picker-section-title">Групповые рассылки</div>
            <div class="ak-chat-picker-shortcuts" id="akChatPickerShortcuts"><button type="button" data-role-group="admin">УТЗ</button><button type="button" data-role-group="operator">РЦ</button><button type="button" data-role-group="all">Всем</button></div>
          </section>
          <section class="ak-chat-picker-people" id="akChatPickerPeopleSection">
            <div class="ak-chat-picker-section-title" id="akChatPickerPeopleTitle">Личные сообщения сотрудникам</div>
            <div id="akChatPickerList" class="ak-chat-picker-list"></div>
          </section>
          <div class="ak-chat-picker-footer" id="akChatPickerFooter" hidden><span id="akChatPickerSelected">Выбрано: 0</span><button type="button" id="akChatPickerAction">Продолжить</button></div>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    const toastNode = document.createElement('div'); toastNode.id = 'akChatToast'; toastNode.className = 'ak-chat-toast';
    toastNode.setAttribute('role','status'); toastNode.setAttribute('aria-live','polite'); document.body.appendChild(toastNode);

    fab.addEventListener('click', () => openChat());
    $('akChatClose').addEventListener('click', closeChat); $('akChatMobileClose').addEventListener('click', closeChat);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeChat(); });
    $('akChatSend').addEventListener('click', sendMessage);
    $('akChatInput').addEventListener('input', updateComposer);
    $('akChatInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); editingMessageId ? saveEditedMessage() : sendMessage(); }
    });
    $('akChatFileButton').addEventListener('click', () => $('akChatFileInput').click());
    $('akChatFileInput').addEventListener('change', onFilesSelected);
    $('akChatBookingButton').addEventListener('click', () => openPicker('booking'));
    $('akChatBookingRemove').addEventListener('click', () => setSelectedBooking(null));
    $('akChatNewDirect').addEventListener('click', () => openPicker('recipients'));
    $('akChatPickerClose').addEventListener('click', closePicker); $('akChatPickerSearch').addEventListener('input', renderPickerList);
    $('akChatPickerAction').addEventListener('click', pickerAction);
    $('akChatPickerShortcuts')?.querySelectorAll('[data-role-group]').forEach((button)=>button.addEventListener('click',()=>{
      const targetRole=button.dataset.roleGroup;
      const isBookingDiscussion=pickerMode==='booking-recipients';
      presetGroupTitle=targetRole==='admin'?'УТЗ':targetRole==='operator'?'РЦ':'Всем';
      const allowedRoles=targetRole==='all'
        ? new Set(isBookingDiscussion?['admin','operator']:['admin','operator','super_admin'])
        : new Set([targetRole]);
      const recipients=userRows.filter((row)=>allowedRoles.has(String(row.role||'').toLowerCase())&&row.user_id!==user.id);
      if(!recipients.length){toast('В выбранной группе пока нет сотрудников с включённым доступом к мессенджеру.',true);return;}
      if(recipients.length>200){toast('В группу можно включить не более 200 получателей. Сейчас доступных сотрудников: '+recipients.length+'.',true);return;}
      selectedRecipientIds=new Set(recipients.map((row)=>row.user_id));
      renderPickerList(); updatePickerCount();
    }));
    $('akChatEditCancel').addEventListener('click', cancelEditing); $('akChatEditSave').addEventListener('click', saveEditedMessage);
    $('akChatSearchToggle').addEventListener('click', toggleChatSearch);
    $('akChatSearchClear').addEventListener('click', closeChatSearch);
    $('akChatSearchInput').addEventListener('input', onChatSearchInput);
    $('akChatSearchInput').addEventListener('keydown', (event) => { if (event.key === 'Escape') closeChatSearch(); });
    overlay.querySelectorAll('[data-chat-filter]').forEach((button) => button.addEventListener('click', () => {
      overlay.querySelectorAll('[data-chat-filter]').forEach((item) => item.classList.toggle('is-active', item === button));
      renderConversationList(button.dataset.chatFilter || 'all');
    }));
    const messageList=$('akChatMessageList');
    messageList.addEventListener('click', onMessageListClick);
    messageList.addEventListener('change',(event)=>{
      const checkbox=event.target.closest('[data-chat-select-message]');
      if(!checkbox||!forwardingSelectionMode)return;
      const messageId=checkbox.dataset.chatSelectMessage;
      if(checkbox.checked)selectedMessageIds.add(messageId);else selectedMessageIds.delete(messageId);
      checkbox.closest('.ak-chat-message')?.classList.toggle('is-selected',checkbox.checked);
      updateForwardSelectionBar();
    });
    $('akChatForwardCancel').addEventListener('click',cancelForwardSelection);
    $('akChatForwardContinue').addEventListener('click',()=>{
      if(!selectedMessageIds.size)return;
      void openPicker('forward');
    });
    messageList.addEventListener('scroll',()=>{
      const distance=messageList.scrollHeight-messageList.scrollTop-messageList.clientHeight;
      followMessageTail=distance<64;
    },{passive:true});
    if(typeof ResizeObserver==='function'){
      messageTailObserver=new ResizeObserver(()=>{
        if(!isOpen||!followMessageTail||!messageList.isConnected)return;
        if(messageList.scrollHeight-messageList.clientHeight-messageList.scrollTop>2)messageList.scrollTop=messageList.scrollHeight;
      });
    }
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && isOpen) { if (!$('akChatPicker').hidden) closePicker(); else closeChat(); } });
  };

  const openChat = async (conversationId = null, bookingId = null, messageId = null) => {
    if (!$('akChatOverlay')) return;
    isOpen = true; $('akChatOverlay').hidden = false;
    requestAnimationFrame(() => $('akChatOverlay')?.classList.add('is-open'));
    $('akChatFab')?.setAttribute('aria-expanded','true');
    if (messageId) setSelectedBooking(null);
    else if (bookingId) setSelectedBooking(await loadBookingById(bookingId));
    if (conversationId) { selectedConversationId = conversationId; messageLoadSequence++; followMessageTail = true; }
    if (!selectedConversationId) selectedConversationId = conversations.find((c) => c.kind==='general')?.id || conversations[0]?.id || null;
    renderConversationList(); await renderSelectedConversation();
    if (messageId) {
      let hit=messages.find((row)=>String(row.id)===String(messageId));
      if(!hit){
        const {data,error}=await sb.from('dockslot_chat_messages')
          .select('id,conversation_id,sender_id,body,booking_id,target_user_id,created_at,edited_at,forwarded_from_message_id')
          .eq('id',messageId).maybeSingle();
        if(error)console.warn('[DockSlot chat] Could not resolve slot-linked message:',error.message);
        hit=data||null;
      }
      if(hit&&String(hit.conversation_id)===String(selectedConversationId)) await jumpToSearchResult(hit);
      else toast('Сообщение по этой записи больше недоступно.',true);
    }
  };
  const closeChat = () => {
    isOpen = false; $('akChatOverlay')?.classList.remove('is-open'); $('akChatFab')?.setAttribute('aria-expanded','false');
    window.setTimeout(() => { if (!isOpen && $('akChatOverlay')) $('akChatOverlay').hidden = true; },190);
    closePicker();
  };
  const queueRefreshData = (refreshThread = false, forceThreadBottom = false) => {
    queuedRefreshThread = queuedRefreshThread || Boolean(refreshThread);
    queuedForceThreadBottom = queuedForceThreadBottom || Boolean(forceThreadBottom);
    window.clearTimeout(refreshDebounceTimer);
    refreshDebounceTimer = window.setTimeout(async () => {
      if (loading) { queueRefreshData(queuedRefreshThread, queuedForceThreadBottom); return; }
      const shouldRefreshThread = queuedRefreshThread;
      const shouldForceBottom = queuedForceThreadBottom;
      queuedRefreshThread = false;
      queuedForceThreadBottom = false;
      await refreshData(shouldRefreshThread, shouldForceBottom);
    }, 140);
  };
  const startPolling = () => { window.clearInterval(pollTimer); pollTimer = window.setInterval(() => queueRefreshData(isOpen),45000); };
  const setupRealtime = () => {
    if (!sb.channel || realtimeChannel) return;
    realtimeChannel = sb.channel(`dockslot-chat-${user.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'dockslot_chat_messages'},(payload)=>{
        const isNewActiveMessage = payload?.eventType === 'INSERT'
          && isOpen
          && String(payload?.new?.conversation_id || '') === String(selectedConversationId || '');
        queueRefreshData(isOpen, isNewActiveMessage);
      })
      .on('postgres_changes',{event:'*',schema:'public',table:'dockslot_chat_message_reads'},()=>queueRefreshData(isOpen))
      .on('postgres_changes',{event:'*',schema:'public',table:'dockslot_chat_attachments'},()=>queueRefreshData(isOpen))
      .subscribe((status)=>{ if(status==='CHANNEL_ERROR'||status==='TIMED_OUT') console.warn('[DockSlot chat] Realtime unavailable; polling remains active.'); });
  };

  const refreshData = async (refreshThread = false, forceThreadBottom = false) => {
    if (loading || !user) return;
    const previousActiveLatestId = selectedConversationId
      ? String(lastMessageByConversation.get(selectedConversationId)?.id || '')
      : '';
    loading = true;
    try {
      const { data: liveAccess, error: liveAccessError } = await sb.rpc('dockslot_chat_self_enabled');
      if (liveAccessError) {
        console.warn('[DockSlot chat] Access check failed because of a temporary request error; keeping the existing chat control.', liveAccessError.message || liveAccessError);
        return;
      }
      if (liveAccess === false) { clearSession(); return; }
      if (liveAccess !== true) return;
      const { data: liveSettings, error: liveSettingsError } = await sb.from('dockslot_chat_settings').select('*').eq('id',1).maybeSingle();
      if (liveSettingsError || !liveSettings) throw liveSettingsError || new Error('Настройки мессенджера недоступны.');
      settings = liveSettings;
      if ($('akChatInput')) $('akChatInput').maxLength = Number(settings.max_message_chars)||2000;
      updateComposer();
      const [userResult, convResult, unreadResult, bookingUnreadResult, bookingLinksResult] = await Promise.all([
        sb.rpc('dockslot_chat_list_users'),
        sb.from('dockslot_chat_conversations').select('id,kind,title,created_at,updated_at').order('updated_at',{ascending:false}).limit(1000),
        sb.rpc('dockslot_chat_unread_summary'), sb.rpc('dockslot_chat_booking_unread'),
        sb.rpc('dockslot_chat_booking_links')
      ]);
      for (const result of [userResult,convResult,unreadResult,bookingUnreadResult]) if (result.error) throw result.error;
      if (bookingLinksResult.error) {
        bookingLinks=[];
        console.warn('[DockSlot chat] Slot message markers are unavailable; apply migration 20261125_dockslot_chat_booking_links.sql.',bookingLinksResult.error.message||bookingLinksResult.error);
      } else bookingLinks=bookingLinksResult.data||[];
      userRows = userResult.data||[]; usersById = new Map(userRows.map((row)=>[row.user_id,row]));
      conversations = convResult.data||[];
      unreadByConversation = new Map((unreadResult.data||[]).map((row)=>[row.conversation_id,Number(row.unread_count||0)]));
      bookingUnread = bookingUnreadResult.data||[];
      $('akChatNewDirect')?.toggleAttribute('hidden',!settings.direct_chat_enabled);
      const ids = conversations.filter((c)=>c.kind==='direct'||c.kind==='group').map((c)=>c.id);
      if (ids.length) {
        const {data: memberRows,error:memberError} = await sb.from('dockslot_chat_participants').select('conversation_id,user_id').in('conversation_id',ids);
        if (memberError) throw memberError;
        participants = memberRows||[];
      } else participants=[];
      lastMessageByConversation = new Map();
      if (conversations.length) {
        const cutoff = sixMonthsAgo();
        const {data:previewRows,error:previewError} = await sb.from('dockslot_chat_messages')
          .select('id,conversation_id,sender_id,body,created_at').in('conversation_id',conversations.map((c)=>c.id))
          .gte('created_at',cutoff).order('created_at',{ascending:false}).limit(1000);
        if (previewError) throw previewError;
        (previewRows||[]).forEach((m)=>{ if(!lastMessageByConversation.has(m.conversation_id)) lastMessageByConversation.set(m.conversation_id,m); });
      }
      const currentActiveLatestId = selectedConversationId
        ? String(lastMessageByConversation.get(selectedConversationId)?.id || '')
        : '';
      if (isOpen && refreshThread && currentActiveLatestId && currentActiveLatestId !== previousActiveLatestId) {
        forceThreadBottom = true;
      }
      if (!conversations.some((c)=>c.id===selectedConversationId)) selectedConversationId = conversations.find((c)=>c.kind==='general')?.id || conversations[0]?.id || null;
      setBadge(Array.from(unreadByConversation.values()).reduce((sum,n)=>sum+n,0));
      renderConversationList();
      if (refreshThread && isOpen) { if(selectedConversationId) await loadSelectedMessages({preserveHistory:true,forceBottom:forceThreadBottom}); else await renderSelectedConversation(); }
      updateBookingMarkers();
    } catch(error) {
      console.warn('[DockSlot chat] Data refresh failed:',error?.message||error);
      if(isOpen && !$('akChatMessageList')?.querySelector('.ak-chat-message')) $('akChatMessageList').innerHTML=`<div class="ak-chat-error">Не удалось загрузить переписку. ${escapeHtml(error?.message||'Проверьте подключение и права доступа.')}</div>`;
    } finally { loading=false; }
  };

  const setBadge = (count) => {
    const badge=$('akChatUnreadBadge'); if(!badge)return;
    badge.textContent=count>99?'99+':String(count); badge.hidden=count<=0;
    $('akChatFab')?.classList.toggle('has-unread',count>0);
  };
  const renderConversationList = (filter='all') => {
    const list=$('akChatConversationList'); if(!list)return;
    const filtered=conversations.filter((c)=>filter==='all'||(filter==='direct'&&c.kind==='direct')||(filter==='group'&&c.kind==='group'));
    if(!filtered.length){list.innerHTML='<div class="ak-chat-list-empty">Нет переписок в этой категории.<br>Нажмите «Новое сообщение», чтобы начать.</div>';return;}
    list.replaceChildren();
    filtered.forEach((conversation)=>{
      const title=conversationLabel(conversation);
      const preview=lastMessageByConversation.get(conversation.id)||messages.filter((m)=>m.conversation_id===conversation.id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];
      const button=document.createElement('button'); button.type='button';
      button.className=`ak-chat-conversation${selectedConversationId===conversation.id?' is-active':''}`;
      const avatar=conversation.kind==='general'?icons.group:`<span>${escapeHtml((title.trim()[0]||'С').toLocaleUpperCase('ru-RU'))}</span>`;
      const unread=Number(unreadByConversation.get(conversation.id)||0);
      const typeLabel=conversation.kind==='group'?'Групповой чат':(conversation.kind==='general'?'Командный канал':(roleLabels[getOtherUser(conversation.id)?.role]||'Личная переписка'));
      button.innerHTML=`<span class="ak-chat-list-avatar ${conversation.kind==='general'?'is-general':''}">${avatar}</span><span class="ak-chat-conversation-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(preview?.body?.trim()||typeLabel)}</small></span><span class="ak-chat-conversation-meta"><time>${escapeHtml(preview?fmtTime(preview.created_at):'')}</time>${unread?`<b>${unread>99?'99+':unread}</b>`:''}</span>`;
      button.addEventListener('click',async()=>{selectedConversationId=conversation.id;messageLoadSequence++;followMessageTail=true;setSelectedBooking(null);clearMessageSelection();cancelEditing();closePicker();closeChatSearch();renderConversationList(filter);await renderSelectedConversation();});
      list.appendChild(button);
    });
  };

  const renderSelectedConversation = async () => {
    if(!selectedConversationId){$('akChatMessageList').innerHTML='<div class="ak-chat-empty"><div class="ak-chat-empty-icon">✦</div><strong>Нет доступных чатов</strong><span>Создайте переписку с одним или несколькими сотрудниками.</span></div>';return;}
    const c=getConversation(selectedConversationId); if(!c)return;
    const title=conversationLabel(c), isGeneral=c.kind==='general', memberRows=getParticipants(c.id);
    $('akChatThreadName').textContent=title;
    $('akChatThreadMeta').textContent=isGeneral?'Все сотрудники с доступом к мессенджеру':(c.kind==='direct'?(roleLabels[getOtherUser(c.id)?.role]||'Личная переписка'):`Участники: ${memberRows.length}`);
    $('akChatThreadAvatar').innerHTML=isGeneral||c.kind==='group'?icons.group:escapeHtml((title||'С')[0].toLocaleUpperCase('ru-RU'));
    $('akChatNotice').hidden=!isGeneral;
    $('akChatNotice').textContent=isGeneral?'Общие сообщения видны всем сотрудникам.':'';
    const canLink=settings?.booking_chat_enabled && (c.kind==='direct'||c.kind==='group');
    $('akChatBookingButton').hidden=!settings?.booking_chat_enabled;
    $('akChatBookingButton').disabled=!canLink;
    $('akChatBookingButton').title=!settings?.booking_chat_enabled?'Привязка записей отключена':(isGeneral?'Для отметки по слоту начните личную или групповую переписку':'Привязать запись слота');
    $('akChatFileButton').disabled=false;
    await loadSelectedMessages();
  };

  const loadSelectedMessages = async ({ preserveHistory = false, forceBottom = false } = {}) => {
    const conversationId = selectedConversationId;
    if (!conversationId) return;
    const loadSequence = ++messageLoadSequence;
    const list = $('akChatMessageList');
    const previousScrollTop = list?.scrollTop || 0;
    const wasNearBottom = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 100;

    const { data, error } = await sb.from('dockslot_chat_messages')
      .select('id,conversation_id,sender_id,body,booking_id,target_user_id,created_at,edited_at,forwarded_from_message_id')
      .eq('conversation_id', conversationId).gte('created_at', sixMonthsAgo())
      .order('created_at', { ascending: false }).limit(250);
    if (error) throw error;
    if (loadSequence !== messageLoadSequence || selectedConversationId !== conversationId) return;

    const fetchedMessages = (data || []).reverse();
    const ids = fetchedMessages.map((message) => message.id);
    const bookingIds = [...new Set(fetchedMessages.map((message) => message.booking_id).filter(Boolean))];
    let bookingRows = [];
    let readRows = [];
    let attachmentRows = [];

    const tasks = [];
    if (bookingIds.length) {
      tasks.push(sb.from('bookings').select('id,slot_date,slot_hour,order_number,profiles(company_name)').in('id', bookingIds)
        .then((result) => { if (result.error) throw result.error; bookingRows = result.data || []; }));
    }
    if (ids.length) {
      tasks.push(sb.from('dockslot_chat_message_reads').select('message_id,user_id,read_at').in('message_id', ids)
        .then((result) => { if (result.error) throw result.error; readRows = result.data || []; }));
      tasks.push(sb.from('dockslot_chat_attachments').select('id,message_id,storage_path,file_name,mime_type,file_size').in('message_id', ids)
        .then((result) => { if (result.error) throw result.error; attachmentRows = result.data || []; }));
    }
    await Promise.all(tasks);
    if (loadSequence !== messageLoadSequence || selectedConversationId !== conversationId) return;

    (bookingRows || []).forEach((booking) => bookingsById.set(booking.id, booking));
    if (!preserveHistory) bookingsById = new Map((bookingRows || []).map((booking) => [booking.id, booking]));
    const liveMessages = messages.filter((message) => String(message.conversation_id) === String(conversationId));
    const retainedMessages = preserveHistory
      ? liveMessages
      : liveMessages.filter((message) => message.client_pending);
    const mergedMessages = new Map(retainedMessages.map((message) => [String(message.id), message]));
    fetchedMessages.forEach((message) => mergedMessages.set(String(message.id), message));
    messages = [...mergedMessages.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    hasOlderMessages = (preserveHistory && hasOlderMessages) || (data || []).length === 250;

    const mergeUnique = (oldRows, newRows, keyOf) => [...new Map([...oldRows, ...(newRows || [])].map((row) => [keyOf(row), row])).values()];
    reads = mergeUnique(preserveHistory ? reads : [], readRows, (row) => `${row.message_id}:${row.user_id}`);
    attachments = mergeUnique(preserveHistory ? attachments : [], attachmentRows, (row) => row.id);
    if (!preserveHistory) signedFiles = new Map();

    renderMessages();
    renderConversationList();
    if (forceBottom || !preserveHistory || wasNearBottom) scrollMessageListToBottom();
    else requestAnimationFrame(() => {
      if (loadSequence === messageLoadSequence && selectedConversationId === conversationId && list?.isConnected) {
        list.scrollTop = previousScrollTop;
        followMessageTail = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
      }
    });
    // Do not wait for receipt persistence or file URL signing before painting the thread.
    void markRead(conversationId);
    if (attachmentRows.length) {
      void Promise.all(attachmentRows.map(async (attachment) => {
        try {
          const { data: link, error: linkError } = await sb.storage.from('dockslot-chat-files').createSignedUrl(attachment.storage_path, 3600);
          if (!linkError && link?.signedUrl) signedFiles.set(attachment.id, link.signedUrl);
        } catch (_) { /* attachment remains listed without a preview */ }
      })).then(() => {
        if (loadSequence !== messageLoadSequence || selectedConversationId !== conversationId || !isOpen) return;
        renderMessages();
        if (followMessageTail) scrollMessageListToBottom();
      });
    }
  };
  const loadOlderMessages=async()=>{
    if(!selectedConversationId||!messages.length||!hasOlderMessages||olderMessagesLoading)return;
    olderMessagesLoading=true;
    const list=$('akChatMessageList'),previousHeight=list?.scrollHeight||0,previousTop=list?.scrollTop||0;
    const oldest=messages[0]?.created_at;
    const button=$('akChatLoadOlder');if(button){button.disabled=true;button.textContent='Загрузка…';}
    try{
      const {data,error}=await sb.from('dockslot_chat_messages')
        .select('id,conversation_id,sender_id,body,booking_id,target_user_id,created_at,edited_at,forwarded_from_message_id')
        .eq('conversation_id',selectedConversationId).gte('created_at',sixMonthsAgo()).lt('created_at',oldest)
        .order('created_at',{ascending:false}).limit(250);
      if(error)throw error;
      const older=(data||[]).reverse();
      const moreOlderMessages=(data||[]).length===250;
      if(!older.length){hasOlderMessages=false;renderMessages();return;}
      const ids=older.map((message)=>message.id);
      const bookingIds=[...new Set(older.map((message)=>message.booking_id).filter(Boolean))];
      if(bookingIds.length){
        const {data:bookingRows,error:bookingError}=await sb.from('bookings').select('id,slot_date,slot_hour,order_number,profiles(company_name)').in('id',bookingIds);
        if(bookingError)throw bookingError;(bookingRows||[]).forEach((booking)=>bookingsById.set(booking.id,booking));
      }
      const [readRes,attachRes]=await Promise.all([
        sb.from('dockslot_chat_message_reads').select('message_id,user_id,read_at').in('message_id',ids),
        sb.from('dockslot_chat_attachments').select('id,message_id,storage_path,file_name,mime_type,file_size').in('message_id',ids)
      ]);
      if(readRes.error)throw readRes.error;if(attachRes.error)throw attachRes.error;
      reads=[...reads,...(readRes.data||[])];attachments=[...attachments,...(attachRes.data||[])];
      await Promise.all((attachRes.data||[]).map(async(attachment)=>{
        try{const {data:link,error:linkError}=await sb.storage.from('dockslot-chat-files').createSignedUrl(attachment.storage_path,3600);if(!linkError&&link?.signedUrl)signedFiles.set(attachment.id,link.signedUrl);}catch(_){/* show attachment without preview if signing fails */}
      }));
      messages=[...older,...messages];
      hasOlderMessages=moreOlderMessages;
      renderMessages();
      requestAnimationFrame(()=>{if(list)list.scrollTop=previousTop+(list.scrollHeight-previousHeight);});
    }catch(error){toast(error?.message||'Не удалось загрузить более ранние сообщения.',true);}
    finally{olderMessagesLoading=false;const loadButton=$('akChatLoadOlder');if(loadButton){loadButton.disabled=false;loadButton.textContent='Загрузить более ранние сообщения';}}
  };

  const markRead=async(conversationId)=>{
    const {error}=await sb.rpc('dockslot_chat_mark_read',{p_conversation_id:conversationId});
    if(error)console.warn('[DockSlot chat] Could not mark conversation read:',error.message);
    else{unreadByConversation.delete(conversationId);bookingUnread=bookingUnread.map((row)=>row.conversation_id===conversationId?{...row,unread_count:0}:row);setBadge([...unreadByConversation.values()].reduce((s,n)=>s+n,0));updateBookingMarkers();}
  };

  const updateForwardSelectionBar=()=>{
    const list=$('akChatMessageList');
    const bar=$('akChatForwardSelectionBar');
    if(list)list.classList.toggle('is-forward-selection',forwardingSelectionMode);
    if(bar)bar.hidden=!forwardingSelectionMode;
    const count=$('akChatForwardSelectionCount');
    if(count)count.textContent=`Выбрано: ${selectedMessageIds.size}`;
    const next=$('akChatForwardContinue');
    if(next){next.disabled=!selectedMessageIds.size;next.textContent=selectedMessageIds.size?`Выбрать получателей (${selectedMessageIds.size})`:'Выбрать получателей';}
  };
  const cancelForwardSelection=()=>{
    forwardingSelectionMode=false;
    selectedMessageIds.clear();
    updateForwardSelectionBar();
    $('akChatMessageList')?.querySelectorAll('.ak-chat-message.is-selected').forEach((node)=>node.classList.remove('is-selected'));
    renderMessages();
  };
  const renderMessages=()=>{
    const list=$('akChatMessageList');if(!list)return;
    updateForwardSelectionBar();
    if(observedTailMessage&&messageTailObserver){messageTailObserver.unobserve(observedTailMessage);observedTailMessage=null;}
    if(!messages.length){list.innerHTML='<div class="ak-chat-empty"><div class="ak-chat-empty-icon">✦</div><strong>Начните разговор</strong><span>Отправьте сообщение, фото или документ.</span></div>';return;}
    list.replaceChildren();
    if(hasOlderMessages){const olderButton=document.createElement('button');olderButton.type='button';olderButton.id='akChatLoadOlder';olderButton.className='ak-chat-load-older';olderButton.disabled=olderMessagesLoading;olderButton.textContent=olderMessagesLoading?'Загрузка…':'Загрузить более ранние сообщения';list.appendChild(olderButton);}
    let previousDay='';
    messages.forEach((message)=>{
      const day=fmtDate(message.created_at);
      if(day!==previousDay){const divider=document.createElement('div');divider.className='ak-chat-date-divider';divider.innerHTML=`<span>${escapeHtml(day)}</span>`;list.appendChild(divider);previousDay=day;}
      const own=String(message.sender_id||'')===String(user.id||''), bubble=document.createElement('article');
      const isSelected=selectedMessageIds.has(String(message.id));
      bubble.className=`ak-chat-message${own?' is-own':''}${forwardingSelectionMode&&isSelected?' is-selected':''}`;bubble.dataset.messageId=message.id;
      const sender=own?'Вы':displayName(message.sender_id), senderRole=own?roleLabels[role]:(roleLabels[usersById.get(message.sender_id)?.role]||'');
      const linked=message.booking_id?bookingsById.get(message.booking_id):null;
      const booking=message.booking_id?`<button type="button" class="ak-chat-message-booking" data-chat-message-booking="${escapeHtml(message.booking_id)}">▧ <span>${escapeHtml(linked?bookingLabel(linked):'Запись слота')}</span></button>`:'';
      const fileRows=attachments.filter((a)=>a.message_id===message.id);
      const fileHtml=fileRows.map((a)=>{
        const url=signedFiles.get(a.id), isImage=String(a.mime_type).startsWith('image/')&&a.mime_type!=='image/heic'&&a.mime_type!=='image/heif';
        if(isImage&&url)return `<a class="ak-chat-image-attachment" href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(a.file_name)}" loading="lazy"></a>`;
        return `<a class="ak-chat-file-attachment${url?'':' is-unavailable'}" ${url?`href="${escapeHtml(url)}" target="_blank" rel="noopener"`:'aria-disabled="true"'}><span class="ak-chat-file-type">${escapeHtml((a.file_name.split('.').pop()||'FILE').slice(0,4).toUpperCase())}</span><span><strong>${escapeHtml(a.file_name)}</strong><small>${fmtBytes(Number(a.file_size)||0)}</small></span><b>↓</b></a>`;
      }).join('');
      const readCount=own?reads.filter((r)=>r.message_id===message.id&&r.user_id!==user.id).length:0;
      const chatKind=getConversation(message.conversation_id)?.kind;
      const statusLabel=chatKind==='general'||chatKind==='group'?(readCount?`Прочитали: ${readCount}`:'Отправлено'):(readCount?'Прочитано адресатом':'Отправлено');
      const status=own?(message.client_pending?'<span class="ak-chat-message-status is-pending">Отправляется…</span>':`<span class="ak-chat-message-status${readCount?' is-read':''}" title="${escapeHtml(statusLabel)}">${readCount?'✓✓':'✓'}</span>`):'';
      const edited=message.edited_at?'<span class="ak-chat-edited">изменено</span>':'';
      const forwarded=message.forwarded_from_message_id?'<div class="ak-chat-forwarded-label">↗ Пересланное сообщение</div>':'';
      const createdAtMs=Date.parse(message.created_at);
      const ageMs=Date.now()-createdAtMs;
      // The database RPC is authoritative; this client-side check only controls menu availability.
      // A small negative tolerance avoids hiding Edit when the browser clock is slightly behind.
      const withinEditWindow=Number.isFinite(createdAtMs)&&ageMs<=10*60*1000&&ageMs>=-2*60*1000;
      const hasEditableContent=String(message.body||'').trim().length>0||fileRows.length>0;
      const canEdit=own&&!message.client_pending&&withinEditWindow&&hasEditableContent;
      const readRows=reads.filter((row)=>String(row.message_id)===String(message.id));
      const readByUser=new Map(readRows.map((row)=>[String(row.user_id),row.read_at]));
      const expectedReaderIds=message.target_user_id
        ? [String(message.target_user_id)]
        : getParticipants(message.conversation_id).map((row)=>String(row.user_id)).filter((id)=>id!==String(message.sender_id));
      const receiptReaderIds=expectedReaderIds.length?expectedReaderIds:[...readByUser.keys()];
      const receiptHtml=receiptReaderIds.length?receiptReaderIds.map((id)=>{
        const readAt=readByUser.get(id);
        return `<div class="ak-chat-read-info-row"><strong>${escapeHtml(displayName(id))}</strong><time>${readAt?escapeHtml(fmtDateTime(readAt)):'Не прочитано'}</time></div>`;
      }).join(''):'<div class="ak-chat-read-info-empty">Отметки о прочтении пока не поступили.</div>';
      const readInfoMenu=own&&!message.client_pending?`<button type="button" role="menuitem" class="ak-chat-message-menu-item" data-chat-read-info-toggle="${escapeHtml(message.id)}"><span>Информация о прочтении</span></button><div class="ak-chat-read-info" hidden>${receiptHtml}</div>`:'';
      const editAction=own?`<button type="button" role="menuitem" class="ak-chat-message-menu-item" data-chat-edit="${escapeHtml(message.id)}" ${canEdit?'':'disabled title="Редактирование доступно в течение 10 минут после отправки."'}><span class="ak-chat-menu-item-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m4 16.5-.8 4.3 4.3-.8L19.8 7.7a2.1 2.1 0 0 0-3-3L4 16.5Z"/><path d="m15.4 6.1 3 3"/></svg></span><span>Редактировать</span></button>`:'';
      const messageMenu=message.client_pending?'':`<div class="ak-chat-message-menu-wrap"><button type="button" class="ak-chat-message-menu-trigger" data-chat-message-menu-toggle aria-label="Действия с сообщением" title="Действия">⋯</button><div class="ak-chat-message-menu" role="menu">${readInfoMenu}<button type="button" role="menuitem" class="ak-chat-message-menu-item" data-chat-forward="${escapeHtml(message.id)}"><span class="ak-chat-menu-item-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14 4h6v6"/><path d="m20 4-9 9"/><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5"/></svg></span><span>Переслать</span></button>${editAction}</div></div>`;
      const selectionControl=forwardingSelectionMode
        ? `<label class="ak-chat-message-select" title="Выбрать сообщение"><input type="checkbox" data-chat-select-message="${escapeHtml(message.id)}" ${isSelected?'checked':''} aria-label="Выбрать сообщение"><span aria-hidden="true"></span></label>`
        : '';
      bubble.innerHTML=`
        ${selectionControl}
        <div class="ak-chat-message-content">
          <div class="ak-chat-message-top"><strong>${escapeHtml(sender)}</strong>${senderRole?`<span>${escapeHtml(senderRole)}</span>`:''}${messageMenu}</div>
          ${forwarded}${booking}
          ${message.body?`<div class="ak-chat-message-text">${escapeHtml(message.body).replace(/\n/g,'<br>')}</div>`:''}
          ${fileHtml?`<div class="ak-chat-message-attachments">${fileHtml}</div>`:''}
          <div class="ak-chat-message-bottom"><time>${escapeHtml(fmtTime(message.created_at))}</time>${edited}${status}</div>
        </div>`;
      list.appendChild(bubble);
    });
    updateForwardSelectionBar();
    observeMessageTail(list.lastElementChild);
  };

  const updateComposer=()=>{
    const input=$('akChatInput');if(!input)return;
    const max=Number(settings?.max_message_chars)||2000;
    const length=input.value.length;
    $('akChatCharCount').textContent=`${length}/${max}`;
    $('akChatCharCount').classList.toggle('is-near-limit',length>max*.9);
    $('akChatSend').disabled=(!input.value.trim()&&!selectedFiles.length)||length>max||isSending||Boolean(editingMessageId);

    // Keep the actual keystroke immediate; measure textarea height once per paint frame.
    if(composerResizeFrame)cancelAnimationFrame(composerResizeFrame);
    composerResizeFrame=requestAnimationFrame(()=>{
      composerResizeFrame=0;
      if(!input.isConnected)return;
      input.style.height='auto';
      const style=window.getComputedStyle(input);
      const minHeight=Math.max(31,parseFloat(style.minHeight)||31);
      const maxHeight=Math.max(minHeight,parseFloat(style.maxHeight)||160);
      const measured=Math.max(minHeight,input.scrollHeight);
      const nextHeight=Math.min(measured,maxHeight);
      input.style.height=`${Math.ceil(nextHeight)}px`;
      input.style.overflowY=measured>maxHeight?'auto':'hidden';
    });
  };

  const uploadFiles=async(files,conversationId)=>{
    const stored=[];
    try{
      for(const file of files){
        const meta=validateFile(file);const path=`${conversationId}/${user.id}/${newId()}-${safeFileName(file.name)}`;
        const {error}=await sb.storage.from('dockslot-chat-files').upload(path,file,{cacheControl:'3600',upsert:false,contentType:meta.mime});
        if(error)throw error;
        stored.push({storage_path:path,file_name:file.name,mime_type:meta.mime,file_size:file.size});
      }
      return stored;
    }catch(error){
      if(stored.length)try{await sb.storage.from('dockslot-chat-files').remove(stored.map((f)=>f.storage_path));}catch(_){}
      throw error;
    }
  };
  const observeMessageTail=(node)=>{
    const list=$('akChatMessageList');
    if(!messageTailObserver||!list)return;
    const next=node||list.lastElementChild;
    if(observedTailMessage===next)return;
    if(observedTailMessage)messageTailObserver.unobserve(observedTailMessage);
    observedTailMessage=next||null;
    if(observedTailMessage)messageTailObserver.observe(observedTailMessage);
  };

  const scrollMessageListToBottom=()=>{
    const list=$('akChatMessageList');
    if(!list)return;
    followMessageTail=true;
    if(bottomScrollFrame)return;
    bottomScrollFrame=requestAnimationFrame(()=>{
      bottomScrollFrame=0;
      if(!isOpen||!list.isConnected||list!==$('akChatMessageList'))return;
      // Use direct scrollTop assignment only. A second frame accounts for layout
      // changes caused by the newly inserted message without starting smooth motion.
      list.scrollTop=list.scrollHeight;
      requestAnimationFrame(()=>{
        if(!isOpen||!list.isConnected||list!==$('akChatMessageList')||!followMessageTail)return;
        const distance=list.scrollHeight-list.clientHeight-list.scrollTop;
        if(distance>1)list.scrollTop=list.scrollHeight;
      });
    });
  };

  const sendMessage=async()=>{
    if(!selectedConversationId||isSending||editingMessageId)return;
    const input=$('akChatInput'),body=String(input?.value||'').trim(),conversation=getConversation(selectedConversationId);
    if(!conversation)return;
    if(!body&&!selectedFiles.length)return;
    const max=Number(settings?.max_message_chars)||2000;if(body.length>max)return toast(`Максимум ${max} символов.`,true);
    if(selectedFiles.length>(Number(settings?.max_attachments_per_message)||10))return toast(`Можно прикрепить не более ${settings.max_attachments_per_message||10} файлов.`,true);

    const sendStartedAt=new Date().toISOString();
    const pendingId=`pending-${newId()}`;
    const bookingDraft=selectedBooking;
    const bookingId=bookingDraft?.id||null;
    const targetUserId=conversation.kind==='direct'?getOtherUser(conversation.id)?.user_id:null;
    const draftFiles=[...selectedFiles];
    const pendingMessage={id:pendingId,conversation_id:conversation.id,sender_id:user.id,body,booking_id:bookingId,
      target_user_id:targetUserId,created_at:sendStartedAt,edited_at:null,forwarded_from_message_id:null,client_pending:true};

    // Clear the composer immediately after creating the optimistic message.
    // This prevents the typed text from remaining visible while the server confirms the send.
    messages=[...messages,pendingMessage].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    if(input)input.value='';
    selectedFiles=[];renderSelectedFiles();setSelectedBooking(null);updateComposer();
    renderMessages();renderConversationList();scrollMessageListToBottom();

    isSending=true;updateComposer();let uploaded=[];
    try{
      uploaded=await uploadFiles(draftFiles,conversation.id);
      const {data:messageId,error}=await sb.rpc('dockslot_chat_send_message',{
        p_conversation_id:conversation.id,p_body:body,p_booking_id:bookingId,
        p_target_user_id:targetUserId,p_files:uploaded
      });
      if(error)throw error;
      if(!messageId)throw new Error('Сервер не вернул идентификатор сообщения.');

      const sentAt=new Date().toISOString();
      const sentMessage={...pendingMessage,id:messageId,created_at:sentAt,client_pending:false};
      if(String(selectedConversationId)===String(conversation.id)){
        messages=messages.map((item)=>item.id===pendingId?sentMessage:item).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
        updateComposer();renderMessages();scrollMessageListToBottom();
      }else{
        messages=messages.filter((item)=>item.id!==pendingId);
      }
      lastMessageByConversation.set(conversation.id,sentMessage);
      conversation.updated_at=sentAt;
      renderConversationList();

      // Load file metadata and signed URLs without blocking the send button or the next message.
      if(uploaded.length){
        void (async()=>{
          try{
            const {data:fileRows,error:fileError}=await sb.from('dockslot_chat_attachments')
              .select('id,message_id,storage_path,file_name,mime_type,file_size').eq('message_id',messageId);
            if(fileError)throw fileError;
            const found=fileRows||[];
            attachments=[...attachments.filter((item)=>!found.some((row)=>row.id===item.id)),...found];
            await Promise.all(found.map(async(attachment)=>{
              try{const {data:link,error:linkError}=await sb.storage.from('dockslot-chat-files').createSignedUrl(attachment.storage_path,3600);if(!linkError&&link?.signedUrl)signedFiles.set(attachment.id,link.signedUrl);}catch(_){}
            }));
            if(isOpen&&selectedConversationId===conversation.id)renderMessages();
          }catch(fileError){console.warn('[DockSlot chat] Attachment preview will refresh on the next update.',fileError?.message||fileError);}
        })();
      }
      queueRefreshData(false);
    }catch(error){
      messages=messages.filter((item)=>item.id!==pendingId);
      const stillInConversation=String(selectedConversationId)===String(conversation.id);
      if(stillInConversation){renderMessages();renderConversationList();}
      if(uploaded.length)try{await sb.storage.from('dockslot-chat-files').remove(uploaded.map((f)=>f.storage_path));}catch(_){}
      // Restore the draft only in the conversation where it was composed.
      if(stillInConversation&&input&&!String(input.value||'').trim())input.value=body;
      if(stillInConversation&&!selectedFiles.length&&draftFiles.length)selectedFiles=draftFiles;
      if(stillInConversation&&!selectedBooking&&bookingDraft)setSelectedBooking(bookingDraft);
      if(stillInConversation){renderSelectedFiles();updateComposer();scrollMessageListToBottom();}
      console.error('[DockSlot chat] Message send failed:',error);toast(error?.message||'Не удалось отправить сообщение.',true);
      // Reconcile once: the database may have committed the message even if the HTTP response was lost.
      queueRefreshData(true);
    }finally{isSending=false;updateComposer();input?.focus();}
  };

  const onFilesSelected=(event)=>{
    const incoming=Array.from(event.target.files||[]);event.target.value='';
    try{
      const all=[...selectedFiles,...incoming];
      if(all.length>(Number(settings?.max_attachments_per_message)||10))throw new Error(`Можно прикрепить не более ${settings.max_attachments_per_message||10} файлов.`);
      all.forEach(validateFile);selectedFiles=all;renderSelectedFiles();updateComposer();
    }catch(error){toast(error.message,true);}
  };
  const renderSelectedFiles=()=>{
    const row=$('akChatFilesRow');if(!row)return;row.replaceChildren();row.hidden=!selectedFiles.length;
    selectedFiles.forEach((file,index)=>{
      const chip=document.createElement('span');chip.className='ak-chat-file-chip';
      chip.innerHTML=`<span>${escapeHtml(file.name)}</span><small>${fmtBytes(file.size)}</small><button type="button" aria-label="Убрать файл">×</button>`;
      chip.querySelector('button').addEventListener('click',()=>{selectedFiles.splice(index,1);renderSelectedFiles();updateComposer();});row.appendChild(chip);
    });
  };

  const toggleChatSearch=()=>{
    const panel=$('akChatSearchPanel');if(!panel)return;
    panel.hidden=!panel.hidden;
    if(!panel.hidden){$('akChatSearchInput').value='';$('akChatSearchResults').hidden=true;$('akChatSearchInput').focus();}
    else closeChatSearch();
  };
  const closeChatSearch=()=>{
    const panel=$('akChatSearchPanel');if(panel)panel.hidden=true;
    if($('akChatSearchInput'))$('akChatSearchInput').value='';
    if($('akChatSearchResults')){$('akChatSearchResults').hidden=true;$('akChatSearchResults').replaceChildren();}
    chatSearchRows=[];window.clearTimeout(chatSearchTimer);
  };
  const onChatSearchInput=()=>{
    window.clearTimeout(chatSearchTimer);
    chatSearchTimer=window.setTimeout(()=>void runChatSearch(),260);
  };
  const runChatSearch=async()=>{
    const query=String($('akChatSearchInput')?.value||'').trim();
    const results=$('akChatSearchResults');if(!results)return;
    if(query.length<2){results.hidden=true;results.replaceChildren();return;}
    results.hidden=false;results.innerHTML='<div class="ak-chat-search-state">Ищем сообщения…</div>';
    try{
      const safeQuery=query.replace(/[\%_]/g,'\\$&');
      const {data,error}=await sb.from('dockslot_chat_messages')
        .select('id,conversation_id,sender_id,body,created_at,booking_id,edited_at,forwarded_from_message_id')
        .eq('conversation_id',selectedConversationId).gte('created_at',sixMonthsAgo())
        .ilike('body',`%${safeQuery}%`).order('created_at',{ascending:false}).limit(50);
      if(error)throw error;
      chatSearchRows=data||[];results.replaceChildren();
      if(!chatSearchRows.length){results.innerHTML='<div class="ak-chat-search-state">Совпадений не найдено.</div>';return;}
      chatSearchRows.forEach((row)=>{
        const button=document.createElement('button');button.type='button';button.className='ak-chat-search-result';
        button.innerHTML=`<strong>${escapeHtml(displayName(row.sender_id))}</strong><span>${escapeHtml(String(row.body||'').slice(0,180))}</span><time>${escapeHtml(fmtDate(row.created_at))} · ${escapeHtml(fmtTime(row.created_at))}</time>`;
        button.addEventListener('click',()=>void jumpToSearchResult(row));results.appendChild(button);
      });
    }catch(error){results.innerHTML=`<div class="ak-chat-search-state is-error">Ошибка поиска: ${escapeHtml(error?.message||'не удалось выполнить запрос')}</div>`;}
  };
  const jumpToSearchResult=async(hit)=>{
    try{
      const {data:before,error:beforeError}=await sb.from('dockslot_chat_messages')
        .select('id,conversation_id,sender_id,body,booking_id,target_user_id,created_at,edited_at,forwarded_from_message_id')
        .eq('conversation_id',selectedConversationId).gte('created_at',sixMonthsAgo()).lte('created_at',hit.created_at)
        .order('created_at',{ascending:false}).limit(35);
      if(beforeError)throw beforeError;
      const {data:after,error:afterError}=await sb.from('dockslot_chat_messages')
        .select('id,conversation_id,sender_id,body,booking_id,target_user_id,created_at,edited_at,forwarded_from_message_id')
        .eq('conversation_id',selectedConversationId).gte('created_at',sixMonthsAgo()).gt('created_at',hit.created_at)
        .order('created_at',{ascending:true}).limit(15);
      if(afterError)throw afterError;
      const merged=new Map([...(before||[]),...(after||[])].map(row=>[row.id,row]));
      merged.set(hit.id,{...(merged.get(hit.id)||{}),...hit});
      messages=[...merged.values()].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
      hasOlderMessages=(before||[]).length===35;bookingsById=new Map();
      const ids=messages.map(row=>row.id), bookingIds=[...new Set(messages.map(row=>row.booking_id).filter(Boolean))];
      const tasks=[
        sb.from('dockslot_chat_message_reads').select('message_id,user_id,read_at').in('message_id',ids),
        sb.from('dockslot_chat_attachments').select('id,message_id,storage_path,file_name,mime_type,file_size').in('message_id',ids)
      ];
      if(bookingIds.length)tasks.push(sb.from('bookings').select('id,slot_date,slot_hour,order_number,profiles(company_name)').in('id',bookingIds));
      const results=await Promise.all(tasks);results.forEach((result)=>{if(result.error)throw result.error;});
      reads=results[0].data||[];attachments=results[1].data||[];signedFiles=new Map();
      (results[2]?.data||[]).forEach(row=>bookingsById.set(row.id,row));
      await Promise.all(attachments.map(async(file)=>{try{const {data,error}=await sb.storage.from('dockslot-chat-files').createSignedUrl(file.storage_path,3600);if(!error&&data?.signedUrl)signedFiles.set(file.id,data.signedUrl);}catch(_){}}));
      closeChatSearch();renderMessages();
      requestAnimationFrame(()=>{
        const target=$('akChatMessageList')?.querySelector(`[data-message-id="${CSS.escape(String(hit.id))}"]`);
        if(target){target.scrollIntoView({behavior:'auto',block:'center'});target.classList.add('is-search-hit');window.setTimeout(()=>target.classList.remove('is-search-hit'),2400);}
      });
    }catch(error){toast(error?.message||'Не удалось открыть найденное сообщение.',true);}
  };

  const onMessageListClick=async(event)=>{
    if(!event.target.closest('[data-chat-message-menu-toggle],.ak-chat-message-menu-wrap')) $('akChatMessageList')?.querySelectorAll('.ak-chat-message-menu-wrap.is-open').forEach((node)=>node.classList.remove('is-open'));
    const olderButton=event.target.closest('#akChatLoadOlder');if(olderButton){void loadOlderMessages();return;}
    const bookingButton=event.target.closest('[data-chat-message-booking]');if(bookingButton){void openBookingFromMessage(bookingButton.dataset.chatMessageBooking);return;}
    const menuToggle=event.target.closest('[data-chat-message-menu-toggle]');
    if(menuToggle){
      const wrap=menuToggle.closest('.ak-chat-message-menu-wrap');
      const open=!wrap?.classList.contains('is-open');
      $('akChatMessageList')?.querySelectorAll('.ak-chat-message-menu-wrap.is-open').forEach((node)=>node.classList.remove('is-open'));
      wrap?.classList.toggle('is-open',open);return;
    }
    const readInfoToggle=event.target.closest('[data-chat-read-info-toggle]');
    if(readInfoToggle){
      const panel=readInfoToggle.parentElement?.querySelector('.ak-chat-read-info');
      if(panel)panel.hidden=!panel.hidden;
      return;
    }
    const forwardButton=event.target.closest('[data-chat-forward]');
    if(forwardButton){
      selectedMessageIds.clear();
      selectedMessageIds.add(String(forwardButton.dataset.chatForward));
      forwardingSelectionMode=true;
      forwardButton.closest('.ak-chat-message-menu-wrap')?.classList.remove('is-open');
      renderMessages();
      updateForwardSelectionBar();
      toast('Отметьте сообщения для пересылки. Первое сообщение уже выбрано.');
      return;
    }
    const editButton=event.target.closest('[data-chat-edit]');if(editButton){const message=messages.find((m)=>m.id===editButton.dataset.chatEdit);editButton.closest('.ak-chat-message-menu-wrap')?.classList.remove('is-open');if(message)startEditing(message);}
  };
  const clearMessageSelection=()=>{
    selectedMessageIds.clear();
    forwardingSelectionMode=false;
    updateForwardSelectionBar();
  };

  const startEditing=(message)=>{
    const createdAtMs=Date.parse(message?.created_at);
    const ageMs=Date.now()-createdAtMs;
    if(String(message?.sender_id||'')!==String(user?.id||'')||!Number.isFinite(createdAtMs)||ageMs>10*60*1000||ageMs< -2*60*1000){
      return toast('Редактировать своё сообщение можно только в течение 10 минут после отправки.',true);
    }
    editingMessageId=message.id;$('akChatInput').value=message.body||'';$('akChatEditPanel').hidden=false;updateComposer();$('akChatInput').focus();
  };
  const cancelEditing=()=>{editingMessageId=null;if($('akChatEditPanel'))$('akChatEditPanel').hidden=true;if($('akChatInput'))$('akChatInput').value='';updateComposer();};
  const saveEditedMessage=async()=>{
    if(!editingMessageId)return;
    const body=String($('akChatInput').value||'');
    const hasFiles=attachments.some((file)=>file.message_id===editingMessageId);
    if(!body.trim()&&!hasFiles)return toast('Текст сообщения не может быть пустым, если к нему не прикреплён файл.',true);
    const id=editingMessageId;$('akChatEditSave').disabled=true;
    try{const {error}=await sb.rpc('dockslot_chat_edit_message',{p_message_id:id,p_body:body});if(error)throw error;cancelEditing();await loadSelectedMessages();toast('Сообщение изменено.');}
    catch(error){toast(error?.message||'Не удалось изменить сообщение.',true);}
    finally{$('akChatEditSave').disabled=false;}
  };

  const loadRecipientUsers=async()=>{
    const list=$('akChatPickerList');
    if(list)list.innerHTML='<div class="ak-chat-picker-empty">Загружаем сотрудников…</div>';
    const {data,error}=await sb.rpc('dockslot_chat_list_users');
    if(error){
      userRows=[];
      if(list)list.innerHTML='<div class="ak-chat-picker-empty is-error">Не удалось загрузить список сотрудников. Проверьте доступ к мессенджеру и повторите попытку.</div>';
      console.warn('[DockSlot chat] Recipient list load failed:',error.message||error);
      return;
    }
    userRows=Array.isArray(data)?data:[];
    for(const row of userRows)usersById.set(row.user_id,row);
  };
  const openPicker=async(mode, bookingContext=null)=>{
    pickerMode=mode;selectedRecipientIds.clear();presetGroupTitle=null;
    bookingDiscussionContext=mode==='booking-recipients'?(bookingContext||null):null;
    const picker=$('akChatPicker');picker.hidden=false;
    const titles={recipients:'Новое сообщение · получатели',booking:'Привязать запись слота',forward:'Переслать выбранные сообщения','booking-recipients':'Обсудить запись · выберите адресатов'};
    $('akChatPickerTitle').textContent=titles[mode]||'Выберите';
    $('akChatPickerSearch').placeholder=mode==='booking'?'Поиск по поставщику или номеру документа…':'Поиск по наименованию компании…';
    $('akChatPickerShortcuts').hidden=!['recipients','booking-recipients'].includes(mode);
    $('akChatPickerGroupsSection')?.toggleAttribute('hidden',!['recipients','booking-recipients'].includes(mode));
    $('akChatPickerPeopleTitle').textContent=mode==='booking-recipients'?'Сотрудники для обсуждения записи':'Личные сообщения сотрудникам';
    $('akChatPickerFooter').hidden=mode==='booking';
    if(mode==='booking')await loadBookingsForPicker();
    else if(mode==='recipients'||mode==='booking-recipients'){await loadRecipientUsers();renderPickerList();}
    else renderPickerList();
    $('akChatPickerSearch').focus();
  };
  const loadBookingsForPicker=async()=>{
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const shift=(iso,offset)=>{const [y,m,d]=iso.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d+offset));return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;};
    const {data,error}=await sb.from('bookings').select('id,slot_date,slot_hour,order_number,profiles(company_name)')
      .eq('status','active').gte('slot_date',shift(today,-30)).lte('slot_date',shift(today,30))
      .order('slot_date',{ascending:true}).order('slot_hour',{ascending:true}).limit(200);
    if(error){toast('Не удалось загрузить записи для привязки.',true);pickerBookings=[];}else pickerBookings=data||[];
    renderPickerList();
  };
  const renderPickerList=()=>{
    const query=String($('akChatPickerSearch')?.value||'').toLocaleLowerCase('ru-RU').trim(),list=$('akChatPickerList');if(!list)return;list.replaceChildren();
    if(pickerMode==='booking'){
      const matches=pickerBookings.filter((b)=>`${bookingLabel(b)} ${b.order_number||''}`.toLocaleLowerCase('ru-RU').includes(query));
      if(!matches.length)list.innerHTML='<div class="ak-chat-picker-empty">Активные записи за выбранный период не найдены.</div>';
      matches.forEach((b)=>{const button=document.createElement('button');button.type='button';button.className='ak-chat-picker-item';button.innerHTML=`<span class="ak-chat-picker-avatar is-slot">▧</span><span><strong>${escapeHtml(bookingLabel(b))}</strong><small>${escapeHtml(b.order_number?`Документ: ${b.order_number}`:`ID ${String(b.id).slice(0,8)}`)}</small></span><b>＋</b>`;button.addEventListener('click',()=>{setSelectedBooking(b);closePicker();});list.appendChild(button);});return;
    }
    const bookingDiscussion=pickerMode==='booking-recipients';
    if(settings?.enabled!==true||settings?.direct_chat_enabled!==true){
      const reason=settings?.enabled!==true
        ? 'Мессенджер сейчас выключен в настройках. Включите его на странице управления, чтобы выбирать сотрудников и начинать переписку.'
        : 'Личные и групповые чаты отключены суперадминистратором.';
      list.innerHTML=`<div class="ak-chat-picker-empty is-muted">${escapeHtml(reason)}</div>`;
      $('akChatPickerShortcuts')?.querySelectorAll('button').forEach((button)=>button.disabled=true);
      updatePickerCount();return;
    }
    $('akChatPickerShortcuts')?.querySelectorAll('button').forEach((button)=>button.disabled=false);
    const allowedRoles=bookingDiscussion?new Set(['admin','operator']):new Set(['admin','super_admin','operator']);
    const matches=userRows.filter((row)=>row.user_id!==user.id&&allowedRoles.has(String(row.role||'').toLowerCase())&&`${row.company_name||''} ${roleLabels[row.role]||row.role}`.toLocaleLowerCase('ru-RU').includes(query));
    if(!matches.length)list.innerHTML=bookingDiscussion
      ? '<div class="ak-chat-picker-empty">Нет сотрудников УТЗ или РЦ с разрешённым доступом к мессенджеру.</div>'
      : '<div class="ak-chat-picker-empty">Нет сотрудников с ролью admin, super_admin или operator и включённым доступом к личным сообщениям.</div>';
    matches.forEach((row)=>{
      const label=document.createElement('label');label.className='ak-chat-picker-item is-selectable';
      const employeeName=String(row.company_name||'Без наименования');
      label.innerHTML=`<span class="ak-chat-picker-avatar">${escapeHtml(employeeName[0].toLocaleUpperCase('ru-RU'))}</span><span><strong>${escapeHtml(employeeName)}</strong><small>${escapeHtml(roleLabels[row.role]||row.role)}</small></span><input type="checkbox" data-recipient-id="${row.user_id}" ${selectedRecipientIds.has(row.user_id)?'checked':''}>`;
      label.querySelector('input').addEventListener('change',(event)=>{
        presetGroupTitle=null;
        if(event.target.checked){
          if(selectedRecipientIds.size>=200){event.target.checked=false;toast('В одной переписке можно выбрать не более 200 получателей.',true);return;}
          selectedRecipientIds.add(row.user_id);
        }else selectedRecipientIds.delete(row.user_id);
        updatePickerCount();
      });
      list.appendChild(label);
    });updatePickerCount();
  };
  const updatePickerCount=()=>{
    $('akChatPickerSelected').textContent=`Выбрано: ${selectedRecipientIds.size}`;
    $('akChatPickerAction').textContent=pickerMode==='forward'?'Переслать сообщения':pickerMode==='booking-recipients'?`Начать обсуждение (${selectedRecipientIds.size})`:`Открыть чат (${selectedRecipientIds.size})`;
    $('akChatPickerAction').disabled=!selectedRecipientIds.size;
  };
  const closePicker=()=>{
    if($('akChatPicker'))$('akChatPicker').hidden=true;
    if(pickerMode==='booking-recipients')bookingDiscussionContext=null;
  };
  const pickerAction=async()=>{
    const ids=[...selectedRecipientIds];if(!ids.length)return;
    if(pickerMode==='recipients')await createConversationForUsers(ids,presetGroupTitle);
    else if(pickerMode==='booking-recipients')await createBookingDiscussion(ids,presetGroupTitle,bookingDiscussionContext);
    else if(pickerMode==='forward')await forwardSelectedMessages(ids);
  };
  const createConversationForUsers=async(ids,groupTitle=null)=>{
    try{
      const title=groupTitle || (ids.length>1?`Группа · ${ids.length+1} участников`:null);
      const {data,error}=await sb.rpc('dockslot_chat_create_group',{p_user_ids:ids,p_title:title});if(error)throw error;
      closePicker();await refreshData(false);selectedConversationId=data;clearMessageSelection();setSelectedBooking(null);renderConversationList();await renderSelectedConversation();
    }catch(error){toast(error?.message||'Не удалось создать переписку.',true);}
  };
  const createBookingDiscussion=async(ids,groupTitle,bookingContext)=>{
    if(!bookingContext?.id)return toast('Не удалось определить запись для обсуждения.',true);
    try{
      const title=groupTitle || (ids.length>1?`Группа · ${ids.length+1} участников`:null);
      $('akChatPickerAction').disabled=true;$('akChatPickerAction').textContent='Открываем чат…';
      const {data,error}=await sb.rpc('dockslot_chat_create_booking_discussion',{
        p_user_ids:ids,p_booking_id:bookingContext.id,p_title:title
      });
      if(error)throw error;
      closePicker();bookingDiscussionContext=null;
      await refreshData(false);selectedConversationId=data;clearMessageSelection();
      setSelectedBooking(bookingContext);renderConversationList();await renderSelectedConversation();
      $('akChatInput')?.focus();
      toast('Переписка открыта. Сообщение будет привязано к записи слота.');
    }catch(error){toast(error?.message||'Не удалось начать обсуждение записи.',true);}
    finally{if($('akChatPickerAction'))$('akChatPickerAction').disabled=!selectedRecipientIds.size;}
  };

  const forwardSelectedMessages=async(recipientIds)=>{
    const sourceIds=messages.filter((m)=>selectedMessageIds.has(m.id)).map((m)=>m.id);if(!sourceIds.length)return;
    let pendingUploads=[], targetId=null, forwardedCount=0;
    try{
      $('akChatPickerAction').disabled=true;$('akChatPickerAction').textContent='Пересылка…';
      const title=recipientIds.length>1?`Группа · ${recipientIds.length+1} участников`:null;
      const {data,error:createError}=await sb.rpc('dockslot_chat_create_group',{p_user_ids:recipientIds,p_title:title});if(createError)throw createError;
      targetId=data;
      for(const sourceId of sourceIds){
        const sourceFiles=attachments.filter((a)=>a.message_id===sourceId);const targetFiles=[];
        for(const attachment of sourceFiles){
          const {data:download,error:downloadError}=await sb.storage.from('dockslot-chat-files').download(attachment.storage_path);
          if(downloadError)throw downloadError;
          const newPath=`${targetId}/${user.id}/${newId()}-${safeFileName(attachment.file_name)}`;
          const {error:uploadError}=await sb.storage.from('dockslot-chat-files').upload(newPath,download,{cacheControl:'3600',upsert:false,contentType:attachment.mime_type});if(uploadError)throw uploadError;
          pendingUploads.push(newPath);
          targetFiles.push({storage_path:newPath,file_name:attachment.file_name,mime_type:attachment.mime_type,file_size:attachment.file_size});
        }
        const {error:forwardError}=await sb.rpc('dockslot_chat_forward_message',{p_source_message_id:sourceId,p_target_conversation_id:targetId,p_files:targetFiles});
        if(forwardError)throw forwardError;
        const committedPaths=new Set(targetFiles.map((file)=>file.storage_path));
        pendingUploads=pendingUploads.filter((path)=>!committedPaths.has(path));
        forwardedCount+=1;
      }
      closePicker();clearMessageSelection();await refreshData(false);selectedConversationId=targetId;renderConversationList();await renderSelectedConversation();toast(`Переслано сообщений: ${sourceIds.length}`);
    }catch(error){
      if(pendingUploads.length)try{await sb.storage.from('dockslot-chat-files').remove(pendingUploads);}catch(_){}
      if(targetId&&forwardedCount>0){
        closePicker();clearMessageSelection();await refreshData(false);selectedConversationId=targetId;renderConversationList();await renderSelectedConversation();
        toast(`Переслано ${forwardedCount} из ${sourceIds.length}. Остальные сообщения не отправлены: ${error?.message||'ошибка'}`,true);
      }else toast(error?.message||'Не удалось переслать сообщения.',true);
    }
    finally{if($('akChatPickerAction'))$('akChatPickerAction').disabled=false;}
  };

  const setSelectedBooking=(booking)=>{
    selectedBooking=booking||null;const row=$('akChatBookingRow');if(row)row.hidden=!selectedBooking;
    if(selectedBooking)$('akChatBookingLabel').textContent=bookingLabel(selectedBooking);
  };
  const loadBookingById=async(id)=>{
    const {data,error}=await sb.from('bookings').select('id,slot_date,slot_hour,order_number,profiles(company_name)').eq('id',id).maybeSingle();
    if(error)console.warn('[DockSlot chat] Booking lookup failed:',error.message);return data||{id};
  };
  const closeBookingDiscussPopover=()=>{
    if(bookingDiscussPopoverCleanup){bookingDiscussPopoverCleanup();bookingDiscussPopoverCleanup=null;}
    bookingDiscussPopover?.remove();bookingDiscussPopover=null;
  };
  const openBookingDiscussion=async(bookingId)=>{
    if(!settings?.booking_chat_enabled||!settings?.direct_chat_enabled){toast('Обсуждение записей сейчас отключено.',true);return;}
    const booking=await loadBookingById(bookingId);
    if(!booking?.id){toast('Не удалось загрузить запись слота.',true);return;}
    await openChat();
    await openPicker('booking-recipients',booking);
  };
  const showBookingDiscussPopover=(marker,bookingId)=>{
    if(!settings?.booking_chat_enabled||!settings?.direct_chat_enabled){toast('Обсуждение записей сейчас отключено.',true);return;}
    closeBookingDiscussPopover();
    const rect=marker.getBoundingClientRect(),popover=document.createElement('div');
    popover.className='ak-chat-booking-discuss-popover';
    popover.setAttribute('role','dialog');
    popover.innerHTML='<button type="button" data-chat-discuss-start><span class="ak-chat-discuss-popover-icon">▧</span><span><strong>Обсудить запись</strong><small>Выбрать сотрудников или группу</small></span><span class="ak-chat-discuss-popover-arrow">›</span></button>';
    document.body.appendChild(popover);bookingDiscussPopover=popover;
    const width=Math.min(238,window.innerWidth-20),height=58;
    const left=Math.max(10,Math.min(window.innerWidth-width-10,rect.left+rect.width/2-width/2));
    const below=rect.bottom+7;
    const top=below+height+10<=window.innerHeight?below:Math.max(10,rect.top-height-7);
    popover.style.left=`${left}px`;popover.style.top=`${top}px`;
    popover.querySelector('[data-chat-discuss-start]')?.addEventListener('click',()=>{
      closeBookingDiscussPopover();void openBookingDiscussion(bookingId);
    });
    const onOutside=(event)=>{if(bookingDiscussPopover&&!bookingDiscussPopover.contains(event.target)&&event.target!==marker)closeBookingDiscussPopover();};
    const onEscape=(event)=>{if(event.key==='Escape')closeBookingDiscussPopover();};
    const onScroll=()=>closeBookingDiscussPopover();
    document.addEventListener('pointerdown',onOutside,true);
    document.addEventListener('keydown',onEscape,true);
    window.addEventListener('scroll',onScroll,true);
    bookingDiscussPopoverCleanup=()=>{
      document.removeEventListener('pointerdown',onOutside,true);
      document.removeEventListener('keydown',onEscape,true);
      window.removeEventListener('scroll',onScroll,true);
    };
  };
  const openBookingFromMessage=async(id)=>{
    const booking=await loadBookingById(id);closeChat();
    if(booking?.slot_date){const url=new URL('admin_day.html',window.location.href);url.searchParams.set('date',booking.slot_date);url.searchParams.set('booking_id',id);window.location.href=url.toString();}
  };
  const updateBookingMarkers=()=>{
    const cards=document.querySelectorAll('.slot-box[data-chat-booking-id], .overview-booking-row[data-chat-booking-id]');
    if(!cards.length)return;
    const linksByBooking=new Map((bookingLinks||[]).map((row)=>[String(row.booking_id),row]));
    cards.forEach((card)=>{
      const id=String(card.dataset.chatBookingId||'');if(!id)return;
      let marker=card.querySelector('.ak-chat-booking-link');
      if(!marker){
        marker=document.createElement('button');marker.type='button';marker.className='ak-chat-booking-link is-disabled';
        marker.setAttribute('aria-label','Нет адресного сообщения по этой записи');
        marker.title='Нет адресного сообщения по этой записи';marker.disabled=true;
        marker.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.4a8.5 8.5 0 0 1-8.7 8.1 9.5 9.5 0 0 1-3.8-.8L3 20l1.4-4.3a7.8 7.8 0 0 1-1.1-4.3A8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 8.5 8.4Z"/><path d="M8 11.5h.1m3.9 0h.1m3.9 0h.1"/></svg>';
        const statusIcons=card.querySelector('.sb-status-icons');
        const verify=statusIcons?.querySelector('.booking-verify,.overview-verify-btn,[data-verify-booking]');
        if(statusIcons)statusIcons.insertBefore(marker,verify||statusIcons.firstChild);
        else {
          const verifyButton=card.querySelector('.overview-verify-btn,[data-verify-booking]');
          if(verifyButton)verifyButton.before(marker);
          else (card.querySelector('.overview-booking-main')||card).appendChild(marker);
        }
      }
      const info=linksByBooking.get(id);
      const canDiscuss=!info&&Boolean(settings?.booking_chat_enabled&&settings?.direct_chat_enabled);
      marker.disabled=!info&&!canDiscuss;
      marker.classList.toggle('is-active',Boolean(info));
      marker.classList.toggle('is-discussable',canDiscuss);
      marker.classList.toggle('is-disabled',!info&&!canDiscuss);
      marker.title=info?'Открыть переписку по этой записи':(canDiscuss?'Обсудить запись':'Обсуждение записей отключено');
      marker.setAttribute('aria-label',marker.title);
      marker.onclick=info
        ?(event)=>{event.preventDefault();event.stopPropagation();closeBookingDiscussPopover();void openChat(info.conversation_id,null,info.message_id);}
        :canDiscuss
          ?(event)=>{event.preventDefault();event.stopPropagation();showBookingDiscussPopover(marker,id);}
          :null;
    });
  };
  const focusLinkedBookingCard=()=>{
    const params=new URLSearchParams(window.location.search),id=params.get('booking_id');if(!id)return;
    const card=Array.from(document.querySelectorAll('.slot-box[data-chat-booking-id], .overview-booking-row[data-chat-booking-id]')).find((node)=>node.dataset.chatBookingId===id);if(!card)return;
    card.classList.add('ak-chat-slot-target');card.scrollIntoView({behavior:'smooth',block:'center'});
    window.setTimeout(()=>card.classList.remove('ak-chat-slot-target'),4200);params.delete('booking_id');const q=params.toString();window.history.replaceState({},'',`${window.location.pathname}${q?`?${q}`:''}${window.location.hash}`);
  };
  const watchBookingCards=()=>{
    const containers=[document.getElementById('hoursContainer'),document.getElementById('bookingList')||document.querySelector('.overview-booking-list')].filter(Boolean);
    if(typeof MutationObserver!=='function')return; bookingObserver?.disconnect();bookingObserver=new MutationObserver(()=>{updateBookingMarkers();focusLinkedBookingCard();});
    containers.forEach((container)=>bookingObserver.observe(container,{childList:true,subtree:true}));
    updateBookingMarkers();focusLinkedBookingCard();
  };
  const clearSession=()=>{
    closeBookingDiscussPopover();
    window.clearInterval(pollTimer);window.clearTimeout(refreshDebounceTimer);if(bottomScrollFrame)cancelAnimationFrame(bottomScrollFrame);if(composerResizeFrame)cancelAnimationFrame(composerResizeFrame);messageTailObserver?.disconnect();messageTailObserver=null;observedTailMessage=null;bottomScrollFrame=0;composerResizeFrame=0;messageLoadSequence++;refreshDebounceTimer=null;queuedRefreshThread=false;queuedForceThreadBottom=false;bookingObserver?.disconnect();bookingObserver=null;
    document.querySelectorAll('.ak-chat-slot-marker').forEach((node)=>node.remove());
    if(realtimeChannel){try{void sb.removeChannel(realtimeChannel);}catch(_){}realtimeChannel=null;}
    user=null;role='';isOpen=false;$('akChatFab')?.remove();$('akChatOverlay')?.remove();$('akChatToast')?.remove();
  };
  if(typeof sb.auth.onAuthStateChange==='function')sb.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'||!session?.user?.id)clearSession();
    else if(user?.id&&String(session.user.id)!==String(user.id)){clearSession();window.setTimeout(()=>void init(),0);}
  });
  window.dockslotChat={open:(conversationId,bookingId,messageId)=>openChat(conversationId,bookingId,messageId),refresh:()=>refreshData(isOpen)};
  init();
});
