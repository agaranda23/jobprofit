/**
 * campaignBounty.js — creator bounty accrual + clawback for campaign-code
 * referrals (JP-LU9 Phase 2).
 *
 * A campaign referral (record-referral.js's fallback when `?ref=CODE` doesn't
 * match a personal profiles.referral_code) has NO referrer profile — there is
 * nobody to double-side-reward. Instead, a bounty accrues to the CAMPAIGN
 * itself, for the founder to pay the creator manually (bank transfer,
 * off-platform — no in-app Stripe Connect payout rail exists or is planned).
 *
 * Trigger rule: the referee's 2nd successful payment (amount_paid > 0) OR
 * 30 days retained since their 1st, WHICHEVER COMES FIRST — deliberately NOT
 * the 1st payment. Gating on the 1st payment alone would let a creator (or a
 * referred user colluding with one) run "pay £12, claim the bounty, refund"
 * for free money. See clawback below for the belt-and-braces backstop on top
 * of that.
 *
 * Clawback: voidCampaignBounty() is called directly from stripe-webhook.js on
 * charge.refunded / charge.dispute.created (NOT from the invoice.payment_succeeded
 * path below) and flips bounty_status → 'void', whatever state it was
 * previously in (including 'pending', i.e. before accrual) — a refund or
 * dispute must always kill a bounty's chances of ever accruing, not just
 * claw back one that already had.
 *
 * Redelivery safety: Stripe redelivers a webhook on any non-2xx response.
 * recordCampaignBountyPayment compares the incoming invoice.id against
 * referrals.bounty_last_invoice_id and no-ops on a match, so a redelivered
 * invoice.payment_succeeded can never double-count bounty_payment_count. This
 * mirrors referralReward.js's own idempotency note: a single read-then-write
 * is "good enough" here (not a DB-level atomic claim) because the cost of a
 * rare double-processed race is a one-off miscount the founder can spot in
 * the conversions report, never a double payout (the founder reads this
 * report and pays by hand — it is never auto-disbursed).
 *
 * Fail-soft contract: both exported functions catch their own errors and
 * return a result object — neither throws. A bug here must never turn an
 * already-successful Stripe payment (or an already-processed refund) into a
 * 500, which would make Stripe re-deliver the whole webhook.
 */

/** PostgREST / Postgres error codes */
const PG_UNDEFINED_COLUMN = '42703';
const PG_UNDEFINED_TABLE = '42P01';
const PG_NO_ROWS = 'PGRST116';

/** 2nd successful payment triggers accrual immediately, regardless of dates. */
export const BOUNTY_TRIGGER_PAYMENT_COUNT = 2;

/** OR this many days retained since the 1st successful payment, whichever is first. */
export const BOUNTY_TRIGGER_RETENTION_DAYS = 30;

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
 * Pure eligibility check — 2nd successful payment OR 30 days retained since
 * the 1st, whichever comes first.
 *
 * @param {{ paymentCount: number, firstPaymentAt: string|null|undefined, now?: Date }} params
 * @returns {boolean}
 */
export function isBountyEligible({ paymentCount, firstPaymentAt, now = new Date() }) {
  if (paymentCount >= BOUNTY_TRIGGER_PAYMENT_COUNT) return true;
  if (!firstPaymentAt) return false;
  const first = new Date(firstPaymentAt);
  if (isNaN(first.getTime())) return false;
  return now.getTime() - first.getTime() >= BOUNTY_TRIGGER_RETENTION_DAYS * 86400000;
}

/**
 * Records a successful payment against a campaign referral and accrues the
 * bounty once eligible. Called from referralReward.js's grantReferralReward()
 * whenever the referrals row it looked up has a non-null campaign_id (the
 * FORK point — a campaign referral never reaches the personal peer-reward
 * flow below that fork).
 *
 * NEVER throws — always resolves.
 *
 * @param {{
 *   adminClient: object,
 *   referralRow: { id: string, campaign_id: string, bounty_status?: string,
 *                  bounty_payment_count?: number, bounty_first_payment_at?: string|null,
 *                  bounty_last_invoice_id?: string|null },
 *   invoice: { id: string, amount_paid: number },
 *   now?: Date,
 * }} params
 * @returns {Promise<object>}
 */
