-- Безопасная разовая очистка старого списка поставщиков из личной памяти Докси.
-- Удаляются только записи старого механизма: отдельные строки «Мой поставщик: …»,
-- записи с маркером doxi-my-supplier-v1 и известные заголовки агрегированного списка.
-- Обычные заметки, предпочтения, договорённости и напоминания не затрагиваются.
-- Перед выполнением сделайте резервную копию Supabase.

BEGIN;

-- Предварительный просмотр набора строк, которые будут удалены:
-- SELECT id, user_id, title, category, created_at
-- FROM public.doxi_user_memory
-- WHERE COALESCE(title, '') ILIKE 'Мой поставщик: %'
--    OR COALESCE(content, '') LIKE '%doxi-my-supplier-v1%'
--    OR lower(trim(COALESCE(title, ''))) IN (
--      'мои поставщики',
--      'мой список поставщиков',
--      'личный список поставщиков',
--      'список моих поставщиков'
--    )
-- ORDER BY user_id, created_at;

DELETE FROM public.doxi_user_memory
WHERE COALESCE(title, '') ILIKE 'Мой поставщик: %'
   OR COALESCE(content, '') LIKE '%doxi-my-supplier-v1%'
   OR lower(trim(COALESCE(title, ''))) IN (
     'мои поставщики',
     'мой список поставщиков',
     'личный список поставщиков',
     'список моих поставщиков'
   )
RETURNING id, user_id, title;

COMMIT;
