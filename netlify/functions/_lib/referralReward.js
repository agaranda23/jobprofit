/**
 * referralReward.js — grants the JP-LU7 Phase 2 double-sided referral reward.
 *
 * Called from netlify/functions/stripe-webhook.js on invoice.payment_succeeded
 * whenever invoice.amount_paid > 0 — i.e. the referee's FIRST invoice where
 * REAL money actually moved, regardless of billing_reason. This deliberately
 * does NOT gate on billing_reason === 'subscription_create': the app's default
 * signup is a card-free 14-day trial, so the referee's real first charge often
 * arrives later as a 'subscription_cycle' invoice, not 'subscription_create'.
 * A £0 invoice (the trial's own invoice, amount_paid === 0) is skipped — no
 * real money, no reward. grantReferralReward() re-checks amount_paid itself
 * (defence in depth — never trust the caller to have gated correctly).
 *
 * Delivery rule (per user, chosen by THEIR OWN live Stripe state so the
 * reward is never merely cosmetic):
 *   - No LIVE (billed) subscription (free tier, trialing, or a lapsed/
 *     cancelled one) → stack profiles.pro_comp_until by 31 days. isPro() in
 *     src/lib/plan.js treats a future pro_comp_until as Pro on its own,
 *     independent of plan/trial. A card-free trialing subscription generates
 *     no future invoice, so a balance credit there would be inert — routing
 *     it to pro_comp_until instead makes the reward immediately visible.
 *   - An 'active' Stripe subscription (one actually being billed) → a Stripe
 *     customer-balance credit for one month's plan amount, coupon-free (no
 *     pre-created Stripe coupon required). The amount is read from THAT
 *     subscription's own price rather than hardcoded, so a per-customer price
 *     change is still honoured.
 *
 * Idempotency: the referrals row is claimed with a single conditional
 * UPDATE ... WHERE status = 'pending'. Stripe redelivers webhooks on any
 * non-2xx response, so this single-statement claim is the one thing that
 * MUST be atomic — a second delivery finds status != 'pending' and no-ops.
 * This also covers renewal (subsequent) payments on the same subscription:
 * the referrals row is already 'rewarded' by then, so they no-op too.
 * stripe_invoice_id is recorded for audit / manual reconciliation, not as the
 * primary guard.
 *
 * Fail-soft contract: every exported function catches its own errors and
 * returns a result object — nothing here ever throws. A bug in reward-granting
 * must never turn an already-successful Stripe payment into a 500, which
 * would make Stripe re-deliver the whole webhook and re-run work that already
 * succeeded (the plan-status update in stripe-webhook.js). A failed grant is
 * loudly logged as an error (never as 'granted') so it surfaces for manual
 * follow-up — see grantReferralReward's final step below. It is NOT currently
 * auto-retried: the referrals row stays 'rewarded' once claimed even if the
 * grant itself failed, because a retry could double-credit a side that
 * already succeeded (grantBalanceCredit has no Stripe idempotency key yet).
 * TODO: add per-referral Stripe idempotency keys + a claim-rollback so a
 * failed grant can be safely retried instead of requiring a manual fix.
 *
 * ── Campaign-code fork (JP-LU9) ───────────────────────────────────────────────
 * A referrals row attributed to a campaign code (record-referral.js's fallback
 * when `?ref=CODE` doesn't match a personal profiles.referral_code) carries a
 * non-null campaign_id and has NO referrer profile — there's nobody to
 * double-side-reward. grantReferralReward() detects this (a falsy
 * profiles.referred_by whose referrals row nonetheless has campaign_id set)
 * and forks straight to ./campaignBounty.js's recordCampaignBountyPayment(),
 * which accrues a bounty to the CAMPAIGN instead of granting a peer reward.
 * See campaignBounty.js for the full trigger rule (2nd payment OR 30 days
 * retained) and the charge.refunded / charge.dispute.created clawback.
 */

import { recordCampaignBountyPayment } from './campaignBounty.js';

/** PostgREST / Postgres error codes */
const PG_UNDEFINED_COLUMN = '42703';
const PG_UNDEFINED_TABLE  = '42P01';
const PG_NO_ROWS          = 'PGRST116';

const FREE_MONTH_DAYS = 31; // stacks after any existing trial/comp, per spec

// Fallback only fires if a Stripe subscription object is unexpectedly missing
// price data (should never happen for OHNAR's current single-price Pro plan)
// — logged loudly so it is visible if it ever does.
const FALLBACK_AMOUNT_MINOR = 1200; // £12.00
const FALLBACK_CURRENCY = 'gbp';

