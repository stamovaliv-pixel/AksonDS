-- AKSon DockSlot security hardening v4.1
-- Adds administrator-managed booking-excluded dates, server enforcement, and scheduled expiry cleanup.
-- Run in Supabase SQL Editor as project owner only after a current backup and preflight checks.
-- The script assumes the application tables/columns used by the current frontend already exist.
-- Prepared using the supplied production trigger and Storage-policy definitions; not executed against production.
-- This migration replaces RLS policies on five public tables and changes registries to private.

begin;

-- v4.1: excluded calendar dates. A date here blocks new active bookings regardless of weekday.
alter table public.app_settings
  add column if not exists booking_excluded_dates date[] not null default '{}'::date[];

update public.app_settings
set booking_excluded_dates = '{}'::date[]
where booking_excluded_dates is null;

alter table public.app_settings
  alter column booking_excluded_dates set default '{}'::date[],
  alter column booking_excluded_dates set not null;

-- Daily/hourly cleanup uses the warehouse business timezone (Asia/Almaty).
create or replace function public.cleanup_expired_booking_excluded_dates()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := timezone('Asia/Almaty', now())::date;
  v_rows integer := 0;
begin
  update public.app_settings s
     set booking_excluded_dates = coalesce(
       (select array_agg(d order by d)
          from unnest(coalesce(s.booking_excluded_dates, '{}'::date[])) as dates(d)
         where d >= v_today),
       '{}'::date[]
     )
   where s.id = 1
     and exists (
       select 1
         from unnest(coalesce(s.booking_excluded_dates, '{}'::date[])) as dates(d)
        where d < v_today
     );

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function public.cleanup_expired_booking_excluded_dates() from public, anon, authenticated;

-- 1) Role helpers. SECURITY DEFINER prevents RLS recursion when policies inspect profiles.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role::text
  from public.profiles p
  where p.id = auth.uid()
  limit 1;
$$;

create or replace function public.is_active_app_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.is_blocked, false) = false
  );
$$;

revoke all on function public.current_app_role() from public, anon;
revoke all on function public.is_active_app_user() from public, anon;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_active_app_user() to authenticated;

-- 2) New registrations always create a supplier profile and its primary contact.
-- Role is assigned here, never copied from user-controlled auth metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, company_name, inn, role, is_blocked)
  values (
    new.id,
    nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'company_name', '')), 250), ''),
    nullif(left(trim(coalesce(new.raw_user_meta_data ->> 'inn', '')), 20), ''),
    'supplier',
    false
  )
  on conflict (id) do nothing;

  -- Keep the existing registration workflow: every new profile gets a primary contact.
  -- NOT EXISTS makes the handler safe if a profile/contact was pre-created by an admin.
  insert into public.contacts (profile_id, full_name, phone, is_primary)
  select
    new.id,
    left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 200),
    left(trim(coalesce(new.raw_user_meta_data ->> 'phone', '')), 50),
    true
  where not exists (
    select 1
    from public.contacts c
    where c.profile_id = new.id
      and c.is_primary is true
  );

  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Keep one Auth trigger, preserving the current trigger name and event.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Profile guard: a user cannot self-promote or unblock themselves through PostgREST.
create or replace function public.guard_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  if auth.uid() is not null then
    v_role := coalesce(public.current_app_role(), '');
    if v_role <> 'admin' and (
      new.role is distinct from old.role
      or new.is_blocked is distinct from old.is_blocked
    ) then
      raise exception 'Изменение роли и блокировки доступно только администратору.'
        using errcode = '42501';
    end if;
    if new.id is distinct from old.id then
      raise exception 'Изменение идентификатора профиля запрещено.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_profile_privileged_fields() from public, anon, authenticated;

drop trigger if exists profiles_guard_privileged_fields on public.profiles;
create trigger profiles_guard_privileged_fields
before update on public.profiles
for each row execute function public.guard_profile_privileged_fields();

-- 3) Remove the overly broad prior policies from the audited tables and replace them.
-- The current screenshot shows bookings policies applied to PUBLIC; these are removed here.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'bookings', 'contacts', 'app_settings', 'audit_log')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.contacts enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_log enable row level security;

-- Remove accidental anonymous/table-wide rights. Column grants on profiles intentionally
-- allow editing only regular profile fields; role is not writable from the browser.
revoke all on table public.profiles, public.bookings, public.contacts,
  public.app_settings, public.audit_log from public, anon, authenticated;

