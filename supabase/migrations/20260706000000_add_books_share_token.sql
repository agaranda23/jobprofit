-- Migration: add revocable "books share" token to profiles
--
-- Powers the read-only accountant "books link" (feat/accountant-books-link).
-- A Pro trader generates a token from Settings → Costs → "Share my books with
-- your accountant". The token is the ONLY key that unlocks a read-only summary
-- of their income/expenses/VAT/tax-estimate at /books/<token>. Revoking sets
-- the column back to NULL, which immediately invalidates the link (the next
-- request finds no matching row → 404).
--
-- books_share_token       — nullable UUID. NULL = no active share link.
-- books_share_created_at  — nullable timestamptz. Set whenever a new token is
--                            minted; lets the Settings UI show "Shared since …".
--
-- SECURITY MODEL (mirrors the CURRENT jobs public-link pattern, i.e. the
-- POST-H-1-fix model in 20260606000001_close_anon_jobs_enumeration.sql — NOT
-- the original 20260520223130 anon-RLS-policy pattern, which was deliberately
-- retired for leaking an enumeration surface):
--   - NO new RLS policy is added here, and in particular NO "TO anon" policy.
--   - profiles has never had an anon SELECT policy and this migration does not
--     add one. The only reader of this column is the fetch-books-summary
--     Netlify function, which uses the SERVICE ROLE key to do an exact-match
--     lookup server-side and returns a hand-picked (whitelisted) subset of
--     fields — never sort_code/account_number/stripe_*/the raw row.
--   - The existing "profiles_select_own" / "profiles_update_own" policies
--     (auth.uid() = id) already cover this column for the trader themselves —
--     no policy change needed for the generate/revoke write path either.
--
-- Idempotent — ADD COLUMN IF NOT EXISTS + a partial unique index guard.
--
-- FOUNDER ACTION REQUIRED: run the SQL between BEGIN and COMMIT below in the
-- Supabase Studio SQL Editor before/after merging feat/accountant-books-link
-- (the app degrades gracefully — Settings row just can't generate a link
-- until the column exists; nothing else breaks).

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS books_share_token uuid,
  ADD COLUMN IF NOT EXISTS books_share_created_at timestamptz;

-- Guards against a UUID collision ever mapping two traders' books to the same
-- link (astronomically unlikely with crypto.randomUUID(), but free to enforce).
CREATE UNIQUE INDEX IF NOT EXISTS profiles_books_share_token_idx
  ON public.profiles (books_share_token)
  WHERE books_share_token IS NOT NULL;

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ────────────────────────────────────
-- BEGIN;
-- DROP INDEX IF EXISTS profiles_books_share_token_idx;
-- ALTER TABLE public.profiles
--   DROP COLUMN IF EXISTS books_share_token,
--   DROP COLUMN IF EXISTS books_share_created_at;
-- COMMIT;
