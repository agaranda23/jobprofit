-- Migration: add default_markup to public.profiles
-- Date: 2026-06-10
-- Branch: feat/materials-library
--
-- PURPOSE
-- -------
-- Stores the user's global default markup percentage applied when placing a
-- library material onto a quote. Per-line overrides are stored on the
-- materials row itself (materials.default_markup).
--
-- Default 20 matches the founder-approved product default.
--
-- IDEMPOTENCY
-- -----------
-- ADD COLUMN IF NOT EXISTS is safe to re-run.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_markup numeric(5,2) NOT NULL DEFAULT 20;

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ───────────────────────────────────
-- BEGIN;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS default_markup;
-- COMMIT;
