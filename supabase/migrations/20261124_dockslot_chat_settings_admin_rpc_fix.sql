-- DockSlot Messenger v1.5
-- Fixes settings save on the management page without relying on PostgREST
-- UPDATE ... RETURNING .single(). The function checks the authoritative
-- profiles row and only permits an active super_admin.

begin;

create or replace function public.dockslot_chat_update_settings(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_is_blocked boolean;
  v_roles text[];
  v_row public.dockslot_chat_settings%rowtype;
  v_max_chars integer;
  v_max_per_minute integer;
  v_max_attachment_mb integer;
  v_max_attachments integer;
begin
  if v_uid is null then
    raise exception 'Требуется авторизация.' using errcode = '28000';
  end if;

  select p.role::text, coalesce(p.is_blocked, false)
    into v_role, v_is_blocked
    from public.profiles p
   where p.id = v_uid;

  if not found or coalesce(v_role, '') <> 'super_admin' or v_is_blocked then
    raise exception 'Недостаточно прав для изменения настроек мессенджера.' using errcode = '42501';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Некорректный формат настроек.' using errcode = '22023';
  end if;

  if not (p_payload ?& array[
    'enabled', 'enabled_roles', 'general_chat_enabled', 'direct_chat_enabled',
    'booking_chat_enabled', 'max_message_chars', 'max_messages_per_minute',
    'max_attachment_size_mb', 'max_attachments_per_message'
  ]) then
    raise exception 'Переданы не все параметры настроек.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload->'enabled') <> 'boolean'
     or jsonb_typeof(p_payload->'general_chat_enabled') <> 'boolean'
     or jsonb_typeof(p_payload->'direct_chat_enabled') <> 'boolean'
     or jsonb_typeof(p_payload->'booking_chat_enabled') <> 'boolean' then
    raise exception 'Флаги включения должны иметь логический тип.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload->'enabled_roles') <> 'array' then
    raise exception 'Список ролей должен быть массивом.' using errcode = '22023';
  end if;

  select coalesce(array_agg(item.value), array[]::text[])
    into v_roles
    from jsonb_array_elements_text(p_payload->'enabled_roles') as item(value);

  if cardinality(v_roles) = 0
     or exists (
       select 1 from unnest(v_roles) as r(role)
       where r.role not in ('admin', 'operator', 'super_admin')
     ) then
    raise exception 'В списке доступны только роли admin, operator и super_admin; выберите хотя бы одну.'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_payload->'max_message_chars') <> 'number'
     or jsonb_typeof(p_payload->'max_messages_per_minute') <> 'number'
     or jsonb_typeof(p_payload->'max_attachment_size_mb') <> 'number'
     or jsonb_typeof(p_payload->'max_attachments_per_message') <> 'number' then
    raise exception 'Числовые ограничения переданы в неверном формате.' using errcode = '22023';
  end if;

  if (p_payload->>'max_message_chars')::numeric <> trunc((p_payload->>'max_message_chars')::numeric)
     or (p_payload->>'max_messages_per_minute')::numeric <> trunc((p_payload->>'max_messages_per_minute')::numeric)
     or (p_payload->>'max_attachment_size_mb')::numeric <> trunc((p_payload->>'max_attachment_size_mb')::numeric)
     or (p_payload->>'max_attachments_per_message')::numeric <> trunc((p_payload->>'max_attachments_per_message')::numeric) then
    raise exception 'Числовые ограничения должны быть целыми числами.' using errcode = '22023';
  end if;

  v_max_chars := (p_payload->>'max_message_chars')::integer;
  v_max_per_minute := (p_payload->>'max_messages_per_minute')::integer;
  v_max_attachment_mb := (p_payload->>'max_attachment_size_mb')::integer;
  v_max_attachments := (p_payload->>'max_attachments_per_message')::integer;

  if v_max_chars not between 100 and 10000 then
    raise exception 'Лимит длины сообщения должен быть от 100 до 10 000 символов.' using errcode = '22023';
  end if;
  if v_max_per_minute not between 1 and 60 then
    raise exception 'Лимит частоты должен быть от 1 до 60 сообщений в минуту.' using errcode = '22023';
  end if;
  if v_max_attachment_mb not between 1 and 50 then
    raise exception 'Размер файла должен быть от 1 до 50 МБ.' using errcode = '22023';
  end if;
  if v_max_attachments not between 1 and 10 then
    raise exception 'Количество файлов должно быть от 1 до 10.' using errcode = '22023';
  end if;

  update public.dockslot_chat_settings
     set enabled = (p_payload->>'enabled')::boolean,
         enabled_roles = v_roles,
         general_chat_enabled = (p_payload->>'general_chat_enabled')::boolean,
         direct_chat_enabled = (p_payload->>'direct_chat_enabled')::boolean,
         booking_chat_enabled = (p_payload->>'booking_chat_enabled')::boolean,
         max_message_chars = v_max_chars,
         max_messages_per_minute = v_max_per_minute,
         max_attachment_size_mb = v_max_attachment_mb,
         max_attachments_per_message = v_max_attachments,
         updated_at = now(),
         updated_by = v_uid
   where id = 1
   returning * into v_row;

  if not found then
    raise exception 'Строка настроек мессенджера id = 1 не найдена. Выполните основную SQL-миграцию Messenger v1.2.'
      using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$function$;

revoke all on function public.dockslot_chat_update_settings(jsonb) from public, anon, authenticated;
grant execute on function public.dockslot_chat_update_settings(jsonb) to authenticated;

commit;
