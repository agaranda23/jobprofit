-- Migration: create public.materials table for the Materials Library MVP
-- Date: 2026-06-10
-- Branch: feat/materials-library
--
-- PURPOSE
-- -------
-- Stores a per-user library of material/part line items so tradespeople can
-- re-use buy prices, descriptions, and unit info across quotes and receipts.
-- The library builds itself as users save line items from live jobs.
--
-- DESIGN DECISIONS
-- ----------------
-- * buy price stored EX-VAT as `cost`; `vat_rate` defaults to 0.20.
-- * `default_markup` is a per-row override of the profile-level default (%).
-- * `use_count` ranks type-ahead results (most-used first).
-- * `archived` is soft-delete: hidden from type-ahead but never lost.
-- * No supplier-API integration in v1 — self-serve only.
-- * Kits and CSV import are future Pro features — NOT in this migration.
--
-- RLS
-- ---
-- Standard owner-scoped policies: authenticated users see only their own rows.
-- No public-token or anon access needed.
--
-- IDEMPOTENCY
-- -----------
-- CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS guards make this safe
-- to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.materials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  desc          text NOT NULL,
  cost          numeric(10,2) NOT NULL,          -- buy price ex-VAT
  unit          text,                            -- e.g. "each", "m²", "length"
  supplier_code text,                            -- e.g. "SFX-123456"
  supplier      text,                            -- e.g. "Screwfix"
  default_markup numeric(5,2),                   -- per-row markup % override; NULL = use profile default
  vat_rate      numeric(4,3) NOT NULL DEFAULT 0.20,
  use_count     integer NOT NULL DEFAULT 0,
  archived      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for type-ahead: user's non-archived rows ordered by use_count desc
CREATE INDEX IF NOT EXISTS materials_user_active_idx
  ON public.materials (user_id, use_count DESC)
  WHERE archived = false;

-- Index for supplier_code search
CREATE INDEX IF NOT EXISTS materials_user_code_idx
  ON public.materials (user_id, supplier_code)
  WHERE supplier_code IS NOT NULL AND archived = false;

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "materials_select_own" ON public.materials;
CREATE POLICY "materials_select_own"
  ON public.materials FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "materials_insert_own" ON public.materials;
CREATE POLICY "materials_insert_own"
  ON public.materials FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "materials_update_own" ON public.materials;
CREATE POLICY "materials_update_own"
  ON public.materials FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "materials_delete_own" ON public.materials;
CREATE POLICY "materials_delete_own"
  ON public.materials FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ───────────────────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS public.materials;
-- COMMIT;
