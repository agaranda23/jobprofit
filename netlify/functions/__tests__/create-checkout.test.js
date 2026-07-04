/**
 * Tests for netlify/functions/create-checkout.js
 *
 * No network calls. Stripe and Supabase are both mocked.
 * Pattern mirrors accept-quote.test.js — pure logic + mocked I/O.
 *
 * Covers:
 *   A. Missing env vars → 500
 *   B. Missing/invalid auth token → 401
 *   C. Invalid Supabase token → 401
 *   D. Success path → 200 { url }
 *   E. Stripe create throws → 502
 *   F. Returning customer path (existing stripe_customer_id)
 *   G. Method guard (405 / 200 OPTIONS)
 *   H. Default path (no coupon_mode) — card-free 14-day trial config
 *   I. coupon_mode=trial_extension — still card-required, applies coupon
 *   J. coupon_mode=none — still card-required, charges immediately
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_URL       = 'https://abc.supabase.co';
const FAKE_SRK       = 'service-role-key-fake';
const FAKE_STRIPE_SK = 'sk_test_fake';
const FAKE_PRICE_ID  = 'price_test_fake';
const FAKE_USER_ID   = 'user-uuid-abc';
const FAKE_USER_EMAIL = 'trader@example.com';
const FAKE_SESSION_URL = 'https://checkout.stripe.com/pay/cs_test_fake';

// ── Stripe mock ───────────────────────────────────────────────────────────────
let mockStripeSessionCreate = vi.fn(async () => ({ url: FAKE_SESSION_URL }));

vi.mock('stripe', () => {
  function MockStripe() {
    return {
      checkout: {
        sessions: {
          create: (...args) => mockStripeSessionCreate(...args),
        },
      },
    };
  }
  return { default: MockStripe };
});

// ── Supabase mock ─────────────────────────────────────────────────────────────
let mockGetUser  = vi.fn(async () => ({ data: { user: { id: FAKE_USER_ID, email: FAKE_USER_EMAIL } }, error: null }));
let mockProfile  = { data: { stripe_customer_id: null }, error: null };

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: (...args) => mockGetUser(...args),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => mockProfile),
    })),
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent({ token = `Bearer tok`, body = '{}' } = {}) {
  return {
    httpMethod: 'POST',
    body,
    headers: {
      authorization: token,
      origin: 'https://ohnar.co.uk',
    },
  };
}

async function getHandler() {
  const mod = await import('../create-checkout.js');
  return mod.handler;
}

function setEnv() {
  process.env.STRIPE_SECRET_KEY       = FAKE_STRIPE_SK;
  process.env.STRIPE_PRICE_ID         = FAKE_PRICE_ID;
  process.env.VITE_SUPABASE_URL       = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SRK;
}

function clearEnv() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

beforeEach(() => {
  setEnv();
  mockGetUser  = vi.fn(async () => ({ data: { user: { id: FAKE_USER_ID, email: FAKE_USER_EMAIL } }, error: null }));
  mockProfile  = { data: { stripe_customer_id: null }, error: null };
  mockStripeSessionCreate = vi.fn(async () => ({ url: FAKE_SESSION_URL }));
  vi.clearAllMocks();
});

afterEach(() => {
  clearEnv();
  vi.resetModules();
});

// ─── A. Missing env vars ──────────────────────────────────────────────────────

describe('A. Missing env vars → 500', () => {
  it('returns 500 when STRIPE_SECRET_KEY is absent', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });

  it('returns 500 when STRIPE_PRICE_ID is absent', async () => {
    delete process.env.STRIPE_PRICE_ID;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });

  it('returns 500 when SUPABASE_SERVICE_ROLE_KEY is absent', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });
});

// ─── B. Missing auth token → 401 ─────────────────────────────────────────────

describe('B. Missing auth token → 401', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'POST', body: '{}', headers: {} });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/missing/i);
  });

  it('returns 401 when Authorization header is not a Bearer token', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'POST', body: '{}', headers: { authorization: 'Basic abc' } });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/missing/i);
  });
});

// ─── C. Invalid Supabase token → 401 ─────────────────────────────────────────

describe('C. Invalid Supabase token → 401', () => {
  it('returns 401 when Supabase rejects the token', async () => {
    mockGetUser = vi.fn(async () => ({ data: { user: null }, error: { message: 'Invalid JWT' } }));
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: 'Bearer invalid-tok' }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/invalid|expired/i);
  });
});

// ─── D. Success path → 200 { url } ───────────────────────────────────────────

describe('D. Success path', () => {
  it('returns 200 { url } on a valid authenticated request', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: `Bearer valid-tok` }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toBe(FAKE_SESSION_URL);
  });

  it('passes customer_email (not customer) when no existing stripe_customer_id', async () => {
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok' }));

    if (capturedParams) {
      expect(capturedParams.customer_email).toBe(FAKE_USER_EMAIL);
      expect(capturedParams.customer).toBeUndefined();
    }
  });

  it('passes metadata.user_id and client_reference_id', async () => {
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok' }));

    if (capturedParams) {
      expect(capturedParams.metadata?.user_id).toBe(FAKE_USER_ID);
      expect(capturedParams.client_reference_id).toBe(FAKE_USER_ID);
      expect(capturedParams.mode).toBe('subscription');
    }
  });
});

// ─── E. Stripe throws → 502 ──────────────────────────────────────────────────

describe('E. Stripe create throws → 502', () => {
  it('returns 502 when Stripe session create fails', async () => {
    mockStripeSessionCreate = vi.fn(async () => { throw new Error('Stripe network error'); });

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: 'Bearer valid-tok' }));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/checkout session|try again/i);
  });
});

// ─── F. Returning customer path ───────────────────────────────────────────────

describe('F. Returning customer — uses existing stripe_customer_id', () => {
  it('passes customer instead of customer_email when a stripe_customer_id exists', async () => {
    const EXISTING_CID = 'cus_existing123';
    mockProfile = { data: { stripe_customer_id: EXISTING_CID }, error: null };

    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok' }));

    if (capturedParams) {
      expect(capturedParams.customer).toBe(EXISTING_CID);
      expect(capturedParams.customer_email).toBeUndefined();
    }
  });
});

// ─── H. Default path — genuinely card-free 14-day trial ─────────────────────
// The upgrade sheet promises "14-day free trial · no card needed" — this is
// the config that makes that literally true in Stripe.

describe('H. Default path (no coupon_mode) — card-free trial', () => {
  it('sets payment_method_collection to if_required', async () => {
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: '{}' }));

    expect(capturedParams.payment_method_collection).toBe('if_required');
  });

  it('sets subscription_data.trial_period_days to 14', async () => {
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: '{}' }));

    expect(capturedParams.subscription_data?.trial_period_days).toBe(14);
  });

  it('sets trial_settings.end_behavior.missing_payment_method to cancel', async () => {
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: '{}' }));

    expect(capturedParams.subscription_data?.trial_settings?.end_behavior?.missing_payment_method).toBe('cancel');
  });

  it('does not apply a coupon on the default path', async () => {
    process.env.STRIPE_TRIAL_EXTENSION_COUPON_ID = 'coupon_should_not_apply';
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: '{}' }));

    expect(capturedParams.discounts).toBeUndefined();
    delete process.env.STRIPE_TRIAL_EXTENSION_COUPON_ID;
  });

  it('also applies when the body is malformed (falls back to default)', async () => {
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: 'not-json' }));

    expect(capturedParams.payment_method_collection).toBe('if_required');
    expect(capturedParams.subscription_data?.trial_period_days).toBe(14);
  });
});

// ─── I. trial_extension path — still collects a card, applies coupon ────────
// Moment-1 "add a card, keep Pro free another month" — the whole point is
// getting a card on file, so this path must NOT relax card collection.

describe('I. coupon_mode=trial_extension — still card-required', () => {
  it('does NOT set payment_method_collection or subscription_data trial', async () => {
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: JSON.stringify({ coupon_mode: 'trial_extension' }) }));

    expect(capturedParams.payment_method_collection).toBeUndefined();
    expect(capturedParams.subscription_data).toBeUndefined();
  });

  it('applies the coupon when STRIPE_TRIAL_EXTENSION_COUPON_ID is set', async () => {
    process.env.STRIPE_TRIAL_EXTENSION_COUPON_ID = 'coupon_free_month';
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: JSON.stringify({ coupon_mode: 'trial_extension' }) }));

    expect(capturedParams.discounts).toEqual([{ coupon: 'coupon_free_month' }]);
    delete process.env.STRIPE_TRIAL_EXTENSION_COUPON_ID;
  });

  it('degrades gracefully (no discounts) when the coupon env var is not set', async () => {
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: JSON.stringify({ coupon_mode: 'trial_extension' }) }));

    expect(capturedParams.discounts).toBeUndefined();
  });

  it('sets metadata.coupon_mode to trial_extension', async () => {
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: JSON.stringify({ coupon_mode: 'trial_extension' }) }));

    expect(capturedParams.metadata?.coupon_mode).toBe('trial_extension');
  });
});

// ─── J. coupon_mode=none — charges immediately, still card-required ─────────
// Moment-2 "charge me now" — trial already spent, no further grace period.

describe('J. coupon_mode=none — immediate charge, still card-required', () => {
  it('does NOT set payment_method_collection or subscription_data trial', async () => {
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: JSON.stringify({ coupon_mode: 'none' }) }));

    expect(capturedParams.payment_method_collection).toBeUndefined();
    expect(capturedParams.subscription_data).toBeUndefined();
  });

  it('does not apply a discount', async () => {
    process.env.STRIPE_TRIAL_EXTENSION_COUPON_ID = 'coupon_should_not_apply';
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: JSON.stringify({ coupon_mode: 'none' }) }));

    expect(capturedParams.discounts).toBeUndefined();
    delete process.env.STRIPE_TRIAL_EXTENSION_COUPON_ID;
  });

  it('sets metadata.coupon_mode to none', async () => {
    let capturedParams = null;
    mockStripeSessionCreate = vi.fn(async (params) => {
      capturedParams = params;
      return { url: FAKE_SESSION_URL };
    });

    const handler = await getHandler();
    await handler(makeEvent({ token: 'Bearer valid-tok', body: JSON.stringify({ coupon_mode: 'none' }) }));

    expect(capturedParams.metadata?.coupon_mode).toBe('none');
  });
});

// ─── G. Method guard ─────────────────────────────────────────────────────────

describe('G. Method guard', () => {
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
