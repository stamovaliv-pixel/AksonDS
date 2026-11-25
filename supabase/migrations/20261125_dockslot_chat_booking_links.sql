-- DockSlot Messenger v1.9
-- Return the latest slot-linked message visible to the current authenticated employee.
-- Suppliers and unrelated participants cannot discover linked conversations through this RPC.
begin;

create or replace function public.dockslot_chat_booking_links()
returns table (
  booking_id uuid,
  conversation_id uuid,
  message_id uuid,
  latest_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (m.booking_id)
         m.booking_id,
         m.conversation_id,
         m.id as message_id,
         m.created_at as latest_at
    from public.dockslot_chat_messages m
    join public.dockslot_chat_conversations c on c.id = m.conversation_id
   where auth.uid() is not null
     and public.dockslot_chat_enabled_for(auth.uid())
     and public.dockslot_chat_can_access(m.conversation_id, auth.uid())
     and m.booking_id is not null
     and m.created_at >= now() - interval '6 months'
     and m.sender_id <> auth.uid()
     and (
       m.target_user_id = auth.uid()
       or (
         m.target_user_id is null
         and c.kind in ('group', 'general')
         and exists (
           select 1
             from public.dockslot_chat_participants p
            where p.conversation_id = c.id
              and p.user_id = auth.uid()
         )
       )
     )
   order by m.booking_id, m.created_at desc, m.id desc;
$$;

revoke all on function public.dockslot_chat_booking_links() from public, anon;
grant execute on function public.dockslot_chat_booking_links() to authenticated;

commit;
