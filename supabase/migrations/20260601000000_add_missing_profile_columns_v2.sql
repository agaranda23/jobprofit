-- Migration: add ALL missing profile columns (comprehensive idempotent sweep)
-- Date: 2026-06-01
--
-- Root cause: each feature sprint adds profile fields but migrations were not
-- always applied in production. This migration is the single authoritative
-- record of every column the client reads/writes on the profiles table.
--
-- Safe to run multiple times — every statement uses ADD COLUMN IF NOT EXISTS.
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → Run).
--
-- Columns already declared in earlier migrations (kept here for documentation
-- only — ADD COLUMN IF NOT EXISTS means duplicates are no-ops):
--
--   id, business_name, first_name, last_name, sort_code, account_number,
--   created_at, updated_at
--     → 20260513_create_profiles_table.sql
--
--   preferred_voice_lang
--     → 20260526000000_add_preferred_voice_lang.sql
--
--   overheads, tax_set_aside_pct, stripe_customer_id,
--   stripe_subscription_id, subscription_status, stripe_payment_link,
--   plan, trial_ends_at, account_name, logo_url
--     → 20260531000000_add_missing_profile_columns.sql
--
--   weekly_digest_enabled
--     → 20260531100000_add_weekly_digest_enabled.sql
--
--   is_cis_subcontractor, cis_default_rate
--     → 20260531200000_add_cis_profile_columns.sql
--
--   stripe_user_id, stripe_connect_status,
--   stripe_connect_connected_at, stripe_connect_disconnected_at
--     → 20260531300000_add_stripe_connect_columns.sql
--
--   default_deposit_percent
--     → 20260531600000_add_deposit_support.sql
--
-- NEWLY ADDED by this migration (previously missing — caused live save failures):
--
--   hourly_rate       — £/hr rate for time-cost calculation on jobs
--                       (SettingsScreen openEditHourlyRate, validates ≥ 0)
--
-- Re-declared as belt-and-braces (were in 20260531000000 but reported as
-- missing in production — likely that migration was not run):
--   account_name, logo_url, vat_number
--
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. hourly_rate (NEW — was never in any migration) ─────────────────────────
-- Stored as numeric so calculations don't accumulate float rounding.
-- NULL means "not set" — the client treats NULL and '' the same way (optional).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(10, 2);

-- ── 2. vat_number (belt-and-braces — may have been missed) ───────────────────
-- Nullable text. Appears on invoices when set.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vat_number text;

-- ── 3. account_name (belt-and-braces — was in 20260531000000) ────────────────
-- The account holder name shown on invoices alongside sort code + account number.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_name text;

-- ── 4. logo_url (belt-and-braces — was in 20260531000000) ────────────────────
-- Public URL of the trader's logo image. Set by the logo upload flow in
-- SettingsScreen — either a pasted URL or the result of a Supabase Storage upload.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS logo_url text;

-- ── 5. All other columns (belt-and-braces, all idempotent) ───────────────────
-- These are already in earlier migrations but listed here so a fresh Supabase
-- project can bootstrap from this single file.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS overheads jsonb DEFAULT '[]'::jsonb;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS tax_set_aside_pct int DEFAULT 20;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_payment_link text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS preferred_voice_lang text NOT NULL DEFAULT 'en-GB';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS weekly_digest_enabled boolean DEFAULT true;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_cis_subcontractor boolean DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cis_default_rate int DEFAULT 20;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_user_id text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_status text DEFAULT 'disconnected';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_connected_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_disconnected_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_deposit_percent integer DEFAULT 25;

-- Add the 0–100 check constraint for default_deposit_percent if not already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'profiles'
      AND constraint_name = 'profiles_default_deposit_percent_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_default_deposit_percent_check
        CHECK (default_deposit_percent IS NULL OR (default_deposit_percent >= 0 AND default_deposit_percent <= 100));
  END IF;
END $$;

-- ── Rollback (run manually if needed, column by column) ───────────────────────
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS hourly_rate;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS vat_number;
-- (other columns are pre-existing and should not be dropped)
