-- Migration: create profiles table
-- Date: 2026-05-13
-- Branch: nav-redesign-slice-2
--
-- The previous migration (20260513_add_name_columns_to_profiles.sql) assumed the
-- table already existed. It does not — there has never been a profiles table in
-- production. This file supersedes that migration and creates the table from
-- scratch, idempotently.
--
-- Run this in the Supabase SQL editor. It is safe to run twice.

-- ─── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id             UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name  TEXT,
  first_name     TEXT,
  last_name      TEXT,
  sort_code      TEXT,
  account_number TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- ─── 2. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop policies first so re-running is a no-op
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ─── 3. Auto-create empty row on sign-up ────────────────────────────────────
-- SECURITY DEFINER so the trigger can bypass RLS on insert.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ─── 4. Backfill existing users ──────────────────────────────────────────────
-- Gives every user who already has an auth account an empty profiles row.
-- ON CONFLICT DO NOTHING is safe to re-run.

INSERT INTO public.profiles (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;
