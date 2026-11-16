-- DOXI table access matrix v1.0
-- Run once in Supabase SQL Editor. The browser never accesses this table directly;
-- only the authenticated, server-side doxi-chat Edge Function uses service_role.

create table if not exists public.doxi_table_permissions (
  table_name text primary key,
  can_select boolean not null default false,
  can_insert boolean not null default false,
  can_update boolean not null default false,
  can_delete boolean not null default false,
  scope_mode text not null default 'all' check (scope_mode in ('all', 'current_user')),
  max_rows integer not null default 100 check (max_rows between 1 and 1000),
  updated_by uuid null references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint doxi_table_permissions_known_table check (table_name in (
    'admin_personal_notes', 'admin_personal_reminders', 'app_notifications', 'app_settings',
    'audit_log', 'booking_verification', 'bookings', 'contacts', 'doxi_action_audit',
    'doxi_action_drafts', 'doxi_conversations', 'doxi_knowledge_documents', 'doxi_messages',
    'doxi_notes', 'doxi_reminders', 'doxi_settings', 'doxi_thinking_comments',
    'doxi_user_memory', 'load_advisory_settings', 'load_advisory_signal',
    'load_control_audit_legacy', 'notification_preferences', 'profiles',
    'push_subscriptions', 'shift_board_settings'
  )),
  constraint doxi_profiles_read_only check (
    table_name <> 'profiles' or (not can_insert and not can_update and not can_delete)
  ),
  constraint doxi_push_subscriptions_locked check (
    table_name <> 'push_subscriptions' or (not can_select and not can_insert and not can_update and not can_delete)
  )
);

alter table public.doxi_table_permissions enable row level security;
revoke all on table public.doxi_table_permissions from anon, authenticated;
grant select, insert, update, delete on table public.doxi_table_permissions to service_role;

insert into public.doxi_table_permissions
  (table_name, can_select, can_insert, can_update, can_delete, scope_mode, max_rows)
values
  ('admin_personal_notes', true, true, true, true, 'current_user', 100),
  ('admin_personal_reminders', true, true, true, true, 'current_user', 100),
  ('app_notifications', false, false, false, false, 'all', 100),
  ('app_settings', true, false, false, false, 'all', 100),
  ('audit_log', false, false, false, false, 'all', 100),
  ('booking_verification', false, false, false, false, 'all', 100),
  ('bookings', true, false, false, false, 'all', 300),
  ('contacts', false, false, false, false, 'all', 100),
  ('doxi_action_audit', false, false, false, false, 'all', 100),
  ('doxi_action_drafts', false, false, false, false, 'all', 100),
  ('doxi_conversations', false, false, false, false, 'all', 100),
  ('doxi_knowledge_documents', true, true, false, true, 'all', 100),
  ('doxi_messages', false, false, false, false, 'all', 100),
  ('doxi_notes', false, false, false, false, 'all', 100),
  ('doxi_reminders', false, false, false, false, 'all', 100),
  ('doxi_settings', false, false, false, false, 'all', 50),
  ('doxi_thinking_comments', true, true, true, true, 'all', 100),
  ('doxi_user_memory', true, true, true, true, 'current_user', 50),
  ('load_advisory_settings', false, false, false, false, 'all', 100),
  ('load_advisory_signal', false, false, false, false, 'all', 200),
  ('load_control_audit_legacy', false, false, false, false, 'all', 100),
  ('notification_preferences', false, false, false, false, 'all', 100),
  ('profiles', true, false, false, false, 'all', 250),
  ('push_subscriptions', false, false, false, false, 'all', 50),
  ('shift_board_settings', false, false, false, false, 'all', 100)
on conflict (table_name) do nothing;

comment on table public.doxi_table_permissions is
  'Super-admin controlled allow-list of tables and operations available to Doxi server tools. No direct browser access.';
