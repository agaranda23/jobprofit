-- Migration #37 — referral programme reward grant (JP-LU7 Phase 2)
--
-- Phase 1 (#33, 20260623010000_add_referrals.sql) only built ATTRIBUTION —
-- profiles.referral_code / referred_by + the referrals table. Nobody was ever
-- actually paid out. This migration adds the columns needed to GRANT the
-- reward, and SELF-HEALS Phase 1 in case it was never applied — migrations
-- in this repo are applied BY HAND in prod and #33 is still recorded as
-- "deferred" in APPLIED.md, so this file re-declares Phase 1's DDL with the
-- same IF NOT EXISTS / guarded statements. Pasting THIS FILE ALONE into a
-- project where #33 was never run brings prod fully up to date in one go.
--
-- IDEMPOTENT: every statement uses IF NOT EXISTS / DROP … IF EXISTS, safe to
-- re-run.
--
-- APPLIED: deferred — run in Supabase Studio after merging
-- feat/referral-rewards-phase2. See netlify/functions/_lib/referralReward.js
-- for how these columns are used.

-- ── Phase 1 self-heal: profiles.referral_code / referred_by ──────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES profiles(id);

-- ── Phase 1 self-heal: referrals table + RLS ──────────────────────────────────

CREATE TABLE IF NOT EXISTS referrals (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid        NOT NULL REFERENCES profiles(id),
  referee_id  uuid        NOT NULL REFERENCES profiles(id),
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'rewarded')),
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- Enforce one referral row per referee (idempotent upsert-friendly)
  CONSTRAINT referrals_unique_referee UNIQUE (referee_id)
);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Referrers can see the referrals they originated.
-- Writes go through service-role functions (record-referral.js, stripe-webhook.js),
-- so no client INSERT/UPDATE policy is required.

DROP POLICY IF EXISTS referrals_select_own ON referrals;
CREATE POLICY referrals_select_own ON referrals
  FOR SELECT
  USING (auth.uid() = referrer_id);

-- ── Phase 2: reward-grant columns ─────────────────────────────────────────────

-- profiles.pro_comp_until — free Pro-month comp for the "no live subscription"
-- delivery path (see grantOneMonth() in referralReward.js). isPro() in
-- src/lib/plan.js treats a future pro_comp_until as Pro on its own, stacked
-- independently of plan/trial state.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS pro_comp_until timestamptz;

-- referrals.stripe_invoice_id + rewarded_at — audit trail + idempotency guard.
-- stripe-webhook.js claims a row with a single conditional
-- UPDATE referrals SET status='rewarded', ... WHERE id = $1 AND status = 'pending',
-- so a re-delivered invoice.payment_succeeded webhook can never double-grant
-- (the second delivery's conditional UPDATE affects zero rows).
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text;

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS rewarded_at timestamptz;
