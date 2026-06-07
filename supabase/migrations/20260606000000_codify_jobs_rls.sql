-- Migration: codify owner-scoped RLS policies on public.jobs — Security C-2
-- Date: 2026-06-06
-- Branch: fix/security-stop-the-line
--
-- PURPOSE
-- -------
-- The jobs table has been protected in production via RLS policies applied
-- through the Supabase dashboard. This migration makes those policies
-- code-reviewable and version-controlled, and ensures they exist in every
-- environment (local dev, staging, new deployments).
--
-- Only the four owner-scoped policies (authenticated user) are codified here.
-- The token-gated anon SELECT policy ("jobs_select_public_by_token") that powers
-- public quote/invoice/receipt pages is managed in the separate migration
-- 20260520223130_jobs_public_select_by_token.sql and is NOT touched here.
--
-- COLUMN REQUIREMENTS
-- -------------------
-- Requires the `user_id uuid` column that references auth.users(id).
-- Verified: store.js inserts { user_id } and queries .eq('user_id', userId).
--
-- IDEMPOTENCY
-- -----------
-- ALTER TABLE … ENABLE ROW LEVEL SECURITY is a no-op if RLS is already on.
-- DROP POLICY IF EXISTS guards make this safe to re-run against a DB where
-- the policies already exist.
--
-- ROLLBACK
-- --------
-- See the rollback block at the bottom of this file.

BEGIN;

-- Enable RLS on jobs (safe no-op if already enabled).
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

-- ── Owner-scoped SELECT ──────────────────────────────────────────────────────
-- Authenticated users can read only their own jobs.
-- The anon public-token policy is in a separate migration — do not duplicate it here.
DROP POLICY IF EXISTS "jobs_select_own" ON public.jobs;

CREATE POLICY "jobs_select_own"
  ON public.jobs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ── Owner-scoped INSERT ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "jobs_insert_own" ON public.jobs;

CREATE POLICY "jobs_insert_own"
  ON public.jobs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ── Owner-scoped UPDATE ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "jobs_update_own" ON public.jobs;

CREATE POLICY "jobs_update_own"
  ON public.jobs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- ── Owner-scoped DELETE ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "jobs_delete_own" ON public.jobs;

CREATE POLICY "jobs_delete_own"
  ON public.jobs
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

COMMIT;

-- ─── ROLLBACK (do not run unless reverting) ──────────────────────────────────
--
-- BEGIN;
-- DROP POLICY IF EXISTS "jobs_select_own" ON public.jobs;
-- DROP POLICY IF EXISTS "jobs_insert_own" ON public.jobs;
-- DROP POLICY IF EXISTS "jobs_update_own" ON public.jobs;
-- DROP POLICY IF EXISTS "jobs_delete_own" ON public.jobs;
-- -- Do NOT disable RLS on jobs — the anon token policy still depends on it.
-- COMMIT;
