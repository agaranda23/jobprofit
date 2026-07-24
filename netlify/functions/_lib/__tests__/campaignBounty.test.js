/**
 * Tests for netlify/functions/_lib/campaignBounty.js (JP-LU9 Phase 2)
 *
 * No vi.mock('@supabase/supabase-js') gymnastics — the exported functions
 * take `adminClient` as a plain argument, so tests pass lightweight fake
 * objects instead (same spirit as referralReward.test.js).
 *
 * Covers:
 *   A. isBountyEligible — pure trigger-rule math (2nd payment OR 30 days)
 *   B. recordCampaignBountyPayment — 1st payment accrues nothing (anti-arbitrage)
 *   C. recordCampaignBountyPayment — 2nd payment accrues the bounty
 *   D. recordCampaignBountyPayment — 30-days-retained fallback accrues on a
 *      single payment once enough time has passed
 *   E. recordCampaignBountyPayment — redelivery guard (same invoice.id no-ops)
 *   F. recordCampaignBountyPayment — already owed / already void short-circuits
 *   G. recordCampaignBountyPayment — zero-amount defence in depth
 *   H. voidCampaignBounty — happy path clawback
 *   I. voidCampaignBounty — no-ops for a non-campaign / missing / already-void referral
 */

import { describe, it, expect, vi } from 'vitest';
import {
  isBountyEligible,
  recordCampaignBountyPayment,
  voidCampaignBounty,
  isSchemaMissing,
  BOUNTY_TRIGGER_PAYMENT_COUNT,
  BOUNTY_TRIGGER_RETENTION_DAYS,
} from '../campaignBounty.js';

const CAMPAIGN_ID = 'campaign-uuid-1';
const REFERRAL_ID = 'referral-uuid-2';
const CUSTOMER_ID = 'cus_test_1';
const PROFILE_ID = 'profile-uuid-3';

// ── A. isBountyEligible ───────────────────────────────────────────────────────

describe('A. isBountyEligible — pure trigger-rule math', () => {
  it('is NOT eligible on the 1st payment (anti-arbitrage)', () => {
    expect(isBountyEligible({ paymentCount: 1, firstPaymentAt: new Date().toISOString() })).toBe(false);
  });

  it('is eligible on the 2nd payment regardless of dates', () => {
    expect(isBountyEligible({ paymentCount: BOUNTY_TRIGGER_PAYMENT_COUNT, firstPaymentAt: new Date().toISOString() })).toBe(true);
  });

  it('is eligible once 30 days have passed since the 1st payment, even on payment 1', () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const firstPaymentAt = new Date(now.getTime() - BOUNTY_TRIGGER_RETENTION_DAYS * 86400000).toISOString();
    expect(isBountyEligible({ paymentCount: 1, firstPaymentAt, now })).toBe(true);
  });

  it('is NOT eligible before 30 days have passed on a single payment', () => {
    const now = new Date('2026-08-01T00:00:00Z');
    const firstPaymentAt = new Date(now.getTime() - (BOUNTY_TRIGGER_RETENTION_DAYS - 1) * 86400000).toISOString();
    expect(isBountyEligible({ paymentCount: 1, firstPaymentAt, now })).toBe(false);
  });

  it('is NOT eligible with no firstPaymentAt and only 1 payment', () => {
    expect(isBountyEligible({ paymentCount: 1, firstPaymentAt: null })).toBe(false);
  });
});

// ── C. isSchemaMissing (re-exported, same contract as referralReward.js) ─────

describe('isSchemaMissing — pure error-code check', () => {
  it('returns true for 42703 / 42P01', () => {
    expect(isSchemaMissing({ code: '42703' })).toBe(true);
    expect(isSchemaMissing({ code: '42P01' })).toBe(true);
  });
  it('returns false for an unrelated error or null', () => {
    expect(isSchemaMissing({ code: '23505' })).toBe(false);
    expect(isSchemaMissing(null)).toBe(false);
  });
});

// ── Fake Supabase builder ─────────────────────────────────────────────────────

