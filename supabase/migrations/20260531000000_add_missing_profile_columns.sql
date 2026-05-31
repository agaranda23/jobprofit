-- Migration: add all profile columns that were authored in src/lib/migrations/
-- but never promoted to supabase/migrations/ and never run in production.
--
-- ROOT CAUSE: the "overhead tracking / true profit" feature (merged ~2026-05-28)
-- and subsequent billing/trial features wrote their ALTER TABLE statements under
-- src/lib/migrations/ instead of supabase/migrations/. None were run in Supabase.
-- Result: every save that touches overheads, tax_set_aside_pct, stripe_payment_link,
-- plan, or trial columns fails with a PostgreSQL "column does not exist" error,
-- which surfaces in the app as "Could not save — try again."
--
-- This migration is idempotent — every statement uses ADD COLUMN IF NOT EXISTS
-- or ALTER COLUMN only when safe. Run it once in the Supabase SQL editor.
--
-- FOUNDER ACTION REQUIRED — see README note in PR description.

BEGIN;

-- ── 1. overheads ─────────────────────────────────────────────────────────────
-- JSONB array of { id, name, amount, category, is_active } objects.
-- Used by Settings → "Monthly running costs" and the Money tab True Profit card.
-- DEFAULT '[]' means existing profile rows get an empty array, not NULL.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS overheads jsonb DEFAULT '[]'::jsonb;

-- ── 2. tax_set_aside_pct ──────────────────────────────────────────────────────
-- Percentage of income to set aside for tax (default 20 for UK sole traders).
-- Used by Money tab → Tax pot estimate.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tax_set_aside_pct int DEFAULT 20;

-- ── 3. Stripe billing columns ─────────────────────────────────────────────────
-- Written by the Stripe webhook (service-role key, bypasses RLS) and read
-- client-side to determine subscription status.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text;

-- ── 4. stripe_payment_link ────────────────────────────────────────────────────
-- The tradesperson's own Stripe Payment Link URL, embedded in invoices.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_payment_link text;

-- ── 5. plan + trial_ends_at ───────────────────────────────────────────────────
-- plan: 'free' | 'trial' | 'pro' — drives Pro feature gating.
-- trial_ends_at: timestamp when the 14-day trial expires.
--
-- Existing users: plan stays NULL (app treats NULL as 'free').
-- New signups after this migration: plan defaults to 'trial', trial_ends_at
-- defaults to now() + 14 days (handled by the handle_new_user trigger default).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan text,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

-- Set column defaults so the handle_new_user trigger auto-populates new rows.
-- These DEFAULT changes do NOT touch existing rows — only future INSERTs.
ALTER TABLE public.profiles
  ALTER COLUMN plan SET DEFAULT 'trial';

ALTER TABLE public.profiles
  ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');

-- ── 6. account_name + logo_url ────────────────────────────────────────────────
-- May already exist (added manually via Supabase dashboard on earlier branches).
-- ADD COLUMN IF NOT EXISTS is a no-op if they do.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_name text,
  ADD COLUMN IF NOT EXISTS logo_url text;

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ───────────────────────────────────
-- Run manually in the Supabase SQL editor if you need to undo this migration.
--
-- BEGIN;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS overheads;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS tax_set_aside_pct;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_customer_id;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_subscription_id;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS subscription_status;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_payment_link;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS plan;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS trial_ends_at;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS account_name;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS logo_url;
-- COMMIT;
