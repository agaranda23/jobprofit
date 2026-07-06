/**
 * Tests for netlify/functions/_lib/referralReward.js (JP-LU7 Phase 2)
 *
 * No vi.mock('@supabase/supabase-js') / vi.mock('stripe') gymnastics — the
 * exported functions take `stripe` and `adminClient` as plain arguments, so
 * tests pass lightweight fake objects instead (same spirit as
 * weeklyDigestCalc.test.js — pure/injectable logic, no module mocking).
 *
 * Covers:
 *   A. computeStackedCompUntil — pure date math
 *   B. extractSubscriptionAmount — pure price extraction + fallback
 *   C. isSchemaMissing — pure error-code check
 *   D. grantReferralReward — happy path (marks rewarded, grants both)
 *   E. grantReferralReward — idempotency (re-delivered webhook doesn't double-grant)
 *   F. grantReferralReward — self-referral skip
 *   G. grantReferralReward — already-rewarded skip
 *   H. grantReferralReward — free-tier referrer gets pro_comp_until
 *   I. grantReferralReward — paying referrer gets a balance credit
 *   J. grantReferralReward — not-referred / schema-missing degradation
 */

import { describe, it, expect, vi } from 'vitest';
import {
  computeStackedCompUntil,
  extractSubscriptionAmount,
  isSchemaMissing,
  grantReferralReward,
} from '../_lib/referralReward.js';

const REFERRER_ID = 'referrer-uuid-1';
const REFEREE_ID  = 'referee-uuid-2';
const REFERRAL_ROW_ID = 'referral-row-uuid-9';
const REFEREE_CUSTOMER = 'cus_referee';
const REFERRER_CUSTOMER = 'cus_referrer';
const INVOICE_ID = 'in_test_123';
const SUB_ID = 'sub_test_456';

// ── A. computeStackedCompUntil ────────────────────────────────────────────────

describe('A. computeStackedCompUntil — pure date math', () => {
  it('stacks 31 days from now when there is no existing comp', () => {
    const now = new Date('2026-07-06T12:00:00Z');
    const result = computeStackedCompUntil(null, now);
    expect(new Date(result).getTime()).toBe(now.getTime() + 31 * 86400000);
  });

  it('stacks 31 days on top of an existing FUTURE comp (never shortens it)', () => {
    const now = new Date('2026-07-06T12:00:00Z');
    const existing = new Date('2026-08-01T12:00:00Z').toISOString(); // already in the future
    const result = computeStackedCompUntil(existing, now);
    expect(new Date(result).getTime()).toBe(new Date(existing).getTime() + 31 * 86400000);
  });

  it('does NOT stack on an expired comp — bases from now instead', () => {
    const now = new Date('2026-07-06T12:00:00Z');
    const expired = new Date('2026-01-01T12:00:00Z').toISOString();
    const result = computeStackedCompUntil(expired, now);
    expect(new Date(result).getTime()).toBe(now.getTime() + 31 * 86400000);
  });

  it('treats an unparseable existing value as no comp (bases from now)', () => {
    const now = new Date('2026-07-06T12:00:00Z');
    const result = computeStackedCompUntil('not-a-date', now);
    expect(new Date(result).getTime()).toBe(now.getTime() + 31 * 86400000);
  });
});

// ── B. extractSubscriptionAmount ──────────────────────────────────────────────

describe('B. extractSubscriptionAmount — pure price extraction', () => {
  it('reads amount + currency from the subscription price', () => {
    const sub = { items: { data: [{ price: { unit_amount: 1200, currency: 'gbp' } }] } };
    expect(extractSubscriptionAmount(sub)).toEqual({ amount: 1200, currency: 'gbp' });
  });

  it('falls back to £12 GBP when the subscription has no items', () => {
    expect(extractSubscriptionAmount({ items: { data: [] } })).toEqual({ amount: 1200, currency: 'gbp' });
  });

  it('falls back to £12 GBP when the subscription is null', () => {
    expect(extractSubscriptionAmount(null)).toEqual({ amount: 1200, currency: 'gbp' });
  });

  it('falls back when unit_amount is zero or missing', () => {
    const sub = { items: { data: [{ price: { unit_amount: 0, currency: 'gbp' } }] } };
    expect(extractSubscriptionAmount(sub)).toEqual({ amount: 1200, currency: 'gbp' });
  });
});

