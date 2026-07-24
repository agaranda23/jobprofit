-- Migration #39 — influencer/affiliate campaign codes (JP-LU9 Phase 1+2)
--
-- Adds:
--   1. campaigns table — typed creator codes (e.g. MITCH60), deliberately NOT
--      tied to a profiles row (unlike personal referral codes). Used for the
--      audience perk (extended trial) and creator bounty tracking. Creators
--      are paid manually off-platform (bank transfer) — there is no in-app
--      Stripe Connect payout rail and none is planned in this PR.
--   2. referrals.campaign_id — links a referrals row to a campaign instead of
--      a personal referrer. referrer_id is relaxed to nullable so a
--      campaign-attributed row can omit it (there is no referrer profile).
--   3. referrals.bounty_* columns — creator bounty accrual + clawback state.
--      Deliberately separate from the existing status/rewarded_at columns,
--      which track ONLY the personal peer double-sided reward (JP-LU7).
--
-- IDEMPOTENT: IF NOT EXISTS / DROP ... IF EXISTS guards throughout — safe to
-- paste into Supabase Studio more than once.
--
-- GRACEFUL DEGRADATION: record-referral.js, referralReward.js and
-- campaignBounty.js all check for 42703 (undefined column) / 42P01 (undefined
-- table) and no-op rather than error, so merging the application code before
-- running this migration is safe — campaign codes simply resolve as
-- "unknown_code" (same as today) until this migration is applied.
--
-- APPLIED: deferred — RUN IN SUPABASE STUDIO → SQL EDITOR before campaign
-- codes go live. Update this file's status in APPLIED.md the same day you
-- run it (repo convention — see supabase/migrations/APPLIED.md).

BEGIN;

-- ── 1. campaigns table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS campaigns (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Canonical uppercase — record-referral.js uppercases the incoming ?ref=
  -- code before lookup, so this constraint is what actually makes the match
  -- case-insensitive end to end (a creator can say "use code MITCH60" out
  -- loud and a fan can type "mitch60" and it still resolves).
  code                 text        NOT NULL UNIQUE CHECK (code = upper(code)),
  -- Free-text creator/payout identity for the founder's own payout ledger —
  -- never shown in-app, never read by any client. e.g. "Mitch @mitchtrades —
  -- bank transfer, sort code on file".
  creator_label        text        NOT NULL,
  -- Audience perk: profiles.trial_ends_at is extended to now() + comp_days on
  -- first successful attribution (extend-only — see record-referral.js).
  comp_days            int         NOT NULL DEFAULT 60,
  -- When true, a referral through this code stamps profiles.founding_member
  -- immediately at SIGNUP (not at checkout, unlike the normal path in
  -- stripe-webhook.js). This exists because comp_days can push the eventual
  -- checkout date past FOUNDER_CUTOFF (2026-09-30) — without this, a user who
  -- joined via a founding_lock campaign before the cutoff could still miss
  -- the price lock purely because their comped trial ran past it. See
  -- record-referral.js's foundingLockShouldStamp().
  founding_lock        boolean     NOT NULL DEFAULT false,
  -- Per-successful-referral bounty owed to the creator, in minor currency
  -- units (pence). NULL = rate not yet agreed — set manually per campaign
  -- when the founder creates the row. Snapshotted onto
  -- referrals.bounty_amount_minor at accrual time so a later rate change
  -- never retroactively edits an already-earned bounty.
  bounty_amount_minor  int         NULL,
  bounty_currency      text        NOT NULL DEFAULT 'gbp',
  -- Optional total spend cap across the whole campaign, in minor units.
  -- NOT enforced automatically anywhere in this PR — informational only,
  -- checked manually against the campaign-conversions report before running
  -- payouts. See the PR description's follow-up list.
  payout_cap_minor     int         NULL,
  active               boolean     NOT NULL DEFAULT true,
  expires_at           timestamptz NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT campaigns_comp_days_positive CHECK (comp_days > 0)
);

COMMENT ON TABLE campaigns IS
  'Influencer/affiliate campaign codes (JP-LU9). Not tied to a profiles row — creators are paid manually off-platform. See supabase/migrations/APPLIED.md #39.';

-- RLS: campaigns is never read by client-side code (only Netlify functions
-- using the service-role key touch this table) — enable RLS with NO policies
-- at all, i.e. default-deny, rather than adding an open SELECT policy nobody
-- needs.
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- ── 2. referrals table — relax referrer_id, add campaign_id ──────────────────

-- Campaign-attributed rows have no personal referrer profile to reference.
ALTER TABLE referrals
  ALTER COLUMN referrer_id DROP NOT NULL;

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id);

-- Every referrals row is attributed to EITHER a personal referrer OR a
-- campaign — never neither, never both (today's design has no concept of a
-- campaign code also crediting a personal referrer).
ALTER TABLE referrals
  DROP CONSTRAINT IF EXISTS referrals_attribution_source;
ALTER TABLE referrals
  ADD CONSTRAINT referrals_attribution_source
  CHECK (
    (referrer_id IS NOT NULL AND campaign_id IS NULL) OR
    (referrer_id IS NULL AND campaign_id IS NOT NULL)
  );

-- ── 3. referrals table — bounty accrual + clawback state ─────────────────────
-- Campaign-referral rows only — always 'none' / NULL / 0 on personal-referral
-- rows. Deliberately separate from status/rewarded_at (the peer-reward flow).

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS bounty_status text NOT NULL DEFAULT 'none'
    CHECK (bounty_status IN ('none', 'pending', 'owed', 'void'));

-- Counts invoice.payment_succeeded events with amount_paid > 0 for this
-- referee. Bounty accrues on the 2nd successful payment OR 30 days retained
-- since the 1st, whichever comes first — see campaignBounty.js. Gating on the
-- 1st payment alone would allow a "pay £12, claim the bounty, refund" attack.
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS bounty_payment_count int NOT NULL DEFAULT 0;

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS bounty_first_payment_at timestamptz;

-- Redelivery guard — mirrors stripe_invoice_id's role for the peer-reward
-- path. Stripe redelivers a webhook on any non-2xx response; comparing the
-- incoming invoice.id against the last one processed stops a redelivered
-- event from double-counting bounty_payment_count.
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS bounty_last_invoice_id text;

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS bounty_owed_at timestamptz;

ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS bounty_voided_at timestamptz;

-- 'charge.refunded' | 'charge.dispute.created' — which clawback event fired.
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS bounty_void_reason text;

-- Snapshot of campaigns.bounty_amount_minor at the moment bounty_status
-- flips to 'owed' — see the column comment on campaigns.bounty_amount_minor.
ALTER TABLE referrals
  ADD COLUMN IF NOT EXISTS bounty_amount_minor int;

-- No RLS policy change needed: referrals_select_own (auth.uid() = referrer_id)
-- is simply never true for a campaign row (referrer_id is NULL there), so
-- campaign rows stay invisible to any client — correct, since creators have
-- no profiles row / no login to see them from.

COMMIT;
