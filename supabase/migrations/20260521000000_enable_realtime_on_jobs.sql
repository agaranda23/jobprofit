-- Migration: enable Realtime broadcasts for the jobs table
-- Date: 2026-05-21
-- Branch: feat/phase-h-realtime-jobs
--
-- PURPOSE
-- -------
-- Adds the `jobs` table to the `supabase_realtime` publication so that
-- postgres_changes events fire whenever a row is INSERTed, UPDATEd, or DELETEd.
-- This enables the Phase H subscription in src/lib/realtime.js.
--
-- The `supabase_realtime` publication is created automatically by Supabase.
-- Rows in the publication fire change events on authenticated channels filtered
-- by user_id — the client subscribes with a filter so each user only receives
-- their own job changes.
--
-- IDEMPOTENCY
-- -----------
-- The DO block checks pg_publication_tables before altering, so running this
-- file twice is safe — the second run is a no-op.
--
-- ALTERNATIVE (dashboard)
-- -----------------------
-- You can also enable Realtime for the jobs table without running this SQL:
-- Supabase dashboard → Database → Replication → toggle the `jobs` table on.
-- Both methods are equivalent. Run only one.
--
-- RUN ORDER
-- ---------
-- Run after 20260520213419_add_meta_column_to_jobs_and_receipts_rls.sql.
-- Run in the Supabase SQL editor. No superuser role required.
--
-- ROLLBACK
-- --------
-- See the ROLLBACK block at the bottom of this file (commented out).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname   = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
  END IF;
END $$;

COMMIT;

-- ─── ROLLBACK (do not run unless reverting) ──────────────────────────────────
--
-- BEGIN;
-- ALTER PUBLICATION supabase_realtime DROP TABLE public.jobs;
-- COMMIT;
--
-- After rollback, remove or comment out src/lib/realtime.js and the
-- subscribeToJobs call in AppShell.jsx, then redeploy.