// ── C. isSchemaMissing ────────────────────────────────────────────────────────

describe('C. isSchemaMissing — pure error-code check', () => {
  it('returns true for 42703 (undefined column)', () => {
    expect(isSchemaMissing({ code: '42703' })).toBe(true);
  });

  it('returns true for 42P01 (undefined table)', () => {
    expect(isSchemaMissing({ code: '42P01' })).toBe(true);
  });

  it('returns true when the message contains "does not exist"', () => {
    expect(isSchemaMissing({ message: 'column profiles.pro_comp_until does not exist' })).toBe(true);
  });

  it('returns false for an unrelated error', () => {
    expect(isSchemaMissing({ code: '23505', message: 'duplicate key' })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isSchemaMissing(null)).toBe(false);
    expect(isSchemaMissing(undefined)).toBe(false);
  });
});

// ── Fake Stripe + Supabase builders ───────────────────────────────────────────

/**
 * Builds a fake `adminClient` covering exactly the chains referralReward.js
 * uses: profiles select-by-column + single(), profiles update + eq(), and
 * referrals select + single() / conditional claim update + select().
 *
 * `state` is a plain object the test can inspect afterwards for assertions,
 * and mutate beforehand to control fixture responses.
 */
function makeFakeSupabase({
  refereeProfile = { data: null, error: { code: 'PGRST116' } },
  referrerProfile = { data: null, error: { code: 'PGRST116' } },
  referralRow = { data: null, error: { code: 'PGRST116' } },
  claimResult = { data: [], error: null },
} = {}) {
  const profileUpdates = [];
  const referralUpdates = [];

  const from = vi.fn((table) => {
    if (table === 'profiles') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col) => ({
            single: vi.fn(async () => (col === 'stripe_customer_id' ? refereeProfile : referrerProfile)),
          })),
        })),
        update: vi.fn((payload) => ({
          eq: vi.fn(async (col, val) => {
            profileUpdates.push({ payload, col, val });
            return { error: null };
          }),
        })),
      };
    }
    if (table === 'referrals') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => referralRow),
          })),
        })),
        update: vi.fn((payload) => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(async () => {
                referralUpdates.push(payload);
                return claimResult;
              }),
            })),
          })),
        })),
      };
    }
    return {};
  });

  return { client: { from }, profileUpdates, referralUpdates };
}

function makeFakeStripe({ subscriptionsRetrieve, subscriptionsList, createBalanceTransaction } = {}) {
  const balanceTxnCalls = [];
  return {
    stripe: {
      subscriptions: {
        retrieve: subscriptionsRetrieve || vi.fn(async () => null),
        list: subscriptionsList || vi.fn(async () => ({ data: [] })),
      },
      customers: {
        createBalanceTransaction: createBalanceTransaction || vi.fn(async (customerId, params) => {
          balanceTxnCalls.push({ customerId, params });
          return { id: 'txn_fake' };
        }),
      },
    },
    balanceTxnCalls,
  };
}

function referredProfile(overrides = {}) {
  return {
    data: {
      id: REFEREE_ID,
      referred_by: REFERRER_ID,
      stripe_customer_id: REFEREE_CUSTOMER,
      plan: 'pro',
      pro_comp_until: null,
      ...overrides,
    },
    error: null,
  };
}

function pendingReferralRow(overrides = {}) {
  return {
    data: {
      id: REFERRAL_ROW_ID,
      status: 'pending',
      referrer_id: REFERRER_ID,
      referee_id: REFEREE_ID,
      ...overrides,
    },
    error: null,
  };
}

