-- Migration: add welcome_email_sent_at to profiles
-- Date: 2026-06-22
-- Branch: feat/welcome-email
--
-- PURPOSE
-- -------
-- The send-welcome-email Netlify function uses this column as an idempotency
-- guard: it sets the timestamp on first send and checks it is NULL before
-- attempting any send. Without this column the function would send on every
-- app open.
--
-- The column is nullable so that:
--   a) Existing users get NULL and will receive the welcome email on their
--      next app load (if they have an email address).
--   b) New users created before the function is provisioned with a Resend key
--      also get NULL and will receive the email once the key is set.
--
-- SAFE TO RUN MULTIPLE TIMES — IF NOT EXISTS guard is applied.
-- Run this in Supabase Studio → SQL Editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

-- No index required — the column is only queried via .eq('id', userId) which
-- uses the existing primary-key index on profiles.id.
