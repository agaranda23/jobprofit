-- Migration: add founding_member flag to profiles
--
-- Run this in Supabase Studio (SQL editor) before deploying the
-- feat/founding-member-price-lock PR.
--
-- This column is the server-of-record for the Founding Member cohort flag.
-- It is set to true at checkout by the Stripe webhook (after a server-side
-- eligibility re-check against FOUNDER_CUTOFF) and cleared to false on a
-- confirmed subscription cancellation (customer.subscription.deleted).
-- It is never modified by client-side code.
--
-- RLS: the profiles table is already behind per-user RLS. The webhook writes
-- via the service-role key which bypasses RLS — this is intentional and safe
-- because the webhook is server-side only and never exposed to the browser.
-- Client reads come through the normal per-user RLS policy (users can only
-- read their own row), so no additional RLS policy is required.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS founding_member boolean DEFAULT false;
