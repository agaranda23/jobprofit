-- Migration #33 — referral programme foundation (JP-LU7 Phase 1)
--
-- Adds two columns to profiles and creates the referrals table.
-- IDEMPOTENT: every statement uses IF NOT EXISTS / DROP … IF EXISTS so the
-- founder can paste this into the Supabase SQL Editor more than once safely.
--
-- APPLIED: deferred — run in Supabase Studio after merging feat/referral-link-attribution.
-- The application code degrades gracefully (no-ops) until these columns/table exist.

-- ── profiles columns ─────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES profiles(id);

-- ── referrals table ──────────────────────────────────────────────────────────

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

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Referrers can see the referrals they originated.
-- Writes go through the record-referral Netlify function (service-role bypass),
-- so no client INSERT policy is required.

DROP POLICY IF EXISTS referrals_select_own ON referrals;
CREATE POLICY referrals_select_own ON referrals
  FOR SELECT
  USING (auth.uid() = referrer_id);
