-- Read-only diagnostic. Does not modify schema or data.
SELECT
  column_name,
  data_type,
  udt_name,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'doxi_action_drafts'
  AND column_name = 'status';

SELECT
  conname,
  pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'public.doxi_action_drafts'::regclass
  AND contype = 'c'
ORDER BY conname;

SELECT status, count(*) AS rows_count
FROM public.doxi_action_drafts
WHERE created_at >= now() - interval '7 days'
GROUP BY status
ORDER BY status;
