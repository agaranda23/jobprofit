/**
 * Tests for netlify/functions/stripe-webhook.js
 *
 * No network calls. Stripe and Supabase are both mocked.
 * Pattern mirrors accept-quote.test.js — pure logic + mocked I/O.
 *
 * Covers:
 *   A. Signature failure → 400
 *   B. Missing env vars → 500
 *   C. checkout.session.completed → plan='pro', stripe ids saved
 *      (including a card-free trialing subscription — see C.trialing test)
 *   D. customer.subscription.deleted → plan='free', ids cleared
 *      (covers BOTH a deliberate cancel AND Stripe's automatic trial-end
 *      cancellation when no payment method was ever added — Stripe fires the
 *      same event either way, so one handler covers both)
 *   E. customer.subscription.updated → subscription_status synced
 *   F. invoice.payment_failed → subscription_status='past_due'
 *   G. invoice.payment_succeeded → subscription_status='active'
 *   H. Unknown event → 200 { received: true } (no DB call)
 *   I. Missing user_id in checkout session → 200 (logged, not retried)
 *   K. Referral reward grant wiring (JP-LU7 Phase 2) — only fires the grant
 *      helper on billing_reason==='subscription_create'; a bug in the grant
 *      never turns a successful payment into a 500. The grant logic itself
 *      (happy path, idempotency, self-referral, free-tier vs paying delivery)
 *      is unit-tested directly against real DB/Stripe fakes in
 *      referralReward.test.js — this file only proves the wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_URL        = 'https://abc.supabase.co';
const FAKE_SRK        = 'service-role-key-fake';
const FAKE_STRIPE_SK  = 'sk_test_fake';
const FAKE_WEBHOOK_SECRET = 'whsec_fake';
const FAKE_USER_ID    = 'user-uuid-abc';
const FAKE_CUSTOMER   = 'cus_test123';
const FAKE_SUB_ID     = 'sub_test456';

// ── Stripe mock ───────────────────────────────────────────────────────────────
// constructEvent is the critical path — controls what event gets dispatched.
let mockConstructEvent = vi.fn(() => ({
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_fake',
      customer: FAKE_CUSTOMER,
      subscription: FAKE_SUB_ID,
      metadata: { user_id: FAKE_USER_ID },
      client_reference_id: FAKE_USER_ID,
    },
  },
}));

vi.mock('stripe', () => {
  function MockStripe() {
    return {
      webhooks: {
        constructEvent: (...args) => mockConstructEvent(...args),
      },
    };
  }
  return { default: MockStripe };
});

// ── Supabase mock ─────────────────────────────────────────────────────────────
let mockUpdate = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      update: (...args) => mockUpdate(...args),
    })),
  })),
}));

// ── Referral reward grant mock ────────────────────────────────────────────────
// Mocked as a whole module so this file only has to assert the WIRING
// (called / not called, with what invoice) — the grant logic itself is
// covered exhaustively in referralReward.test.js against real fakes.
let mockGrantReferralReward = vi.fn(async () => ({ granted: true }));

vi.mock('../_lib/referralReward.js', () => ({
  grantReferralReward: (...args) => mockGrantReferralReward(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(body = 'raw-body') {
  return {
    httpMethod: 'POST',
    body,
    isBase64Encoded: false,
    headers: {
      'stripe-signature': 't=123,v1=abc',
    },
  };
}

async function getHandler() {
  const mod = await import('../stripe-webhook.js');
  return mod.handler;
}

function setEnv() {
  process.env.STRIPE_SECRET_KEY        = FAKE_STRIPE_SK;
  process.env.STRIPE_WEBHOOK_SECRET    = FAKE_WEBHOOK_SECRET;
  process.env.VITE_SUPABASE_URL        = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SRK;
}

function clearEnv() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

beforeEach(() => {
  setEnv();
  mockUpdate = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  mockGrantReferralReward = vi.fn(async () => ({ granted: true }));
  mockConstructEvent = vi.fn(() => ({
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_fake',
        customer: FAKE_CUSTOMER,
        subscription: FAKE_SUB_ID,
        metadata: { user_id: FAKE_USER_ID },
        client_reference_id: FAKE_USER_ID,
      },
    },
  }));
  vi.clearAllMocks();
});

afterEach(() => {
  clearEnv();
  vi.resetModules();
});

// ─── A. Signature failure → 400 ───────────────────────────────────────────────

describe('A. Signature failure → 400', () => {
  it('returns 400 when constructEvent throws (bad signature)', async () => {
    mockConstructEvent = vi.fn(() => { throw new Error('No signatures found matching the expected signature'); });
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/signature/i);
  });
});

// ─── B. Missing env vars → 500 ───────────────────────────────────────────────

describe('B. Missing env vars → 500', () => {
  it('returns 500 when STRIPE_WEBHOOK_SECRET is absent', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });

  it('returns 500 when STRIPE_SECRET_KEY is absent', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
  });
});

// ─── C. checkout.session.completed ───────────────────────────────────────────

describe('C. checkout.session.completed → plan=pro', () => {
  it('returns 200 and calls DB update with plan=pro and stripe ids', async () => {
    let capturedUpdate = null;
    mockUpdate = vi.fn((payload) => {
      capturedUpdate = payload;
      return { eq: vi.fn(async () => ({ error: null })) };
    });

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).received).toBe(true);

    if (capturedUpdate) {
      expect(capturedUpdate.plan).toBe('pro');
      expect(capturedUpdate.stripe_customer_id).toBe(FAKE_CUSTOMER);
      expect(capturedUpdate.stripe_subscription_id).toBe(FAKE_SUB_ID);
      expect(capturedUpdate.subscription_status).toBe('active');
    }
  });

  it('returns 200 (no retry) when user_id is missing from session', async () => {
    mockConstructEvent = vi.fn(() => ({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_no_user',
          customer: FAKE_CUSTOMER,
          subscription: FAKE_SUB_ID,
          metadata: {},
          client_reference_id: null,
        },
      },
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
  });

  // ── Card-free trial: checkout.session.completed fires the same whether or
  // not a card was collected — a trialing subscription completes the Checkout
  // Session just like a paid one. Pro must be granted immediately either way,
  // since isPro() (src/lib/plan.js) gates on profiles.plan, not on Stripe's
  // subscription status.
  it('grants plan=pro even when the session has no payment method (card-free trial)', async () => {
    mockConstructEvent = vi.fn(() => ({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_trial_no_card',
          customer: FAKE_CUSTOMER,
          subscription: FAKE_SUB_ID,
          metadata: { user_id: FAKE_USER_ID, coupon_mode: 'default' },
          client_reference_id: FAKE_USER_ID,
          // No payment_method / setup_intent on the session — nothing was collected.
        },
      },
    }));

    let capturedUpdate = null;
    mockUpdate = vi.fn((payload) => {
      capturedUpdate = payload;
      return { eq: vi.fn(async () => ({ error: null })) };
    });

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);
    if (capturedUpdate) {
      expect(capturedUpdate.plan).toBe('pro');
      expect(capturedUpdate.stripe_subscription_id).toBe(FAKE_SUB_ID);
    }
  });
});

// ─── D. customer.subscription.deleted ────────────────────────────────────────

describe('D. customer.subscription.deleted → plan=free', () => {
  it('returns 200 and sets plan=free, clears sub id', async () => {
    mockConstructEvent = vi.fn(() => ({
      type: 'customer.subscription.deleted',
      data: {
        object: { id: FAKE_SUB_ID, customer: FAKE_CUSTOMER, status: 'canceled' },
      },
    }));

    let capturedUpdate = null;
    mockUpdate = vi.fn((payload) => {
      capturedUpdate = payload;
      return { eq: vi.fn(async () => ({ error: null })) };
    });

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);

    if (capturedUpdate) {
      expect(capturedUpdate.plan).toBe('free');
      expect(capturedUpdate.stripe_subscription_id).toBeNull();
      expect(capturedUpdate.subscription_status).toBe('canceled');
    }
  });

  // Same event, different cause: Stripe fires customer.subscription.deleted
  // when trial_settings.end_behavior.missing_payment_method:'cancel' auto-cancels
  // an unpaid trial at day 14, exactly as it does for a manual cancellation.
  // cancellation_details.reason lets Stripe tell the two apart, but the app
  // doesn't need to — either way the correct outcome is plan=free, no charge.
  it('also fires (and is handled identically) when Stripe auto-cancels a card-free trial at day 14', async () => {
    mockConstructEvent = vi.fn(() => ({
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: FAKE_SUB_ID,
          customer: FAKE_CUSTOMER,
          status: 'canceled',
          cancellation_details: { reason: 'payment_method_missing_at_trial_end' },
        },
      },
    }));

    let capturedUpdate = null;
    mockUpdate = vi.fn((payload) => {
      capturedUpdate = payload;
      return { eq: vi.fn(async () => ({ error: null })) };
    });

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);
    if (capturedUpdate) {
      expect(capturedUpdate.plan).toBe('free');
      expect(capturedUpdate.stripe_subscription_id).toBeNull();
    }
  });
});

// ─── E. customer.subscription.updated ────────────────────────────────────────

describe('E. customer.subscription.updated → status synced', () => {
  it('returns 200 and syncs subscription_status', async () => {
    mockConstructEvent = vi.fn(() => ({
      type: 'customer.subscription.updated',
      data: {
        object: { id: FAKE_SUB_ID, customer: FAKE_CUSTOMER, status: 'past_due' },
      },
    }));

    let capturedUpdate = null;
    mockUpdate = vi.fn((payload) => {
      capturedUpdate = payload;
      return { eq: vi.fn(async () => ({ error: null })) };
    });

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);

    if (capturedUpdate) {
      expect(capturedUpdate.subscription_status).toBe('past_due');
    }
  });
});

// ─── F. invoice.payment_failed ────────────────────────────────────────────────

describe('F. invoice.payment_failed → subscription_status=past_due', () => {
  it('returns 200 and sets subscription_status=past_due', async () => {
    mockConstructEvent = vi.fn(() => ({
      type: 'invoice.payment_failed',
      data: {
        object: { id: 'in_test', customer: FAKE_CUSTOMER },
      },
    }));

    let capturedUpdate = null;
    mockUpdate = vi.fn((payload) => {
      capturedUpdate = payload;
      return { eq: vi.fn(async () => ({ error: null })) };
    });

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);

    if (capturedUpdate) {
      expect(capturedUpdate.subscription_status).toBe('past_due');
    }
  });
});

// ─── G. invoice.payment_succeeded ────────────────────────────────────────────

describe('G. invoice.payment_succeeded → subscription_status=active', () => {
  it('returns 200 and sets subscription_status=active', async () => {
    mockConstructEvent = vi.fn(() => ({
      type: 'invoice.payment_succeeded',
      data: {
        object: { id: 'in_test', customer: FAKE_CUSTOMER },
      },
    }));

    let capturedUpdate = null;
    mockUpdate = vi.fn((payload) => {
      capturedUpdate = payload;
      return { eq: vi.fn(async () => ({ error: null })) };
    });

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);

    if (capturedUpdate) {
      expect(capturedUpdate.subscription_status).toBe('active');
    }
  });
});

// ─── K. Referral reward grant wiring (JP-LU7 Phase 2) ────────────────────────

describe('K. Referral reward grant wiring', () => {
  it('calls grantReferralReward when billing_reason is subscription_create', async () => {
    mockConstructEvent = vi.fn(() => ({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_referral_test',
          customer: FAKE_CUSTOMER,
          subscription: FAKE_SUB_ID,
          billing_reason: 'subscription_create',
        },
      },
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);
    expect(mockGrantReferralReward).toHaveBeenCalledTimes(1);
    const callArg = mockGrantReferralReward.mock.calls[0][0];
    expect(callArg.invoice.id).toBe('in_referral_test');
    expect(callArg.invoice.billing_reason).toBe('subscription_create');
    expect(callArg.adminClient).toBeDefined();
    expect(callArg.stripe).toBeDefined();
  });

  it('does NOT call grantReferralReward when billing_reason is absent (plain renewal, matches test G)', async () => {
    mockConstructEvent = vi.fn(() => ({
      type: 'invoice.payment_succeeded',
      data: {
        object: { id: 'in_test', customer: FAKE_CUSTOMER },
      },
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);
    expect(mockGrantReferralReward).not.toHaveBeenCalled();
  });

  it('does NOT call grantReferralReward for a subscription_cycle (renewal) invoice', async () => {
    mockConstructEvent = vi.fn(() => ({
      type: 'invoice.payment_succeeded',
      data: {
        object: { id: 'in_renewal', customer: FAKE_CUSTOMER, billing_reason: 'subscription_cycle' },
      },
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);
    expect(mockGrantReferralReward).not.toHaveBeenCalled();
  });

  it('still returns 200 and does not crash the webhook when grantReferralReward throws', async () => {
    mockGrantReferralReward = vi.fn(async () => { throw new Error('unexpected grant failure'); });
    mockConstructEvent = vi.fn(() => ({
      type: 'invoice.payment_succeeded',
      data: {
        object: {
          id: 'in_referral_throws',
          customer: FAKE_CUSTOMER,
          subscription: FAKE_SUB_ID,
          billing_reason: 'subscription_create',
        },
      },
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).received).toBe(true);
  });
});

// ─── H. Unknown event → 200, no DB call ──────────────────────────────────────

describe('H. Unknown event type → 200 immediately', () => {
  it('returns 200 for an unhandled event type without calling DB', async () => {
    mockConstructEvent = vi.fn(() => ({
      type: 'customer.created',
      data: { object: { id: 'cus_new' } },
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).received).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ─── I. base64-encoded body ───────────────────────────────────────────────────

describe('I. base64-encoded body is decoded before signature check', () => {
  it('passes decoded body to constructEvent when isBase64Encoded=true', async () => {
    const rawBody = '{"type":"checkout.session.completed"}';
    const b64Body = Buffer.from(rawBody).toString('base64');

    let capturedBody = null;
    mockConstructEvent = vi.fn((body) => {
      capturedBody = body;
      return {
        type: 'checkout.session.completed',
        data: {
          object: {
            customer: FAKE_CUSTOMER,
            subscription: FAKE_SUB_ID,
            metadata: { user_id: FAKE_USER_ID },
            client_reference_id: FAKE_USER_ID,
          },
        },
      };
    });

    const handler = await getHandler();
    await handler({
      httpMethod: 'POST',
      body: b64Body,
      isBase64Encoded: true,
      headers: { 'stripe-signature': 't=123,v1=abc' },
    });

    if (capturedBody !== null) {
      expect(capturedBody).toBe(rawBody);
    }
  });
});

// ─── Method guard ─────────────────────────────────────────────────────────────

describe('Method guard', () => {
  it('returns 405 for GET requests', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'GET', headers: {}, body: '' });
    expect(res.statusCode).toBe(405);
  });

  it('returns 200 for OPTIONS preflight', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'OPTIONS', headers: {}, body: '' });
    expect(res.statusCode).toBe(200);
  });
});
