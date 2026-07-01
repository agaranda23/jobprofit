-- Migration: add google_review_link to profiles
-- Date: 2026-07-01
-- Branch: feat/post-paid-review-nudge
--
-- google_review_link — text (nullable). The trader's Google review shortlink
--   (e.g. https://g.page/r/...). When set, the post-paid "Leave a review"
--   CTA in PostPaidSheet sends a WhatsApp message to the customer containing
--   this link. When null/empty, a settings nudge is shown in its place so the
--   trader is guided to add the link before the next completed job.
--
-- RLS: the existing row-level policies (profiles_select_own, profiles_update_own,
-- profiles_insert_own) apply at the row level and automatically cover every new
-- column — no policy changes needed.
--
-- Safe to run multiple times — ADD COLUMN IF NOT EXISTS is idempotent.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS google_review_link text;

-- Rollback (run manually if needed):
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS google_review_link;
