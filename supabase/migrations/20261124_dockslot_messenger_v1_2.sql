-- DockSlot Messenger v1.2 (unpublished release, based on latest DockSlot)
-- Чаты, история за 6 месяцев, закрытый архив Super Admin, вложения, редактирование,
-- пересылка, реакции и адресные сообщения нескольким сотрудникам.
-- Выполнить один раз в Supabase SQL Editor от имени владельца проекта.

begin;

-- -----------------------------------------------------------------------------
-- Settings and core tables
-- -----------------------------------------------------------------------------
create table if not exists public.dockslot_chat_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  enabled_roles text[] not null default array['admin','operator','super_admin']::text[],
  general_chat_enabled boolean not null default true,
  direct_chat_enabled boolean not null default true,
  booking_chat_enabled boolean not null default true,
  max_message_chars integer not null default 2000 check (max_message_chars between 100 and 10000),
  max_messages_per_minute integer not null default 12 check (max_messages_per_minute between 1 and 60),
  max_attachment_size_mb integer not null default 20 check (max_attachment_size_mb between 1 and 50),
  max_attachments_per_message integer not null default 10 check (max_attachments_per_message between 1 and 10),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.dockslot_chat_settings
  add column if not exists max_messages_per_minute integer not null default 12,
  add column if not exists max_attachment_size_mb integer not null default 20,
  add column if not exists max_attachments_per_message integer not null default 10;

insert into public.dockslot_chat_settings (id)
values (1)
on conflict (id) do nothing;

create table if not exists public.dockslot_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dockslot_chat_conversations
  drop constraint if exists dockslot_chat_conversations_kind_check;
alter table public.dockslot_chat_conversations
  add constraint dockslot_chat_conversations_kind_check check (kind in ('general','direct','group'));

create unique index if not exists dockslot_chat_one_general_conversation
  on public.dockslot_chat_conversations (kind)
  where kind = 'general';

