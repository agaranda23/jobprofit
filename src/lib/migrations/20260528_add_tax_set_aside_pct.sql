-- Migration: add tax_set_aside_pct to profiles
-- Run this in Supabase Studio (SQL editor) before deploying the
-- feat/money-tax-setaside-and-pro-gating branch to production.
--
-- Safe to run multiple times: ALTER TABLE … ADD COLUMN IF NOT EXISTS
-- will no-op if the column already exists.
--
-- Default 20 = 20 % tax set-aside (sensible baseline for UK sole traders
-- below the higher-rate threshold).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS tax_set_aside_pct int DEFAULT 20;
