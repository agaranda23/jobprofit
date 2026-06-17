-- Migration: trial clock starts at first real use, not at auth-record creation.
-- Date: 2026-06-17
-- Branch: fix/trial-starts-at-first-use
--
-- ROOT CAUSE
-- ----------
-- The column DEFAULT on trial_ends_at was:
--
--   ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');
--
-- This fires at INSERT time — which is when the auth.users trigger
-- (handle_new_user) creates the profiles row.  If the user signed up via OTP
-- days or weeks before they actually used the app, their 14-day window is
-- already partially consumed.
--
-- FIX
-- ---
-- 1. Remove the DEFAULT so trial_ends_at is NULL for new signups.
-- 2. The app sets trial_ends_at = now() + 14 days the FIRST time it sees the
--    column is NULL while the user is authenticated (first real app load).
--    Subsequent loads are a no-op (idempotent guard in the app).
-- 3. Existing rows with a non-NULL trial_ends_at are untouched — do NOT reset
--    active-trial or paying users.
--
-- SAFE TO RUN MULTIPLE TIMES — all changes are guarded.
-- Run this in Supabase Studio → SQL Editor.

BEGIN;

-- ── 1. Remove the column DEFAULT so new auth signups get trial_ends_at = NULL ──
-- After this runs, every new user who signs up gets a NULL trial_ends_at and a
-- plan of 'trial'. The app fills in trial_ends_at on first authenticated load.
-- Previously-enrolled users whose trial_ends_at is already set are not affected
-- because DEFAULT only applies to future INSERTs.

ALTER TABLE public.profiles
  ALTER COLUMN trial_ends_at DROP DEFAULT;

-- ── 2. No backfill of existing rows ───────────────────────────────────────────
-- We intentionally do NOT mass-reset existing trial_ends_at values because:
--   a) Active-trial users would lose days they have already earned.
--   b) Paying (plan='pro') users must be completely untouched.
--   c) Task 1 diagnosis is needed to decide whether a targeted backfill for
--      specific "burned clock" accounts is warranted. If it is, run:
--
--      UPDATE public.profiles
--        SET trial_ends_at = now() + interval '14 days'
--        WHERE id = (SELECT id FROM auth.users WHERE email = 'THEIR_EMAIL')
--          AND plan = 'trial';
--
-- ── 3. Preserve the plan DEFAULT ('trial') for new signups ───────────────────
-- plan DEFAULT 'trial' was added in 20260531000000 and must stay — we still
-- want new users to start on the trial plan.  This is idempotent.
ALTER TABLE public.profiles
  ALTER COLUMN plan SET DEFAULT 'trial';

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ───────────────────────────────────
-- BEGIN;
-- ALTER TABLE public.profiles
--   ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');
-- COMMIT;