function makeInvoice(overrides = {}) {
  return {
    id: INVOICE_ID,
    customer: REFEREE_CUSTOMER,
    subscription: SUB_ID,
    billing_reason: 'subscription_create',
    ...overrides,
  };
}

// ── D. Happy path ──────────────────────────────────────────────────────────────

describe('D. grantReferralReward — happy path', () => {
  it('claims the referral row and grants both referrer and referee', async () => {
    const { client, referralUpdates, profileUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile(),
      referrerProfile: { data: { id: REFERRER_ID, stripe_customer_id: null, plan: 'free', pro_comp_until: null }, error: null },
      referralRow: pendingReferralRow(),
      claimResult: { data: [{ id: REFERRAL_ROW_ID }], error: null },
    });
    const { stripe, balanceTxnCalls } = makeFakeStripe({
      subscriptionsRetrieve: vi.fn(async () => ({
        items: { data: [{ price: { unit_amount: 1200, currency: 'gbp' } }] },
      })),
    });

    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });

    expect(result.granted).toBe(true);
    // referrals row was claimed (status flipped to rewarded)
    expect(referralUpdates).toHaveLength(1);
    expect(referralUpdates[0].status).toBe('rewarded');
    expect(referralUpdates[0].stripe_invoice_id).toBe(INVOICE_ID);

    // referee (has a live subscription) → balance credit
    expect(result.refereeResult.method).toBe('balance_credit');
    expect(balanceTxnCalls).toHaveLength(1);
    expect(balanceTxnCalls[0].customerId).toBe(REFEREE_CUSTOMER);
    expect(balanceTxnCalls[0].params.amount).toBe(-1200);

    // referrer (free tier, no stripe_customer_id) → pro_comp_until stack
    expect(result.referrerResult.method).toBe('pro_comp_until');
    expect(profileUpdates).toHaveLength(1);
    expect(profileUpdates[0].col).toBe('id');
    expect(profileUpdates[0].val).toBe(REFERRER_ID);
    expect(profileUpdates[0].payload.pro_comp_until).toBeDefined();
  });
});

// ── E. Idempotency ────────────────────────────────────────────────────────────

describe('E. grantReferralReward — idempotent on re-delivered webhook', () => {
  it('no-ops when the conditional claim affects zero rows (already claimed)', async () => {
    const { client, profileUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile(),
      referrerProfile: { data: { id: REFERRER_ID, stripe_customer_id: null, plan: 'free', pro_comp_until: null }, error: null },
      referralRow: pendingReferralRow(),
      claimResult: { data: [], error: null }, // 0 rows affected — another delivery got there first
    });
    const { stripe, balanceTxnCalls } = makeFakeStripe();

    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });

    expect(result.skipped).toBe('already_claimed');
    expect(balanceTxnCalls).toHaveLength(0);
    expect(profileUpdates).toHaveLength(0);
  });
});

// ── F. Self-referral skip ─────────────────────────────────────────────────────

describe('F. grantReferralReward — self-referral skip', () => {
  it('skips when referred_by equals the referee themselves', async () => {
    const { client, referralUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile({ referred_by: REFEREE_ID }), // self-referral
    });
    const { stripe } = makeFakeStripe();

    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });

    expect(result.skipped).toBe('self_referral');
    expect(referralUpdates).toHaveLength(0);
  });
});

// ── G. Already-rewarded skip ──────────────────────────────────────────────────

describe('G. grantReferralReward — already-rewarded skip', () => {
  it('skips without re-claiming when the referrals row is already status=rewarded', async () => {
    const { client, referralUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile(),
      referralRow: pendingReferralRow({ status: 'rewarded' }),
    });
    const { stripe } = makeFakeStripe();

    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });

    expect(result.skipped).toBe('already_rewarded');
    expect(referralUpdates).toHaveLength(0);
  });
});