/**
 * Returns true when a PostgREST error means the column/table doesn't exist
 * yet (migration not applied to prod — degrade gracefully rather than error).
 * @param {object|null|undefined} error
 * @returns {boolean}
 */
export function isSchemaMissing(error) {
  if (!error) return false;
  const code = error.code;
  const msg = error.message || '';
  return code === PG_UNDEFINED_COLUMN || code === PG_UNDEFINED_TABLE || msg.includes('does not exist');
}

/**
 * Computes the new pro_comp_until timestamp, stacking on top of any existing
 * FUTURE comp (never shortens an existing grant; never stacks on an expired one).
 * @param {string|null|undefined} currentProCompUntil
 * @param {Date} [now]
 * @returns {string} ISO timestamp
 */
export function computeStackedCompUntil(currentProCompUntil, now = new Date()) {
  const currentDate = currentProCompUntil ? new Date(currentProCompUntil) : null;
  const base = currentDate && !isNaN(currentDate.getTime()) && currentDate > now ? currentDate : now;
  return new Date(base.getTime() + FREE_MONTH_DAYS * 86400000).toISOString();
}

/**
 * Extracts a { amount, currency } pair (Stripe minor units + ISO currency)
 * from a Stripe Subscription object's first line item price. Falls back to
 * the OHNAR £12/mo GBP price if extraction fails for any reason.
 * @param {object|null|undefined} subscription - Stripe Subscription object
 * @returns {{ amount: number, currency: string }}
 */
export function extractSubscriptionAmount(subscription) {
  const price = subscription?.items?.data?.[0]?.price;
  const amount = price?.unit_amount;
  const currency = price?.currency;
  if (typeof amount === 'number' && amount > 0 && currency) {
    return { amount, currency };
  }
  console.warn('referralReward: could not read subscription price — using fallback £12/mo GBP');
  return { amount: FALLBACK_AMOUNT_MINOR, currency: FALLBACK_CURRENCY };
}

/** Grants one free Pro month via the pro_comp_until column (no-live-subscription path). */
async function grantCompMonth(adminClient, userId, currentProCompUntil) {
  const newUntil = computeStackedCompUntil(currentProCompUntil);
  const { error } = await adminClient
    .from('profiles')
    .update({ pro_comp_until: newUntil })
    .eq('id', userId);
  if (error) throw error;
  return { method: 'pro_comp_until', pro_comp_until: newUntil };
}

/** Grants one free month via a Stripe customer-balance credit (live-subscription path). */
async function grantBalanceCredit(stripe, stripeCustomerId, subscription) {
  const { amount, currency } = extractSubscriptionAmount(subscription);
  await stripe.customers.createBalanceTransaction(stripeCustomerId, {
    amount: -Math.abs(amount),
    currency,
    description: 'OHNAR referral reward — one free month',
  });
  return { method: 'balance_credit', amount, currency };
}

/**
 * Finds the customer's current LIVE (actually billed) subscription, if any.
 * Deliberately excludes 'trialing' — a card-free trial has no live billing,
 * so routing it to a balance credit would be inert (no future invoice for the
 * credit to apply against). Only 'active' counts; everything else (trialing,
 * free tier, lapsed/cancelled) falls through to the pro_comp_until path.
 * Never throws — returns null on any lookup failure.
 */
async function findActiveSubscription(stripe, stripeCustomerId) {
  if (!stripeCustomerId) return null;
  try {
    const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: 'all', limit: 10 });
    return subs.data.find((s) => s.status === 'active') || null;
  } catch (err) {
    console.warn('referralReward: subscription lookup failed for', stripeCustomerId, err?.message);
    return null;
  }
}

/**
 * Grants one Pro month to a single user, choosing delivery by their OWN live
 * Stripe state: an 'active' (billed) subscription → balance credit; anything
 * else, including 'trialing' → pro_comp_until stack. If the balance credit
 * itself fails (e.g. the customer object is in a bad state), falls back to
 * the comp-month path so the user still receives real value rather than
 * nothing. Returns { method: 'error', error } if BOTH the credit and the
 * comp-month fallback fail — callers MUST treat this as a failed grant, never
 * as a success.
 *
 * @param {object} stripe
 * @param {object} adminClient
 * @param {{ userId: string, stripeCustomerId: string|null, proCompUntil: string|null, subscriptionHint?: object|null }} user
 * @returns {Promise<{ method: string, [key: string]: any }>}
 */
