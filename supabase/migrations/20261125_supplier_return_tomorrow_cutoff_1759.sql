-- Supplier return booking cutoff for tomorrow.
-- A supplier may create a booking with supply type "return", or add that type
-- to an existing booking for tomorrow, until 17:59:59 Moscow time today.
-- From 18:00:00 Europe/Moscow onward, the mutation is rejected server-side.
-- All other dates, roles, booking fields and existing validation rules are unchanged.

begin;

create or replace function public.enforce_supplier_return_tomorrow_cutoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moscow_now timestamp without time zone;
  v_moscow_today date;
  v_new_types jsonb;
  v_old_types jsonb;
  v_new_has_return boolean := false;
  v_old_has_return boolean := false;
  v_is_adding_return boolean := false;
begin
  -- The rule is exclusively for supplier actions made through an authenticated session.
  if auth.uid() is null
     or coalesce(public.current_app_role(), '') <> 'supplier' then
    return new;
  end if;

  v_moscow_now := pg_catalog.timezone('Europe/Moscow', pg_catalog.clock_timestamp());
  v_moscow_today := v_moscow_now::date;

  v_new_types := pg_catalog.to_jsonb(new) -> 'supply_types';
  if pg_catalog.jsonb_typeof(v_new_types) = 'array'
     and pg_catalog.jsonb_array_length(v_new_types) > 0 then
    v_new_has_return := v_new_types @> '["return"]'::jsonb;
  else
    v_new_has_return := coalesce(new.supply_type::text, '') = 'return';
  end if;

  if tg_op = 'UPDATE' then
    v_old_types := pg_catalog.to_jsonb(old) -> 'supply_types';
    if pg_catalog.jsonb_typeof(v_old_types) = 'array'
       and pg_catalog.jsonb_array_length(v_old_types) > 0 then
      v_old_has_return := v_old_types @> '["return"]'::jsonb;
    else
      v_old_has_return := coalesce(old.supply_type::text, '') = 'return';
    end if;

    -- Do not block unrelated edits to a booking that already has "return".
    v_is_adding_return := v_new_has_return and not v_old_has_return;
  else
    v_is_adding_return := v_new_has_return;
  end if;

  if v_is_adding_return
     and new.slot_date = v_moscow_today + 1
     and v_moscow_now::time >= time '18:00:00' then
    raise exception 'Запись на завтра с типом «Возврат» можно создать или дополнить этим типом сегодня только до 17:59 по московскому времени.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_supplier_return_tomorrow_cutoff()
  from public, anon, authenticated;

-- The name sorts before bookings_validate_server_side, so this focused cutoff
-- is evaluated before the existing general booking validator.
drop trigger if exists bookings_00_supplier_return_tomorrow_cutoff on public.bookings;
create trigger bookings_00_supplier_return_tomorrow_cutoff
before insert or update of slot_date, supply_type, supply_types
on public.bookings
for each row
execute function public.enforce_supplier_return_tomorrow_cutoff();

commit;
