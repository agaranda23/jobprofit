-- Migration: add auto_chase_enabled column to profiles
--
-- Controls whether the daily chase-reminder push is active for a user.
-- Default true so existing pro/trial users are opted-in automatically.
-- Free users: the scheduled function filters them out (plan check); the
-- column is set for them too but never read by the scheduler.
--
-- Idempotent — safe to run more than once.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auto_chase_enabled boolean DEFAULT true;

-- Rollback: ALTER TABLE public.profiles DROP COLUMN IF EXISTS auto_chase_enabled;