-- Table-level REVOKE does not necessarily remove old column-level grants; clear those too.
do $$
declare r record; v_grantee text;
begin
  for r in
    select table_name, column_name, grantee
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name in ('profiles', 'bookings', 'contacts', 'app_settings', 'audit_log')
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  loop
    v_grantee := case when r.grantee = 'PUBLIC' then 'PUBLIC' else quote_ident(r.grantee) end;
    execute format('REVOKE ALL PRIVILEGES (%I) ON TABLE public.%I FROM %s',
      r.column_name, r.table_name, v_grantee);
  end loop;
end $$;

grant select on table public.profiles to authenticated;
grant update (company_name, inn) on table public.profiles to authenticated;
grant update (is_blocked) on table public.profiles to authenticated;
-- Role is deliberately not granted for client-side UPDATE.

 grant select, delete on table public.bookings to authenticated;
revoke insert, update on table public.bookings from authenticated;
grant insert (profile_id, slot_date, slot_hour, supply_types, supply_type, order_type,
              order_number, registry_file_url, is_tk, comment, status)
  on table public.bookings to authenticated;
grant update (slot_date, slot_hour, profile_id, supply_types, supply_type, order_type,
              order_number, registry_file_url, is_tk, comment, gate_number,
              arrival_time, departure_time)
  on table public.bookings to authenticated;

grant select, delete on table public.contacts to authenticated;
revoke insert, update on table public.contacts from authenticated;
grant insert (profile_id, full_name, phone, is_primary) on table public.contacts to authenticated;
grant update (full_name, phone) on table public.contacts to authenticated;
grant select on table public.app_settings to authenticated;
grant update on table public.app_settings to authenticated;
grant select on table public.audit_log to authenticated;

-- profiles: user sees their own profile; operational staff can look up suppliers.
create policy profiles_select_own_or_staff
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or (public.is_active_app_user() and public.current_app_role() in ('admin', 'operator', 'viewer'))
);

create policy profiles_update_own_or_admin
on public.profiles for update to authenticated
using (
  public.is_active_app_user()
  and (id = auth.uid() or public.current_app_role() = 'admin')
)
with check (
  public.is_active_app_user()
  and (id = auth.uid() or public.current_app_role() = 'admin')
);

-- bookings: suppliers only see their records; staff roles can see all operational records.
create policy bookings_select_own_or_staff
on public.bookings for select to authenticated
using (
  public.is_active_app_user()
  and (
    profile_id = auth.uid()
    or public.current_app_role() in ('admin', 'operator', 'viewer')
  )
);

create policy bookings_insert_own_or_operator
on public.bookings for insert to authenticated
with check (
  public.is_active_app_user()
  and (
    (public.current_app_role() = 'supplier' and profile_id = auth.uid())
    or public.current_app_role() in ('admin', 'operator')
  )
);

create policy bookings_update_own_or_operator
on public.bookings for update to authenticated
using (
  public.is_active_app_user()
  and (
    (public.current_app_role() = 'supplier' and profile_id = auth.uid())
    or public.current_app_role() in ('admin', 'operator')
  )
)
with check (
  public.is_active_app_user()
  and (
    (public.current_app_role() = 'supplier' and profile_id = auth.uid())
    or public.current_app_role() in ('admin', 'operator')
  )
);

create policy bookings_delete_own_or_operator
on public.bookings for delete to authenticated
using (
  public.is_active_app_user()
  and (
    (public.current_app_role() = 'supplier' and profile_id = auth.uid())
    or public.current_app_role() in ('admin', 'operator')
  )
);

-- contacts: self-service contact rows belong to one profile; staff can help troubleshoot.
create policy contacts_select_own_or_staff
on public.contacts for select to authenticated
using (
  public.is_active_app_user()
  and (profile_id = auth.uid() or public.current_app_role() in ('admin', 'operator'))
);
create policy contacts_insert_own_or_staff
on public.contacts for insert to authenticated
with check (
  public.is_active_app_user()
  and (profile_id = auth.uid() or public.current_app_role() in ('admin', 'operator'))
);
create policy contacts_update_own_or_staff
on public.contacts for update to authenticated
using (
  public.is_active_app_user()
  and (profile_id = auth.uid() or public.current_app_role() in ('admin', 'operator'))
)
with check (
  public.is_active_app_user()
  and (profile_id = auth.uid() or public.current_app_role() in ('admin', 'operator'))
);
create policy contacts_delete_own_or_staff
on public.contacts for delete to authenticated
using (
  public.is_active_app_user()
  and (profile_id = auth.uid() or public.current_app_role() in ('admin', 'operator'))
);

