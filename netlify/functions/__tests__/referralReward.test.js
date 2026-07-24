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
 *   K. grantReferralReward — amount_paid gating (BUG 1: fires on the real
 *      trial-to-paid conversion regardless of billing_reason; skips £0)
 *   L. grantReferralReward — a failed grant surfaces as an error, never as
 *      success (BUG 2)
 *   M. grantReferralReward — a trialing referrer gets pro_comp_until, not an
 *      inert balance credit (BUG 3)
 *   N. grantReferralReward — campaign-code fork (JP-LU9): a referee with no
 *      referred_by but a referrals row carrying campaign_id routes to
 *      recordCampaignBountyPayment instead of the peer double-sided reward,
 *      and 'not_referred' is preserved for a genuinely un-referred user.
 *      The bounty accrual logic itself is unit-tested directly in
 *      campaignBounty.test.js against real fakes — this file only proves the
 *      fork wiring, mirroring how stripe-webhook.test.js mocks THIS module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeStackedCompUntil,
  extractSubscriptionAmount,
  isSchemaMissing,
  grantReferralReward,
} from '../_lib/referralReward.js';

// campaignBounty.js's own logic (2nd-payment-or-30-days, redelivery guard,
// etc.) is exhaustively covered in campaignBounty.test.js against real fakes.
// Mocking it here — same pattern stripe-webhook.test.js uses for THIS module
// — keeps this file focused on proving grantReferralReward's FORK wiring.
let mockRecordCampaignBountyPayment = vi.fn(async () => ({ bounty: 'pending' }));
vi.mock('../_lib/campaignBounty.js', () => ({
  recordCampaignBountyPayment: (...args) => mockRecordCampaignBountyPayment(...args),
}));

beforeEach(() => {
  mockRecordCampaignBountyPayment = vi.fn(async () => ({ bounty: 'pending' }));
});

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
  profileUpdateErrorFor = [], // user ids for which the profiles.update() call simulates a DB failure
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
            if (profileUpdateErrorFor.includes(val)) {
              return { error: { message: 'simulated DB failure' } };
            }
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
    amount_paid: 1200, // real money moved — the gate the reward now fires on (BUG 1 fix)
    // billing_reason deliberately NOT 'subscription_create' by default — proves the
    // grant no longer depends on it (BUG 1: the real trial-to-paid conversion
    // typically arrives as 'subscription_cycle', not 'subscription_create').
    billing_reason: 'subscription_cycle',
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

// ── K. amount_paid gating (BUG 1 fix) ─────────────────────────────────────────

describe('K. grantReferralReward — amount_paid gating (BUG 1 fix)', () => {
  it('grants on the real trial-to-paid conversion even though billing_reason is subscription_cycle, not subscription_create', async () => {
    const { client, referralUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile(),
      referrerProfile: { data: { id: REFERRER_ID, stripe_customer_id: null, plan: 'free', pro_comp_until: null }, error: null },
      referralRow: pendingReferralRow(),
      claimResult: { data: [{ id: REFERRAL_ROW_ID }], error: null },
    });
    const { stripe } = makeFakeStripe({
      subscriptionsRetrieve: vi.fn(async () => ({
        items: { data: [{ price: { unit_amount: 1200, currency: 'gbp' } }] },
      })),
    });

    // amount_paid > 0, billing_reason is explicitly the renewal-style reason a
    // card-free trial's real first charge actually arrives as.
    const invoice = makeInvoice({ billing_reason: 'subscription_cycle', amount_paid: 1200 });
    const result = await grantReferralReward({ stripe, adminClient: client, invoice });

    expect(result.granted).toBe(true);
    expect(referralUpdates).toHaveLength(1);
  });

  it('skips a £0 invoice — no real money moved (e.g. the card-free trial\'s own invoice)', async () => {
    const { client, referralUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile(),
      referralRow: pendingReferralRow(),
    });
    const { stripe } = makeFakeStripe();

    const invoice = makeInvoice({ amount_paid: 0 });
    const result = await grantReferralReward({ stripe, adminClient: client, invoice });

    expect(result.skipped).toBe('zero_amount');
    expect(referralUpdates).toHaveLength(0);
  });

  it('skips when amount_paid is missing or non-numeric', async () => {
    const { client } = makeFakeSupabase({ refereeProfile: referredProfile() });
    const { stripe } = makeFakeStripe();

    const invoice = makeInvoice({ amount_paid: undefined });
    const result = await grantReferralReward({ stripe, adminClient: client, invoice });

    expect(result.skipped).toBe('zero_amount');
  });

  it('does not double-grant on a renewal (subsequent) payment for the same referee', async () => {
    // The referrals row is already 'rewarded' from the first qualifying
    // payment — a second invoice.payment_succeeded (renewal) for the same
    // referee must no-op, never re-grant.
    const { client, referralUpdates, profileUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile(),
      referralRow: pendingReferralRow({ status: 'rewarded' }),
    });
    const { stripe, balanceTxnCalls } = makeFakeStripe();

    const renewalInvoice = makeInvoice({ id: 'in_renewal_2', billing_reason: 'subscription_cycle', amount_paid: 1200 });
    const result = await grantReferralReward({ stripe, adminClient: client, invoice: renewalInvoice });

    expect(result.skipped).toBe('already_rewarded');
    expect(referralUpdates).toHaveLength(0);
    expect(profileUpdates).toHaveLength(0);
    expect(balanceTxnCalls).toHaveLength(0);
  });
});

