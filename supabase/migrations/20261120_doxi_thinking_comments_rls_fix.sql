-- DOXI 3.5 hotfix: allow authenticated users to read active thinking comments
-- and reserve comment management for active Super Admin users.
-- No Edge Function redeploy is required after running this SQL.

begin;

do $preflight$
begin
  if to_regclass('public.doxi_thinking_comments') is null then
    raise exception 'public.doxi_thinking_comments does not exist. Check the earlier Doxi migrations.';
  end if;
  if to_regprocedure('public.current_app_role()') is null then
    raise exception 'public.current_app_role() does not exist. Apply DockSlot security hardening v4.1 first.';
  end if;
  if to_regprocedure('public.is_active_app_user()') is null then
    raise exception 'public.is_active_app_user() does not exist. Apply DockSlot security hardening v4.1 first.';
  end if;
end
$preflight$;

alter table public.doxi_thinking_comments enable row level security;

revoke all on table public.doxi_thinking_comments from anon;
grant select, insert, update, delete on table public.doxi_thinking_comments to authenticated;

-- Replace policies on this application-managed table with the intended rules.
-- service_role remains able to perform server-side maintenance (RLS bypass).
do $drop_policies$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'doxi_thinking_comments'
  loop
    execute format('drop policy if exists %I on public.doxi_thinking_comments', p.policyname);
  end loop;
end
$drop_policies$;

create policy doxi_thinking_comments_select_active_or_superadmin
on public.doxi_thinking_comments
for select
to authenticated
using (
  public.is_active_app_user()
  and (
    is_active is true
    or public.current_app_role() = 'super_admin'
  )
);

create policy doxi_thinking_comments_insert_superadmin
on public.doxi_thinking_comments
for insert
to authenticated
with check (
  public.is_active_app_user()
  and public.current_app_role() = 'super_admin'
);

create policy doxi_thinking_comments_update_superadmin
on public.doxi_thinking_comments
for update
to authenticated
using (
  public.is_active_app_user()
  and public.current_app_role() = 'super_admin'
)
with check (
  public.is_active_app_user()
  and public.current_app_role() = 'super_admin'
);

create policy doxi_thinking_comments_delete_superadmin
on public.doxi_thinking_comments
for delete
to authenticated
using (
  public.is_active_app_user()
  and public.current_app_role() = 'super_admin'
);

commit;

-- Read-only verification: expect RLS=true and SELECT/INSERT/UPDATE/DELETE grants=true
-- for authenticated. RLS policies further restrict writes to active Super Admin users.
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select_grant,
  has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert_grant,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update_grant,
  has_table_privilege('authenticated', c.oid, 'DELETE') as authenticated_delete_grant
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'doxi_thinking_comments';

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'doxi_thinking_comments'
order by policyname;