function makeFakeSupabase({
  campaignResult = { data: { bounty_amount_minor: 1500 }, error: null },
  updateResult = { error: null },
  profileResult = { data: { id: PROFILE_ID }, error: { code: 'PGRST116' } },
  referralLookupResult = { data: null, error: { code: 'PGRST116' } },
} = {}) {
  const referralUpdates = [];

  const from = vi.fn((table) => {
    if (table === 'campaigns') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => campaignResult),
          })),
        })),
      };
    }
    if (table === 'referrals') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => referralLookupResult),
          })),
        })),
        update: vi.fn((payload) => ({
          eq: vi.fn(async () => {
            referralUpdates.push(payload);
            return updateResult;
          }),
        })),
      };
    }
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => profileResult),
          })),
        })),
      };
    }
    return {};
  });

  return { client: { from }, referralUpdates };
}

function makeReferralRow(overrides = {}) {
  return {
    id: REFERRAL_ID,
    campaign_id: CAMPAIGN_ID,
    bounty_status: 'pending',
    bounty_payment_count: 0,
    bounty_first_payment_at: null,
    bounty_last_invoice_id: null,
    ...overrides,
  };
}

function makeInvoice(overrides = {}) {
  return { id: 'in_test_1', amount_paid: 1200, ...overrides };
}

// ── B. 1st payment — no accrual ───────────────────────────────────────────────

describe('B. recordCampaignBountyPayment — 1st payment does not accrue', () => {
  it('records the payment but leaves bounty_status pending', async () => {
    const { client, referralUpdates } = makeFakeSupabase();
    const result = await recordCampaignBountyPayment({
      adminClient: client,
      referralRow: makeReferralRow(),
      invoice: makeInvoice(),
      now: new Date('2026-07-01T00:00:00Z'),
    });

    expect(result.bounty).toBe('pending');
    expect(referralUpdates).toHaveLength(1);
    expect(referralUpdates[0].bounty_status).toBe('pending');
    expect(referralUpdates[0].bounty_payment_count).toBe(1);
    expect(referralUpdates[0].bounty_first_payment_at).toBeDefined();
    expect(referralUpdates[0].bounty_owed_at).toBeUndefined();
  });
});

// ── C. 2nd payment — accrues ──────────────────────────────────────────────────

describe('C. recordCampaignBountyPayment — 2nd payment accrues the bounty', () => {
  it('flips bounty_status to owed and snapshots the campaign bounty amount', async () => {
    const { client, referralUpdates } = makeFakeSupabase({
      campaignResult: { data: { bounty_amount_minor: 1500 }, error: null },
    });
    const firstPaymentAt = new Date('2026-07-01T00:00:00Z').toISOString();
    const result = await recordCampaignBountyPayment({
      adminClient: client,
      referralRow: makeReferralRow({ bounty_payment_count: 1, bounty_first_payment_at: firstPaymentAt, bounty_last_invoice_id: 'in_first' }),
      invoice: makeInvoice({ id: 'in_second' }),
      now: new Date('2026-07-05T00:00:00Z'),
    });

    expect(result.bounty).toBe('owed');
    expect(result.amountMinor).toBe(1500);
    expect(referralUpdates).toHaveLength(1);
    expect(referralUpdates[0].bounty_status).toBe('owed');
    expect(referralUpdates[0].bounty_payment_count).toBe(2);
    expect(referralUpdates[0].bounty_amount_minor).toBe(1500);
    expect(referralUpdates[0].bounty_owed_at).toBeDefined();
    // firstPaymentAt is preserved, not reset
    expect(referralUpdates[0].bounty_first_payment_at).toBe(firstPaymentAt);
  });

  it('snapshots null when the campaign has no bounty_amount_minor set yet', async () => {
    const { client, referralUpdates } = makeFakeSupabase({
      campaignResult: { data: { bounty_amount_minor: null }, error: null },
    });
    const result = await recordCampaignBountyPayment({
      adminClient: client,
      referralRow: makeReferralRow({ bounty_payment_count: 1, bounty_first_payment_at: new Date().toISOString() }),
      invoice: makeInvoice({ id: 'in_second' }),
    });

    expect(result.bounty).toBe('owed');
    expect(referralUpdates[0].bounty_amount_minor).toBeNull();
  });
});

// ── D. 30-days-retained fallback ──────────────────────────────────────────────

