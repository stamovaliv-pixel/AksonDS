-- DockSlot Messenger v1.10
-- Server-side creation of slot discussions with only enabled admin/operator recipients.
-- The booking id is attached to the first message sent from the opened conversation.
BEGIN;

CREATE OR REPLACE FUNCTION public.dockslot_chat_create_booking_discussion(
  p_user_ids uuid[],
  p_booking_id uuid,
  p_title text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sender_role text;
  v_user_ids uuid[];
  v_requested_count integer;
  v_title text;
  v_conversation_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Требуется авторизация.' USING ERRCODE = '42501';
  END IF;

  SELECT p.role::text
    INTO v_sender_role
    FROM public.profiles p
   WHERE p.id = auth.uid()
     AND COALESCE(p.is_blocked, false) = false;

  IF v_sender_role IS NULL
     OR v_sender_role NOT IN ('admin', 'operator', 'super_admin')
     OR NOT public.dockslot_chat_enabled_for(auth.uid()) THEN
    RAISE EXCEPTION 'У вас нет доступа к обсуждению записей.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.dockslot_chat_settings s
     WHERE s.id = 1
       AND s.enabled = true
       AND s.direct_chat_enabled = true
       AND s.booking_chat_enabled = true
  ) THEN
    RAISE EXCEPTION 'Личные и слот-обсуждения отключены суперадминистратором.' USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.bookings b WHERE b.id = p_booking_id
  ) THEN
    RAISE EXCEPTION 'Запись слота не найдена.' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT incoming.user_id)
    INTO v_requested_count
    FROM unnest(COALESCE(p_user_ids, ARRAY[]::uuid[])) AS incoming(user_id)
   WHERE incoming.user_id IS NOT NULL
     AND incoming.user_id <> auth.uid();

  SELECT COALESCE(array_agg(valid_user.user_id ORDER BY valid_user.user_id), ARRAY[]::uuid[])
    INTO v_user_ids
    FROM (
      SELECT DISTINCT p.id AS user_id
        FROM unnest(COALESCE(p_user_ids, ARRAY[]::uuid[])) AS incoming(user_id)
        JOIN public.profiles p ON p.id = incoming.user_id
       WHERE p.id <> auth.uid()
         AND p.role::text IN ('admin', 'operator')
         AND COALESCE(p.is_blocked, false) = false
         AND public.dockslot_chat_enabled_for(p.id)
    ) AS valid_user;

  IF COALESCE(cardinality(v_user_ids), 0) < 1
     OR COALESCE(cardinality(v_user_ids), 0) <> COALESCE(v_requested_count, 0)
     OR COALESCE(cardinality(v_user_ids), 0) > 200 THEN
    RAISE EXCEPTION 'Выберите от 1 до 200 доступных сотрудников УТЗ или РЦ. Другие роли нельзя добавлять в обсуждение записи.'
      USING ERRCODE = '42501';
  END IF;

  v_title := NULLIF(LEFT(BTRIM(COALESCE(p_title, '')), 80), '');
  IF cardinality(v_user_ids) > 1 AND v_title IS NULL THEN
    v_title := 'Обсуждение записи';
  END IF;

  -- Existing secure conversation-creation logic is reused. It rechecks the current
  -- sender and every participant against enabled-role settings and chat permissions.
  v_conversation_id := public.dockslot_chat_create_group(v_user_ids, v_title);
  RETURN v_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.dockslot_chat_create_booking_discussion(uuid[], uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dockslot_chat_create_booking_discussion(uuid[], uuid, text)
  TO authenticated;

COMMIT;
