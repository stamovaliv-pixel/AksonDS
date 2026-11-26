-- Require a numbered VzU reference in the comment whenever a booking includes Return.
-- The trigger runs on booking creation and on changes to supply type/comment fields.

begin;

create or replace function public.require_vzu_comment_for_return()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_types jsonb;
  v_has_return boolean := false;
  v_comment text;
begin
  v_types := pg_catalog.to_jsonb(new) -> 'supply_types';
  if pg_catalog.jsonb_typeof(v_types) = 'array'
     and pg_catalog.jsonb_array_length(v_types) > 0 then
    v_has_return := v_types @> '["return"]'::jsonb;
  else
    v_has_return := coalesce(pg_catalog.to_jsonb(new) ->> 'supply_type', '') = 'return';
  end if;

  if not v_has_return then
    return new;
  end if;

  v_comment := coalesce(new.comment, '');
  if v_comment !~* '(^|[^А-ЯЁа-яёA-Za-z0-9])взу[[:space:]]*[-–—:]?[[:space:]]*(№[[:space:]]*)?[0-9]+' then
    raise exception 'Для типа поставки «Возврат» требуется указать номер ВзУ в комментарии к записи.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.require_vzu_comment_for_return()
  from public, anon, authenticated;

drop trigger if exists bookings_00_return_vzu_comment on public.bookings;
create trigger bookings_00_return_vzu_comment
before insert or update of supply_type, supply_types, comment
on public.bookings
for each row
execute function public.require_vzu_comment_for_return();

commit;
