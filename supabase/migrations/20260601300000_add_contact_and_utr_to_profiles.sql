-- Migration: add business contact details + UTR to profiles
-- Date: 2026-06-01
-- Branch: fix/business-details-not-on-documents
--
-- These columns are READ by the PDF generators (invoicePDF.js, receiptPDF.js)
-- but were never WRITABLE via Settings — causing the "filled in Settings but
-- fields don't appear on documents" bug.
--
-- address    — business address, rendered in the invoice/quote/receipt header
-- phone      — business phone, rendered next to email in the document header
-- email      — business email, rendered next to phone in the document header
-- utr_number — UTR (Unique Taxpayer Reference), rendered under address/contact
--              when set; relevant for self-assessment / CIS subcontractors
--
-- RLS: only the user who owns the row can read or write these columns.
-- The existing RLS policies on profiles (profiles_select_own,
-- profiles_update_own, profiles_insert_own) apply at the row level and
-- automatically cover any new column — no policy changes needed.
--
-- Safe to run multiple times — ADD COLUMN IF NOT EXISTS is idempotent.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS address text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS utr_number text;

-- Rollback (run manually if needed):
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS address;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS phone;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS email;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS utr_number;