// ── L. A failed grant surfaces as an error, never as success (BUG 2 fix) ─────

describe('L. grantReferralReward — failed grant never reported as success (BUG 2 fix)', () => {
  it('returns granted:false (not true) when the referee\'s own grant fails', async () => {
    const { client, referralUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile({ stripe_customer_id: null }), // no live subscription path
      referrerProfile: { data: { id: REFERRER_ID, stripe_customer_id: null, plan: 'free', pro_comp_until: null }, error: null },
      referralRow: pendingReferralRow(),
      claimResult: { data: [{ id: REFERRAL_ROW_ID }], error: null },
      profileUpdateErrorFor: [REFEREE_ID], // simulate a DB failure writing the referee's pro_comp_until
    });
    const { stripe } = makeFakeStripe();

    // No invoice.subscription hint → referee falls through to the
    // pro_comp_until (grantCompMonth) path, which is the one wired to fail.
    const invoice = makeInvoice({ subscription: null });
    const result = await grantReferralReward({ stripe, adminClient: client, invoice });

    expect(result.granted).toBe(false);
    expect(result.refereeResult.method).toBe('error');
    // The referrals row is still claimed 'rewarded' (stranded, not rolled
    // back) — see the TODO in referralReward.js's file-level docstring.
    expect(referralUpdates).toHaveLength(1);
  });

  it('returns granted:false when the referrer profile lookup fails (referrer_not_found)', async () => {
    const { client, referralUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile(),
      referrerProfile: { data: null, error: { message: 'connection timeout' } }, // not PGRST116 — a real failure
      referralRow: pendingReferralRow(),
      claimResult: { data: [{ id: REFERRAL_ROW_ID }], error: null },
    });
    const { stripe } = makeFakeStripe({
      subscriptionsRetrieve: vi.fn(async () => ({ items: { data: [{ price: { unit_amount: 1200, currency: 'gbp' } }] } })),
    });

    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });

    expect(result.referrerResult.skipped).toBe('referrer_not_found');
    expect(result.granted).toBe(false);
    // Referee's own reward still succeeded and the row is still claimed —
    // only the reported outcome must not say "granted".
    expect(result.refereeResult.method).toBe('balance_credit');
    expect(referralUpdates).toHaveLength(1);
  });
});

// ── M. Trialing referrer → pro_comp_until, not an inert balance credit (BUG 3) ─

