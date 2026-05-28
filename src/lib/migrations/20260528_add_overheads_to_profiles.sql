-- Migration: add overheads column to profiles
-- Run this in Supabase Studio (SQL editor) before deploying the
-- feat/money-true-profit-overhead branch to production.
--
-- Safe to run multiple times: ALTER TABLE … ADD COLUMN IF NOT EXISTS
-- will no-op if the column already exists.
--
-- Overheads are stored as a JSONB array on the profile row — same
-- pattern as other meta fields (no new table, no RLS work required).
-- Shape: [{ id, name, amount (number), category, is_active (bool) }]
--
-- The app reads it null-safe: Array.isArray(profile?.overheads) ? profile.overheads : []

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS overheads jsonb DEFAULT '[]'::jsonb;
