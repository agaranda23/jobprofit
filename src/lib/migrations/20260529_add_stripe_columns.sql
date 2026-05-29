-- Migration: add Stripe billing columns to profiles
--
-- Run this in Supabase Studio (SQL editor) before deploying the stripe-checkout-billing PR.
-- All columns are optional/nullable — the app is null-safe if this migration hasn't run yet.
--
-- RLS: these columns live on the profiles table which is already behind per-user RLS
-- (users can only read/write their own row). The webhook writes via the service-role key
-- which bypasses RLS — that is intentional and safe because the webhook is server-side only.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS subscription_status text;
