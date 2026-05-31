-- Migration: add invoice_payment_tokens table
--
-- Stores one-time Stripe Checkout Session tokens for invoice Pay-now links.
-- Each token maps a short URL (/p/<token>) to a Stripe Checkout Session on
-- the trader's connected account (Standard Connect, decision #2, 2026-05-31).
--
-- Status lifecycle:
--   'pending'   — session created, not yet paid
--   'paid'      — webhook confirmed checkout.session.completed (PR 3 sets this)
--   'expired'   — session expired and was not regenerated
--   'cancelled' — customer cancelled at the Stripe checkout page
--   'refunded'  — Stripe charge.refunded webhook received (PR 3 sets this)
--
-- Note on expires_at: Stripe Checkout Sessions expire after a maximum of
-- 24 hours (not 30 days as the Stripe docs describe for Payment Links).
-- We store expires_at in our DB to support the pay-redirect.js logic that
-- decides whether to auto-regenerate an expired session. The frontend never
-- relies on our expires_at for display — it only calls create-invoice-payment-link
-- which honours the idempotency check.
--
-- RLS:
--   - Traders can SELECT their own rows (trader_user_id = auth.uid()).
--   - INSERT / UPDATE is service-role only (server-side function calls only).
--   - No direct client-side write is ever expected.
--
-- FK on invoices: the jobs table doubles as the invoice record in the current
-- schema (invoiceSentAt, invoiceNumber stored in jobs.meta or as top-level
-- columns). There is no separate `invoices` table. The FK here references the
-- `jobs` table using the job's UUID PK. Column is named invoice_id so the
-- application layer keeps invoice semantics clear, even though the backing
-- table is `jobs`.
--
-- Run once in the Supabase SQL editor before deploying feat/stripe-connect-pr2-pay-now-links.
-- Safe to re-run (CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS pattern).

BEGIN;

-- ── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.invoice_payment_tokens (
  id                         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token                      text        UNIQUE NOT NULL,
  invoice_id                 uuid        NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  trader_user_id             uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_checkout_session_id text        NOT NULL,
  stripe_payment_intent_id   text,
  amount_pence               integer     NOT NULL,
  currency                   text        NOT NULL DEFAULT 'gbp',
  status                     text        NOT NULL DEFAULT 'pending',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  expires_at                 timestamptz NOT NULL,
  paid_at                    timestamptz
);

COMMENT ON TABLE public.invoice_payment_tokens IS
  'One-time Stripe Checkout Session tokens for invoice Pay-now links. '
  'Each row represents one pay attempt for one invoice. Status lifecycle: '
  'pending → paid / expired / cancelled / refunded. '
  'invoice_id references public.jobs (no separate invoices table exists).';

-- ── 2. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS invoice_payment_tokens_invoice_idx
  ON public.invoice_payment_tokens (invoice_id);

CREATE INDEX IF NOT EXISTS invoice_payment_tokens_trader_idx
  ON public.invoice_payment_tokens (trader_user_id);

-- token column already has a UNIQUE index via the constraint above;
-- adding a named index for clarity in query plans.
CREATE INDEX IF NOT EXISTS invoice_payment_tokens_token_idx
  ON public.invoice_payment_tokens (token);

-- ── 3. Row Level Security ─────────────────────────────────────────────────────

ALTER TABLE public.invoice_payment_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ipt_select_own" ON public.invoice_payment_tokens;

CREATE POLICY "ipt_select_own"
  ON public.invoice_payment_tokens FOR SELECT
  USING (auth.uid() = trader_user_id);

-- No INSERT/UPDATE policy: all writes go through server-side functions
-- that use the service-role key which bypasses RLS.

COMMIT;

-- ── ROLLBACK (do not run unless reverting) ─────────────────────────────────
-- BEGIN;
-- DROP TABLE IF EXISTS public.invoice_payment_tokens;
-- COMMIT;
