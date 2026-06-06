-- Migration: close anon job enumeration hole — Security H-1
-- Date: 2026-06-06
-- Branch: fix/security-stop-the-line
--
-- PURPOSE
-- -------
-- The policy "jobs_select_public_by_token" (added in 20260520223130) allowed
-- any anon Supabase client to SELECT every jobs row where meta->>'publicAccessToken'
-- IS NOT NULL. Although client queries filtered by an exact token, the RLS check
-- itself was permissive: any caller who omitted the .eq() filter (or used the
-- Supabase REST API directly) could page through every tokenised job, including
-- customer signatures stored in meta.
--
-- FIX
-- ---
-- Drop the permissive anon policy. Public job data is now served exclusively by
-- the `fetch-public-job` Netlify function, which uses the service role to do an
-- exact-match token lookup and returns only whitelisted fields — never raw meta.
--
-- The public quote/invoice/receipt pages (PublicQuoteView, PublicInvoiceView,
-- PublicReceiptView) have been updated to call /.netlify/functions/fetch-public-job
-- instead of using the anon Supabase client directly. The store.fetchPublicJob()
-- function remains in place for backwards compatibility but the public pages no
-- longer call it for their primary data load.
--
-- IMPORTANT: the authenticated owner policies codified in 20260606000000 are
-- NOT affected. Logged-in traders can still read their own jobs via the
-- "jobs_select_own" policy (auth.uid() = user_id).
--
-- IDEMPOTENCY
-- -----------
-- DROP POLICY IF EXISTS is a no-op if the policy has already been removed.
--
-- ROLLBACK
-- --------
-- To restore the old anon access (not recommended — re-opens the hole),
-- re-run 20260520223130_jobs_public_select_by_token.sql.

BEGIN;

DROP POLICY IF EXISTS "jobs_select_public_by_token" ON public.jobs;

COMMIT;
