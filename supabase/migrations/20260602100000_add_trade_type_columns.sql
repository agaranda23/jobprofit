-- Migration: add trade-type profile fields (Phase 1 data capture).
--
-- trade_types:   array of curated trade keys the user identifies with (up to 3).
--                e.g. '{"plumber","gas_engineer"}' — stored as text[] for
--                simple equality checks. No FK reference needed.
-- trade_primary: the user's starred main trade from the selected set.
--                Matches one of the values in trade_types.
-- trade_other:   free-text when the user picks "Other" from the chip grid.
--
-- All columns are nullable — existing users are unaffected. No gate, no
-- required field — users who never visit Settings → Your trade see nothing.
--
-- RLS: no changes needed. Existing profile RLS policies (users may only
-- read/update their own row, service role has full access) already cover
-- all new columns on the profiles table.
--
-- FOUNDER ACTION REQUIRED: run the SQL between BEGIN and COMMIT in your
-- Supabase project (Studio → SQL Editor → New query → Run), then deploy
-- the feat/trade-type-capture branch so the frontend columns are live.
-- The migration is idempotent — safe to re-run.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trade_types  text[]  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trade_primary text   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS trade_other  text    DEFAULT NULL;

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ───────────────────────────────────
-- BEGIN;
-- ALTER TABLE public.profiles
--   DROP COLUMN IF EXISTS trade_types,
--   DROP COLUMN IF EXISTS trade_primary,
--   DROP COLUMN IF EXISTS trade_other;
-- COMMIT;