-- Settings are readable by active signed-in users; only admins can change them.
create policy app_settings_select_authenticated
on public.app_settings for select to authenticated
using (public.is_active_app_user());
create policy app_settings_update_admin
on public.app_settings for update to authenticated
using (public.is_active_app_user() and public.current_app_role() = 'admin')
with check (public.is_active_app_user() and public.current_app_role() = 'admin');

-- Audit log is read-only from the browser and visible only to admins.
create policy audit_log_select_admin
on public.audit_log for select to authenticated
using (public.is_active_app_user() and public.current_app_role() = 'admin');

-- Convert only URLs for this project's registries bucket into object keys.
-- Strip query strings/fragments from old signed URLs instead of saving tokens into the key.
update public.bookings
set registry_file_url = regexp_replace(
  registry_file_url,
  '^https?://[^/]+/storage/v1/object/(public|sign)/registries/([^?#]*).*$','\2','i'
)
where registry_file_url ~* '^https?://[^/]+/storage/v1/object/(public|sign)/registries/';

update public.app_settings
set registry_template_url = regexp_replace(
  registry_template_url,
  '^https?://[^/]+/storage/v1/object/(public|sign)/registries/([^?#]*).*$','\2','i'
)
where registry_template_url ~* '^https?://[^/]+/storage/v1/object/(public|sign)/registries/';

-- 4) Server-side booking validation. Advisory transaction locks serialize concurrent
-- inserts/updates to the same date/hour before counting capacity.
create or replace function public.validate_booking_server_side()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_start_hour integer;
  v_end_hour integer;
  v_slots_per_hour integer;
  v_reserve_per_hour integer;
  v_deadline_hours integer;
  v_return_deadline_days integer;
  v_available_days jsonb;
  v_excluded_dates date[];
  v_local_now timestamp;
  v_today date;
  v_is_slot_change boolean;
  v_is_type_change boolean;
  v_capacity_change boolean;
  v_types jsonb;
  v_is_im_only boolean;
  v_im_count bigint := 0;
  v_regular_count bigint := 0;
  v_reserve_used bigint := 0;
  v_main_used bigint := 0;
  v_path text;
  v_gate text;
  v_old_gate text;
  v_lock_key text;
  v_gate_lock_keys text[] := array[]::text[];
  v_gate_check_needed boolean := false;
  v_gate_state_changed boolean := false;