describe('D. recordCampaignBountyPayment — 30-days-retained fallback', () => {
  // NOTE on reachability: with the current wiring (recordCampaignBountyPayment
  // is only invoked from an actual invoice.payment_succeeded event), the very
  // FIRST call for a referral always has bounty_payment_count going in as 0
  // and bounty_first_payment_at as null — so firstPaymentAt is set to `now`
  // in that same call, giving 0 elapsed days. A SECOND call always makes
  // paymentCount >= 2, which is already eligible via the payment-count rule
  // alone. So today, this time-based branch can only matter if
  // bounty_first_payment_at was already set by something OTHER than this
  // function (e.g. a future scheduled sweep re-checking stale campaign
  // referrals — see the PR's follow-up list). These tests exercise that
  // forward-compatible input shape directly.

  it('does not accrue when bounty_first_payment_at is set but < 30 days have elapsed and payment_count is still 0 going in', async () => {
    const { client } = makeFakeSupabase();
    const firstPaymentAt = new Date('2026-06-01T00:00:00Z').toISOString();
    const result = await recordCampaignBountyPayment({
      adminClient: client,
      referralRow: makeReferralRow({ bounty_payment_count: 0, bounty_first_payment_at: firstPaymentAt }),
      invoice: makeInvoice({ id: 'in_recheck_too_soon' }),
      now: new Date('2026-06-15T00:00:00Z'), // only 14 days later
    });
    expect(result.bounty).toBe('pending');
  });

  it('accrues once 30+ days have elapsed since bounty_first_payment_at, even though payment_count only reaches 1 on this call', async () => {
    const { client, referralUpdates } = makeFakeSupabase();
    const firstPaymentAt = new Date('2026-06-01T00:00:00Z').toISOString();
    const result = await recordCampaignBountyPayment({
      adminClient: client,
      referralRow: makeReferralRow({ bounty_payment_count: 0, bounty_first_payment_at: firstPaymentAt }),
      invoice: makeInvoice({ id: 'in_late_recheck' }),
      now: new Date('2026-07-05T00:00:00Z'), // 34 days after firstPaymentAt
    });
    expect(result.bounty).toBe('owed');
    expect(referralUpdates[0].bounty_status).toBe('owed');
    expect(referralUpdates[0].bounty_payment_count).toBe(1);
  });
});

// ── E. Redelivery guard ────────────────────────────────────────────────────────

describe('E. recordCampaignBountyPayment — redelivery guard', () => {
  it('no-ops when invoice.id matches bounty_last_invoice_id (Stripe redelivery)', async () => {
    const { client, referralUpdates } = makeFakeSupabase();
    const result = await recordCampaignBountyPayment({
      adminClient: client,
      referralRow: makeReferralRow({ bounty_last_invoice_id: 'in_dup' }),
      invoice: makeInvoice({ id: 'in_dup' }),
    });
    expect(result.skipped).toBe('duplicate_invoice');
    expect(referralUpdates).toHaveLength(0);
  });
});

// ── F. Already owed / already void ────────────────────────────────────────────

describe('F. recordCampaignBountyPayment — terminal states short-circuit', () => {
  it('skips when bounty_status is already owed', async () => {
    const { client, referralUpdates } = makeFakeSupabase();
    const result = await recordCampaignBountyPayment({
      adminClient: client,
      referralRow: makeReferralRow({ bounty_status: 'owed' }),
      invoice: makeInvoice(),
    });
    expect(result.skipped).toBe('already_owed');
    expect(referralUpdates).toHaveLength(0);
  });

  it('skips when bounty_status is void (clawed back) — never re-accrues', async () => {
    const { client, referralUpdates } = makeFakeSupabase();
    const result = await recordCampaignBountyPayment({
      adminClient: client,
      referralRow: makeReferralRow({ bounty_status: 'void' }),
      invoice: makeInvoice(),
    });
    expect(result.skipped).toBe('bounty_void');
    expect(referralUpdates).toHaveLength(0);
  });
});

// ── G. Zero-amount defence in depth ───────────────────────────────────────────

describe('G. recordCampaignBountyPayment — zero-amount guard', () => {
  it('skips a £0 invoice', async () => {
    const { client, referralUpdates } = makeFakeSupabase();
    const result = await recordCampaignBountyPayment({
      adminClient: client,
      referralRow: makeReferralRow(),
      invoice: makeInvoice({ amount_paid: 0 }),
    });
    expect(result.skipped).toBe('zero_amount');
    expect(referralUpdates).toHaveLength(0);
  });

  it('skips when referralRow has no campaign_id', async () => {
    const { client } = makeFakeSupabase();
    const result = await recordCampaignBountyPayment({
      adminClient: client,
      referralRow: makeReferralRow({ campaign_id: null }),
      invoice: makeInvoice(),
    });
    expect(result.skipped).toBe('not_campaign_referral');
  });

  it('never throws even when adminClient.from throws synchronously', async () => {
    const client = { from: () => { throw new Error('boom'); } };
    await expect(
      recordCampaignBountyPayment({ adminClient: client, referralRow: makeReferralRow({ bounty_payment_count: 1, bounty_first_payment_at: new Date().toISOString() }), invoice: makeInvoice() })
    ).resolves.toMatchObject({ skipped: 'unexpected_error' });
  });
});

