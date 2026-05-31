-- Migration: add Stripe Connect columns to profiles
--
-- Adds the four columns needed to track a trader's connected Stripe account
-- (Standard Connect mode — decision #2, locked 2026-05-31).
--
-- stripe_user_id            — the Stripe connected account ID (acct_...).
--                             Null until the trader completes OAuth.
-- stripe_connect_status     — 'disconnected' | 'connected' | 'pending'.
--                             'pending' is reserved for a future Express flow;
--                             v1 only uses 'disconnected' and 'connected'.
-- stripe_connect_connected_at    — timestamp when last connected.
-- stripe_connect_disconnected_at — timestamp when last disconnected.
--
-- RLS: existing profiles policies allow each user to SELECT and UPDATE only
-- their own row. No additional RLS changes are required — the new columns
-- are covered automatically by the existing per-user policies.
--
-- This migration is idempotent — uses ADD COLUMN IF NOT EXISTS.
-- Run it once in the Supabase SQL editor:
--   Project → SQL Editor → New query → paste → Run.
--
-- FOUNDER ACTION REQUIRED: run the SQL between BEGIN and COMMIT below
-- in your Supabase project before deploying feat/stripe-connect-pr1-settings.

BEGIN;

-- ── 1. Connected account ID (Standard Connect) ────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_user_id text;

-- ── 2. Connection status ──────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_status text DEFAULT 'disconnected';

-- ── 3. Connected at timestamp ─────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_connected_at timestamptz;

-- ── 4. Disconnected at timestamp ──────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_disconnected_at timestamptz;

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ────────────────────────────────────
-- BEGIN;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_user_id;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_connect_status;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_connect_connected_at;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS stripe_connect_disconnected_at;
-- COMMIT;
