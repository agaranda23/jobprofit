-- Migration: add trial lifecycle columns to profiles
-- Date: 2026-05-29
-- Branch: feat/trial-lifecycle
--
-- Run this in Supabase Studio (SQL editor) AFTER the Stripe migration
-- (20260529_add_stripe_columns.sql). Safe to run twice — all statements are
-- idempotent via IF NOT EXISTS / WHERE guards.
--
-- ── Why existing users are safe ──────────────────────────────────────────────
-- Profile rows for ALL existing auth users were created by the backfill INSERT
-- in 20260513_create_profiles_table.sql. Those rows already exist, so the
-- column DEFAULTs below only take effect for FUTURE INSERT statements (i.e. the
-- handle_new_user trigger firing for a brand-new signup). Existing rows keep
-- NULL for trial_ends_at and keep whatever plan value they already have (which
-- is 'free' from the previous plan migration default). No UPDATE is issued —
-- we do NOT back-date existing users into a trial.
--
-- ── What new signups get ──────────────────────────────────────────────────────
-- The handle_new_user trigger does: INSERT INTO profiles (id) VALUES (NEW.id)
-- It sets no other columns, so column DEFAULTs govern them. After this migration:
--   plan            → 'trial'
--   trial_ends_at   → now() + 14 days
-- Full Pro access from day 1, auto-expires on day 15 (app handles expiry flip).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

-- Change the default for plan so NEW rows (new signups) start on 'trial'.
-- The previous default was 'free' — existing rows are already written and
-- are unaffected by this DEFAULT change.
ALTER TABLE public.profiles
  ALTER COLUMN plan SET DEFAULT 'trial';

-- Set the trial_ends_at default so NEW rows auto-populate 14-day window.
ALTER TABLE public.profiles
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');