export async function recordCampaignBountyPayment({ adminClient, referralRow, invoice, now = new Date() }) {
  try {
    // Defence in depth — the caller (referralReward.js) should already gate
    // on amount_paid > 0, but never trust that alone for a money path.
    if (typeof invoice?.amount_paid !== 'number' || invoice.amount_paid <= 0) {
      return { skipped: 'zero_amount' };
    }
    if (!referralRow?.campaign_id) return { skipped: 'not_campaign_referral' };

    // A voided bounty stays voided — a refund/dispute permanently disqualifies
    // this referral from ever accruing, even on a later payment.
    if (referralRow.bounty_status === 'void') return { skipped: 'bounty_void' };
    // Already accrued — nothing more to do on subsequent payments.
    if (referralRow.bounty_status === 'owed') return { skipped: 'already_owed' };

    // Redelivery guard: Stripe resends the SAME invoice.id on a retried
    // delivery. A genuinely new (2nd, 3rd, ...) payment always has a
    // different invoice.id, so this only ever blocks a true redelivery.
    if (invoice.id && referralRow.bounty_last_invoice_id === invoice.id) {
      return { skipped: 'duplicate_invoice' };
    }

    const paymentCount = (referralRow.bounty_payment_count ?? 0) + 1;
    const firstPaymentAt = referralRow.bounty_first_payment_at || now.toISOString();
    const eligible = isBountyEligible({ paymentCount, firstPaymentAt, now });

    const updatePayload = {
      bounty_payment_count: paymentCount,
      bounty_first_payment_at: firstPaymentAt,
      bounty_last_invoice_id: invoice.id ?? null,
    };

    if (eligible) {
      // Snapshot the campaign's current bounty rate so a later rate change
      // never retroactively edits an already-earned bounty.
      let bountyAmountMinor = null;
      try {
        const { data: campaign, error: campaignErr } = await adminClient
          .from('campaigns')
          .select('bounty_amount_minor')
          .eq('id', referralRow.campaign_id)
          .single();
        if (!campaignErr) bountyAmountMinor = campaign?.bounty_amount_minor ?? null;
      } catch (err) {
        console.warn('campaignBounty: could not read campaign bounty_amount_minor', err?.message);
      }
      updatePayload.bounty_status = 'owed';
      updatePayload.bounty_owed_at = now.toISOString();
      updatePayload.bounty_amount_minor = bountyAmountMinor;
    } else {
      updatePayload.bounty_status = 'pending';
    }

    const { error: updateErr } = await adminClient
      .from('referrals')
      .update(updatePayload)
      .eq('id', referralRow.id);

    if (updateErr) {
      if (isSchemaMissing(updateErr)) return { skipped: 'schema_missing' };
      console.error('campaignBounty: failed to update referral row', referralRow.id, updateErr.message);
      return { skipped: 'update_error', error: updateErr.message };
    }

    return eligible
      ? { bounty: 'owed', referralId: referralRow.id, paymentCount, amountMinor: updatePayload.bounty_amount_minor }
      : { bounty: 'pending', referralId: referralRow.id, paymentCount };
  } catch (err) {
    console.error('campaignBounty: recordCampaignBountyPayment unexpected error', err?.message);
    return { skipped: 'unexpected_error', error: err?.message };
  }
}

/**
 * Clawback — flips a campaign referral's bounty_status to 'void' on a refund
 * or dispute. Called directly from stripe-webhook.js on charge.refunded /
 * charge.dispute.created (these are Charge/Dispute events, not Invoice events,
 * so they can't flow through grantReferralReward's invoice-keyed lookup).
 *
 * Looks up the paying user's profile by Stripe customer id, then their
 * referrals row. No-ops (never throws) if there's no campaign referral for
 * that customer, or it's already void.
 *
 * Voids from ANY prior bounty_status (including 'pending', i.e. before the
 * bounty ever accrued) — a refund/dispute must permanently disqualify the
 * referral, not just claw back a bounty that had already been marked 'owed'.
 *
 * @param {{ adminClient: object, stripeCustomerId: string|null|undefined, reason: string }} params
 * @returns {Promise<object>}
 */
export async function voidCampaignBounty({ adminClient, stripeCustomerId, reason }) {
  try {
    if (!stripeCustomerId) return { skipped: 'no_customer' };

    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('id')
      .eq('stripe_customer_id', stripeCustomerId)
      .single();

    if (profileErr) {
      if (isSchemaMissing(profileErr)) return { skipped: 'schema_missing' };
      if (profileErr.code === PG_NO_ROWS) return { skipped: 'no_profile' };
      console.error('campaignBounty: profile lookup failed', profileErr.message);
      return { skipped: 'profile_lookup_error' };
    }
    if (!profile) return { skipped: 'no_profile' };

    const { data: referralRow, error: referralErr } = await adminClient
      .from('referrals')
      .select('id, campaign_id, bounty_status')
      .eq('referee_id', profile.id)
      .single();

    if (referralErr) {
      if (isSchemaMissing(referralErr)) return { skipped: 'schema_missing' };
      if (referralErr.code === PG_NO_ROWS) return { skipped: 'no_referral' };
      console.error('campaignBounty: referral lookup failed', referralErr.message);
      return { skipped: 'referral_lookup_error' };
    }
    if (!referralRow?.campaign_id) return { skipped: 'not_campaign_referral' };
    if (referralRow.bounty_status === 'void') return { skipped: 'already_void' };

    const { error: updateErr } = await adminClient
      .from('referrals')
      .update({
        bounty_status: 'void',
        bounty_voided_at: new Date().toISOString(),
        bounty_void_reason: reason ?? null,
      })
      .eq('id', referralRow.id);

    if (updateErr) {
      if (isSchemaMissing(updateErr)) return { skipped: 'schema_missing' };
      console.error('campaignBounty: void update failed', updateErr.message);
      return { skipped: 'update_error', error: updateErr.message };
    }

    console.log('campaignBounty: voided', { referralId: referralRow.id, reason, previousStatus: referralRow.bounty_status });
    return { voided: true, referralId: referralRow.id, previousStatus: referralRow.bounty_status };
  } catch (err) {
    console.error('campaignBounty: voidCampaignBounty unexpected error', err?.message);
    return { skipped: 'unexpected_error', error: err?.message };
  }
}
