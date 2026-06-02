-- Migration: add AI quote build quota columns to profiles
-- Date: 2026-06-02
--
-- Adds a monthly-resetting counter for AI quote builds.
-- Free tier: 3 builds per calendar month. Pro: unlimited (checked in generate-quote.js).
--
-- Design:
--   ai_quote_builds_count  — number of AI builds used this period
--   ai_quote_builds_period — YYYY-MM string identifying the current month
--
-- Reset logic: when ai_quote_builds_period != current YYYY-MM, the server
-- resets the count to 0 and sets the period to the current month on next use.
-- This is a soft reset — no cron job required; the application handles it.
--
-- Safe to run multiple times — both statements use ADD COLUMN IF NOT EXISTS.
-- Run in: Supabase dashboard → SQL Editor → Run.
--
-- RLS note: profiles rows are owned by the authenticated user (existing policy
-- profiles_select_own / profiles_update_own). These new columns are covered
-- automatically by those policies — no new RLS rules required.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Monthly build counter ─────────────────────────────────────────────────
-- Counts AI quote builds in the current billing period.
-- Default 0 so existing users start with their full free quota immediately.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_quote_builds_count integer DEFAULT 0;

-- ── 2. Period key (YYYY-MM) ───────────────────────────────────────────────────
-- Identifies which month the counter belongs to. When the stored value differs
-- from the current month the server resets the counter before checking quota.
-- NULL treated as "never used" → effectively a fresh period.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS ai_quote_builds_period text;

-- ── Rollback (run manually if needed) ────────────────────────────────────────
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS ai_quote_builds_count;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS ai_quote_builds_period;
