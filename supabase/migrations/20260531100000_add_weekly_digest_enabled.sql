-- Migration: add weekly_digest_enabled to profiles
--
-- Adds a per-user preference controlling the Monday morning push digest.
-- Default is TRUE (opt-out model): existing users who are push-subscribed will
-- receive the digest unless they explicitly turn it off. This is intentional —
-- the digest fires only when there is real activity last week, so a "You made £0"
-- push never lands. Opt-out is the right default for a high-value, low-frequency nudge.
--
-- This migration is idempotent — ADD COLUMN IF NOT EXISTS is a no-op if the
-- column already exists.
--
-- !! FOUNDER ACTION REQUIRED !!
-- Run this SQL in the Supabase dashboard → SQL Editor before merging to main.
-- Without this, the Settings toggle will not save (the column does not exist yet).
-- Dashboard URL: https://app.supabase.com → your project → SQL Editor → New query
--
-- ROLLBACK (only if reverting):
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS weekly_digest_enabled;

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled boolean DEFAULT true;

COMMIT;
