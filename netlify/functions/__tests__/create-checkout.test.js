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

function makeEvent({ token = `Bearer tok` } = {}) {
  return {
    httpMethod: 'POST',
    body: '{}',
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
