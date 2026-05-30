-- Migration: add stripe_payment_link to profiles
--
-- Run this in Supabase Studio (SQL editor) before deploying feat/invoice-pay-by-link-v2.
-- Idempotent — safe to run more than once.
--
-- Purpose: stores the tradesperson's own Stripe Payment Link URL.
-- When set, invoices (WhatsApp + PDF) include a "Pay by card" link
-- pointing directly to this URL. JobProfit never touches the funds —
-- money goes straight from the customer to the tradesperson's Stripe account.
--
-- RLS: profiles is already behind per-user RLS (each user can only
-- read/write their own row). No policy changes needed.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_payment_link text;
