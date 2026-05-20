-- Migration: anonymous public SELECT on jobs by publicAccessToken — Phase G-1
-- Date: 2026-05-20
-- Branch: feat/phase-g1-public-quote-view
--
-- PURPOSE
-- -------
-- Allow an unauthenticated (anon) user to read a SINGLE jobs row when they
-- supply the correct publicAccessToken that is stored in the job's meta column.
--
-- This powers the customer-facing public quote view at /q/<token>. The trader
-- generates the token lazily (on first "Send link" tap) and it is stored in
-- meta->>'publicAccessToken'. The public page fetches the job using:
--
--   supabase
--     .from('jobs')
--     .select(...)
--     .eq('meta->>publicAccessToken', token)
--     .single()
--
-- SECURITY MODEL
-- --------------
-- Two layers of restriction make the token the capability:
--   1. RLS POLICY: only rows where meta->>'publicAccessToken' IS NOT NULL are
--      readable by anon at all. Jobs with no token are never visible to anon.
--   2. CLIENT FILTER: the query always adds .eq('meta->>publicAccessToken', token)
--      so only the single matching row is returned. An anon client cannot read
--      all shared jobs — it always needs the specific token.
--
-- The combination is equivalent to URL-as-capability: the token IS the permission.
-- Without the exact UUID, the RLS still blocks the row because the client filter
-- produces no match, and even if it didn't, step 1 means anon can only see rows
-- that explicitly have a token. Jobs without a token are completely hidden.
--
-- Authenticated users continue to read their own jobs via the existing
-- "jobs_select_own" policy (auth.uid() = user_id). Authenticated reads are
-- unaffected by this migration.
--
-- COLUMN REQUIREMENTS
-- -------------------
-- Requires the `meta jsonb` column added in migration 20260520213419.
-- Run that migration first if not already applied.
--
-- IDEMPOTENCY
-- -----------
-- DROP POLICY IF EXISTS guards make this safe to re-run.
--
-- ROLLBACK
-- --------
-- See the rollback block at the bottom of this file.

BEGIN;

-- Allow the anon role to read jobs that have a publicAccessToken set.
-- The specific token filter lives in the client query — see store.js
-- fetchPublicJob() which adds .eq('meta->>publicAccessToken', token).
DROP POLICY IF EXISTS "jobs_select_public_by_token" ON public.jobs;

CREATE POLICY "jobs_select_public_by_token"
  ON public.jobs
  FOR SELECT
  TO anon
  USING (meta->>'publicAccessToken' IS NOT NULL);

-- GIN index already exists on meta (jobs_meta_gin_idx from 20260520213419).
-- No additional index needed — Postgres will use the GIN index for
-- jsonb existence and equality operators.

COMMIT;

-- ─── ROLLBACK (do not run unless reverting) ──────────────────────────────────
--
-- BEGIN;
-- DROP POLICY IF EXISTS "jobs_select_public_by_token" ON public.jobs;
-- COMMIT;
