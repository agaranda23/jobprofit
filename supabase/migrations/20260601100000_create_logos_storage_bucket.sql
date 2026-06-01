-- Migration: create `logos` public storage bucket + RLS
-- Date: 2026-06-01
--
-- The `logos` bucket is PUBLIC — objects are accessible via the Supabase
-- CDN public URL without authentication. This is intentional: logo images
-- need to be embeddable in invoices/PDFs that are sent to customers.
--
-- NOTE: This SQL creates the bucket record in storage.buckets and sets the
-- RLS policies on storage.objects. If the bucket already exists in the
-- Supabase dashboard the INSERT will be a no-op (ON CONFLICT DO NOTHING).
--
-- After running this SQL, the founder MUST also go to:
--   Supabase Dashboard → Storage → logos bucket → Settings
-- and confirm "Public bucket" is checked. The SQL alone is sufficient but
-- the dashboard toggle is a second confirmation.
--
-- Path pattern: logos/<user_id>/<filename>
-- e.g.          logos/abc-123/logo-1717200000000.jpg
--
-- RLS policies:
--   SELECT  — anyone (public CDN reads)
--   INSERT  — authenticated users to their own prefix only
--   UPDATE  — authenticated users to their own prefix only
--   DELETE  — authenticated users to their own prefix only
--
-- Safe to run multiple times (ON CONFLICT DO NOTHING + DROP POLICY IF EXISTS).

-- ── 1. Create bucket ─────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'logos',
  'logos',
  true,                                         -- public: readable without auth
  2097152,                                      -- 2 MB limit enforced server-side
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

-- ── 2. RLS on storage.objects ────────────────────────────────────────────────

-- Public read: anyone can read logo objects (needed for invoice embeds)
DROP POLICY IF EXISTS "logos_public_select" ON storage.objects;
CREATE POLICY "logos_public_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'logos');

-- Authenticated upload into own prefix
DROP POLICY IF EXISTS "logos_owner_insert" ON storage.objects;
CREATE POLICY "logos_owner_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'logos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated overwrite of own objects
DROP POLICY IF EXISTS "logos_owner_update" ON storage.objects;
CREATE POLICY "logos_owner_update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'logos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Authenticated delete of own objects
DROP POLICY IF EXISTS "logos_owner_delete" ON storage.objects;
CREATE POLICY "logos_owner_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'logos'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── Rollback ──────────────────────────────────────────────────────────────────
-- DROP POLICY IF EXISTS "logos_public_select" ON storage.objects;
-- DROP POLICY IF EXISTS "logos_owner_insert"  ON storage.objects;
-- DROP POLICY IF EXISTS "logos_owner_update"  ON storage.objects;
-- DROP POLICY IF EXISTS "logos_owner_delete"  ON storage.objects;
-- DELETE FROM storage.buckets WHERE id = 'logos';
