-- Doxi learning loop v1.0
-- Stores automatically detected answer gaps and reviewed learning cases.
-- All reads/writes go through the super-admin-only doxi-chat Edge Function using service_role.

begin;

create table if not exists public.doxi_learning_cases (
  id uuid primary key default gen_random_uuid(),
  question_message_id bigint unique,
  conversation_id uuid,
  user_id uuid,
  user_role text not null default 'unknown',
  page_name text not null default '',
  question text not null,
  assistant_answer text not null default '',
  reason_type text not null default 'knowledge_gap'
    check (reason_type in ('knowledge_gap','data_access','permissions','missing_context','manual')),
  context_type text not null default 'general'
    check (context_type in ('general','bookings','suppliers','arrivals','verification','calendar','permissions','warehouse')),
  source text not null default 'automatic'
    check (source in ('automatic','manual')),
  status text not null default 'pending'
    check (status in ('pending','trained','dismissed')),
  occurrences integer not null default 1 check (occurrences >= 1),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  solution_title text,
  solution_content text,
  knowledge_category text,
  knowledge_document_id text,
  learned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists doxi_learning_cases_status_last_seen_idx
  on public.doxi_learning_cases (status, last_seen_at desc);

create index if not exists doxi_learning_cases_context_status_idx
  on public.doxi_learning_cases (context_type, status);

alter table public.doxi_learning_cases enable row level security;
revoke all on table public.doxi_learning_cases from anon, authenticated;
grant select, insert, update, delete on table public.doxi_learning_cases to service_role;

comment on table public.doxi_learning_cases is
  'Super-admin review queue for Doxi answer gaps. Not exposed to chat model table tools; accessed only by dedicated super_admin endpoints.';

commit;

-- Verification: one table, RLS enabled, no browser-role privileges.
select
  to_regclass('public.doxi_learning_cases') as learning_table,
  (select relrowsecurity from pg_class where oid = 'public.doxi_learning_cases'::regclass) as rls_enabled;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'doxi_learning_cases'
order by grantee, privilege_type;
