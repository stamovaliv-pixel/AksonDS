/* DockSlot Messenger v1.4 — message actions, search, nav notifications and soft launcher glow. */
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
  const reactionDefs = [
    ['heart', '❤️', 'Сердце'], ['like', '👍', 'Класс'], ['cry', '🥺', 'Трогает'],
    ['laugh', '😄', 'Смеюсь'], ['rofl', '🤣', 'Ржу'], ['strong', '💪', 'Сила'], ['fire', '🔥', 'Огонь']
  ];
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
  let messages = [], reads = [], attachments = [], reactions = [], signedFiles = new Map();
  let lastMessageByConversation = new Map(), bookingsById = new Map();
  let unreadByConversation = new Map(), bookingUnread = [];
  let selectedConversationId = null, selectedBooking = null;
  let selectedFiles = [], selectedMessageIds = new Set(), selectedRecipientIds = new Set();
  let pickerBookings = [], pickerMode = '', presetGroupTitle = null, editingMessageId = null;
  let hasOlderMessages = false, olderMessagesLoading = false;
  let chatSearchTimer = null, chatSearchRows = [];
  let realtimeChannel = null, pollTimer = null, bookingObserver = null;
  let isOpen = false, isSending = false, loading = false;
  let refreshDebounceTimer = null, queuedRefreshThread = false;
  let bottomScrollRevision = 0;

  const getConversation = (id) => conversations.find((row) => row.id === id) || null;
  const getParticipants = (conversationId) => participants.filter((row) => row.conversation_id === conversationId);
  const getOtherUser = (conversationId) => {
    const row = getParticipants(conversationId).find((item) => item.user_id !== user?.id);
    return row ? usersById.get(row.user_id) || { user_id: row.user_id, display_name: 'Сотрудник DockSlot', role: '' } : null;
  };
  const displayName = (id) => id === user?.id
    ? String(user.user_metadata?.full_name || user.user_metadata?.name || 'Вы')
    : (usersById.get(id)?.display_name || 'Сотрудник DockSlot');
  const fmtTime = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ru-RU', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Moscow' }).format(date) : '';
  };
  const fmtDate = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ru-RU', { day:'numeric', month:'long', year:'numeric', timeZone:'Europe/Moscow' }).format(date) : '';
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
    if (conversation.kind === 'direct') return getOtherUser(conversation.id)?.display_name || 'Личный диалог';
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
          <div class="ak-chat-picker-shortcuts" id="akChatPickerShortcuts"><button type="button" data-role-group="admin">УТЗ</button><button type="button" data-role-group="operator">РЦ</button></div>
          <div id="akChatPickerList" class="ak-chat-picker-list"></div>
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
      const targetRole=button.dataset.roleGroup; presetGroupTitle=targetRole==='admin'?'УТЗ':'РЦ'; selectedRecipientIds=new Set(userRows.filter((row)=>row.role===targetRole&&row.user_id!==user.id).map((row)=>row.user_id));
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
    $('akChatMessageList').addEventListener('click', onMessageListClick);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && isOpen) { if (!$('akChatPicker').hidden) closePicker(); else closeChat(); } });
  };

  const openChat = async (conversationId = null, bookingId = null) => {
    if (!$('akChatOverlay')) return;
    isOpen = true; $('akChatOverlay').hidden = false;
    requestAnimationFrame(() => $('akChatOverlay')?.classList.add('is-open'));
    $('akChatFab')?.setAttribute('aria-expanded','true');
    if (bookingId) setSelectedBooking(await loadBookingById(bookingId));
    if (conversationId) selectedConversationId = conversationId;
    if (!selectedConversationId) selectedConversationId = conversations.find((c) => c.kind==='general')?.id || conversations[0]?.id || null;
    renderConversationList(); await renderSelectedConversation();
  };
  const closeChat = () => {
    isOpen = false; $('akChatOverlay')?.classList.remove('is-open'); $('akChatFab')?.setAttribute('aria-expanded','false');
    window.setTimeout(() => { if (!isOpen && $('akChatOverlay')) $('akChatOverlay').hidden = true; },190);
    closePicker();
  };
  const queueRefreshData = (refreshThread = false) => {
    queuedRefreshThread = queuedRefreshThread || Boolean(refreshThread);
    window.clearTimeout(refreshDebounceTimer);
    refreshDebounceTimer = window.setTimeout(async () => {
      if (loading) { queueRefreshData(queuedRefreshThread); return; }
      const shouldRefreshThread = queuedRefreshThread;
      queuedRefreshThread = false;
      await refreshData(shouldRefreshThread);
    }, 380);
  };
  const startPolling = () => { window.clearInterval(pollTimer); pollTimer = window.setInterval(() => queueRefreshData(isOpen),45000); };
  const setupRealtime = () => {
    if (!sb.channel || realtimeChannel) return;
    realtimeChannel = sb.channel(`dockslot-chat-${user.id}`)
      .on('postgres_changes',{event:'*',schema:'public',table:'dockslot_chat_messages'},()=>queueRefreshData(isOpen))
      .on('postgres_changes',{event:'*',schema:'public',table:'dockslot_chat_message_reads'},()=>queueRefreshData(isOpen))
      .on('postgres_changes',{event:'*',schema:'public',table:'dockslot_chat_attachments'},()=>queueRefreshData(isOpen))
      .on('postgres_changes',{event:'*',schema:'public',table:'dockslot_chat_message_reactions'},()=>queueRefreshData(isOpen))
      .subscribe((status)=>{ if(status==='CHANNEL_ERROR'||status==='TIMED_OUT') console.warn('[DockSlot chat] Realtime unavailable; polling remains active.'); });
  };

  const refreshData = async (refreshThread = false) => {
    if (loading || !user) return;
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
      const [userResult, convResult, unreadResult, bookingUnreadResult] = await Promise.all([
        sb.rpc('dockslot_chat_list_users'),
        sb.from('dockslot_chat_conversations').select('id,kind,title,created_at,updated_at').order('updated_at',{ascending:false}).limit(1000),
        sb.rpc('dockslot_chat_unread_summary'), sb.rpc('dockslot_chat_booking_unread')
      ]);
      for (const result of [userResult,convResult,unreadResult,bookingUnreadResult]) if (result.error) throw result.error;
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
      if (!conversations.some((c)=>c.id===selectedConversationId)) selectedConversationId = conversations.find((c)=>c.kind==='general')?.id || conversations[0]?.id || null;
      setBadge(Array.from(unreadByConversation.values()).reduce((sum,n)=>sum+n,0));
      renderConversationList();
      if (refreshThread && isOpen) { if(selectedConversationId) await loadSelectedMessages({preserveHistory:true}); else await renderSelectedConversation(); }
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
      button.addEventListener('click',async()=>{selectedConversationId=conversation.id;setSelectedBooking(null);clearMessageSelection();cancelEditing();closePicker();closeChatSearch();renderConversationList(filter);await renderSelectedConversation();});
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
    if(!selectedConversationId)return;
    const list=$('akChatMessageList');
    const scrollRevisionAtStart=bottomScrollRevision;
    const previousScrollTop=list?.scrollTop||0;
    const wasNearBottom=!list||list.scrollHeight-list.scrollTop-list.clientHeight<100;
    const previousMessages=preserveHistory?messages:[];
    const previousReads=preserveHistory?reads:[];
    const previousAttachments=preserveHistory?attachments:[];
    const previousReactions=preserveHistory?reactions:[];
    const previousSignedFiles=preserveHistory?signedFiles:new Map();
    const previousHasOlder=preserveHistory?hasOlderMessages:false;
    const {data,error}=await sb.from('dockslot_chat_messages')
      .select('id,conversation_id,sender_id,body,booking_id,target_user_id,created_at,edited_at,forwarded_from_message_id')
      .eq('conversation_id',selectedConversationId).gte('created_at',sixMonthsAgo()).order('created_at',{ascending:false}).limit(250);
    if(error)throw error;
    const fetchedMessages=(data||[]).reverse();
    hasOlderMessages=previousHasOlder||(data||[]).length===250;
    if(preserveHistory){
      const merged=new Map(previousMessages.map((message)=>[message.id,message]));
      fetchedMessages.forEach((message)=>merged.set(message.id,message));
      messages=[...merged.values()].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    }else{
      messages=fetchedMessages;
      bookingsById=new Map();
    }
    const bookingIds=[...new Set(fetchedMessages.map((message)=>message.booking_id).filter(Boolean))];
    if(bookingIds.length){
      const {data:bookingRows,error:bookingError}=await sb.from('bookings').select('id,slot_date,slot_hour,order_number,profiles(company_name)').in('id',bookingIds);
      if(bookingError)throw bookingError;(bookingRows||[]).forEach((booking)=>bookingsById.set(booking.id,booking));
    }
    const ids=fetchedMessages.map((message)=>message.id);
    const newSignedFiles=new Map(previousSignedFiles);
    if(ids.length){
      const [readRes,attachRes,reactionRes]=await Promise.all([
        sb.from('dockslot_chat_message_reads').select('message_id,user_id,read_at').in('message_id',ids),
        sb.from('dockslot_chat_attachments').select('id,message_id,storage_path,file_name,mime_type,file_size').in('message_id',ids),
        sb.from('dockslot_chat_message_reactions').select('message_id,user_id,reaction_key').in('message_id',ids)
      ]);
      if(readRes.error)throw readRes.error;if(attachRes.error)throw attachRes.error;if(reactionRes.error)throw reactionRes.error;
      const mergeUnique=(oldRows,newRows,keyOf)=>[...new Map([...oldRows,...(newRows||[])].map((row)=>[keyOf(row),row])).values()];
      reads=mergeUnique(previousReads,readRes.data,(row)=>`${row.message_id}:${row.user_id}`);
      attachments=mergeUnique(previousAttachments,attachRes.data,(row)=>row.id);
      reactions=mergeUnique(previousReactions,reactionRes.data,(row)=>`${row.message_id}:${row.user_id}:${row.reaction_key}`);
      await Promise.all((attachRes.data||[]).map(async(attachment)=>{
        try{const {data:link,error:linkError}=await sb.storage.from('dockslot-chat-files').createSignedUrl(attachment.storage_path,3600);if(!linkError&&link?.signedUrl)newSignedFiles.set(attachment.id,link.signedUrl);}catch(_){/* attachment remains listed without preview */}
      }));
    }else if(!preserveHistory){reads=[];attachments=[];reactions=[];}
    signedFiles=newSignedFiles;
    await markRead(selectedConversationId);
    renderMessages();renderConversationList();
    requestAnimationFrame(()=>{
      if(!list)return;
      if(bottomScrollRevision!==scrollRevisionAtStart){scrollMessageListToBottom();return;}
      if(preserveHistory&&!forceBottom&&!wasNearBottom)list.scrollTop=previousScrollTop;
      else scrollMessageListToBottom();
    });
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
      const [readRes,attachRes,reactionRes]=await Promise.all([
        sb.from('dockslot_chat_message_reads').select('message_id,user_id,read_at').in('message_id',ids),
        sb.from('dockslot_chat_attachments').select('id,message_id,storage_path,file_name,mime_type,file_size').in('message_id',ids),
        sb.from('dockslot_chat_message_reactions').select('message_id,user_id,reaction_key').in('message_id',ids)
      ]);
      if(readRes.error)throw readRes.error;if(attachRes.error)throw attachRes.error;if(reactionRes.error)throw reactionRes.error;
      reads=[...reads,...(readRes.data||[])];attachments=[...attachments,...(attachRes.data||[])];reactions=[...reactions,...(reactionRes.data||[])];
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

  const renderMessages=()=>{
    const list=$('akChatMessageList');if(!list)return;
    if(!messages.length){list.innerHTML='<div class="ak-chat-empty"><div class="ak-chat-empty-icon">✦</div><strong>Начните разговор</strong><span>Отправьте сообщение, фото или документ.</span></div>';return;}
    list.replaceChildren();
    if(hasOlderMessages){const olderButton=document.createElement('button');olderButton.type='button';olderButton.id='akChatLoadOlder';olderButton.className='ak-chat-load-older';olderButton.disabled=olderMessagesLoading;olderButton.textContent=olderMessagesLoading?'Загрузка…':'Загрузить более ранние сообщения';list.appendChild(olderButton);}
    let previousDay='';
    messages.forEach((message)=>{
      const day=fmtDate(message.created_at);
      if(day!==previousDay){const divider=document.createElement('div');divider.className='ak-chat-date-divider';divider.innerHTML=`<span>${escapeHtml(day)}</span>`;list.appendChild(divider);previousDay=day;}
      const own=message.sender_id===user.id, bubble=document.createElement('article');
      bubble.className=`ak-chat-message${own?' is-own':''}`;bubble.dataset.messageId=message.id;
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
      const age=Date.now()-new Date(message.created_at).getTime();
      const canEdit=own&&age<=10*60*1000&&(String(message.body||'').length>0||fileRows.length>0);
      const reactionRows = reactionDefs.map(([key, emoji, label]) => {
        const rows = reactions.filter((r) => r.message_id === message.id && r.reaction_key === key);
        const mine = rows.some((r) => r.user_id === user.id);
        return { key, emoji, label, count: rows.length, mine };
      });
      const activeReactionHtml = reactionRows.filter((item) => item.count > 0).map((item) =>
        `<button type="button" class="ak-chat-reaction${item.mine?' is-mine':''}" data-chat-reaction="${item.key}" data-chat-message="${message.id}" title="${item.label}" aria-pressed="${item.mine}">${item.emoji}<small>${item.count}</small></button>`
      ).join('');
      const reactionPickerHtml = `<div class="ak-chat-reaction-control">
        <button type="button" class="ak-chat-reaction-trigger" data-chat-reaction-toggle aria-label="Добавить реакцию" title="Добавить реакцию">${icons.heart}</button>
        <div class="ak-chat-reaction-menu" role="group" aria-label="Выбор реакции">
          ${reactionRows.map((item) => `<button type="button" data-chat-reaction="${item.key}" data-chat-message="${message.id}" title="${item.label}" aria-label="${item.label}">${item.emoji}</button>`).join('')}
        </div>
      </div>`;
      const messageMenu=message.client_pending?'':`<div class="ak-chat-message-menu-wrap"><button type="button" class="ak-chat-message-menu-trigger" data-chat-message-menu-toggle aria-label="Действия с сообщением" title="Действия">···</button><div class="ak-chat-message-menu" role="menu"><button type="button" role="menuitem" data-chat-forward="${escapeHtml(message.id)}">Переслать</button><button type="button" role="menuitem" data-chat-edit="${escapeHtml(message.id)}" ${canEdit?'':'hidden'}>Редактировать</button></div></div>`;
      bubble.innerHTML=`
        <div class="ak-chat-message-content">
          <div class="ak-chat-message-top"><strong>${escapeHtml(sender)}</strong>${senderRole?`<span>${escapeHtml(senderRole)}</span>`:''}${messageMenu}</div>
          ${forwarded}${booking}
          ${message.body?`<div class="ak-chat-message-text">${escapeHtml(message.body).replace(/\n/g,'<br>')}</div>`:''}
          ${fileHtml?`<div class="ak-chat-message-attachments">${fileHtml}</div>`:''}
          <div class="ak-chat-message-reaction-row"><div class="ak-chat-reactions">${activeReactionHtml}</div>${reactionPickerHtml}</div>
          <div class="ak-chat-message-bottom"><time>${escapeHtml(fmtTime(message.created_at))}</time>${edited}${status}</div>
        </div>`;
      list.appendChild(bubble);
    });
    updateSelectionBar();
  };

  const updateComposer=()=>{
    const input=$('akChatInput');if(!input)return;
    const max=Number(settings?.max_message_chars)||2000;
    $('akChatCharCount').textContent=`${input.value.length}/${max}`;
    $('akChatCharCount').classList.toggle('is-near-limit',input.value.length>max*.9);
    $('akChatSend').disabled=(!input.value.trim()&&!selectedFiles.length)||input.value.length>max||isSending||Boolean(editingMessageId);
    input.style.height='auto';input.style.height=`${Math.min(input.scrollHeight,160)}px`;
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
  const scrollMessageListToBottom=()=>{
    const list=$('akChatMessageList');
    if(!list)return;
    const revision=++bottomScrollRevision;
    const commit=()=>{
      if(!isOpen||!list.isConnected||revision!==bottomScrollRevision)return;
      list.classList.add('ak-chat-force-bottom');
      // Use the actual scroll container geometry; scrollIntoView alone can scroll the page instead.
      list.scrollTop=Math.max(0,list.scrollHeight-list.clientHeight);
      const lastMessage=list.querySelector('.ak-chat-message:last-of-type') || [...list.querySelectorAll('.ak-chat-message')].at(-1);
      if(lastMessage){
        const listRect=list.getBoundingClientRect(),messageRect=lastMessage.getBoundingClientRect();
        const overflow=messageRect.bottom-listRect.bottom;
        if(overflow>0)list.scrollTop+=overflow+8;
      }
    };
    requestAnimationFrame(()=>{commit();requestAnimationFrame(commit);requestAnimationFrame(commit);});
    [60,180,420].forEach((delay)=>window.setTimeout(commit,delay));
    window.setTimeout(()=>{if(revision===bottomScrollRevision&&list.isConnected)list.classList.remove('ak-chat-force-bottom');},650);
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
      messages=messages.map((item)=>item.id===pendingId?sentMessage:item).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
      lastMessageByConversation.set(conversation.id,sentMessage);
      conversation.updated_at=sentAt;
      updateComposer();renderMessages();renderConversationList();scrollMessageListToBottom();

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
      messages=messages.filter((item)=>item.id!==pendingId);renderMessages();renderConversationList();
      if(uploaded.length)try{await sb.storage.from('dockslot-chat-files').remove(uploaded.map((f)=>f.storage_path));}catch(_){}
      // Restore the draft only when the user has not started typing a different message.
      if(input&&!String(input.value||'').trim())input.value=body;
      if(!selectedFiles.length&&draftFiles.length)selectedFiles=draftFiles;
      if(!selectedBooking&&bookingDraft)setSelectedBooking(bookingDraft);
      renderSelectedFiles();updateComposer();scrollMessageListToBottom();
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
      const merged=new Map([...(before||[]),...(after||[]),{...hit,target_user_id:null}].map(row=>[row.id,row]));
      messages=[...merged.values()].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
      hasOlderMessages=(before||[]).length===35;bookingsById=new Map();
      const ids=messages.map(row=>row.id), bookingIds=[...new Set(messages.map(row=>row.booking_id).filter(Boolean))];
      const tasks=[
        sb.from('dockslot_chat_message_reads').select('message_id,user_id,read_at').in('message_id',ids),
        sb.from('dockslot_chat_attachments').select('id,message_id,storage_path,file_name,mime_type,file_size').in('message_id',ids),
        sb.from('dockslot_chat_message_reactions').select('message_id,user_id,reaction_key').in('message_id',ids)
      ];
      if(bookingIds.length)tasks.push(sb.from('bookings').select('id,slot_date,slot_hour,order_number,profiles(company_name)').in('id',bookingIds));
      const results=await Promise.all(tasks);results.forEach((result)=>{if(result.error)throw result.error;});
      reads=results[0].data||[];attachments=results[1].data||[];reactions=results[2].data||[];signedFiles=new Map();
      (results[3]?.data||[]).forEach(row=>bookingsById.set(row.id,row));
      await Promise.all(attachments.map(async(file)=>{try{const {data,error}=await sb.storage.from('dockslot-chat-files').createSignedUrl(file.storage_path,3600);if(!error&&data?.signedUrl)signedFiles.set(file.id,data.signedUrl);}catch(_){}}));
      closeChatSearch();renderMessages();
      requestAnimationFrame(()=>{
        const target=$('akChatMessageList')?.querySelector(`[data-message-id="${CSS.escape(String(hit.id))}"]`);
        if(target){target.scrollIntoView({behavior:'smooth',block:'center'});target.classList.add('is-search-hit');window.setTimeout(()=>target.classList.remove('is-search-hit'),2400);}
      });
    }catch(error){toast(error?.message||'Не удалось открыть найденное сообщение.',true);}
  };

  const onMessageListClick=async(event)=>{
    if(!event.target.closest('[data-chat-message-menu-toggle],.ak-chat-message-menu-wrap')) $('akChatMessageList')?.querySelectorAll('.ak-chat-message-menu-wrap.is-open').forEach((node)=>node.classList.remove('is-open'));
    const olderButton=event.target.closest('#akChatLoadOlder');if(olderButton){void loadOlderMessages();return;}
    const bookingButton=event.target.closest('[data-chat-message-booking]');if(bookingButton){void openBookingFromMessage(bookingButton.dataset.chatMessageBooking);return;}
    const reactionToggle=event.target.closest('[data-chat-reaction-toggle]');
    if(reactionToggle){
      const bubble=reactionToggle.closest('.ak-chat-message');
      const opening=!bubble?.classList.contains('is-reaction-open');
      $('akChatMessageList')?.querySelectorAll('.ak-chat-message.is-reaction-open').forEach((node)=>node.classList.remove('is-reaction-open'));
      bubble?.classList.toggle('is-reaction-open',opening);return;
    }
    const menuToggle=event.target.closest('[data-chat-message-menu-toggle]');
    if(menuToggle){
      const wrap=menuToggle.closest('.ak-chat-message-menu-wrap');
      const open=!wrap?.classList.contains('is-open');
      $('akChatMessageList')?.querySelectorAll('.ak-chat-message-menu-wrap.is-open').forEach((node)=>node.classList.remove('is-open'));
      wrap?.classList.toggle('is-open',open);return;
    }
    const forwardButton=event.target.closest('[data-chat-forward]');
    if(forwardButton){
      selectedMessageIds.clear();selectedMessageIds.add(forwardButton.dataset.chatForward);
      forwardButton.closest('.ak-chat-message-menu-wrap')?.classList.remove('is-open');
      await openPicker('forward');return;
    }
    const reactionButton=event.target.closest('[data-chat-reaction]');if(reactionButton){
      const {chatReaction:key,chatMessage:id}=reactionButton.dataset;
      reactionButton.closest('.ak-chat-message')?.classList.remove('is-reaction-open');
      const {error}=await sb.rpc('dockslot_chat_toggle_reaction',{p_message_id:id,p_reaction_key:key});
      if(error)toast(error.message||'Не удалось поставить реакцию.',true);else await loadSelectedMessages({preserveHistory:true});return;
    }
    const editButton=event.target.closest('[data-chat-edit]');if(editButton){const message=messages.find((m)=>m.id===editButton.dataset.chatEdit);editButton.closest('.ak-chat-message-menu-wrap')?.classList.remove('is-open');if(message)startEditing(message);}
  };
  const clearMessageSelection=()=>{selectedMessageIds.clear();};

  const startEditing=(message)=>{
    if(message.sender_id!==user.id||Date.now()-new Date(message.created_at).getTime()>10*60*1000)return toast('Редактирование доступно только в течение 10 минут после отправки.',true);
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

  const openPicker=async(mode)=>{
    pickerMode=mode;selectedRecipientIds.clear();presetGroupTitle=null;
    const picker=$('akChatPicker');picker.hidden=false;
    const titles={recipients:'Новое сообщение · получатели',booking:'Привязать запись слота',forward:'Переслать выбранные сообщения'};
    $('akChatPickerTitle').textContent=titles[mode]||'Выберите';
    $('akChatPickerSearch').placeholder=mode==='booking'?'Поиск по поставщику или номеру документа…':'Поиск по компании, сотруднику или роли…';
    $('akChatPickerShortcuts').hidden=mode!=='recipients';
    $('akChatPickerSearch').value='';$('akChatPickerFooter').hidden=mode==='booking';
    if(mode==='booking')await loadBookingsForPicker();else renderPickerList();
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
    const matches=userRows.filter((u)=>u.user_id!==user.id&&`${u.display_name} ${u.company_name||''} ${roleLabels[u.role]||u.role}`.toLocaleLowerCase('ru-RU').includes(query));
    if(!matches.length)list.innerHTML='<div class="ak-chat-picker-empty">Нет доступных сотрудников. В списке только роли, которым суперадминистратор разрешил мессенджер.</div>';
    matches.forEach((row)=>{
      const label=document.createElement('label');label.className='ak-chat-picker-item is-selectable';
      label.innerHTML=`<span class="ak-chat-picker-avatar">${escapeHtml((row.display_name||'С')[0].toLocaleUpperCase('ru-RU'))}</span><span><strong>${escapeHtml(row.display_name)}</strong><small>${escapeHtml(roleLabels[row.role]||row.role)}${row.company_name?` · ${escapeHtml(row.company_name)}`:''}</small></span><input type="checkbox" data-recipient-id="${row.user_id}" ${selectedRecipientIds.has(row.user_id)?'checked':''}>`;
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
    $('akChatPickerAction').textContent=pickerMode==='forward'?'Переслать сообщения':`Открыть чат (${selectedRecipientIds.size})`;
    $('akChatPickerAction').disabled=!selectedRecipientIds.size;
  };
  const closePicker=()=>{if($('akChatPicker'))$('akChatPicker').hidden=true;};
  const pickerAction=async()=>{
    const ids=[...selectedRecipientIds];if(!ids.length)return;
    if(pickerMode==='recipients')await createConversationForUsers(ids,presetGroupTitle);
    else if(pickerMode==='forward')await forwardSelectedMessages(ids);
  };
  const createConversationForUsers=async(ids,groupTitle=null)=>{
    try{
      const title=groupTitle || (ids.length>1?`Группа · ${ids.length+1} участников`:null);
      const {data,error}=await sb.rpc('dockslot_chat_create_group',{p_user_ids:ids,p_title:title});if(error)throw error;
      closePicker();await refreshData(false);selectedConversationId=data;clearMessageSelection();setSelectedBooking(null);renderConversationList();await renderSelectedConversation();
    }catch(error){toast(error?.message||'Не удалось создать переписку.',true);}
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
  const openBookingFromMessage=async(id)=>{
    const booking=await loadBookingById(id);closeChat();
    if(booking?.slot_date){const url=new URL('admin_day.html',window.location.href);url.searchParams.set('date',booking.slot_date);url.searchParams.set('booking_id',id);window.location.href=url.toString();}
  };
  const updateBookingMarkers=()=>{
    if(!document.querySelector('.slot-box[data-chat-booking-id], .overview-booking-row[data-chat-booking-id]'))return;
    const aggregated=new Map();
    bookingUnread.forEach((row)=>{
      const count=Number(row.unread_count||0),current=aggregated.get(row.booking_id);
      if(!current) aggregated.set(row.booking_id,{count,conversationId:row.conversation_id,latest:row.latest_at});
      else { current.count += count; if(new Date(row.latest_at)>new Date(current.latest)){current.conversationId=row.conversation_id;current.latest=row.latest_at;} }
    });
    document.querySelectorAll('.slot-box[data-chat-booking-id], .overview-booking-row[data-chat-booking-id]').forEach((card)=>{
      const id=card.dataset.chatBookingId,info=aggregated.get(id);let marker=card.querySelector('.ak-chat-slot-marker');
      if(!info){marker?.remove();return;}
      if(!marker){marker=document.createElement('button');marker.type='button';marker.className='ak-chat-slot-marker';marker.innerHTML=`${icons.chat}<span></span>`;const header=card.querySelector('.sb-header'),dots=header?.querySelector('.btn-dots');if(header&&dots)header.insertBefore(marker,dots);else { const anchor=card.querySelector('.overview-booking-main')||card; anchor.appendChild(marker); }}
      const badge=marker.querySelector('span'),badgeText=info.count>9?'9+':String(info.count),badgeHidden=info.count<=0;
      if(badge.textContent!==badgeText)badge.textContent=badgeText;
      if(badge.hidden!==badgeHidden)badge.hidden=badgeHidden;
      marker.classList.toggle('is-read',badgeHidden);
      const markerTitle=info.count>0?`${info.count} непрочитанных сообщений по этой записи`:'Есть сообщение по этой записи';
      const markerLabel=info.count>0?`Открыть чат по записи, непрочитанных сообщений: ${info.count}`:'Открыть сообщение по записи';
      if(marker.title!==markerTitle)marker.title=markerTitle;
      if(marker.getAttribute('aria-label')!==markerLabel)marker.setAttribute('aria-label',markerLabel);
      marker.onclick=(event)=>{event.preventDefault();event.stopPropagation();void openChat(info.conversationId,id);};
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
    window.clearInterval(pollTimer);window.clearTimeout(refreshDebounceTimer);refreshDebounceTimer=null;queuedRefreshThread=false;bookingObserver?.disconnect();bookingObserver=null;
    document.querySelectorAll('.ak-chat-slot-marker').forEach((node)=>node.remove());
    if(realtimeChannel){try{void sb.removeChannel(realtimeChannel);}catch(_){}realtimeChannel=null;}
    user=null;role='';isOpen=false;$('akChatFab')?.remove();$('akChatOverlay')?.remove();$('akChatToast')?.remove();
  };
  if(typeof sb.auth.onAuthStateChange==='function')sb.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'||!session?.user?.id)clearSession();
    else if(user?.id&&String(session.user.id)!==String(user.id)){clearSession();window.setTimeout(()=>void init(),0);}
  });
  window.dockslotChat={open:(conversationId,bookingId)=>openChat(conversationId,bookingId),refresh:()=>refreshData(isOpen)};
  init();
});
