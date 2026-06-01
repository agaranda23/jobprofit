-- Migration: add document-completeness settings to profiles
-- Date: 2026-06-01
-- Branch: feat/document-completeness-quote-invoice
--
-- itemise_documents   — boolean (default false). When OFF (the default) the
--   customer-facing invoice and quote PDFs do NOT show the labour/materials
--   cost split or the "Additional costs" line. The trader's total is shown
--   as a single number. CIS deduction maths and internal profit calculations
--   continue to use the materials figure regardless of this toggle.
--
-- quote_validity_days — int (default 30). The number of days after the quote
--   issue date before the quote expires. Rendered as "Valid until <date>" in
--   the quote PDF header and on the public quote view.
--
-- payment_terms_days  — int (default 14). The default net payment term. When
--   no explicit dueDate is supplied the invoice auto-computes:
--   dueDate = today + payment_terms_days. This drives the "Due: <date>" line.
--
-- RLS: the existing row-level policies (profiles_select_own, profiles_update_own,
-- profiles_insert_own) apply at the row level and automatically cover every new
-- column — no policy changes needed.
--
-- Safe to run multiple times — ADD COLUMN IF NOT EXISTS is idempotent.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS itemise_documents boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS quote_validity_days integer NOT NULL DEFAULT 30;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS payment_terms_days integer NOT NULL DEFAULT 14;

-- Rollback (run manually if needed):
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS itemise_documents;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS quote_validity_days;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS payment_terms_days;
