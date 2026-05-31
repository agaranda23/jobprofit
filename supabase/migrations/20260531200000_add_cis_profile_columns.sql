-- Migration: add CIS subcontractor profile fields.
--
-- is_cis_subcontractor: whether this user is a CIS subcontractor (contractor
--   deducts tax from their pay before they receive it).
-- cis_default_rate: the CIS deduction rate that applies to this user.
--   20 = registered, 30 = unregistered, 0 = Gross Payment Status.
--
-- Both columns are opt-out by default (false / 20). Non-CIS users see NO
-- CIS UI — the profile fields merely act as a signal to the frontend.
--
-- This migration is idempotent — uses ADD COLUMN IF NOT EXISTS. Run it once
-- in the Supabase SQL editor (Project → SQL Editor → New query → Run).
--
-- FOUNDER ACTION REQUIRED: run the SQL between BEGIN and COMMIT below in your
-- Supabase project. No RLS changes needed — existing profile RLS policies
-- (users may only read/update their own row) already cover these new columns.

BEGIN;

-- ── 1. CIS subcontractor flag ─────────────────────────────────────────────────
-- Default false so existing rows are unchanged and non-CIS users see nothing.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_cis_subcontractor boolean DEFAULT false;

-- ── 2. CIS default deduction rate ────────────────────────────────────────────
-- 20 = standard registered subcontractor rate.
-- 30 = unregistered.
-- 0  = Gross Payment Status (contractor deducts nothing; subbie owes all tax).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cis_default_rate int DEFAULT 20;

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ───────────────────────────────────
-- BEGIN;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_cis_subcontractor;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS cis_default_rate;
-- COMMIT;