// ── H. voidCampaignBounty — happy path ────────────────────────────────────────

describe('H. voidCampaignBounty — happy path clawback', () => {
  it('flips bounty_status to void for a campaign referral', async () => {
    const { client, referralUpdates } = makeFakeSupabase({
      profileResult: { data: { id: PROFILE_ID }, error: null },
      referralLookupResult: { data: { id: REFERRAL_ID, campaign_id: CAMPAIGN_ID, bounty_status: 'owed' }, error: null },
    });

    const result = await voidCampaignBounty({ adminClient: client, stripeCustomerId: CUSTOMER_ID, reason: 'charge.refunded' });

    expect(result.voided).toBe(true);
    expect(result.previousStatus).toBe('owed');
    expect(referralUpdates).toHaveLength(1);
    expect(referralUpdates[0].bounty_status).toBe('void');
    expect(referralUpdates[0].bounty_void_reason).toBe('charge.refunded');
  });

  it('voids even a bounty that is still pending (before it ever accrued)', async () => {
    const { client, referralUpdates } = makeFakeSupabase({
      profileResult: { data: { id: PROFILE_ID }, error: null },
      referralLookupResult: { data: { id: REFERRAL_ID, campaign_id: CAMPAIGN_ID, bounty_status: 'pending' }, error: null },
    });

    const result = await voidCampaignBounty({ adminClient: client, stripeCustomerId: CUSTOMER_ID, reason: 'charge.dispute.created' });

    expect(result.voided).toBe(true);
    expect(referralUpdates[0].bounty_status).toBe('void');
  });
});

// ── I. voidCampaignBounty — no-op paths ───────────────────────────────────────

describe('I. voidCampaignBounty — no-ops', () => {
  it('skips when there is no stripeCustomerId', async () => {
    const { client } = makeFakeSupabase();
    const result = await voidCampaignBounty({ adminClient: client, stripeCustomerId: null, reason: 'charge.refunded' });
    expect(result.skipped).toBe('no_customer');
  });

  it('skips when no profile matches the customer id', async () => {
    const { client } = makeFakeSupabase({ profileResult: { data: null, error: { code: 'PGRST116' } } });
    const result = await voidCampaignBounty({ adminClient: client, stripeCustomerId: CUSTOMER_ID, reason: 'charge.refunded' });
    expect(result.skipped).toBe('no_profile');
  });

  it('skips when the referral is not a campaign referral', async () => {
    const { client } = makeFakeSupabase({
      profileResult: { data: { id: PROFILE_ID }, error: null },
      referralLookupResult: { data: { id: REFERRAL_ID, campaign_id: null, bounty_status: 'none' }, error: null },
    });
    const result = await voidCampaignBounty({ adminClient: client, stripeCustomerId: CUSTOMER_ID, reason: 'charge.refunded' });
    expect(result.skipped).toBe('not_campaign_referral');
  });

  it('skips (no double-write) when already void', async () => {
    const { client, referralUpdates } = makeFakeSupabase({
      profileResult: { data: { id: PROFILE_ID }, error: null },
      referralLookupResult: { data: { id: REFERRAL_ID, campaign_id: CAMPAIGN_ID, bounty_status: 'void' }, error: null },
    });
    const result = await voidCampaignBounty({ adminClient: client, stripeCustomerId: CUSTOMER_ID, reason: 'charge.refunded' });
    expect(result.skipped).toBe('already_void');
    expect(referralUpdates).toHaveLength(0);
  });

  it('never throws even when adminClient.from throws synchronously', async () => {
    const client = { from: () => { throw new Error('boom'); } };
    await expect(
      voidCampaignBounty({ adminClient: client, stripeCustomerId: CUSTOMER_ID, reason: 'charge.refunded' })
    ).resolves.toMatchObject({ skipped: 'unexpected_error' });
  });
});