describe('M. grantReferralReward — trialing referrer gets pro_comp_until (BUG 3 fix)', () => {
  it('routes a referrer on a card-free trialing subscription to pro_comp_until, not a balance credit', async () => {
    const { client, profileUpdates } = makeFakeSupabase({
      refereeProfile: referredProfile(),
      referrerProfile: { data: { id: REFERRER_ID, stripe_customer_id: REFERRER_CUSTOMER, plan: 'pro', pro_comp_until: null }, error: null },
      referralRow: pendingReferralRow(),
      claimResult: { data: [{ id: REFERRAL_ROW_ID }], error: null },
    });
    const { stripe, balanceTxnCalls } = makeFakeStripe({
      subscriptionsRetrieve: vi.fn(async () => ({ items: { data: [{ price: { unit_amount: 1200, currency: 'gbp' } }] } })),
      // Referrer's only subscription is 'trialing' — card-free, no live billing.
      subscriptionsList: vi.fn(async () => ({
        data: [{ status: 'trialing', items: { data: [{ price: { unit_amount: 1200, currency: 'gbp' } }] } }],
      })),
    });

    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });

    expect(result.granted).toBe(true);
    expect(result.referrerResult.method).toBe('pro_comp_until');
    // Only the referee's credit — the trialing referrer must NOT get a balance credit.
    expect(balanceTxnCalls).toHaveLength(1);
    expect(balanceTxnCalls.every((c) => c.customerId !== REFERRER_CUSTOMER)).toBe(true);
    expect(profileUpdates.some((u) => u.val === REFERRER_ID && u.payload.pro_comp_until)).toBe(true);
  });
});

// ── N. Campaign-code fork (JP-LU9) ────────────────────────────────────────────

const CAMPAIGN_ID = 'campaign-uuid-1';

describe('N. grantReferralReward — campaign-code fork (JP-LU9)', () => {
  it('routes to recordCampaignBountyPayment when the referee has no referred_by but their referrals row carries campaign_id', async () => {
    const { client } = makeFakeSupabase({
      refereeProfile: referredProfile({ referred_by: null }),
      referralRow: { data: { id: REFERRAL_ROW_ID, campaign_id: CAMPAIGN_ID, bounty_status: 'pending', bounty_payment_count: 0, bounty_first_payment_at: null, bounty_last_invoice_id: null }, error: null },
    });
    const { stripe } = makeFakeStripe();
    mockRecordCampaignBountyPayment = vi.fn(async () => ({ bounty: 'owed', referralId: REFERRAL_ROW_ID, amountMinor: 1500 }));

    const invoice = makeInvoice();
    const result = await grantReferralReward({ stripe, adminClient: client, invoice });

    expect(mockRecordCampaignBountyPayment).toHaveBeenCalledTimes(1);
    const callArg = mockRecordCampaignBountyPayment.mock.calls[0][0];
    expect(callArg.referralRow.campaign_id).toBe(CAMPAIGN_ID);
    expect(callArg.invoice).toBe(invoice);

    expect(result.campaign).toBe(true);
    expect(result.campaignId).toBe(CAMPAIGN_ID);
    expect(result.bounty).toBe('owed');
    // Never touches the peer double-sided reward path
    expect(result.granted).toBeUndefined();
  });

  it('still returns not_referred for a genuinely un-referred user (no referrals row at all)', async () => {
    const { client } = makeFakeSupabase({
      refereeProfile: referredProfile({ referred_by: null }),
      referralRow: { data: null, error: { code: 'PGRST116' } },
    });
    const { stripe } = makeFakeStripe();

    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });

    expect(result.skipped).toBe('not_referred');
    expect(mockRecordCampaignBountyPayment).not.toHaveBeenCalled();
  });

  it('returns not_referred when a referrals row exists but has no campaign_id (defensive — should not happen in practice)', async () => {
    const { client } = makeFakeSupabase({
      refereeProfile: referredProfile({ referred_by: null }),
      referralRow: { data: { id: REFERRAL_ROW_ID, campaign_id: null }, error: null },
    });
    const { stripe } = makeFakeStripe();

    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });

    expect(result.skipped).toBe('not_referred');
    expect(mockRecordCampaignBountyPayment).not.toHaveBeenCalled();
  });

  it('degrades gracefully on 42703 during the campaign-fork referrals lookup', async () => {
    const { client } = makeFakeSupabase({
      refereeProfile: referredProfile({ referred_by: null }),
      referralRow: { data: null, error: { code: '42703', message: 'column does not exist' } },
    });
    const { stripe } = makeFakeStripe();

    const result = await grantReferralReward({ stripe, adminClient: client, invoice: makeInvoice() });

    expect(result.skipped).toBe('schema_missing');
  });
});
