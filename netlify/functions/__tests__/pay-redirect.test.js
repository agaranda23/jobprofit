/**
 * Tests for netlify/functions/pay-redirect.js
 *
 * No network calls. Stripe and Supabase are both mocked.
 *
 * Covers:
 *   A. Missing token in path → 404 HTML
 *   B. Token not found in DB → 404 HTML
 *   C. Token found, status 'paid' → 200 HTML "already paid"
 *   D. Token found, expired (DB expires_at in the past) → 200 HTML "link expired"
 *   E. Happy path — valid token, Stripe returns URL → 302 redirect
 *   F. Stripe session status 'expired' → 200 HTML "link expired"
 *   G. Stripe session status 'complete' → 200 HTML "already paid"
 *   H. Missing env vars → 503 HTML
 *   I. Method guard (non-GET returns 405)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_URL         = 'https://abc.supabase.co';
const FAKE_SRK         = 'service-role-key-fake';
const FAKE_STRIPE_SK   = 'sk_test_fake';
const FAKE_TOKEN       = 'abc123xyz';
const FAKE_SESSION_ID  = 'cs_test_fake';
const FAKE_SESSION_URL = 'https://checkout.stripe.com/pay/cs_test_fake';
const FAKE_TRADER_ID   = 'trader-uuid-1';
const FAKE_STRIPE_UID  = 'acct_fake456';

// ── Stripe mock ───────────────────────────────────────────────────────────────
let mockSessionRetrieve = vi.fn(async () => ({
  status: 'open',
  url: FAKE_SESSION_URL,
}));

vi.mock('stripe', () => {
  function MockStripe() {
    return {
      checkout: {
        sessions: {
          retrieve: (...args) => mockSessionRetrieve(...args),
        },
      },
    };
  }
  return { default: MockStripe };
});

// ── Supabase mock ─────────────────────────────────────────────────────────────
let mockTokenResult = {
  data: {
    stripe_checkout_session_id: FAKE_SESSION_ID,
    status: 'pending',
    expires_at: new Date(Date.now() + 3600_000).toISOString(), // 1h from now
    trader_user_id: FAKE_TRADER_ID,
  },
  error: null,
};

let mockProfileResult = {
  data: { stripe_user_id: FAKE_STRIPE_UID },
  error: null,
};

let mockUpdateResult = { error: null };

let mockSingleCallCount = 0;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn() },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      update: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        then: vi.fn(fn => Promise.resolve(fn(mockUpdateResult))),
        catch: vi.fn(() => Promise.resolve()),
      })),
      single: vi.fn(async () => {
        mockSingleCallCount++;
        if (mockSingleCallCount === 1) return mockTokenResult;
        return mockProfileResult;
      }),
    })),
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent({ path = `/p/${FAKE_TOKEN}`, method = 'GET' } = {}) {
  return { httpMethod: method, path, headers: {} };
}

async function getHandler() {
  const mod = await import('../pay-redirect.js');
  return mod.handler;
}

function setEnv() {
  process.env.STRIPE_SECRET_KEY         = FAKE_STRIPE_SK;
  process.env.VITE_SUPABASE_URL         = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SRK;
}

function clearEnv() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

beforeEach(() => {
  setEnv();
  mockSingleCallCount = 0;
  mockTokenResult = {
    data: {
      stripe_checkout_session_id: FAKE_SESSION_ID,
      status: 'pending',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      trader_user_id: FAKE_TRADER_ID,
    },
    error: null,
  };
  mockProfileResult = { data: { stripe_user_id: FAKE_STRIPE_UID }, error: null };
  mockSessionRetrieve = vi.fn(async () => ({ status: 'open', url: FAKE_SESSION_URL }));
  vi.clearAllMocks();
});

afterEach(() => {
  clearEnv();
  vi.resetModules();
});

// ─── A. Missing token in path → 404 ─────────────────────────────────────────

describe('A. Missing token → 404 HTML', () => {
  it('returns 404 when path has no token segment', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'GET', path: '/p/', headers: {} });
    expect(res.statusCode).toBe(404);
    expect(res.headers['Content-Type']).toMatch(/html/i);
  });
});

// ─── B. Token not found → 404 HTML ──────────────────────────────────────────

describe('B. Token not found → 404 HTML', () => {
  it('returns 404 HTML when token not in DB', async () => {
    mockTokenResult = { data: null, error: { code: 'PGRST116' } };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(404);
    expect(res.body).toMatch(/not found/i);
  });
});

// ─── C. Already paid → 200 HTML ──────────────────────────────────────────────

describe('C. Token status "paid" → 200 already-paid HTML', () => {
  it('returns 200 with "already received" copy when status is paid', async () => {
    mockTokenResult = { data: { ...mockTokenResult.data, status: 'paid' }, error: null };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/paid|received/i);
  });
});

// ─── D. Token expired (DB) → 200 HTML "link expired" ─────────────────────────

describe('D. Token expired (DB expires_at in past) → 200 link-expired HTML', () => {
  it('returns 200 with "expired" copy when expires_at is in the past', async () => {
    mockTokenResult = {
      data: {
        ...mockTokenResult.data,
        expires_at: new Date(Date.now() - 1000).toISOString(), // 1s in the past
      },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/expired/i);
  });
});

// ─── E. Happy path → 302 redirect to Stripe URL ──────────────────────────────

describe('E. Happy path → 302 redirect', () => {
  it('redirects to the Stripe Checkout URL', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toBe(FAKE_SESSION_URL);
  });

  it('uses stripeAccount header for the connected account', async () => {
    const handler = await getHandler();
    await handler(makeEvent());
    expect(mockSessionRetrieve).toHaveBeenCalledOnce();
    const [,, options] = mockSessionRetrieve.mock.calls[0];
    expect(options?.stripeAccount).toBe(FAKE_STRIPE_UID);
  });
});

// ─── F. Stripe session expired → 200 HTML ────────────────────────────────────

describe('F. Stripe session status "expired" → 200 link-expired HTML', () => {
  it('returns 200 with expired copy when Stripe reports session expired', async () => {
    mockSessionRetrieve = vi.fn(async () => ({ status: 'expired', url: null }));
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/expired/i);
  });
});

// ─── G. Stripe session complete → 200 HTML ───────────────────────────────────

describe('G. Stripe session status "complete" → 200 already-paid HTML', () => {
  it('returns 200 with "already paid" copy when Stripe reports session complete', async () => {
    mockSessionRetrieve = vi.fn(async () => ({ status: 'complete', url: null }));
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatch(/paid|received/i);
  });
});

// ─── H. Missing env vars → 503 ───────────────────────────────────────────────

describe('H. Missing env vars → 503 HTML', () => {
  it('returns 503 when STRIPE_SECRET_KEY is absent', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(503);
  });
});

// ─── I. Method guard ─────────────────────────────────────────────────────────

describe('I. Method guard', () => {
  it('returns 405 for POST requests', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ method: 'POST' }));
    expect(res.statusCode).toBe(405);
  });

  it('returns 302 for HEAD requests (same as GET for redirects)', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ method: 'HEAD' }));
    expect(res.statusCode).toBe(302);
  });
});