create table if not exists public.dockslot_chat_participants (
  conversation_id uuid not null references public.dockslot_chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.dockslot_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dockslot_chat_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  body text not null default '',
  booking_id uuid references public.bookings(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  forwarded_from_message_id uuid references public.dockslot_chat_messages(id) on delete set null
);

alter table public.dockslot_chat_messages
  add column if not exists edited_at timestamptz,
  add column if not exists forwarded_from_message_id uuid references public.dockslot_chat_messages(id) on delete set null;
alter table public.dockslot_chat_messages alter column body set default '';
alter table public.dockslot_chat_messages
  drop constraint if exists dockslot_chat_messages_body_check;
alter table public.dockslot_chat_messages
  add constraint dockslot_chat_messages_body_check check (length(btrim(body)) between 0 and 10000);

create table if not exists public.dockslot_chat_message_reads (
  message_id uuid not null references public.dockslot_chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists public.dockslot_chat_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.dockslot_chat_messages(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.dockslot_chat_message_reactions (
  message_id uuid not null references public.dockslot_chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction_key text not null check (reaction_key in ('heart','like','cry','laugh','rofl','strong','fire')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, reaction_key)
);

create index if not exists dockslot_chat_messages_conversation_created_idx
  on public.dockslot_chat_messages (conversation_id, created_at desc);
create index if not exists dockslot_chat_messages_sender_created_idx
  on public.dockslot_chat_messages (sender_id, created_at desc);
create index if not exists dockslot_chat_messages_created_id_idx
  on public.dockslot_chat_messages (created_at desc, id desc);
create index if not exists dockslot_chat_messages_booking_target_idx
  on public.dockslot_chat_messages (booking_id, target_user_id, created_at desc)
  where booking_id is not null;
create index if not exists dockslot_chat_messages_target_created_idx
  on public.dockslot_chat_messages (target_user_id, created_at desc)
  where target_user_id is not null;
create index if not exists dockslot_chat_participants_user_idx
  on public.dockslot_chat_participants (user_id, conversation_id);
create index if not exists dockslot_chat_reads_user_idx
  on public.dockslot_chat_message_reads (user_id, message_id);
create index if not exists dockslot_chat_attachments_message_idx
  on public.dockslot_chat_attachments (message_id, created_at);
create index if not exists dockslot_chat_reactions_message_idx
  on public.dockslot_chat_message_reactions (message_id, reaction_key);

insert into public.dockslot_chat_conversations (kind, title)
values ('general', 'Общий чат')
on conflict (kind) where kind = 'general' do nothing;

-- -----------------------------------------------------------------------------
-- Shared helper functions
-- -----------------------------------------------------------------------------
create or replace function public.dockslot_chat_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dockslot_chat_settings_updated_at on public.dockslot_chat_settings;
create trigger dockslot_chat_settings_updated_at
before update on public.dockslot_chat_settings
for each row execute function public.dockslot_chat_set_updated_at();

create or replace function public.dockslot_chat_enforce_send_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_recent_count integer;
begin
  perform 1 from public.profiles p where p.id = new.sender_id for update;
  if not found then
    raise exception 'Профиль отправителя не найден.' using errcode = '42501';
  end if;

  select s.max_messages_per_minute into v_limit
    from public.dockslot_chat_settings s where s.id = 1;
  if v_limit is null then v_limit := 12; end if;

  new.created_at := clock_timestamp();
  select count(*)::integer into v_recent_count
    from public.dockslot_chat_messages m
   where m.sender_id = new.sender_id
     and m.created_at > new.created_at - interval '1 minute';
  if v_recent_count >= v_limit then
    raise exception 'Достигнут лимит отправки: не более % сообщений в минуту.', v_limit
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists dockslot_chat_message_send_limit on public.dockslot_chat_messages;
create trigger dockslot_chat_message_send_limit
before insert on public.dockslot_chat_messages
for each row execute function public.dockslot_chat_enforce_send_limit();

create or replace function public.dockslot_chat_touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.dockslot_chat_conversations
     set updated_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists dockslot_chat_message_touch_conversation on public.dockslot_chat_messages;
create trigger dockslot_chat_message_touch_conversation
after insert on public.dockslot_chat_messages
for each row execute function public.dockslot_chat_touch_conversation();

create or replace function public.dockslot_chat_enabled_for(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      join public.dockslot_chat_settings s on s.id = 1
     where p.id = p_user_id
       and coalesce(p.is_blocked, false) = false
       and p.role::text = any(s.enabled_roles)
       and p.role::text in ('admin','operator','super_admin')
       and s.enabled = true
  );
$$;

create or replace function public.dockslot_chat_self_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.dockslot_chat_enabled_for(auth.uid()); $$;

create or replace function public.dockslot_chat_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'super_admin', false)
     and coalesce(public.is_active_app_user(), false);
$$;

create or replace function public.dockslot_chat_can_access(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_user_id is distinct from auth.uid() then false else exists (
    select 1
      from public.dockslot_chat_conversations c
      join public.dockslot_chat_settings s on s.id = 1
     where c.id = p_conversation_id
       and public.dockslot_chat_enabled_for(p_user_id)
       and (c.kind = 'general' or c.updated_at >= now() - interval '6 months')
       and (
         (c.kind = 'general' and s.general_chat_enabled = true)
         or
         (c.kind in ('direct','group') and s.direct_chat_enabled = true and exists (
           select 1 from public.dockslot_chat_participants cp
            where cp.conversation_id = c.id and cp.user_id = p_user_id
         ))
       )
  ) end;
$$;

drop function if exists public.dockslot_chat_list_users();
create function public.dockslot_chat_list_users()
returns table (user_id uuid, display_name text, role text, company_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           nullif(btrim(p.company_name), ''), nullif(split_part(u.email, '@', 1), ''),
           case p.role::text
             when 'admin' then 'Менеджер УТЗ'
             when 'operator' then 'Сотрудник РЦ'
             when 'super_admin' then 'Суперадминистратор'
             else 'Пользователь DockSlot'
           end) as display_name,
         p.role::text,
         coalesce(nullif(btrim(p.company_name), ''), '') as company_name
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join lateral (
      select ct.full_name
        from public.contacts ct
       where ct.profile_id = p.id
       order by ct.is_primary desc nulls last
       limit 1
    ) c on true
   where public.dockslot_chat_enabled_for(auth.uid()) = true
     and public.dockslot_chat_enabled_for(p.id) = true
   order by display_name;
$$;

-- -----------------------------------------------------------------------------
-- Conversation creation
-- -----------------------------------------------------------------------------
create or replace function public.dockslot_chat_create_direct(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
begin
  if auth.uid() is null or p_other_user_id is null or p_other_user_id = auth.uid() then
    raise exception 'Выберите другого сотрудника.' using errcode = '22023';
  end if;
  if not public.dockslot_chat_enabled_for(auth.uid()) or not public.dockslot_chat_enabled_for(p_other_user_id) then
    raise exception 'Личный чат недоступен для одного из пользователей.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.dockslot_chat_settings s where s.id = 1 and s.direct_chat_enabled) then
    raise exception 'Личные сообщения отключены суперадминистратором.' using errcode = '42501';
  end if;

  select c.id into v_conversation_id
    from public.dockslot_chat_conversations c
   where c.kind = 'direct'
     and exists (select 1 from public.dockslot_chat_participants p where p.conversation_id = c.id and p.user_id = auth.uid())
     and exists (select 1 from public.dockslot_chat_participants p where p.conversation_id = c.id and p.user_id = p_other_user_id)
     and (select count(*) from public.dockslot_chat_participants p where p.conversation_id = c.id) = 2
     and c.updated_at >= now() - interval '6 months'
   order by c.updated_at desc
   limit 1;
  if v_conversation_id is not null then return v_conversation_id; end if;

  insert into public.dockslot_chat_conversations (kind, created_by)
  values ('direct', auth.uid()) returning id into v_conversation_id;
  insert into public.dockslot_chat_participants (conversation_id, user_id)
  values (v_conversation_id, auth.uid()), (v_conversation_id, p_other_user_id)
  on conflict do nothing;
  return v_conversation_id;
end;
$$;

create or replace function public.dockslot_chat_create_group(p_user_ids uuid[], p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_conversation_id uuid;
  v_count integer;
begin
  if auth.uid() is null or not public.dockslot_chat_enabled_for(auth.uid()) then
    raise exception 'У вас нет доступа к мессенджеру.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.dockslot_chat_settings s where s.id = 1 and s.direct_chat_enabled) then
    raise exception 'Личные и групповые сообщения отключены суперадминистратором.' using errcode = '42501';
  end if;

  select array_agg(unique_ids.user_id order by unique_ids.user_id) into v_ids
    from (
      select distinct incoming.user_id
        from unnest(coalesce(p_user_ids, array[]::uuid[])) as incoming(user_id)
       where incoming.user_id is not null and incoming.user_id <> auth.uid()
    ) unique_ids;
  v_count := coalesce(cardinality(v_ids), 0);
  if v_count < 1 or v_count > 200 then
    raise exception 'Выберите от 1 до 200 получателей.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(v_ids) as selected_user(user_id)
     where not public.dockslot_chat_enabled_for(selected_user.user_id)
  ) then
    raise exception 'В списке есть сотрудник без доступа к мессенджеру.' using errcode = '42501';
  end if;
  if v_count = 1 then
    return public.dockslot_chat_create_direct(v_ids[1]);
  end if;

  select c.id into v_conversation_id
    from public.dockslot_chat_conversations c
   where c.kind = 'group'
     and c.updated_at >= now() - interval '6 months'
     and (select count(*) from public.dockslot_chat_participants p where p.conversation_id = c.id) = v_count + 1
     and not exists (
       select 1 from public.dockslot_chat_participants p
        where p.conversation_id = c.id and p.user_id <> auth.uid() and not (p.user_id = any(v_ids))
     )
     and not exists (
       select 1 from unnest(v_ids) as selected_user(user_id)
        where not exists (
          select 1 from public.dockslot_chat_participants p
           where p.conversation_id = c.id and p.user_id = selected_user.user_id
        )
     )
   order by c.updated_at desc limit 1;
  if v_conversation_id is not null then return v_conversation_id; end if;

  insert into public.dockslot_chat_conversations (kind, title, created_by)
  values ('group', nullif(left(btrim(coalesce(p_title,'')), 80), ''), auth.uid())
  returning id into v_conversation_id;
  insert into public.dockslot_chat_participants (conversation_id, user_id)
  select v_conversation_id, participant.user_id
    from unnest(v_ids || array[auth.uid()]) as participant(user_id)
  on conflict do nothing;
  return v_conversation_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sending, editing, forwarding and reactions
-- -----------------------------------------------------------------------------
create or replace function public.dockslot_chat_send_message(
  p_conversation_id uuid,
  p_body text,
  p_booking_id uuid default null,
  p_target_user_id uuid default null,
  p_files jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_body text := coalesce(p_body, '');
  v_id uuid;
  v_file jsonb;
  v_max_chars integer;
  v_max_mb integer;
  v_max_files integer;
  v_count integer;
  v_size bigint;
  v_actual_size bigint;
  v_mime text;
  v_path text;
begin
  if auth.uid() is null or not public.dockslot_chat_can_access(p_conversation_id, auth.uid()) then
    raise exception 'Нет доступа к выбранной переписке.' using errcode = '42501';
  end if;
  select c.kind into v_kind from public.dockslot_chat_conversations c where c.id = p_conversation_id;
  if v_kind = 'direct' and not exists (
    select 1 from public.dockslot_chat_participants cp
     where cp.conversation_id = p_conversation_id
       and cp.user_id = p_target_user_id
       and public.dockslot_chat_enabled_for(cp.user_id)
  ) then
    raise exception 'У получателя личного сообщения отключён мессенджер.' using errcode = '42501';
  end if;
  if v_kind = 'group' and not exists (
    select 1 from public.dockslot_chat_participants cp
     where cp.conversation_id = p_conversation_id
       and cp.user_id <> auth.uid()
       and public.dockslot_chat_enabled_for(cp.user_id)
  ) then
    raise exception 'В группе нет других участников с включённым мессенджером.' using errcode = '42501';
  end if;
  select s.max_message_chars, s.max_attachment_size_mb, s.max_attachments_per_message
    into v_max_chars, v_max_mb, v_max_files
    from public.dockslot_chat_settings s where s.id = 1;
  v_count := case when jsonb_typeof(coalesce(p_files, '[]'::jsonb)) = 'array' then jsonb_array_length(coalesce(p_files, '[]'::jsonb)) else -1 end;
  if v_count < 0 or v_count > coalesce(v_max_files, 10) then
    raise exception 'Можно прикрепить не более % файлов к одному сообщению.', coalesce(v_max_files,10) using errcode = '22023';
  end if;
  if length(v_body) > coalesce(v_max_chars, 2000) then
    raise exception 'Максимальная длина сообщения — % символов.', coalesce(v_max_chars,2000) using errcode = '22023';
  end if;
  if length(btrim(v_body)) = 0 and v_count = 0 then
    raise exception 'Введите текст или прикрепите файл.' using errcode = '22023';
  end if;

  if v_kind = 'direct' then
    if p_target_user_id is null or p_target_user_id = auth.uid()
       or not exists (select 1 from public.dockslot_chat_participants p where p.conversation_id = p_conversation_id and p.user_id = p_target_user_id) then
      raise exception 'Не удалось определить адресата личного сообщения.' using errcode = '22023';
    end if;
  elsif v_kind = 'group' and p_target_user_id is not null then
    if p_target_user_id = auth.uid() or not exists (select 1 from public.dockslot_chat_participants p where p.conversation_id=p_conversation_id and p.user_id=p_target_user_id and public.dockslot_chat_enabled_for(p.user_id)) then
      raise exception 'Выбранный адресат не является активным участником группы.' using errcode = '42501';
    end if;
  elsif v_kind = 'general' and p_target_user_id is not null then
    raise exception 'В общем чате нельзя адресовать сообщение отдельному пользователю.' using errcode = '22023';
  end if;

  if p_booking_id is not null then
    if v_kind not in ('direct','group') or not exists (select 1 from public.dockslot_chat_settings s where s.id = 1 and s.booking_chat_enabled)
       or not exists (select 1 from public.bookings b where b.id = p_booking_id) then
      raise exception 'Привязка к записи слота недоступна.' using errcode = '42501';
    end if;
  end if;

  for v_file in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    v_path := v_file ->> 'storage_path';
    v_mime := lower(coalesce(v_file ->> 'mime_type',''));
    v_size := coalesce(nullif(v_file ->> 'file_size','')::bigint, 0);
    if v_path is null or v_path not like p_conversation_id::text || '/' || auth.uid()::text || '/%' then
      raise exception 'Некорректный путь загружаемого файла.' using errcode = '22023';
    end if;
    if v_size < 1 or v_size > coalesce(v_max_mb,20)::bigint * 1024 * 1024 then
      raise exception 'Размер вложения превышает допустимый лимит (% МБ).', coalesce(v_max_mb,20) using errcode = '22023';
    end if;
    if v_mime not in (
      'image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif',
      'application/pdf','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv','application/csv','application/vnd.ms-excel.sheet.macroenabled.12'
    ) then
      raise exception 'Тип файла не поддерживается.' using errcode = '22023';
    end if;
    select coalesce(nullif(o.metadata ->> 'size','')::bigint, 0)
      into v_actual_size
      from storage.objects o
     where o.bucket_id = 'dockslot-chat-files' and o.name = v_path;
    if not found then
      raise exception 'Файл не найден в защищённом хранилище.' using errcode = '22023';
    end if;
    if v_actual_size < 1 or v_actual_size <> v_size
       or v_actual_size > coalesce(v_max_mb,20)::bigint * 1024 * 1024 then
      raise exception 'Фактический размер файла не соответствует допустимому лимиту.' using errcode = '22023';
    end if;
  end loop;

  insert into public.dockslot_chat_messages (conversation_id, sender_id, body, booking_id, target_user_id)
  values (p_conversation_id, auth.uid(), v_body, p_booking_id, p_target_user_id)
  returning id into v_id;

  for v_file in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    insert into public.dockslot_chat_attachments (message_id, uploaded_by, storage_path, file_name, mime_type, file_size)
    values (v_id, auth.uid(), v_file ->> 'storage_path', left(coalesce(v_file ->> 'file_name','Файл'),255),
            lower(v_file ->> 'mime_type'), (v_file ->> 'file_size')::bigint);
  end loop;
  return v_id;
end;
$$;

create or replace function public.dockslot_chat_edit_message(p_message_id uuid, p_body text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.dockslot_chat_messages%rowtype;
  v_max_chars integer;
  v_has_files boolean;
  v_edited_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация.' using errcode = '42501'; end if;
  select * into v_message from public.dockslot_chat_messages m where m.id = p_message_id for update;
  if not found or v_message.sender_id <> auth.uid() or not public.dockslot_chat_can_access(v_message.conversation_id, auth.uid()) then
    raise exception 'Редактировать можно только собственные сообщения.' using errcode = '42501';
  end if;
  if v_message.created_at < now() - interval '6 months' or now() > v_message.created_at + interval '10 minutes' then
    raise exception 'Время редактирования сообщения (10 минут) истекло.' using errcode = 'P0001';
  end if;
  select max_message_chars into v_max_chars from public.dockslot_chat_settings where id = 1;
  select exists(select 1 from public.dockslot_chat_attachments a where a.message_id = p_message_id) into v_has_files;
  if length(coalesce(p_body,'')) > coalesce(v_max_chars,2000) or (length(btrim(coalesce(p_body,''))) = 0 and not v_has_files) then
    raise exception 'Введите текст сообщения или оставьте прикреплённый файл.' using errcode = '22023';
  end if;
  update public.dockslot_chat_messages set body = coalesce(p_body,''), edited_at = clock_timestamp()
   where id = p_message_id returning edited_at into v_edited_at;
  return v_edited_at;
end;
$$;

create or replace function public.dockslot_chat_forward_message(
  p_source_message_id uuid,
  p_target_conversation_id uuid,
  p_files jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.dockslot_chat_messages%rowtype;
  v_kind text;
  v_target_user_id uuid;
  v_id uuid;
  v_file jsonb;
  v_max_chars integer;
  v_max_mb integer;
  v_max_files integer;
  v_count integer;
  v_path text;
  v_mime text;
  v_size bigint;
  v_actual_size bigint;
begin
  if auth.uid() is null then raise exception 'Требуется авторизация.' using errcode = '42501'; end if;
  select * into v_source from public.dockslot_chat_messages m
   where m.id = p_source_message_id
     and m.created_at >= now() - interval '6 months'
     and public.dockslot_chat_can_access(m.conversation_id, auth.uid())
     and (m.target_user_id is null or m.target_user_id = auth.uid() or m.sender_id = auth.uid());
  if not found then raise exception 'Исходное сообщение недоступно для пересылки.' using errcode = '42501'; end if;
  if not public.dockslot_chat_can_access(p_target_conversation_id, auth.uid()) then
    raise exception 'Нет доступа к чату-получателю.' using errcode = '42501';
  end if;
  if p_target_conversation_id = v_source.conversation_id then
    raise exception 'Выберите другой чат для пересылки.' using errcode = '22023';
  end if;
  select c.kind into v_kind from public.dockslot_chat_conversations c where c.id = p_target_conversation_id;
  if v_kind not in ('direct','group') then raise exception 'Пересылать можно в личный или групповой чат.' using errcode = '22023'; end if;
  if v_kind = 'direct' then
    select p.user_id into v_target_user_id from public.dockslot_chat_participants p
     where p.conversation_id = p_target_conversation_id and p.user_id <> auth.uid() limit 1;
    if v_target_user_id is null or not public.dockslot_chat_enabled_for(v_target_user_id) then
      raise exception 'У получателя пересылки отключён мессенджер.' using errcode = '42501';
    end if;
  elsif not exists (
    select 1 from public.dockslot_chat_participants cp
     where cp.conversation_id = p_target_conversation_id
       and cp.user_id <> auth.uid()
       and public.dockslot_chat_enabled_for(cp.user_id)
  ) then
    raise exception 'В группе нет других участников с включённым мессенджером.' using errcode = '42501';
  end if;

  select s.max_message_chars, s.max_attachment_size_mb, s.max_attachments_per_message
    into v_max_chars, v_max_mb, v_max_files from public.dockslot_chat_settings s where s.id = 1;
  v_count := case when jsonb_typeof(coalesce(p_files, '[]'::jsonb)) = 'array' then jsonb_array_length(coalesce(p_files, '[]'::jsonb)) else -1 end;
  if v_count < 0 or v_count > coalesce(v_max_files,10) or length(v_source.body) > coalesce(v_max_chars,2000) then
    raise exception 'Пересылаемое сообщение превышает установленные ограничения.' using errcode = '22023';
  end if;
  for v_file in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    v_path := v_file ->> 'storage_path';
    v_mime := lower(coalesce(v_file ->> 'mime_type',''));
    v_size := coalesce(nullif(v_file ->> 'file_size','')::bigint,0);
    if v_path is null or v_path not like p_target_conversation_id::text || '/' || auth.uid()::text || '/%'
       or v_size < 1 or v_size > coalesce(v_max_mb,20)::bigint * 1024 * 1024
       or v_mime not in (
         'image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif','application/pdf','application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/csv',
         'application/vnd.ms-excel.sheet.macroenabled.12'
       ) then
      raise exception 'Недопустимое вложение при пересылке.' using errcode = '22023';
    end if;
    select coalesce(nullif(o.metadata ->> 'size','')::bigint, 0)
      into v_actual_size
      from storage.objects o
     where o.bucket_id='dockslot-chat-files' and o.name=v_path;
    if not found then
      raise exception 'Копия файла не найдена в хранилище.' using errcode = '22023';
    end if;
    if v_actual_size < 1 or v_actual_size <> v_size
       or v_actual_size > coalesce(v_max_mb,20)::bigint * 1024 * 1024 then
      raise exception 'Фактический размер копии файла не соответствует лимиту.' using errcode = '22023';
    end if;
  end loop;

  insert into public.dockslot_chat_messages
    (conversation_id, sender_id, body, booking_id, target_user_id, forwarded_from_message_id)
  values (p_target_conversation_id, auth.uid(), v_source.body,
          case when exists(select 1 from public.dockslot_chat_settings s where s.id=1 and s.booking_chat_enabled) then v_source.booking_id else null end,
          v_target_user_id, v_source.id)
  returning id into v_id;

  for v_file in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    insert into public.dockslot_chat_attachments (message_id, uploaded_by, storage_path, file_name, mime_type, file_size)
    values (v_id, auth.uid(), v_file ->> 'storage_path', left(coalesce(v_file ->> 'file_name','Файл'),255),
            lower(v_file ->> 'mime_type'), (v_file ->> 'file_size')::bigint);
  end loop;
  return v_id;
end;
$$;

create or replace function public.dockslot_chat_toggle_reaction(p_message_id uuid, p_reaction_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.dockslot_chat_messages%rowtype;
  v_removed integer;
begin
  if p_reaction_key is null or p_reaction_key not in ('heart','like','cry','laugh','rofl','strong','fire') then
    raise exception 'Неизвестная реакция.' using errcode = '22023';
  end if;
  select * into v_message from public.dockslot_chat_messages m
   where m.id = p_message_id and m.created_at >= now() - interval '6 months'
     and public.dockslot_chat_can_access(m.conversation_id, auth.uid())
     and (m.target_user_id is null or m.target_user_id = auth.uid() or m.sender_id = auth.uid());
  if not found then raise exception 'Сообщение недоступно.' using errcode = '42501'; end if;
  delete from public.dockslot_chat_message_reactions
   where message_id = p_message_id and user_id = auth.uid() and reaction_key = p_reaction_key;
  get diagnostics v_removed = row_count;
  if v_removed > 0 then return false; end if;
  insert into public.dockslot_chat_message_reactions (message_id, user_id, reaction_key)
  values (p_message_id, auth.uid(), p_reaction_key) on conflict do nothing;
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Read receipts, unread summaries and booking badges
-- -----------------------------------------------------------------------------
create or replace function public.dockslot_chat_mark_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows integer := 0;
begin
  if auth.uid() is null or not public.dockslot_chat_can_access(p_conversation_id, auth.uid()) then
    raise exception 'Нет доступа к этой переписке.' using errcode = '42501';
  end if;
  insert into public.dockslot_chat_message_reads (message_id, user_id)
  select m.id, auth.uid()
    from public.dockslot_chat_messages m
   where m.conversation_id = p_conversation_id
     and m.created_at >= now() - interval '6 months'
     and m.sender_id <> auth.uid()
     and (m.target_user_id is null or m.target_user_id = auth.uid())
  on conflict (message_id, user_id) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.dockslot_chat_unread_summary()
returns table (conversation_id uuid, unread_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select m.conversation_id, count(*)::bigint
    from public.dockslot_chat_messages m
    join public.dockslot_chat_conversations c on c.id = m.conversation_id
    left join public.dockslot_chat_message_reads r on r.message_id = m.id and r.user_id = auth.uid()
   where public.dockslot_chat_can_access(c.id, auth.uid())
     and m.created_at >= now() - interval '6 months'
     and m.sender_id <> auth.uid()
     and (m.target_user_id is null or m.target_user_id = auth.uid())
     and r.message_id is null
   group by m.conversation_id;
$$;

create or replace function public.dockslot_chat_booking_unread()
returns table (booking_id uuid, conversation_id uuid, unread_count bigint, latest_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.booking_id, m.conversation_id,
         count(*) filter (where r.message_id is null)::bigint, max(m.created_at)
    from public.dockslot_chat_messages m
    join public.dockslot_chat_conversations c on c.id = m.conversation_id
    left join public.dockslot_chat_message_reads r on r.message_id = m.id and r.user_id = auth.uid()
   where m.booking_id is not null
     and m.created_at >= now() - interval '6 months'
     and m.sender_id <> auth.uid()
     and (m.target_user_id = auth.uid() or (m.target_user_id is null and c.kind = 'group'
       and exists (select 1 from public.dockslot_chat_participants p where p.conversation_id = c.id and p.user_id = auth.uid())))
     and public.dockslot_chat_can_access(m.conversation_id, auth.uid())
   group by m.booking_id, m.conversation_id
   order by max(m.created_at) desc;
$$;

-- -----------------------------------------------------------------------------
-- Super Admin only, complete message archive (not limited to 6 months)
-- -----------------------------------------------------------------------------
create or replace function public.dockslot_chat_admin_history(
  p_before timestamptz default null,
  p_limit integer default 50,
  p_search text default null,
  p_before_id uuid default null
)
returns table (
  message_id uuid,
  conversation_id uuid,
  conversation_kind text,
  conversation_label text,
  participant_names text,
  sender_id uuid,
  sender_name text,
  sender_role text,
  body text,
  booking_id uuid,
  created_at timestamptz,
  edited_at timestamptz,
  forwarded_from_message_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not public.dockslot_chat_is_super_admin() then
    raise exception 'Полный архив переписок доступен только суперадминистратору.' using errcode = '42501';
  end if;
  return query
  with base as (
    select m.*, c.kind as conv_kind, c.title as conv_title,
           p.role::text as sender_role_value,
           coalesce(nullif(btrim(ct.full_name),''), nullif(btrim(u.raw_user_meta_data ->> 'full_name'),''),
                    nullif(btrim(p.company_name),''), nullif(split_part(u.email,'@',1),''), 'Сотрудник DockSlot') as sender_name_value,
           coalesce(nullif(btrim(c.title),''), case c.kind when 'general' then 'Общий чат' when 'group' then 'Групповой чат' else 'Личный диалог' end) as conv_label
      from public.dockslot_chat_messages m
      join public.dockslot_chat_conversations c on c.id=m.conversation_id
      left join public.profiles p on p.id=m.sender_id
      left join auth.users u on u.id=m.sender_id
      left join lateral (
        select x.full_name from public.contacts x where x.profile_id=m.sender_id
        order by x.is_primary desc nulls last limit 1
      ) ct on true
  )
  select b.id, b.conversation_id, b.conv_kind, b.conv_label,
         coalesce(parts.names,'')::text,
         b.sender_id, b.sender_name_value, b.sender_role_value, b.body, b.booking_id,
         b.created_at, b.edited_at, b.forwarded_from_message_id
    from base b
    left join lateral (
      select string_agg(coalesce(nullif(btrim(ct2.full_name),''), nullif(btrim(u2.raw_user_meta_data ->> 'full_name'),''),
                                  nullif(btrim(p2.company_name),''), nullif(split_part(u2.email,'@',1),''), 'Сотрудник'), ', ' order by cp.added_at) as names
        from public.dockslot_chat_participants cp
        left join public.profiles p2 on p2.id=cp.user_id
        left join auth.users u2 on u2.id=cp.user_id
        left join lateral (select x.full_name from public.contacts x where x.profile_id=cp.user_id
                            order by x.is_primary desc nulls last limit 1) ct2 on true
       where cp.conversation_id=b.conversation_id
    ) parts on true
   where (p_before is null
          or b.created_at < p_before
          or (b.created_at = p_before and (p_before_id is null or b.id < p_before_id)))
     and (nullif(btrim(p_search),'') is null
          or b.body ilike '%' || btrim(p_search) || '%'
          or b.sender_name_value ilike '%' || btrim(p_search) || '%'
          or b.conv_label ilike '%' || btrim(p_search) || '%'
          or coalesce(parts.names,'') ilike '%' || btrim(p_search) || '%')
   order by b.created_at desc, b.id desc
   limit greatest(1, least(coalesce(p_limit,50),200));
end;
$$;

-- -----------------------------------------------------------------------------
-- Private Storage bucket and authorization helper
-- -----------------------------------------------------------------------------
create or replace function public.dockslot_chat_storage_can_access(p_name text, p_for_upload boolean default false)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_owner_id uuid;
begin
  if auth.uid() is null or p_name is null then return false; end if;
  if split_part(p_name,'/',1) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or split_part(p_name,'/',2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  v_conversation_id := split_part(p_name,'/',1)::uuid;
  v_owner_id := split_part(p_name,'/',2)::uuid;
  if p_for_upload then
    return v_owner_id = auth.uid() and public.dockslot_chat_can_access(v_conversation_id, auth.uid());
  end if;
  if public.dockslot_chat_is_super_admin() then return true; end if;
  return exists (
    select 1 from public.dockslot_chat_attachments a
    join public.dockslot_chat_messages m on m.id=a.message_id
    where a.storage_path=p_name
      and m.created_at >= now() - interval '6 months'
      and public.dockslot_chat_can_access(m.conversation_id, auth.uid())
      and (m.target_user_id is null or m.target_user_id=auth.uid() or m.sender_id=auth.uid())
  );
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dockslot-chat-files', 'dockslot-chat-files', false, 52428800,
  array['image/jpeg','image/png','image/gif','image/webp','image/heic','image/heif','application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/csv',
        'application/vnd.ms-excel.sheet.macroenabled.12']::text[]
)
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists dockslot_chat_files_select on storage.objects;
create policy dockslot_chat_files_select on storage.objects
for select to authenticated
using (bucket_id='dockslot-chat-files' and public.dockslot_chat_storage_can_access(name,false));

drop policy if exists dockslot_chat_files_insert on storage.objects;
create policy dockslot_chat_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='dockslot-chat-files'
  and public.dockslot_chat_storage_can_access(name,true)
  and coalesce(nullif(metadata ->> 'size','')::bigint,0) > 0
  and coalesce(nullif(metadata ->> 'size','')::bigint,0) <= (
    select coalesce(s.max_attachment_size_mb,20)::bigint * 1024 * 1024
      from public.dockslot_chat_settings s where s.id=1
  )
);

drop policy if exists dockslot_chat_files_delete_own on storage.objects;
create policy dockslot_chat_files_delete_own on storage.objects
for delete to authenticated
using (bucket_id='dockslot-chat-files' and split_part(name,'/',2)=auth.uid()::text
       and public.dockslot_chat_storage_can_access(name,true)
       and not exists (select 1 from public.dockslot_chat_attachments a where a.storage_path=storage.objects.name));

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.dockslot_chat_settings enable row level security;
alter table public.dockslot_chat_conversations enable row level security;
alter table public.dockslot_chat_participants enable row level security;
alter table public.dockslot_chat_messages enable row level security;
alter table public.dockslot_chat_message_reads enable row level security;
alter table public.dockslot_chat_attachments enable row level security;
alter table public.dockslot_chat_message_reactions enable row level security;

drop policy if exists dockslot_chat_settings_read on public.dockslot_chat_settings;
create policy dockslot_chat_settings_read on public.dockslot_chat_settings
for select to authenticated
using (public.dockslot_chat_is_super_admin() or public.dockslot_chat_self_enabled());

drop policy if exists dockslot_chat_settings_update on public.dockslot_chat_settings;
create policy dockslot_chat_settings_update on public.dockslot_chat_settings
for update to authenticated
using (public.dockslot_chat_is_super_admin())
with check (public.dockslot_chat_is_super_admin());

drop policy if exists dockslot_chat_conversations_read on public.dockslot_chat_conversations;
create policy dockslot_chat_conversations_read on public.dockslot_chat_conversations
for select to authenticated
using (
  public.dockslot_chat_can_access(id, auth.uid())
  and (kind='general' or updated_at >= now() - interval '6 months')
);

drop policy if exists dockslot_chat_participants_read on public.dockslot_chat_participants;
create policy dockslot_chat_participants_read on public.dockslot_chat_participants
for select to authenticated
using (
  exists (
    select 1 from public.dockslot_chat_conversations c
     where c.id=conversation_id and (c.kind='general' or c.updated_at >= now() - interval '6 months')
  )
  and (user_id=auth.uid() or public.dockslot_chat_can_access(conversation_id, auth.uid()))
);

drop policy if exists dockslot_chat_messages_read on public.dockslot_chat_messages;
create policy dockslot_chat_messages_read on public.dockslot_chat_messages
for select to authenticated
using (
  created_at >= now() - interval '6 months'
  and public.dockslot_chat_can_access(conversation_id, auth.uid())
  and (target_user_id is null or target_user_id=auth.uid() or sender_id=auth.uid())
);

-- Message creation is only allowed through SECURITY DEFINER RPC; raw INSERT/UPDATE is revoked.
drop policy if exists dockslot_chat_messages_insert on public.dockslot_chat_messages;
drop policy if exists dockslot_chat_reads_read on public.dockslot_chat_message_reads;
create policy dockslot_chat_reads_read on public.dockslot_chat_message_reads
for select to authenticated
using (
  exists (
    select 1 from public.dockslot_chat_messages m
     where m.id=message_id
       and m.created_at >= now() - interval '6 months'
       and public.dockslot_chat_can_access(m.conversation_id, auth.uid())
       and (user_id=auth.uid() or m.sender_id=auth.uid())
  )
);
drop policy if exists dockslot_chat_reads_insert on public.dockslot_chat_message_reads;

-- Attachment metadata is private to chat participants for 6 months; Super Admin can inspect all history.
drop policy if exists dockslot_chat_attachments_read on public.dockslot_chat_attachments;
create policy dockslot_chat_attachments_read on public.dockslot_chat_attachments
for select to authenticated
using (
  public.dockslot_chat_is_super_admin()
  or exists (
    select 1 from public.dockslot_chat_messages m
     where m.id=message_id and m.created_at >= now() - interval '6 months'
       and public.dockslot_chat_can_access(m.conversation_id, auth.uid())
       and (m.target_user_id is null or m.target_user_id=auth.uid() or m.sender_id=auth.uid())
  )
);

drop policy if exists dockslot_chat_reactions_read on public.dockslot_chat_message_reactions;
create policy dockslot_chat_reactions_read on public.dockslot_chat_message_reactions
for select to authenticated
using (
  public.dockslot_chat_is_super_admin()
  or exists (
    select 1 from public.dockslot_chat_messages m
     where m.id=message_id and m.created_at >= now() - interval '6 months'
       and public.dockslot_chat_can_access(m.conversation_id, auth.uid())
       and (m.target_user_id is null or m.target_user_id=auth.uid() or m.sender_id=auth.uid())
  )
);

-- -----------------------------------------------------------------------------
-- Grants: participants can read their own recent history; all writes use RPC.
-- -----------------------------------------------------------------------------
revoke all on public.dockslot_chat_settings, public.dockslot_chat_conversations,
  public.dockslot_chat_participants, public.dockslot_chat_messages,
  public.dockslot_chat_message_reads, public.dockslot_chat_attachments,
  public.dockslot_chat_message_reactions from public, anon, authenticated;

grant select on public.dockslot_chat_settings to authenticated;
grant update (enabled, enabled_roles, general_chat_enabled, direct_chat_enabled,
  booking_chat_enabled, max_message_chars, max_messages_per_minute,
  max_attachment_size_mb, max_attachments_per_message, updated_by)
  on public.dockslot_chat_settings to authenticated;
grant select on public.dockslot_chat_conversations, public.dockslot_chat_participants,
  public.dockslot_chat_messages, public.dockslot_chat_message_reads,
  public.dockslot_chat_attachments, public.dockslot_chat_message_reactions to authenticated;

revoke all on function public.dockslot_chat_set_updated_at() from public, anon, authenticated;
revoke all on function public.dockslot_chat_touch_conversation() from public, anon, authenticated;
revoke all on function public.dockslot_chat_enforce_send_limit() from public, anon, authenticated;
revoke all on function public.dockslot_chat_enabled_for(uuid) from public, anon, authenticated;
revoke all on function public.dockslot_chat_self_enabled() from public, anon;
revoke all on function public.dockslot_chat_is_super_admin() from public, anon;
revoke all on function public.dockslot_chat_can_access(uuid, uuid) from public, anon;
revoke all on function public.dockslot_chat_storage_can_access(text, boolean) from public, anon;
revoke all on function public.dockslot_chat_list_users() from public, anon;
revoke all on function public.dockslot_chat_create_direct(uuid) from public, anon;
revoke all on function public.dockslot_chat_create_group(uuid[], text) from public, anon;
revoke all on function public.dockslot_chat_send_message(uuid, text, uuid, uuid, jsonb) from public, anon;
revoke all on function public.dockslot_chat_edit_message(uuid, text) from public, anon;
revoke all on function public.dockslot_chat_forward_message(uuid, uuid, jsonb) from public, anon;
revoke all on function public.dockslot_chat_toggle_reaction(uuid, text) from public, anon;
revoke all on function public.dockslot_chat_mark_read(uuid) from public, anon;
revoke all on function public.dockslot_chat_unread_summary() from public, anon;
revoke all on function public.dockslot_chat_booking_unread() from public, anon;
revoke all on function public.dockslot_chat_admin_history(timestamptz, integer, text, uuid) from public, anon;

grant execute on function public.dockslot_chat_self_enabled() to authenticated;
grant execute on function public.dockslot_chat_is_super_admin() to authenticated;
grant execute on function public.dockslot_chat_can_access(uuid, uuid) to authenticated;
grant execute on function public.dockslot_chat_storage_can_access(text, boolean) to authenticated;
grant execute on function public.dockslot_chat_list_users() to authenticated;
grant execute on function public.dockslot_chat_create_direct(uuid) to authenticated;
grant execute on function public.dockslot_chat_create_group(uuid[], text) to authenticated;
grant execute on function public.dockslot_chat_send_message(uuid, text, uuid, uuid, jsonb) to authenticated;
grant execute on function public.dockslot_chat_edit_message(uuid, text) to authenticated;
grant execute on function public.dockslot_chat_forward_message(uuid, uuid, jsonb) to authenticated;
grant execute on function public.dockslot_chat_toggle_reaction(uuid, text) to authenticated;
grant execute on function public.dockslot_chat_mark_read(uuid) to authenticated;
grant execute on function public.dockslot_chat_unread_summary() to authenticated;
grant execute on function public.dockslot_chat_booking_unread() to authenticated;
revoke all on function public.dockslot_chat_admin_history(timestamptz, integer, text, uuid) from authenticated, anon, public;
grant execute on function public.dockslot_chat_admin_history(timestamptz, integer, text, uuid) to service_role;

-- -----------------------------------------------------------------------------
-- Realtime subscriptions
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dockslot_chat_messages') then
    alter publication supabase_realtime add table public.dockslot_chat_messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dockslot_chat_message_reads') then
    alter publication supabase_realtime add table public.dockslot_chat_message_reads;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dockslot_chat_attachments') then
    alter publication supabase_realtime add table public.dockslot_chat_attachments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dockslot_chat_message_reactions') then
    alter publication supabase_realtime add table public.dockslot_chat_message_reactions;
  end if;
exception when undefined_object then
  raise notice 'supabase_realtime publication is not present; enable Realtime for messenger tables in Supabase Dashboard.';
end;
$$;

commit;
