-- Migration: add first_name and last_name to profiles
-- Date: 2026-05-13
-- Slice: nav-redesign-slice-2
--
-- ADDITIVE ONLY. Both columns are nullable with no default.
-- Existing rows remain as-is (NULL). Backfill happens inside
-- the onboarding wizard when the user submits — never here.
-- Old-nav users with NULL first_name / last_name are unaffected.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- Also ensure the bank columns exist. The legacy App.jsx settings
-- stored sort_code / account_number in localStorage only.
-- These columns may already exist if a previous migration added them;
-- ADD COLUMN IF NOT EXISTS is a no-op when they're already present.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sort_code      TEXT,
  ADD COLUMN IF NOT EXISTS account_number TEXT;
