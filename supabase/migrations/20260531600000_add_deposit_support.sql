-- Migration: add deposit-on-acceptance support
--
-- Part of feat/stripe-connect-pr4-deposit-on-acceptance.
--
-- Summary of changes:
--   invoice_payment_tokens:
--     kind               — 'invoice' (default) | 'deposit'. Routing signal for
--                          stripe-connect-webhook.js. Check constraint enforces valid values.
--     quote_id           — nullable FK to jobs.id (quotes and jobs share one table).
--                          Set only when kind='deposit'; null for kind='invoice'.
--     deposit_percent    — nullable integer (0–100). Only set when kind='deposit'.
--
--   jobs:
--     deposit_percent    — % requested on the quote (0 = no deposit requested)
--     deposit_amount_pence — amount in pence calculated at quote-send time
--     deposit_paid_at    — timestamp set by webhook when deposit clears Stripe
--     deposit_payment_token_id — FK to invoice_payment_tokens.id (the deposit token)
--
--   profiles:
--     default_deposit_percent — trader preference (0–100, default 25)
--
-- Schema note: quotes are stored as jobs rows (no separate quotes table exists).
-- The deposit columns go on jobs directly. quote_id on invoice_payment_tokens
-- also references jobs.id to make the deposit→job link explicit and queryable.
--
-- Run once in the Supabase SQL editor before deploying this PR to production.
-- Safe to re-run (ADD COLUMN IF NOT EXISTS + DROP POLICY IF EXISTS pattern).

BEGIN;

-- ── 1. invoice_payment_tokens additions ──────────────────────────────────────

ALTER TABLE public.invoice_payment_tokens
  ADD COLUMN IF NOT EXISTS kind            text        NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS quote_id        uuid        REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deposit_percent integer;

-- Check constraint — guard valid kind values. Only add if not already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'invoice_payment_tokens'
      AND constraint_name = 'ipt_kind_check'
  ) THEN
    ALTER TABLE public.invoice_payment_tokens
      ADD CONSTRAINT ipt_kind_check CHECK (kind IN ('invoice', 'deposit'));
  END IF;
END $$;

-- Check constraint — deposit_percent must be 0–100 when set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'invoice_payment_tokens'
      AND constraint_name = 'ipt_deposit_percent_check'
  ) THEN
    ALTER TABLE public.invoice_payment_tokens
      ADD CONSTRAINT ipt_deposit_percent_check
        CHECK (deposit_percent IS NULL OR (deposit_percent >= 0 AND deposit_percent <= 100));
  END IF;
END $$;

COMMENT ON COLUMN public.invoice_payment_tokens.kind IS
  'Routing tag: ''invoice'' (default) for Pay-now links; ''deposit'' for deposit checkout sessions. '
  'Read by stripe-connect-webhook.js to branch payment handling.';

COMMENT ON COLUMN public.invoice_payment_tokens.quote_id IS
  'FK to jobs.id — set when kind=''deposit''. Identifies the quote the deposit was requested against. '
  'Null for kind=''invoice''.';

COMMENT ON COLUMN public.invoice_payment_tokens.deposit_percent IS
  'Deposit percentage (0–100) at time of checkout session creation. '
  'Only set when kind=''deposit''. Null for invoice tokens.';

-- Index on quote_id for webhook deposit lookups
CREATE INDEX IF NOT EXISTS invoice_payment_tokens_quote_idx
  ON public.invoice_payment_tokens (quote_id)
  WHERE quote_id IS NOT NULL;

-- Index on kind for reconciliation queries
CREATE INDEX IF NOT EXISTS invoice_payment_tokens_kind_idx
  ON public.invoice_payment_tokens (kind);

-- ── 2. jobs additions (quotes share the jobs table) ──────────────────────────

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS deposit_percent          integer      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_amount_pence     integer,
  ADD COLUMN IF NOT EXISTS deposit_paid_at          timestamptz,
  ADD COLUMN IF NOT EXISTS deposit_payment_token_id uuid         REFERENCES public.invoice_payment_tokens(id) ON DELETE SET NULL;

-- Check constraint on deposit_percent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'jobs'
      AND constraint_name = 'jobs_deposit_percent_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_deposit_percent_check
        CHECK (deposit_percent IS NULL OR (deposit_percent >= 0 AND deposit_percent <= 100));
  END IF;
END $$;

COMMENT ON COLUMN public.jobs.deposit_percent IS
  'Deposit % requested on this quote (0 = no deposit). Set by the trader in the quote builder. '
  'Defaults to 0 (no deposit). Only meaningful when the job is in the quoted stage.';

COMMENT ON COLUMN public.jobs.deposit_amount_pence IS
  'Deposit amount in pence, calculated at quote-send time as round(total * deposit_percent / 100 * 100). '
  'Stored so the amount is locked at quote time even if the total changes later.';

COMMENT ON COLUMN public.jobs.deposit_paid_at IS
  'Timestamp set by stripe-connect-webhook when the deposit checkout.session.completed fires. '
  'Null = no deposit paid. Non-null = deposit received, job has a ''Deposit paid'' badge.';

COMMENT ON COLUMN public.jobs.deposit_payment_token_id IS
  'FK to invoice_payment_tokens.id for the deposit token. '
  'Allows the drawer to JOIN straight to the deposit token row for fee/net/receipt display.';

-- Index: find all jobs with deposits paid (used for money-tab revenue calc)
CREATE INDEX IF NOT EXISTS jobs_deposit_paid_at_idx ON public.jobs (deposit_paid_at)
  WHERE deposit_paid_at IS NOT NULL;

-- ── 3. profiles additions ─────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_deposit_percent integer DEFAULT 25;

-- Check constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'profiles'
      AND constraint_name = 'profiles_default_deposit_percent_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_default_deposit_percent_check
        CHECK (default_deposit_percent IS NULL OR (default_deposit_percent >= 0 AND default_deposit_percent <= 100));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.default_deposit_percent IS
  'Trader preference: default deposit % applied to new quotes (0–100). '
  'Defaults to 25 (25%). Trader can override per-quote. 0 = no deposit by default.';

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ────────────────────────────────────
-- BEGIN;
-- ALTER TABLE public.invoice_payment_tokens
--   DROP CONSTRAINT IF EXISTS ipt_kind_check,
--   DROP CONSTRAINT IF EXISTS ipt_deposit_percent_check,
--   DROP COLUMN IF EXISTS kind,
--   DROP COLUMN IF EXISTS quote_id,
--   DROP COLUMN IF EXISTS deposit_percent;
-- ALTER TABLE public.jobs
--   DROP CONSTRAINT IF EXISTS jobs_deposit_percent_check,
--   DROP COLUMN IF EXISTS deposit_percent,
--   DROP COLUMN IF EXISTS deposit_amount_pence,
--   DROP COLUMN IF EXISTS deposit_paid_at,
--   DROP COLUMN IF EXISTS deposit_payment_token_id;
-- ALTER TABLE public.profiles
--   DROP CONSTRAINT IF EXISTS profiles_default_deposit_percent_check,
--   DROP COLUMN IF EXISTS default_deposit_percent;
-- COMMIT;