begin
  if auth.uid() is not null then
    if not public.is_active_app_user() then
      raise exception 'Учетная запись заблокирована или профиль не найден.' using errcode = '42501';
    end if;
    v_role := coalesce(public.current_app_role(), '');
  else
    -- Service-role/migration calls may have no auth.uid(); keep validation, but don't apply user-role checks.
    v_role := 'service';
  end if;

  -- Use the warehouse's business timezone for same-day permissions and deadline checks.
  v_local_now := timezone('Asia/Almaty', now());
  v_today := v_local_now::date;

  -- Registry files can be replaced through the arrival date, inclusive, but not afterward.
  -- Check both old and new booking dates so moving an old booking cannot bypass the rule.
  if TG_OP = 'UPDATE'
     and new.registry_file_url is distinct from old.registry_file_url
     and (old.slot_date < v_today or new.slot_date < v_today) then
    raise exception 'Реестр можно изменить только до конца дня приезда.' using errcode = '42501';
  end if;

  if TG_OP = 'UPDATE' then
    v_is_slot_change := new.slot_date is distinct from old.slot_date
      or new.slot_hour is distinct from old.slot_hour;
    v_is_type_change := new.supply_types is distinct from old.supply_types
      or new.supply_type is distinct from old.supply_type;
  else
    v_is_slot_change := true;
    v_is_type_change := true;
  end if;
  v_capacity_change := v_is_slot_change or v_is_type_change
    or (TG_OP = 'UPDATE' and new.status is distinct from old.status);

  if v_role = 'supplier' then
    if TG_OP = 'INSERT' and new.profile_id is distinct from auth.uid() then
      raise exception 'Нельзя создавать запись от имени другого поставщика.' using errcode = '42501';
    end if;
    if TG_OP = 'INSERT' and new.status is distinct from 'active' then
      raise exception 'Поставщик может создавать только активные записи.' using errcode = '42501';
    end if;
    if TG_OP = 'UPDATE' and (
      new.profile_id is distinct from old.profile_id
      or new.slot_date is distinct from old.slot_date
      or new.slot_hour is distinct from old.slot_hour
      or new.status is distinct from old.status
      or new.gate_number is distinct from old.gate_number
      or new.arrival_time is distinct from old.arrival_time
      or new.departure_time is distinct from old.departure_time
    ) then
      raise exception 'Поставщик не может менять владельца, дату, время, статус или служебные отметки записи.' using errcode = '42501';
    end if;
  elsif v_role not in ('admin', 'operator', 'service') then
    raise exception 'Роль не имеет права изменять записи.' using errcode = '42501';
  end if;

  -- Gate occupancy is independent of the booking-hour slot. A gate is occupied while
  -- gate_number is set and departure_time is NULL; recording departure frees it.
  v_gate := nullif(lower(trim(coalesce(new.gate_number::text, ''))), '');
  if TG_OP = 'UPDATE' then
    v_old_gate := nullif(lower(trim(coalesce(old.gate_number::text, ''))), '');
    v_gate_state_changed := new.gate_number is distinct from old.gate_number
      or new.slot_date is distinct from old.slot_date
      or new.departure_time is distinct from old.departure_time
      or new.status is distinct from old.status;

    if v_gate_state_changed and old.status = 'active' and v_old_gate is not null then
      v_gate_lock_keys := array_append(v_gate_lock_keys, old.slot_date::text || ':' || v_old_gate);
    end if;
    if v_gate_state_changed and new.status = 'active' and v_gate is not null then
      v_gate_lock_keys := array_append(v_gate_lock_keys, new.slot_date::text || ':' || v_gate);
    end if;

    v_gate_check_needed := new.status = 'active'
      and v_gate is not null
      and new.departure_time is null
      and (
        new.gate_number is distinct from old.gate_number
        or new.slot_date is distinct from old.slot_date
        or (old.departure_time is not null and new.departure_time is null)
        or old.status is distinct from 'active'
      );
  else
    if new.status = 'active' and v_gate is not null then
      v_gate_lock_keys := array_append(v_gate_lock_keys, new.slot_date::text || ':' || v_gate);
      v_gate_check_needed := new.departure_time is null;
    end if;
  end if;

  -- Acquire old and new gate locks in a deterministic order to avoid races while freeing/reassigning gates.
  for v_lock_key in
    select distinct lock_key
    from unnest(v_gate_lock_keys) as gate_locks(lock_key)
    order by lock_key
  loop
    perform pg_advisory_xact_lock(hashtext(v_lock_key), 83643);
  end loop;

  if v_gate_check_needed and exists (
    select 1
    from public.bookings b
    where b.id is distinct from new.id
      and b.slot_date = new.slot_date
      and b.status = 'active'
      and b.departure_time is null
      and nullif(lower(trim(coalesce(b.gate_number::text, ''))), '') = v_gate
  ) then
    raise exception 'Ворота % заняты другой поставкой. После указания времени убытия ворота освободятся.', trim(new.gate_number::text)
      using errcode = '23514';
  end if;

  if new.status is distinct from 'active' then
    return new;
  end if;

  select slot_start_hour, slot_end_hour, slots_per_hour, reserve_slots_per_hour,
         booking_deadline_hours, return_deadline_days, to_jsonb(available_days),
         coalesce(booking_excluded_dates, '{}'::date[])
    into v_start_hour, v_end_hour, v_slots_per_hour, v_reserve_per_hour,
         v_deadline_hours, v_return_deadline_days, v_available_days, v_excluded_dates
  from public.app_settings
  where id = 1
  for share;

  if v_start_hour is null or v_end_hour is null then
    raise exception 'Настройки расписания не заданы.' using errcode = '23514';
  end if;
  v_slots_per_hour := greatest(coalesce(v_slots_per_hour, 5), 0);
  v_reserve_per_hour := greatest(coalesce(v_reserve_per_hour, 3), 0);
  v_deadline_hours := greatest(coalesce(v_deadline_hours, 1), 0);
  v_return_deadline_days := greatest(coalesce(v_return_deadline_days, 0), 0);

  v_available_days := coalesce(v_available_days, '[1,2,3,4,5,6,7]'::jsonb);
  if jsonb_typeof(v_available_days) <> 'array' then
    raise exception 'Настройка доступных дней имеет неверный формат.' using errcode = '23514';
  end if;

  if v_capacity_change then
    if new.slot_date is null or new.slot_hour is null or new.profile_id is null then
      raise exception 'Дата, время и поставщик обязательны.' using errcode = '23514';
    end if;
    if new.slot_hour < v_start_hour or new.slot_hour > v_end_hour then
      raise exception 'Выбранное время не входит в расписание.' using errcode = '23514';
    end if;

    -- Available weekday rules apply to new bookings and slot/type changes only.
    if v_available_days is not null
       and jsonb_typeof(v_available_days) = 'array'
       and not (v_available_days @> jsonb_build_array(extract(isodow from new.slot_date)::integer)) then
      raise exception 'В выбранный день запись закрыта.' using errcode = '23514';
    end if;

    -- Excluded dates are a hard database rule. They block new bookings, reactivation,
    -- and moving a booking onto an excluded date, regardless of weekday or caller role.
    -- Unrelated edits to existing bookings on that date remain possible.
    if new.slot_date = any(coalesce(v_excluded_dates, '{}'::date[])) then
      if TG_OP = 'INSERT' then
        raise exception 'Запись на выбранную дату закрыта администратором.' using errcode = '23514';
      elsif new.slot_date is distinct from old.slot_date
         or (old.status is distinct from 'active' and new.status = 'active') then
        raise exception 'Нельзя перенести или активировать запись на дату, закрытую администратором.' using errcode = '23514';
      end if;
    end if;
  end if;

  if v_role = 'supplier' and (v_is_slot_change or v_is_type_change) then
    if new.slot_date < v_today or new.slot_date > v_today + 29 then
      raise exception 'Запись доступна только на ближайшие 30 календарных дней.' using errcode = '23514';
    end if;
    if new.slot_date = v_today
       and extract(hour from v_local_now)::integer >= new.slot_hour - v_deadline_hours then
      raise exception 'Истек срок записи в выбранный временной слот.' using errcode = '23514';
    end if;
  end if;

  v_types := to_jsonb(new) -> 'supply_types';
  if jsonb_typeof(v_types) = 'array' and jsonb_array_length(v_types) > 0 then
    v_is_im_only := jsonb_array_length(v_types) = 1 and (v_types ->> 0) = 'orders_im';
  else
    v_is_im_only := coalesce(new.supply_type, '') = 'orders_im';
    v_types := jsonb_build_array(coalesce(new.supply_type, ''));
  end if;
  if jsonb_typeof(v_types) <> 'array' or jsonb_array_length(v_types) = 0
     or (jsonb_array_length(v_types) = 1 and coalesce(v_types ->> 0, '') = '') then
    raise exception 'Выберите хотя бы один тип поставки.' using errcode = '23514';
  end if;

  if v_role = 'supplier' and (v_is_slot_change or v_is_type_change)
     and v_return_deadline_days > 0
     and v_types @> jsonb_build_array('return')
     and new.slot_date < v_today + v_return_deadline_days then
    raise exception 'Для поставок с возвратом требуется более поздняя дата.' using errcode = '23514';
  end if;

  if coalesce(new.order_type, '') not in ('order', 'upd', 'etrn') then
    raise exception 'Недопустимый тип документа.' using errcode = '23514';
  end if;
  if length(coalesce(new.order_number, '')) > 200 or length(coalesce(new.comment, '')) > 5000 then
    raise exception 'Номер документа или комментарий превышает допустимую длину.' using errcode = '23514';
  end if;

  -- Store object keys only. Do not persist arbitrary/external URLs in booking rows.
  v_path := new.registry_file_url;
  if v_path is not null then
    if v_path ~* '^https?://' or v_path ~ '(^|/)\.\.(/|$)' or left(v_path, 1) = '/' or position(chr(92) in v_path) > 0 then
      raise exception 'В поле реестра должен храниться путь объекта приватного хранилища.' using errcode = '23514';
    end if;
    if v_role = 'supplier'
       and left(v_path, length(auth.uid()::text || '/')) <> (auth.uid()::text || '/')
       and left(v_path, length(auth.uid()::text || '_')) <> (auth.uid()::text || '_') then
      raise exception 'Поставщик может прикреплять только собственные файлы.' using errcode = '42501';
    end if;
  end if;

  -- Capacity is only recalculated when slot, type, or active status changes.
  -- Operational edits (gate/arrival/departure) remain possible after the booking deadline.
  if not v_capacity_change then
    return new;
  end if;

  -- Serialize all active booking mutations for this date/hour, including concurrent clients.
  perform pg_advisory_xact_lock(hashtext(new.slot_date::text), new.slot_hour);

  select
    count(*) filter (where case
      when jsonb_typeof(to_jsonb(b) -> 'supply_types') = 'array' then
        case when jsonb_array_length(to_jsonb(b) -> 'supply_types') > 0
          then jsonb_array_length(to_jsonb(b) -> 'supply_types') = 1
            and (to_jsonb(b) -> 'supply_types' ->> 0) = 'orders_im'
          else coalesce(to_jsonb(b) ->> 'supply_type', '') = 'orders_im'
        end
      else coalesce(to_jsonb(b) ->> 'supply_type', '') = 'orders_im'
    end),
    count(*) filter (where not (case
      when jsonb_typeof(to_jsonb(b) -> 'supply_types') = 'array' then
        case when jsonb_array_length(to_jsonb(b) -> 'supply_types') > 0
          then jsonb_array_length(to_jsonb(b) -> 'supply_types') = 1
            and (to_jsonb(b) -> 'supply_types' ->> 0) = 'orders_im'
          else coalesce(to_jsonb(b) ->> 'supply_type', '') = 'orders_im'
        end
      else coalesce(to_jsonb(b) ->> 'supply_type', '') = 'orders_im'
    end))
  into v_im_count, v_regular_count
  from public.bookings b
  where b.slot_date = new.slot_date
    and b.slot_hour = new.slot_hour
    and b.status = 'active'
    and b.id is distinct from new.id;

  v_reserve_used := least(v_im_count, v_reserve_per_hour);
  v_main_used := v_regular_count + greatest(v_im_count - v_reserve_per_hour, 0);

  if v_is_im_only then
    if v_reserve_used >= v_reserve_per_hour and v_main_used >= v_slots_per_hour then
      raise exception 'В выбранном времени нет свободных мест.' using errcode = '23514';
    end if;
  elsif v_main_used >= v_slots_per_hour then
    raise exception 'Основные места в выбранном времени закончились. Остались только резервные места для заказов ИМ.' using errcode = '23514';
  end if;

  return new;