export async function grantOneMonth(stripe, adminClient, { userId, stripeCustomerId, proCompUntil, subscriptionHint }) {
  try {
    const subscription = subscriptionHint || (await findActiveSubscription(stripe, stripeCustomerId));
    if (subscription && stripeCustomerId) {
      try {
        return await grantBalanceCredit(stripe, stripeCustomerId, subscription);
      } catch (err) {
        console.error('referralReward: balance credit failed, falling back to pro_comp_until for', userId, err?.message);
        // Fall through to the comp-month path below.
      }
    }
    return await grantCompMonth(adminClient, userId, proCompUntil);
  } catch (err) {
    console.error('referralReward: grantOneMonth failed for', userId, err?.message);
    return { method: 'error', error: err?.message ?? 'unknown' };
  }
}

/**
 * Main entry point — call from stripe-webhook.js on invoice.payment_succeeded
 * whenever invoice.amount_paid > 0 (real money moved), regardless of
 * billing_reason.
 *
 * @param {{ stripe: object, adminClient: object, invoice: object }} params
 * @returns {Promise<object>} result summary — ALWAYS resolves, never throws.
 */
export async function grantReferralReward({ stripe, adminClient, invoice }) {
  try {
    // 0. Defence in depth — the caller (stripe-webhook.js) should already
    // gate on amount_paid > 0, but never trust that alone for a money path.
    // A £0 invoice (e.g. the card-free trial's own invoice) is not real
    // money and must never trigger a reward.
    if (typeof invoice?.amount_paid !== 'number' || invoice.amount_paid <= 0) {
      return { skipped: 'zero_amount' };
    }

    // 1. Find the paying user (referee) by their Stripe customer id.
    const { data: refereeProfile, error: refereeErr } = await adminClient
      .from('profiles')
      .select('id, referred_by, stripe_customer_id, plan, pro_comp_until')
      .eq('stripe_customer_id', invoice.customer)
      .single();

    if (refereeErr) {
      if (isSchemaMissing(refereeErr)) return { skipped: 'schema_missing' };
      if (refereeErr.code === PG_NO_ROWS) return { skipped: 'no_profile' };
      console.error('referralReward: referee lookup failed', refereeErr.message);
      return { skipped: 'referee_lookup_error' };
    }

    // ── Campaign-code fork (JP-LU9) ─────────────────────────────────────────
    // Campaign codes are NOT tied to a profiles row, so record-referral.js
    // never sets profiles.referred_by for them — the only trace is the
    // referrals row itself, carrying campaign_id. A falsy referred_by here
    // means either (a) an organic, un-referred signup, or (b) a campaign
    // referral. Check the referrals row directly to tell them apart BEFORE
    // falling back to 'not_referred', so campaign referrals reach bounty
    // accrual instead of being silently dropped.
    if (!refereeProfile?.referred_by) {
      const refereeId = refereeProfile.id;
      const { data: campaignReferralRow, error: campaignReferralErr } = await adminClient
        .from('referrals')
        .select('id, campaign_id, bounty_status, bounty_payment_count, bounty_first_payment_at, bounty_last_invoice_id')
        .eq('referee_id', refereeId)
        .single();

      if (campaignReferralErr) {
        if (isSchemaMissing(campaignReferralErr)) return { skipped: 'schema_missing' };
        if (campaignReferralErr.code === PG_NO_ROWS) return { skipped: 'not_referred' };
        console.error('referralReward: campaign referral row lookup failed', campaignReferralErr.message);
        return { skipped: 'referral_lookup_error' };
      }
      if (!campaignReferralRow?.campaign_id) return { skipped: 'not_referred' };

      // No referrer profile to reward — accrue/track the creator bounty
      // instead. See ./campaignBounty.js for the 2nd-payment-or-30-days rule.
      const bountyResult = await recordCampaignBountyPayment({ adminClient, referralRow: campaignReferralRow, invoice });
      return { campaign: true, campaignId: campaignReferralRow.campaign_id, refereeId, ...bountyResult };
    }

    const referrerId = refereeProfile.referred_by;
    const refereeId = refereeProfile.id;

    // Defensive — record-referral.js already guards against self-referral at
    // attribution time, but never trust that a bad row can't exist.
    if (referrerId === refereeId) {
      console.warn('referralReward: self-referral detected, skipping', refereeId);
      return { skipped: 'self_referral' };
    }

    // 2. Find the pending referrals row for this referee.
    const { data: referralRow, error: referralErr } = await adminClient
      .from('referrals')
      .select('id, status, referrer_id, referee_id')
      .eq('referee_id', refereeId)
      .single();

    if (referralErr) {
      if (isSchemaMissing(referralErr)) return { skipped: 'schema_missing' };
      if (referralErr.code === PG_NO_ROWS) return { skipped: 'no_referral_row' };
      console.error('referralReward: referral row lookup failed', referralErr.message);
      return { skipped: 'referral_lookup_error' };
    }
    if (!referralRow || referralRow.referrer_id !== referrerId) return { skipped: 'referral_mismatch' };
    if (referralRow.status === 'rewarded') return { skipped: 'already_rewarded' };

    // 3. Atomically claim the row. This single conditional UPDATE is the ONLY
    // thing that has to be atomic — a re-delivered webhook finds 0 rows
    // affected (status is no longer 'pending') and no-ops below.
    const { data: claimed, error: claimErr } = await adminClient
      .from('referrals')
      .update({
        status: 'rewarded',
        rewarded_at: new Date().toISOString(),
        stripe_invoice_id: invoice.id,
      })
      .eq('id', referralRow.id)
      .eq('status', 'pending')
      .select('id');

    if (claimErr) {
      if (isSchemaMissing(claimErr)) return { skipped: 'schema_missing' };
      console.error('referralReward: claim update failed', claimErr.message);
      return { skipped: 'claim_error' };
    }
    if (!claimed || claimed.length === 0) {
      console.log('referralReward: referral already claimed by another delivery', refereeId);
      return { skipped: 'already_claimed' };
    }

    // 4. Fetch the referrer's own profile — needed to choose THEIR delivery method.
    const { data: referrerProfile, error: referrerErr } = await adminClient
      .from('profiles')
      .select('id, stripe_customer_id, plan, pro_comp_until')
      .eq('id', referrerId)
      .single();

    if (referrerErr) {
      // Non-fatal: the referrals row is already marked rewarded (audit trail
      // intact) and the referee still gets their reward below. Log loudly so
      // a founder can manually grant the referrer's month if this ever fires.
      console.error('referralReward: referrer profile lookup failed — referee still rewarded, referrer needs manual grant', referrerId, referrerErr.message);
    }

    // 5. Grant the referee. This invoice IS their subscription — pass it as a
    // hint so we don't need an extra Stripe round trip to find it.
    let refereeSubscription = null;
    if (invoice.subscription) {
      try {
        refereeSubscription = await stripe.subscriptions.retrieve(invoice.subscription);
      } catch (err) {
        console.warn('referralReward: could not retrieve referee subscription', err?.message);
      }
    }
    const refereeResult = await grantOneMonth(stripe, adminClient, {
      userId: refereeId,
      stripeCustomerId: refereeProfile.stripe_customer_id,
      proCompUntil: refereeProfile.pro_comp_until,
      subscriptionHint: refereeSubscription,
    });

    // 6. Grant the referrer — THEIR OWN live Stripe state decides the method.
    let referrerResult = { skipped: 'referrer_not_found' };
    if (referrerProfile) {
      referrerResult = await grantOneMonth(stripe, adminClient, {
        userId: referrerProfile.id,
        stripeCustomerId: referrerProfile.stripe_customer_id,
        proCompUntil: referrerProfile.pro_comp_until,
      });
    }

    // 7. Only ever report success when BOTH sides actually landed. The
    // referrals row is already claimed 'rewarded' at this point regardless
    // (see step 3) — a failure here is stranded, not auto-retried (see the
    // fail-soft contract note at the top of this file), so it MUST surface
    // loudly as an error for manual follow-up rather than being logged or
    // returned as a success.
    const refereeFailed = refereeResult.method === 'error';
    const referrerFailed = referrerResult.method === 'error' || referrerResult.skipped === 'referrer_not_found';

    if (refereeFailed || referrerFailed) {
      console.error(
        'referralReward: grant FAILED — referrals row already marked rewarded, needs manual grant',
        { referrerId, refereeId, refereeFailed, referrerFailed, referrerResult, refereeResult }
      );
      return { granted: false, referrerId, refereeId, referrerResult, refereeResult };
    }

    console.log('referralReward: granted', { referrerId, refereeId, referrerResult, refereeResult });
    return { granted: true, referrerId, refereeId, referrerResult, refereeResult };
  } catch (err) {
    // Absolute last-resort guard — this function must NEVER throw.
    console.error('referralReward: unexpected error', err?.message);
    return { skipped: 'unexpected_error', error: err?.message };
  }
}
