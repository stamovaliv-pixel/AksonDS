-- DOXI USER-CONTEXT DATA ENGINE v1.0
-- Run once in Supabase SQL Editor before deploying the matching doxi-chat Edge Function.
-- This function is SECURITY INVOKER: it reports only table/column privileges visible
-- to the calling authenticated role. It does not bypass RLS and does not grant CRUD.

create or replace function public.doxi_get_accessible_schema()
returns table (
  table_name text,
  columns jsonb,
  foreign_keys jsonb,
  primary_keys jsonb,
  can_select boolean,
  can_insert boolean,
  can_update boolean,
  can_delete boolean
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $function$
  select
    t.table_name::text,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'column_name', c.column_name,
          'data_type', c.data_type,
          'is_nullable', c.is_nullable,
          'is_identity', c.is_identity,
          'is_generated', c.is_generated,
          'can_select', has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'SELECT'),
          'can_insert', has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'INSERT'),
          'can_update', has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'UPDATE')
        ) order by c.ordinal_position
      )
      from information_schema.columns c
      where c.table_schema = t.table_schema
        and c.table_name = t.table_name
        and (
          has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'SELECT')
          or has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'INSERT')
          or has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'UPDATE')
        )
    ), '[]'::jsonb) as columns,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'column_name', source_col.attname,
          'foreign_table', target_class.relname,
          'foreign_column', target_col.attname
        ) order by source_col.attnum
      )
      from pg_constraint fk
      join pg_class source_class on source_class.oid = fk.conrelid
      join pg_namespace source_ns on source_ns.oid = source_class.relnamespace
      join pg_class target_class on target_class.oid = fk.confrelid
      join pg_namespace target_ns on target_ns.oid = target_class.relnamespace
      join lateral unnest(fk.conkey) with ordinality as source_key(attnum, ord) on true
      join lateral unnest(fk.confkey) with ordinality as target_key(attnum, ord) on target_key.ord = source_key.ord
      join pg_attribute source_col on source_col.attrelid = source_class.oid and source_col.attnum = source_key.attnum
      join pg_attribute target_col on target_col.attrelid = target_class.oid and target_col.attnum = target_key.attnum
      where fk.contype = 'f'
        and source_ns.nspname = t.table_schema
        and source_class.relname = t.table_name
        and target_ns.nspname = 'public'
    ), '[]'::jsonb) as foreign_keys,
    coalesce((
      select jsonb_agg(pk_col.attname order by pk_key.ord)
      from pg_index pk
      join pg_class pk_class on pk_class.oid = pk.indrelid
      join pg_namespace pk_ns on pk_ns.oid = pk_class.relnamespace
      join lateral unnest(pk.indkey) with ordinality as pk_key(attnum, ord) on true
      join pg_attribute pk_col on pk_col.attrelid = pk_class.oid and pk_col.attnum = pk_key.attnum
      where pk.indisprimary
        and pk_ns.nspname = t.table_schema
        and pk_class.relname = t.table_name
        and pk_key.attnum > 0
        and pk_key.ord <= pk.indnkeyatts
    ), '[]'::jsonb) as primary_keys,
    (
      has_table_privilege(format('%I.%I', t.table_schema, t.table_name), 'SELECT')
      or exists (select 1 from information_schema.columns c where c.table_schema=t.table_schema and c.table_name=t.table_name and has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'SELECT'))
    ) as can_select,
    (
      has_table_privilege(format('%I.%I', t.table_schema, t.table_name), 'INSERT')
      or exists (select 1 from information_schema.columns c where c.table_schema=t.table_schema and c.table_name=t.table_name and has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'INSERT'))
    ) as can_insert,
    (
      has_table_privilege(format('%I.%I', t.table_schema, t.table_name), 'UPDATE')
      or exists (select 1 from information_schema.columns c where c.table_schema=t.table_schema and c.table_name=t.table_name and has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'UPDATE'))
    ) as can_update,
    (
      has_table_privilege(format('%I.%I', t.table_schema, t.table_name), 'DELETE')
    ) as can_delete
  from information_schema.tables t
  where t.table_schema = 'public'
    and t.table_type = 'BASE TABLE'
    and exists (
      select 1 from pg_class rel
      join pg_namespace rel_ns on rel_ns.oid = rel.relnamespace
      where rel_ns.nspname = t.table_schema
        and rel.relname = t.table_name
        and rel.relkind in ('r', 'p')
        and not rel.relispartition
    )
    and (
      has_table_privilege(format('%I.%I', t.table_schema, t.table_name), 'SELECT')
      or has_table_privilege(format('%I.%I', t.table_schema, t.table_name), 'INSERT')
      or has_table_privilege(format('%I.%I', t.table_schema, t.table_name), 'UPDATE')
      or has_table_privilege(format('%I.%I', t.table_schema, t.table_name), 'DELETE')
      or exists (select 1 from information_schema.columns c where c.table_schema=t.table_schema and c.table_name=t.table_name and (
        has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'SELECT')
        or has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'INSERT')
        or has_column_privilege(format('%I.%I', t.table_schema, t.table_name), c.column_name, 'UPDATE')
      ))
    )
  order by t.table_name;
$function$;

revoke all on function public.doxi_get_accessible_schema() from public;
revoke all on function public.doxi_get_accessible_schema() from anon;
grant execute on function public.doxi_get_accessible_schema() to authenticated;

comment on function public.doxi_get_accessible_schema() is
  'Doxi schema discovery under the caller role. SECURITY INVOKER; reports PostgreSQL GRANT, column privileges, PK and FK metadata. RLS is enforced by each subsequent user-JWT query.';




-- Dedicated private draft storage avoids changing the legacy booking-action draft schema.
create table if not exists public.doxi_generic_action_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action_type text not null check (action_type in ('table_insert', 'table_update', 'table_delete')),
  status text not null default 'pending_confirmation'
    check (status in ('pending_confirmation', 'processing', 'committed', 'cancelled', 'failed')),
  payload jsonb not null,
  confirmation_token_hash text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists doxi_generic_action_drafts_user_pending_idx
  on public.doxi_generic_action_drafts (user_id, status, expires_at desc);

alter table public.doxi_generic_action_drafts enable row level security;
revoke all on table public.doxi_generic_action_drafts from public, anon, authenticated;
grant all on table public.doxi_generic_action_drafts to service_role;

comment on table public.doxi_generic_action_drafts is
  'Private one-time confirmation drafts for generic Doxi CRUD actions. Accessible only to the Edge Function service role.';

-- Private audit trail for generic user-JWT table mutations.
create table if not exists public.doxi_generic_action_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  table_name text not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  row_key jsonb not null default '{}'::jsonb,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists doxi_generic_action_audit_user_created_idx
  on public.doxi_generic_action_audit (user_id, created_at desc);

alter table public.doxi_generic_action_audit enable row level security;
revoke all on table public.doxi_generic_action_audit from public, anon, authenticated;
grant select, insert on table public.doxi_generic_action_audit to service_role;

comment on table public.doxi_generic_action_audit is
  'Private audit trail for Doxi generic CRUD actions executed with the caller JWT.';
