-- Migration: add marketing_consent JSONB column to jobs.
--
-- WHY THIS TABLE: JobProfit has no separate customers table. A "customer" is
-- the person who receives a quote at /q/<token>. Their identity (name, email)
-- and all touchpoint data live in the jobs row, inside the meta JSONB column.
-- Marketing consent is similarly scoped to a specific trader-customer pair
-- on a specific job. Storing it in jobs.marketing_consent (a top-level column,
-- not buried inside meta) makes it queryable, auditable, and clearly separated
-- from the transactional fields in meta that the chase ladder reads.
--
-- SCHEMA:
--   marketing_consent JSONB — null means never asked. When captured:
--   {
--     "granted":            boolean,
--     "source":             "public_accept",
--     "timestamp":          ISO 8601 string,
--     "controller_trader_id": UUID (jobs.user_id)
--   }
--
-- HARD SEPARATION GUARANTEE: marketing_consent is a top-level column, not a
-- field inside meta. The chase-reminders function reads ONLY meta fields
-- (chaseRemindedTier, chaseRemindedAt, quoteStatus, status). It has no JOIN
-- or reference to marketing_consent and cannot inadvertently use it as an
-- opt-out flag. This constraint is enforced by convention and documented here
-- for future reviewers.
--
-- RLS: no new policies needed. The existing jobs RLS policies (users may only
-- read/update their own rows; service role has full access) already cover all
-- columns on the jobs table, including this one.
--
-- FOUNDER ACTION REQUIRED — MUST apply before deploying feat/marketing-consent-capture:
--   1. Open Supabase Studio → SQL Editor → New query.
--   2. Paste and run:
--
--        BEGIN;
--        ALTER TABLE public.jobs
--          ADD COLUMN IF NOT EXISTS marketing_consent JSONB DEFAULT NULL;
--        COMMIT;
--
--   3. Verify: Studio → Table Editor → jobs → check the column appears.
--   4. THEN merge / deploy the feat/marketing-consent-capture branch.
--
-- The migration is idempotent (ADD COLUMN IF NOT EXISTS) — safe to re-run.

BEGIN;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS marketing_consent JSONB DEFAULT NULL;

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ───────────────────────────────────
-- BEGIN;
-- ALTER TABLE public.jobs
--   DROP COLUMN IF EXISTS marketing_consent;
-- COMMIT;
