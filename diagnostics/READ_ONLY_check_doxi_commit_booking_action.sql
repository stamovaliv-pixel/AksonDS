-- Только чтение. Ничего не изменяет в Supabase.
-- Проверяет, присутствует ли в теле функции подозрительная JSONB-строка
-- с удвоенными кавычками, замеченная в присланном pg_get_functiondef.
WITH fn AS (
  SELECT pg_get_functiondef(
    'public.doxi_commit_booking_action(uuid,uuid,text)'::regprocedure
  ) AS definition
)
SELECT
  position('[""super_admin""]' IN definition) > 0 AS has_doubled_quotes,
  position('["super_admin"]' IN definition) > 0 AS has_normal_quotes
FROM fn;