end;
$$;
-- A partial unique index is the final concurrency-safe guard for gate occupancy.
-- It frees a gate as soon as departure_time becomes non-NULL.
-- Refuse to migrate if pre-existing active assignments violate this invariant.
do $gate_index_precheck$
declare
  v_duplicates text;
begin
  select string_agg(
           format('дата %s, ворота %s, записей %s', slot_date, gate_key, booking_count),
           E'\n'
         )
    into v_duplicates
  from (
    select
      b.slot_date,
      lower(btrim(b.gate_number::text)) as gate_key,
      count(*) as booking_count
    from public.bookings b
    where b.status = 'active'
      and b.departure_time is null
      and nullif(btrim(b.gate_number::text), '') is not null
    group by b.slot_date, lower(btrim(b.gate_number::text))
    having count(*) > 1
  ) duplicate_gates;

  if v_duplicates is not null then
    raise exception 'Нельзя включить защиту ворот: найдены дубли активных назначений. Сначала устраните конфликты: %', v_duplicates;
  end if;
end;
$gate_index_precheck$;

create unique index if not exists bookings_one_active_undeparted_gate_per_day_idx
  on public.bookings (slot_date, (lower(btrim(gate_number::text))))
  where status = 'active'
    and departure_time is null
    and nullif(btrim(gate_number::text), '') is not null;

