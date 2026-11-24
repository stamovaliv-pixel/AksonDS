document.addEventListener('DOMContentLoaded', async () => {
  'use strict';
  const sb = window.supabaseClient;
  const $ = (id) => document.getElementById(id);
  if (!sb) return;

  const auth = await window.dockslotGetAuthProfile?.();
  const user = auth?.user;
  const profile = auth?.profile;
  if (!user || auth?.error || !profile || profile.is_blocked) {
    window.location.replace('../index.html');
    return;
  }
  if (String(profile.role || '').toLowerCase() !== 'super_admin') {
    window.location.replace('admin_calendar.html');
    return;
  }
  $('chatAdminRoot').hidden = false;

  const controls = {
    enabled: 'chatEnabled', admin: 'roleAdmin', operator: 'roleOperator', super_admin: 'roleSuperAdmin',
    general_chat_enabled: 'generalChat', direct_chat_enabled: 'directChat', booking_chat_enabled: 'bookingChat'
  };
  let toastTimer = null, archiveCursor = null, archiveCursorId = null, archiveLoaded = false, archiveLoading = false, archiveReloadPending = false;
  let archiveRows = [];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[char]);
  const archiveRoleLabels = { admin:'УТЗ', operator:'РЦ', super_admin:'Администратор' };
  const toast = (message, isError = false) => {
    const node = $('chatAdminToast'); node.textContent = message;
    node.classList.toggle('is-error', Boolean(isError)); node.classList.add('is-visible');
    window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => node.classList.remove('is-visible'), 3500);
  };
  const setBusy = (busy) => {
    $('chatAdminSave').disabled = busy;
    Object.values(controls).forEach((id) => { if ($(id)) $(id).disabled = busy; });
    ['maxMessageChars','maxMessagesPerMinute','maxAttachmentSizeMb','maxAttachmentsPerMessage'].forEach((id) => { $(id).disabled = busy; });
  };
  const render = (row) => {
    $('chatEnabled').checked = Boolean(row.enabled);
    $('roleAdmin').checked = (row.enabled_roles || []).includes('admin');
    $('roleOperator').checked = (row.enabled_roles || []).includes('operator');
    $('roleSuperAdmin').checked = (row.enabled_roles || []).includes('super_admin');
    $('generalChat').checked = Boolean(row.general_chat_enabled);
    $('directChat').checked = Boolean(row.direct_chat_enabled);
    $('bookingChat').checked = Boolean(row.booking_chat_enabled);
    $('maxMessageChars').value = String(row.max_message_chars || 2000);
    $('maxMessagesPerMinute').value = String(row.max_messages_per_minute || 12);
    $('maxAttachmentSizeMb').value = String(row.max_attachment_size_mb || 20);
    $('maxAttachmentsPerMessage').value = String(row.max_attachments_per_message || 10);
    $('chatAdminStatusTitle').textContent = row.enabled ? 'Мессенджер включён' : 'Мессенджер отключён';
    $('chatAdminStatusHint').textContent = row.enabled
      ? 'Доступ определяется выбранными ролями и настройками форматов общения.'
      : 'Плавающая кнопка скрыта у сотрудников. Панель управления и закрытый архив доступны суперадминистратору.';
    $('chatAdminStatusTitle').classList.toggle('is-disabled', !row.enabled);
    $('chatAdminSaveMeta').textContent = `Последнее сохранение: ${new Date(row.updated_at).toLocaleString('ru-RU', { dateStyle:'short', timeStyle:'short' })}`;
    $('chatAdminSave').disabled = false;
  };

  try {
    const { data, error } = await sb.from('dockslot_chat_settings').select('*').eq('id', 1).single();
    if (error) throw error;
    render(data);
  } catch (error) {
    $('chatAdminStatusTitle').textContent = 'Настройки не загружены';
    $('chatAdminStatusHint').textContent = error?.message || 'Примените SQL-миграцию Messenger v1.1.';
    $('chatAdminSaveMeta').textContent = 'Сначала примените supabase/migrations/20261123_dockslot_messenger_v1.sql';
    toast('Не удалось загрузить параметры мессенджера. Проверьте миграцию.', true);
    return;
  }

  $('chatAdminSave').addEventListener('click', async () => {
    const ranges = [
      ['maxMessageChars',100,10000,'Лимит длины сообщения должен быть от 100 до 10 000 символов.'],
      ['maxMessagesPerMinute',1,60,'Лимит частоты должен быть от 1 до 60 сообщений в минуту.'],
      ['maxAttachmentSizeMb',1,50,'Размер файла должен быть от 1 до 50 МБ.'],
      ['maxAttachmentsPerMessage',1,10,'Количество файлов должно быть от 1 до 10.']
    ];
    for (const [id,min,max,message] of ranges) {
      const value = Number($(id).value);
      if (!Number.isInteger(value) || value < min || value > max) { toast(message,true); $(id).focus(); return; }
    }
    const roles = ['admin','operator','super_admin'].filter((role) => $(controls[role]).checked);
    if (!roles.length) { toast('Выберите хотя бы одну роль с доступом к мессенджеру.',true); return; }
    const payload = {
      enabled:$('chatEnabled').checked, enabled_roles:roles,
      general_chat_enabled:$('generalChat').checked, direct_chat_enabled:$('directChat').checked,
      booking_chat_enabled:$('bookingChat').checked,
      max_message_chars:Number($('maxMessageChars').value),
      max_messages_per_minute:Number($('maxMessagesPerMinute').value),
      max_attachment_size_mb:Number($('maxAttachmentSizeMb').value),
      max_attachments_per_message:Number($('maxAttachmentsPerMessage').value),
      updated_by:user.id
    };
    setBusy(true); $('chatAdminSave').textContent = 'Сохранение…';
    try {
      const { data, error } = await sb.from('dockslot_chat_settings').update(payload).eq('id',1).select('*').single();
      if (error) throw error;
      render(data); toast('Настройки мессенджера сохранены.');
    } catch (error) { toast(error?.message || 'Не удалось сохранить настройки.',true); }
    finally { setBusy(false); $('chatAdminSave').textContent = 'Сохранить настройки'; }
  });

  const openArchive = async () => {
    $('chatAdminSettingsView').hidden = true;
    $('chatAdminArchiveView').hidden = false;
    if (!archiveLoaded) await loadArchive(true);
  };
  const closeArchive = () => {
    $('chatAdminArchiveView').hidden = true;
    $('chatAdminSettingsView').hidden = false;
  };
  $('openChatArchive').addEventListener('click', openArchive);
  $('closeChatArchive').addEventListener('click', closeArchive);
  $('chatArchiveMore').addEventListener('click', () => loadArchive(false));
  let searchTimer = null;
  $('chatArchiveSearch').addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => { archiveRows=[]; archiveCursor=null; archiveCursorId=null; archiveLoaded=false; void loadArchive(true); }, 350);
  });

  const loadArchive = async (reset) => {
    if (archiveLoading) { if (reset) archiveReloadPending = true; return; }
    archiveLoading = true;
    const list = $('chatArchiveList');
    if (reset) {
      archiveCursor = null; archiveCursorId = null; archiveRows = [];
      list.innerHTML = '<div class="chat-admin-archive-empty">Загрузка истории сообщений…</div>';
    }
    $('chatArchiveMore').disabled = true;
    try {
      const { data: response, error } = await sb.functions.invoke('dockslot-chat-admin-history', { body: {
        p_before:archiveCursor, p_limit:50, p_search:String($('chatArchiveSearch').value || '').trim() || null, p_before_id:archiveCursorId
      }});
      if (error) throw error;
      const batch = response?.data || [];
      archiveRows = reset ? batch : [...archiveRows, ...batch];
      archiveCursor = batch.length ? batch[batch.length-1].created_at : archiveCursor;
      archiveCursorId = batch.length ? batch[batch.length-1].message_id : archiveCursorId;
      archiveLoaded = true;
      await renderArchiveRows(reset);
      $('chatArchiveCount').textContent = `Загружено сообщений: ${archiveRows.length}`;
      $('chatArchiveMore').hidden = batch.length < 50;
      if (!archiveRows.length) list.innerHTML = '<div class="chat-admin-archive-empty">По заданному запросу сообщений не найдено.</div>';
    } catch (error) {
      list.innerHTML = `<div class="chat-admin-archive-empty is-error">Не удалось открыть архив: ${escapeHtml(error?.message || 'Ошибка доступа')}</div>`;
      $('chatArchiveMore').hidden = true;
    } finally {
      archiveLoading=false;
      $('chatArchiveMore').disabled=false;
      if (archiveReloadPending) { archiveReloadPending=false; void loadArchive(true); }
    }
  };

  const renderArchiveRows = async (reset) => {
    const list=$('chatArchiveList');
    if(reset)list.replaceChildren();
    const rows=reset?archiveRows:archiveRows.slice(-50);
    const ids=rows.map((row)=>row.message_id);
    let files=[], reactionRows=[];
    if(ids.length){
      const [fileResult,reactionResult]=await Promise.all([
        sb.from('dockslot_chat_attachments').select('id,message_id,storage_path,file_name,mime_type,file_size').in('message_id',ids),
        sb.from('dockslot_chat_message_reactions').select('message_id,reaction_key').in('message_id',ids)
      ]);
      if(fileResult.error)throw fileResult.error;
      if(reactionResult.error)throw reactionResult.error;
      files=fileResult.data||[]; reactionRows=reactionResult.data||[];
    }
    const reactionEmoji={heart:'❤️',like:'👍',cry:'😢',laugh:'😂',rofl:'🤣',strong:'💪',fire:'🔥'};
    const reactionsByMessage=new Map();
    reactionRows.forEach((reaction)=>{
      const list=reactionsByMessage.get(reaction.message_id)||[];
      const match=list.find((item)=>item.key===reaction.reaction_key);
      if(match)match.count+=1;else list.push({key:reaction.reaction_key,count:1});
      reactionsByMessage.set(reaction.message_id,list);
    });
    const signed=new Map();
    await Promise.all(files.map(async(file)=>{
      const {data,error}=await sb.storage.from('dockslot-chat-files').createSignedUrl(file.storage_path,3600);
      if(!error&&data?.signedUrl)signed.set(file.id,data.signedUrl);
    }));
    const groups=new Map();
    rows.forEach((row)=>{const key=String(row.sender_id||row.sender_name||'unknown');if(!groups.has(key))groups.set(key,{row,messages:[]});groups.get(key).messages.push(row);});
    groups.forEach((group,key)=>{
      const senderRow=group.row;
      let section=list.querySelector(`[data-sender-id="${CSS.escape(key)}"]`);
      if(!section){
        section=document.createElement('section');section.className='chat-admin-archive-sender-group';section.dataset.senderId=key;
        section.innerHTML=`<header><div><strong>${escapeHtml(senderRow.sender_name||'Сотрудник')}</strong><span>${escapeHtml(archiveRoleLabels[senderRow.sender_role]||senderRow.sender_role||'')}</span></div><b class="chat-admin-archive-sender-count">0 сообщ.</b></header>`;
        list.appendChild(section);
      }
      const countNode=section.querySelector('.chat-admin-archive-sender-count');
      if(countNode){const current=Number(section.dataset.messageCount||0)+group.messages.length;section.dataset.messageCount=String(current);countNode.textContent=`${current} сообщ.`;}
      group.messages.forEach((row)=>{
      const card=document.createElement('article');card.className='chat-admin-archive-message';
      const when=new Date(row.created_at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',dateStyle:'short',timeStyle:'short'});
      const group=files.filter((file)=>file.message_id===row.message_id);
      const reactionHtml=(reactionsByMessage.get(row.message_id)||[]).map((reaction)=>`<span>${reactionEmoji[reaction.key]||''} ${reaction.count}</span>`).join('');
      const fileHtml=group.map((file)=>{
        const url=signed.get(file.id);
        return `<a href="${url?escapeHtml(url):'#'}" ${url?'target="_blank" rel="noopener"':'aria-disabled="true"'}><span>${escapeHtml((file.file_name.split('.').pop()||'FILE').toUpperCase())}</span>${escapeHtml(file.file_name)}</a>`;
      }).join('');
      card.innerHTML=`<div class="chat-admin-archive-message-meta"><strong>${escapeHtml(row.sender_name||'Сотрудник')}</strong><span>${escapeHtml(archiveRoleLabels[row.sender_role]||row.sender_role||'')}</span><time>${escapeHtml(when)}</time></div>
        <div class="chat-admin-archive-context"><b>${escapeHtml(row.conversation_label||'Переписка')}</b><span>${escapeHtml(row.participant_names||'')}</span></div>
        ${row.forwarded_from_message_id?'<div class="chat-admin-archive-forwarded">↗ Пересланное сообщение</div>':''}
        <div class="chat-admin-archive-body">${escapeHtml(row.body||'').replace(/\n/g,'<br>')||'<em>Сообщение без текста</em>'}${row.edited_at?'<small> · изменено</small>':''}</div>
        ${fileHtml?`<div class="chat-admin-archive-files">${fileHtml}</div>`:''}
        ${reactionHtml?`<div class="chat-admin-archive-reactions">${reactionHtml}</div>`:''}
        ${row.booking_id?`<div class="chat-admin-archive-booking">Запись слота · ${escapeHtml(row.booking_id)}</div>`:''}`;
      section.appendChild(card);
      });
    });
  };
});