// ── H. Free-tier referrer → pro_comp_until ────────────────────────────────────

describe('H. grantReferralReward — free-tier referrer gets pro_comp_until', () => {
  it('stacks pro_comp_until for a referrer with no Stripe customer id', async () => {
    const { client, profileUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile(),
      referrerProfile: { data: { id: REFERRER_ID, stripe_customer_id: null, plan: 'free', pro_comp_until: null }, error: null },
      referralRow: pendingReferralRow(),
      claimResult: { data: [{ id: REFERRAL_ROW_ID }], error: null },
    });
    const { stripe, balanceTxnCalls } = makeFakeStripe({
      subscriptionsRetrieve: vi.fn(async () => ({ items: { data: [{ price: { unit_amount: 1200, currency: 'gbp' } }] } })),
    });

    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });

    expect(result.referrerResult.method).toBe('pro_comp_until');
    // Referrer never touches Stripe balance credit
    expect(balanceTxnCalls).toHaveLength(1); // only the referee's credit
    expect(profileUpdates.some((u) => u.val === REFERRER_ID && u.payload.pro_comp_until)).toBe(true);
  });
});

// ── I. Paying referrer → balance credit ───────────────────────────────────────

describe('I. grantReferralReward — paying referrer gets a balance credit', () => {
  it('applies a balance credit for a referrer with an active subscription', async () => {
    const { client, profileUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile(),
      referrerProfile: { data: { id: REFERRER_ID, stripe_customer_id: REFERRER_CUSTOMER, plan: 'pro', pro_comp_until: null }, error: null },
      referralRow: pendingReferralRow(),
      claimResult: { data: [{ id: REFERRAL_ROW_ID }], error: null },
    });
    const { stripe, balanceTxnCalls } = makeFakeStripe({
      subscriptionsRetrieve: vi.fn(async () => ({ items: { data: [{ price: { unit_amount: 1200, currency: 'gbp' } }] } })),
      subscriptionsList: vi.fn(async () => ({
        data: [{ status: 'active', items: { data: [{ price: { unit_amount: 1200, currency: 'gbp' } }] } }],
      })),
    });

    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });

    expect(result.referrerResult.method).toBe('balance_credit');
    expect(balanceTxnCalls).toHaveLength(2); // referee + referrer
    expect(balanceTxnCalls.some((c) => c.customerId === REFERRER_CUSTOMER)).toBe(true);
    // Referrer never gets a pro_comp_until write in this branch
    expect(profileUpdates.some((u) => u.val === REFERRER_ID)).toBe(false);
  });
});

// ── J. Not-referred / schema-missing degradation ──────────────────────────────

describe('J. grantReferralReward — degradation paths', () => {
  it('skips when the referee has no referred_by (not a referred user)', async () => {
    const { client } = makeFakeSupabase({
      refereeProfile: referredProfile({ referred_by: null }),
    });
    const { stripe } = makeFakeStripe();
    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });
    expect(result.skipped).toBe('not_referred');
  });

  it('skips when no profile matches the invoice customer (schema-missing or unrelated customer)', async () => {
    const { client } = makeFakeSupabase({
      refereeProfile: { data: null, error: { code: 'PGRST116' } },
    });
    const { stripe } = makeFakeStripe();
    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });
    expect(result.skipped).toBe('no_profile');
  });

  it('degrades gracefully on 42703 (referral columns not migrated yet)', async () => {
    const { client } = makeFakeSupabase({
      refereeProfile: { data: null, error: { code: '42703', message: 'column does not exist' } },
    });
    const { stripe } = makeFakeStripe();
    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });
    expect(result.skipped).toBe('schema_missing');
  });

  it('never throws even when adminClient.from throws synchronously', async () => {
    const client = { from: () => { throw new Error('boom'); } };
    const { stripe } = makeFakeStripe();
    await expect(
      grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() })
    ).resolves.toMatchObject({ skipped: 'unexpected_error' });
  });
});
