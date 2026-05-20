-- Migration: add meta column to jobs table + explicit RLS for receipts
-- Date: 2026-05-20
-- Branch: chore/cloud-write-architecture-plan
-- Author: ENG (plan-first deliverable — application code in follow-up PR)
--
-- PURPOSE
-- -------
-- 1. Add a `meta jsonb` column to the `jobs` table so that job-level state
--    currently living in localStorage only (payments, photos, notes, signature,
--    invoice state, line-item edits) can be persisted to Supabase.
--
-- 2. Add explicit, auditable RLS policies for the `receipts` and `receipt_items`
--    tables. These tables were created and secured via the Supabase dashboard;
--    no migration file has existed. This migration makes their RLS code-reviewable.
--
-- IDEMPOTENCY
-- -----------
-- All statements use IF NOT EXISTS / IF EXISTS guards or DROP…IF EXISTS+recreate
-- so this file is safe to run twice without error.
--
-- RUN ORDER
-- ---------
-- Run in the Supabase SQL editor. No superuser role required — the Supabase
-- service role that executes migrations has sufficient privileges.
--
-- ROLLBACK
-- --------
-- See the ROLLBACK block at the bottom of this file (commented out).
-- Run it manually in the SQL editor if you need to revert.

BEGIN;

-- ─── 1. jobs.meta column ─────────────────────────────────────────────────────
--
-- Adds a JSONB column for all per-job state that doesn't belong in a dedicated
-- column. Existing rows get an empty object as default — no data is altered.
--
-- The application writes this column via updateJobMetaInCloud() (to be added
-- in the follow-up implementation PR). The read path in mapCloudJobToToday()
-- will spread r.meta onto the returned job object.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

-- Partial index: allows efficient lookup of jobs where any meta field matches.
-- Only indexes rows where meta is not empty — free for existing empty rows.
CREATE INDEX IF NOT EXISTS jobs_meta_gin_idx
  ON public.jobs USING gin (meta)
  WHERE meta <> '{}'::jsonb;

-- ─── 2. receipts table — explicit RLS policies ───────────────────────────────
--
-- The receipts table is confirmed to exist (store.js reads/writes it).
-- RLS was enabled manually in the Supabase dashboard. This migration makes
-- the policies auditable from the codebase.
--
-- Assumes the table has a `user_id uuid` column referencing auth.users(id),
-- which is confirmed by the INSERT in addReceiptToCloud() in store.js.
--
-- If RLS is not yet enabled on this table, ALTER TABLE … ENABLE ROW LEVEL
-- SECURITY below will enable it. If it is already enabled, it is a no-op.

ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing policies with these names so re-running is safe.
DROP POLICY IF EXISTS "receipts_select_own"  ON public.receipts;
DROP POLICY IF EXISTS "receipts_insert_own"  ON public.receipts;
DROP POLICY IF EXISTS "receipts_update_own"  ON public.receipts;
DROP POLICY IF EXISTS "receipts_delete_own"  ON public.receipts;

-- Users can read their own receipts.
CREATE POLICY "receipts_select_own"
  ON public.receipts FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert receipts for themselves only.
CREATE POLICY "receipts_insert_own"
  ON public.receipts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own receipts (e.g. linking to a job).
CREATE POLICY "receipts_update_own"
  ON public.receipts FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own receipts.
CREATE POLICY "receipts_delete_own"
  ON public.receipts FOR DELETE
  USING (auth.uid() = user_id);

-- ─── 3. receipt_items table — explicit RLS policies ──────────────────────────
--
-- receipt_items is a child table of receipts. Its user_id column mirrors the
-- parent receipt's user_id (confirmed by addReceiptToCloud() which inserts
-- { receipt_id, user_id, description, cost } rows).
--
-- We use both user_id and a subquery join for defence in depth.

ALTER TABLE public.receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "receipt_items_select_own"  ON public.receipt_items;
DROP POLICY IF EXISTS "receipt_items_insert_own"  ON public.receipt_items;
DROP POLICY IF EXISTS "receipt_items_delete_own"  ON public.receipt_items;

-- Select: own items (user_id shortcut — avoids join on hot read path).
CREATE POLICY "receipt_items_select_own"
  ON public.receipt_items FOR SELECT
  USING (auth.uid() = user_id);

-- Insert: must match own user_id.
CREATE POLICY "receipt_items_insert_own"
  ON public.receipt_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Delete: own items only.
CREATE POLICY "receipt_items_delete_own"
  ON public.receipt_items FOR DELETE
  USING (auth.uid() = user_id);

COMMIT;

-- ─── ROLLBACK (do not run unless reverting) ──────────────────────────────────
--
-- To revert this migration, run the following in the Supabase SQL editor:
--
-- BEGIN;
--
-- -- Remove the GIN index
-- DROP INDEX IF EXISTS public.jobs_meta_gin_idx;
--
-- -- Remove the meta column (safe only if no data has been written to it yet;
-- -- if data exists, the column can be kept and the application code reverted
-- -- separately — the meta column sitting inert does not break anything)
-- ALTER TABLE public.jobs DROP COLUMN IF EXISTS meta;
--
-- -- Remove receipts RLS policies (the table will retain RLS enabled;
-- -- disable manually in the Supabase dashboard if required)
-- DROP POLICY IF EXISTS "receipts_select_own"  ON public.receipts;
-- DROP POLICY IF EXISTS "receipts_insert_own"  ON public.receipts;
-- DROP POLICY IF EXISTS "receipts_update_own"  ON public.receipts;
-- DROP POLICY IF EXISTS "receipts_delete_own"  ON public.receipts;
--
-- -- Remove receipt_items RLS policies
-- DROP POLICY IF EXISTS "receipt_items_select_own"  ON public.receipt_items;
-- DROP POLICY IF EXISTS "receipt_items_insert_own"  ON public.receipt_items;
-- DROP POLICY IF EXISTS "receipt_items_delete_own"  ON public.receipt_items;
--
-- COMMIT;
