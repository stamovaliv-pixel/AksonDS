-- DockSlot Messenger: fix private attachment upload RLS metadata size check.
-- Supabase Storage's upload authorization preflight supplies metadata.contentLength;
-- the committed storage.objects row uses metadata.size. Accept both, without
-- weakening participant/path checks or the configured per-file size limit.

BEGIN;

DROP POLICY IF EXISTS dockslot_chat_files_insert ON storage.objects;

CREATE POLICY dockslot_chat_files_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'dockslot-chat-files'
  AND public.dockslot_chat_storage_can_access(name, true)
  AND CASE
    WHEN COALESCE(
      NULLIF(metadata ->> 'contentLength', ''),
      NULLIF(metadata ->> 'size', '')
    ) ~ '^[0-9]+$'
    THEN
      COALESCE(
        NULLIF(metadata ->> 'contentLength', '')::bigint,
        NULLIF(metadata ->> 'size', '')::bigint
      ) > 0
      AND COALESCE(
        NULLIF(metadata ->> 'contentLength', '')::bigint,
        NULLIF(metadata ->> 'size', '')::bigint
      ) <= (
        SELECT COALESCE(s.max_attachment_size_mb, 20)::bigint * 1024 * 1024
        FROM public.dockslot_chat_settings s
        WHERE s.id = 1
      )
    ELSE false
  END
);

COMMIT;