revoke all on function public.validate_booking_server_side() from public, anon, authenticated;

drop trigger if exists bookings_validate_server_side on public.bookings;
create trigger bookings_validate_server_side
before insert or update on public.bookings
for each row execute function public.validate_booking_server_side();

-- The old trigger hard-coded a maximum of five total bookings. That conflicts with
-- the application's separate main-slot and reserved-IM-slot capacities. The new
-- validator above applies the configured limits under an advisory transaction lock.
drop trigger if exists trg_check_slot_capacity on public.bookings;

-- Preserve the 30-active-bookings-per-supplier rule and serialize concurrent inserts
-- for the same supplier so two requests cannot both pass the count at the limit.
create or replace function public.check_user_booking_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_count bigint;
  v_today date := timezone('Asia/Almaty', now())::date;
begin
  if new.profile_id is null then
    raise exception 'Не указан поставщик для бронирования.' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtext(new.profile_id::text), 841031);

  select count(*)
    into v_count
  from public.bookings b
  where b.profile_id = new.profile_id
    and b.slot_date >= v_today
    and b.status = 'active';

  if v_count >= 30 then
    raise exception 'Превышен лимит активных записей (максимум 30)' using errcode = '23514';
  end if;

  return new;
end;
$$;
revoke all on function public.check_user_booking_limit() from public, anon, authenticated;

