-- DockSlot Messenger v1.16
-- Queue per-user notifications for new chat messages only when a user enabled
-- the "DockSlot Чат" preference. Existing app_notifications Realtime/Web Push
-- delivery is reused; no new VAPID secret or delivery endpoint is introduced.
BEGIN;

CREATE OR REPLACE FUNCTION public.dockslot_chat_notify_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_kind text;
  v_sender_name text;
  v_title text;
  v_body text;
  v_booking_date date;
  v_recipient record;
BEGIN
  SELECT c.kind
    INTO v_kind
    FROM public.dockslot_chat_conversations c
   WHERE c.id = NEW.conversation_id;

  IF v_kind IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(p.company_name), ''), 'Сотрудник DockSlot')
    INTO v_sender_name
    FROM public.profiles p
   WHERE p.id = NEW.sender_id;
  v_sender_name := COALESCE(v_sender_name, 'Сотрудник DockSlot');
  v_title := LEFT('Новое сообщение · ' || v_sender_name, 120);
  v_body := LEFT(COALESCE(NULLIF(BTRIM(NEW.body), ''), 'Новое сообщение в чате'), 500);

  IF NEW.booking_id IS NOT NULL THEN
    SELECT b.slot_date
      INTO v_booking_date
      FROM public.bookings b
     WHERE b.id = NEW.booking_id;
  END IF;

  -- A targeted message is delivered only to its selected recipient.
  IF NEW.target_user_id IS NOT NULL THEN
    FOR v_recipient IN
      SELECT p.id AS user_id
        FROM public.profiles p
        JOIN public.notification_preferences np ON np.user_id = p.id
       WHERE p.id = NEW.target_user_id
         AND p.id <> NEW.sender_id
         AND p.role::text IN ('admin', 'operator', 'super_admin')
         AND COALESCE(p.is_blocked, false) = false
         AND public.dockslot_chat_enabled_for(p.id)
         AND COALESCE(np.preferences #>> '{dockslot_chat,enabled}', 'false') = 'true'
         AND EXISTS (
           SELECT 1
             FROM public.dockslot_chat_participants cp
            WHERE cp.conversation_id = NEW.conversation_id
              AND cp.user_id = p.id
         )
    LOOP
      INSERT INTO public.app_notifications (
        user_id, event_type, title, body, related_booking_id, booking_date, metadata
      ) VALUES (
        v_recipient.user_id,
        'dockslot_chat_message',
        v_title,
        v_body,
        NEW.booking_id,
        v_booking_date,
        jsonb_build_object(
          'notification_type', 'dockslot_chat',
          'conversation_id', NEW.conversation_id,
          'message_id', NEW.id,
          'sender_id', NEW.sender_id
        )
      );
    END LOOP;

  -- The general channel is visible to all employees with enabled chat access.
  ELSIF v_kind = 'general' THEN
    FOR v_recipient IN
      SELECT p.id AS user_id
        FROM public.profiles p
        JOIN public.notification_preferences np ON np.user_id = p.id
       WHERE p.id <> NEW.sender_id
         AND p.role::text IN ('admin', 'operator', 'super_admin')
         AND COALESCE(p.is_blocked, false) = false
         AND public.dockslot_chat_enabled_for(p.id)
         AND COALESCE(np.preferences #>> '{dockslot_chat,enabled}', 'false') = 'true'
    LOOP
      INSERT INTO public.app_notifications (
        user_id, event_type, title, body, related_booking_id, booking_date, metadata
      ) VALUES (
        v_recipient.user_id,
        'dockslot_chat_message',
        v_title,
        v_body,
        NEW.booking_id,
        v_booking_date,
        jsonb_build_object(
          'notification_type', 'dockslot_chat',
          'conversation_id', NEW.conversation_id,
          'message_id', NEW.id,
          'sender_id', NEW.sender_id
        )
      );
    END LOOP;

  -- Group messages are delivered only to the conversation participants.
  ELSE
    FOR v_recipient IN
      SELECT DISTINCT p.id AS user_id
        FROM public.dockslot_chat_participants cp
        JOIN public.profiles p ON p.id = cp.user_id
        JOIN public.notification_preferences np ON np.user_id = p.id
       WHERE cp.conversation_id = NEW.conversation_id
         AND p.id <> NEW.sender_id
         AND p.role::text IN ('admin', 'operator', 'super_admin')
         AND COALESCE(p.is_blocked, false) = false
         AND public.dockslot_chat_enabled_for(p.id)
         AND COALESCE(np.preferences #>> '{dockslot_chat,enabled}', 'false') = 'true'
    LOOP
      INSERT INTO public.app_notifications (
        user_id, event_type, title, body, related_booking_id, booking_date, metadata
      ) VALUES (
        v_recipient.user_id,
        'dockslot_chat_message',
        v_title,
        v_body,
        NEW.booking_id,
        v_booking_date,
        jsonb_build_object(
          'notification_type', 'dockslot_chat',
          'conversation_id', NEW.conversation_id,
          'message_id', NEW.id,
          'sender_id', NEW.sender_id
        )
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.dockslot_chat_notify_new_message()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_dockslot_chat_notify_new_message
  ON public.dockslot_chat_messages;

CREATE TRIGGER trg_dockslot_chat_notify_new_message
AFTER INSERT ON public.dockslot_chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.dockslot_chat_notify_new_message();

COMMENT ON FUNCTION public.dockslot_chat_notify_new_message() IS
  'Creates per-user DockSlot Chat notifications only when the recipient enabled dockslot_chat in notification_preferences.';

COMMIT;
