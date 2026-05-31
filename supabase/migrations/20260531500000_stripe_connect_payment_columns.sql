-- Migration: add payment reconciliation columns to invoice_payment_tokens
--            and card_paid_at to jobs
--
-- Part of feat/stripe-connect-pr3-webhook-reconcile.
--
-- invoice_payment_tokens changes:
--   fee_pence              — Stripe processing fee in pence (from balance_transaction.fee)
--   net_pence              — Net payout to trader in pence (from balance_transaction.net)
--   receipt_url            — Stripe-hosted receipt URL (from charge.receipt_url)
--   refunded_amount_pence  — Amount refunded in pence; 0 for no refund, full amount for full refund
--
-- jobs changes:
--   card_paid_at           — Timestamp set by webhook when job is paid by card.
--                            Null for manually-marked-paid jobs. Lets the drawer
--                            distinguish card payments from cash/manual payments.
--
-- All columns are nullable / default 0 so no data migration is needed.
-- Safe to re-run (ALTER TABLE IF EXISTS + ADD COLUMN IF NOT EXISTS pattern).
--
-- Run once in the Supabase SQL editor before deploying this PR to production.

BEGIN;

-- ── invoice_payment_tokens additions ─────────────────────────────────────────

ALTER TABLE public.invoice_payment_tokens
  ADD COLUMN IF NOT EXISTS fee_pence             integer     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_pence             integer     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_url           text,
  ADD COLUMN IF NOT EXISTS refunded_amount_pence integer     DEFAULT 0;

COMMENT ON COLUMN public.invoice_payment_tokens.fee_pence IS
  'Stripe processing fee in pence. Source: balance_transaction.fee '
  'fetched at checkout.session.completed webhook time. 0 when not yet fetched.';

COMMENT ON COLUMN public.invoice_payment_tokens.net_pence IS
  'Net payout to trader in pence after Stripe fee. '
  'Source: balance_transaction.net. 0 when not yet fetched.';

COMMENT ON COLUMN public.invoice_payment_tokens.receipt_url IS
  'Stripe-hosted receipt URL. Source: charge.receipt_url. '
  'Set at checkout.session.completed time. Null when not available.';

COMMENT ON COLUMN public.invoice_payment_tokens.refunded_amount_pence IS
  'Amount refunded in pence. 0 = no refund; full amount = full refund. '
  'Populated by charge.refunded webhook handler.';

-- ── jobs additions ─────────────────────────────────────────────────────────────

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS card_paid_at timestamptz;

COMMENT ON COLUMN public.jobs.card_paid_at IS
  'Timestamp set by the stripe-connect-webhook when a card payment completes. '
  'Null for jobs marked paid manually (cash/bank transfer). '
  'The drawer uses this to show the card-payment block vs the manual paid block.';

-- Index on card_paid_at to support "find all card-paid jobs for this trader" queries.
CREATE INDEX IF NOT EXISTS jobs_card_paid_at_idx ON public.jobs (card_paid_at)
  WHERE card_paid_at IS NOT NULL;

-- Index on stripe_payment_intent_id for charge.refunded lookup by payment intent.
CREATE INDEX IF NOT EXISTS invoice_payment_tokens_pi_idx
  ON public.invoice_payment_tokens (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ────────────────────────────────────
-- BEGIN;
-- ALTER TABLE public.invoice_payment_tokens
--   DROP COLUMN IF EXISTS fee_pence,
--   DROP COLUMN IF EXISTS net_pence,
--   DROP COLUMN IF EXISTS receipt_url,
--   DROP COLUMN IF EXISTS refunded_amount_pence;
-- ALTER TABLE public.jobs DROP COLUMN IF EXISTS card_paid_at;
-- COMMIT;