-- An aggregate-only function for supplier calendar pages. It never returns supplier IDs,
-- company names, document numbers, comments or file paths.
create or replace function public.get_slot_occupancy(p_slot_date date)
returns table(slot_hour integer, main_used bigint, reserve_used bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start integer;
  v_end integer;
  v_reserve integer;
  v_today date;
begin
  if auth.uid() is null or not public.is_active_app_user() then
    raise exception 'Требуется активная авторизованная учетная запись.' using errcode = '42501';
  end if;
  v_today := timezone('Asia/Almaty', now())::date;
  if p_slot_date is null or p_slot_date < v_today or p_slot_date > v_today + 29 then
    raise exception 'Недопустимая дата для проверки занятости.' using errcode = '22023';
  end if;
  select slot_start_hour, slot_end_hour, reserve_slots_per_hour
    into v_start, v_end, v_reserve
  from public.app_settings where id = 1;
  v_reserve := greatest(coalesce(v_reserve, 3), 0);

  return query
  with hours as (
    select generate_series(v_start, v_end)::integer as h
  ), agg as (
    select b.slot_hour as h,
      count(*) filter (where case
        when jsonb_typeof(to_jsonb(b) -> 'supply_types') = 'array' then
          case when jsonb_array_length(to_jsonb(b) -> 'supply_types') > 0
            then jsonb_array_length(to_jsonb(b) -> 'supply_types') = 1
              and (to_jsonb(b) -> 'supply_types' ->> 0) = 'orders_im'
            else coalesce(to_jsonb(b) ->> 'supply_type', '') = 'orders_im'
          end
        else coalesce(to_jsonb(b) ->> 'supply_type', '') = 'orders_im'
      end) as im_count,
      count(*) filter (where not (case
        when jsonb_typeof(to_jsonb(b) -> 'supply_types') = 'array' then
          case when jsonb_array_length(to_jsonb(b) -> 'supply_types') > 0
            then jsonb_array_length(to_jsonb(b) -> 'supply_types') = 1
              and (to_jsonb(b) -> 'supply_types' ->> 0) = 'orders_im'
            else coalesce(to_jsonb(b) ->> 'supply_type', '') = 'orders_im'
          end
        else coalesce(to_jsonb(b) ->> 'supply_type', '') = 'orders_im'
      end)) as regular_count
    from public.bookings b
    where b.slot_date = p_slot_date and b.status = 'active'
    group by b.slot_hour
  )
  select h.h,
    coalesce(a.regular_count, 0) + greatest(coalesce(a.im_count, 0) - v_reserve, 0),
    least(coalesce(a.im_count, 0), v_reserve)
  from hours h left join agg a on a.h = h.h
  order by h.h;
end;
$$;

create or replace function public.get_calendar_booking_counts(p_from date, p_to date)
returns table(slot_date date, booking_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date;
begin
  if auth.uid() is null or not public.is_active_app_user() then
    raise exception 'Требуется активная авторизованная учетная запись.' using errcode = '42501';
  end if;
  v_today := timezone('Asia/Almaty', now())::date;
  if p_from is null or p_to is null
     or p_from < v_today or p_to < p_from
     or p_to > v_today + 90 or p_to > p_from + 90 then
    raise exception 'Недопустимый диапазон дат.' using errcode = '22023';
  end if;
  return query
    select b.slot_date, count(*)::bigint
    from public.bookings b
    where b.status = 'active' and b.slot_date between p_from and p_to
    group by b.slot_date
    order by b.slot_date;
end;
$$;

revoke all on function public.get_slot_occupancy(date) from public, anon;
revoke all on function public.get_calendar_booking_counts(date, date) from public, anon;
grant execute on function public.get_slot_occupancy(date) to authenticated;
grant execute on function public.get_calendar_booking_counts(date, date) to authenticated;

-- 5) Make registries private and replace the exact Storage policies found in production.
-- Preflight confirmed only these two existing policies for storage.objects:
--   "Allow public read" (PUBLIC SELECT on registries)
--   "Allow authenticated uploads" (authenticated INSERT on registries)
-- Drop those broad policies so they cannot widen access after the bucket becomes private.
-- No policies for unrelated buckets are dropped by this block.

-- Supabase owns storage.objects/storage.buckets. Do not ALTER these managed tables or
-- update bucket metadata directly from SQL. RLS is enabled by Supabase on storage.objects.
-- Before running this migration, set bucket `registries` to Private in Dashboard -> Storage -> registries.
-- This check makes the required precondition explicit and aborts the transaction safely if not met.
do $check_storage_configuration$
declare
  v_bucket_public boolean;
  v_rls_enabled boolean;
begin
  select b.public into v_bucket_public
  from storage.buckets b
  where b.id = 'registries';

  if not found then
    raise exception 'Bucket registries not found. Check Supabase Dashboard -> Storage.';
  end if;

  if v_bucket_public is distinct from false then
    raise exception 'Before running this migration, set bucket registries to Private in Supabase Dashboard -> Storage -> registries.';
  end if;

  select c.relrowsecurity into v_rls_enabled
  from pg_class c
  where c.oid = 'storage.objects'::regclass;

  if v_rls_enabled is distinct from true then
    raise exception 'RLS is not enabled on storage.objects. This managed table cannot be altered by this migration; check Supabase Storage configuration.';
  end if;
end;
$check_storage_configuration$;

-- Exact pre-existing production policy names supplied by the project owner.
drop policy if exists "Allow public read" on storage.objects;
drop policy if exists "Allow authenticated uploads" on storage.objects;

-- Remove names used by prior versions of this migration, making v3 safe if v2 was partially deployed.
drop policy if exists registries_select_private on storage.objects;
drop policy if exists registries_insert_private on storage.objects;
drop policy if exists registries_update_private on storage.objects;
drop policy if exists registries_delete_private on storage.objects;
drop policy if exists registries_guard_select_authenticated on storage.objects;
drop policy if exists registries_guard_insert_authenticated on storage.objects;
drop policy if exists registries_guard_update_authenticated on storage.objects;
drop policy if exists registries_guard_delete_authenticated on storage.objects;
drop policy if exists registries_guard_select_anon on storage.objects;
drop policy if exists registries_guard_insert_anon on storage.objects;
drop policy if exists registries_guard_update_anon on storage.objects;
drop policy if exists registries_guard_delete_anon on storage.objects;

-- Read access: staff can read registries; suppliers can read their own files and the configured template.
create policy registries_select_private
on storage.objects for select to authenticated
using (
  bucket_id = 'registries'
  and public.is_active_app_user()
  and (
    public.current_app_role() in ('admin', 'operator', 'viewer')
    or (storage.foldername(name))[1] = auth.uid()::text
    or left(name, length(auth.uid()::text || '_')) = auth.uid()::text || '_'
    or exists (
      select 1 from public.app_settings s
      where s.id = 1 and s.registry_template_url = name
    )
  )
);

-- Upload access: each supplier can upload only to their own UID folder; operators cannot upload templates.
create policy registries_insert_private
on storage.objects for insert to authenticated
with check (
  bucket_id = 'registries'
  and public.is_active_app_user()
  and (
    (public.current_app_role() = 'admin' and (storage.foldername(name))[1] = 'templates')
    or (public.current_app_role() in ('admin', 'operator') and (storage.foldername(name))[1] <> 'templates')
    or (public.current_app_role() = 'supplier' and (storage.foldername(name))[1] = auth.uid()::text)
  )
);

create policy registries_update_private
on storage.objects for update to authenticated
using (
  bucket_id = 'registries'
  and public.is_active_app_user()
  and (
    public.current_app_role() in ('admin', 'operator')
    or (storage.foldername(name))[1] = auth.uid()::text
  )
)
with check (
  bucket_id = 'registries'
  and public.is_active_app_user()
  and (
    (public.current_app_role() = 'admin' and (storage.foldername(name))[1] = 'templates')
    or (public.current_app_role() in ('admin', 'operator') and (storage.foldername(name))[1] <> 'templates')
    or (public.current_app_role() = 'supplier' and (storage.foldername(name))[1] = auth.uid()::text)
  )
);

create policy registries_delete_private
on storage.objects for delete to authenticated
using (
  bucket_id = 'registries'
  and public.is_active_app_user()
  and (
    public.current_app_role() in ('admin', 'operator')
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

-- Register hourly cleanup when pg_cron is enabled in this Supabase project.
-- Supabase Dashboard: Integrations -> Cron -> Enable pg_cron if the extension is not yet enabled.
do $schedule_excluded_dates_cleanup$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for v_job_id in execute
      'select jobid from cron.job where jobname = $1'
      using 'akson-clean-expired-booking-excluded-dates'
    loop
      execute 'select cron.unschedule($1)' using v_job_id;
    end loop;

    execute 'select cron.schedule($1, $2, $3)'
      using 'akson-clean-expired-booking-excluded-dates',
            '0 * * * *',
            'select public.cleanup_expired_booking_excluded_dates();';
  else
    raise notice 'pg_cron is not enabled. The UI will clean expired dates when an administrator opens Settings; enable Supabase Cron and run the scheduling statement from SECURITY_README.md for hourly database cleanup.';
  end if;
end;
$schedule_excluded_dates_cleanup$;

commit;

-- After running, verify with the queries in SECURITY_README.md. Do not expose service_role keys in the frontend.
