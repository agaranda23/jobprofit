-- Migration: add terms_text and website to profiles
-- Date: 2026-06-01
-- Branch: feat/document-completeness-receipt-terms
--
-- terms_text — text (nullable). Free-form terms & conditions / exclusions text
--   the trader can enter. Rendered in the footer of quote and invoice PDFs
--   (and their public views) when set. When null/empty, the footer section is
--   omitted entirely — no placeholder text is shown to the customer.
--
-- website    — text (nullable). The trader's website URL. Threaded through
--   resolveBusinessIdentity and shown in the business header/contact line on
--   quote, invoice, and receipt documents when set.
--
-- RLS: the existing row-level policies (profiles_select_own, profiles_update_own,
-- profiles_insert_own) apply at the row level and automatically cover every new
-- column — no policy changes needed.
--
-- Safe to run multiple times — ADD COLUMN IF NOT EXISTS is idempotent.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS terms_text text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS website text;

-- Rollback (run manually if needed):
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS terms_text;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS website;
