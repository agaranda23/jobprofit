/**
 * Tests for netlify/functions/create-invoice-payment-link.js
 *
 * No network calls. Stripe and Supabase are both mocked.
 *
 * Covers:
 *   A. Missing env vars → 500
 *   B. Missing/invalid invoiceId in body → 400
 *   C. Missing auth token → 401
 *   D. Invalid Supabase token → 401
 *   E. Trader not connected (no stripe_user_id) → 409 with code NOT_CONNECTED
 *   F. Invoice not found or wrong trader → 400
 *   G. Invoice has no amount → 400
 *   H. Idempotency — existing non-expired token returned without new Stripe session
 *   I. Happy path — creates session, inserts token, returns payUrl
 *   J. No application_fee_amount in Stripe session (decision #1)
 *   K. Metadata set correctly for PR 3 webhook reconciliation
 *   L. Method guard
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_URL          = 'https://abc.supabase.co';
const FAKE_SRK          = 'service-role-key-fake';
const FAKE_STRIPE_SK    = 'sk_test_fake';
const FAKE_USER_ID      = 'user-uuid-abc';
const FAKE_STRIPE_UID   = 'acct_testfake456';
const FAKE_INVOICE_ID   = 'invoice-uuid-123';
const FAKE_SESSION_ID   = 'cs_test_sessionfake';
const FAKE_SESSION_URL  = 'https://checkout.stripe.com/pay/cs_test_sessionfake';
const FAKE_APP_URL      = 'https://app.ohnar.co.uk';

// ── Stripe mock ───────────────────────────────────────────────────────────────
let mockSessionCreate = vi.fn(async () => ({
  id: FAKE_SESSION_ID,
  url: FAKE_SESSION_URL,
}));

vi.mock('stripe', () => {
  function MockStripe() {
    return {
      checkout: {
        sessions: {
          create: (...args) => mockSessionCreate(...args),
        },
      },
    };
  }
  return { default: MockStripe };
});

// ── Supabase mock ─────────────────────────────────────────────────────────────
let mockGetUser = vi.fn(async () => ({
  data: { user: { id: FAKE_USER_ID } },
  error: null,
}));

// Profile: connected by default
let mockProfileResult = {
  data: {
    stripe_user_id: FAKE_STRIPE_UID,
    stripe_connect_status: 'connected',
    business_name: 'Murphy Plumbing Ltd',
    first_name: null,
    last_name: null,
  },
  error: null,
};

// Job: valid by default
let mockJobResult = {
  data: {
    id: FAKE_INVOICE_ID,
    amount: 540,
    total: 540,
    summary: 'Bathroom re-tile at 14 Albany Rd',
    name: 'Bathroom re-tile',
    customer: 'Sam Whitlock',
    customerName: null,
    meta: { invoiceNumber: 'JP-0142' },
  },
  error: null,
};

// Idempotency: no existing token by default
let mockExistingTokenResult = { data: null, error: { code: 'PGRST116' } };

// Insert: success by default
let mockInsertResult = { error: null };

// Shared from().select() chain builder
function makeFromChain(overrides = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn(async () => overrides.insert ?? mockInsertResult),
    single: vi.fn(async () => {
      // Return different results based on call context — simple approach: use a counter
      // so first .single() = profile, second = job, third = existing token.
      mockSingleCallCount = (mockSingleCallCount ?? 0) + 1;
      if (mockSingleCallCount === 1) return mockProfileResult;
      if (mockSingleCallCount === 2) return mockJobResult;
      return mockExistingTokenResult;
    }),
  };
}

let mockSingleCallCount = 0;
let mockFromImpl = () => makeFromChain();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: (...args) => mockGetUser(...args),
    },
    from: vi.fn((...args) => mockFromImpl(...args)),
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent({ token = 'Bearer tok', body = { invoiceId: FAKE_INVOICE_ID }, method = 'POST' } = {}) {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
    headers: { authorization: token },
  };
}

async function getHandler() {
  const mod = await import('../create-invoice-payment-link.js');
  return mod.handler;
}

function setEnv() {
  process.env.STRIPE_SECRET_KEY         = FAKE_STRIPE_SK;
  process.env.VITE_SUPABASE_URL         = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SRK;
  process.env.APP_URL                   = FAKE_APP_URL;
}

function clearEnv() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.APP_URL;
}

beforeEach(() => {
  setEnv();
  mockSingleCallCount = 0;
  mockGetUser = vi.fn(async () => ({
    data: { user: { id: FAKE_USER_ID } },
    error: null,
  }));
  mockProfileResult = {
    data: {
      stripe_user_id: FAKE_STRIPE_UID,
      stripe_connect_status: 'connected',
      business_name: 'Murphy Plumbing Ltd',
      first_name: null,
      last_name: null,
    },
    error: null,
  };
  mockJobResult = {
    data: {
      id: FAKE_INVOICE_ID,
      amount: 540,
      total: 540,
      summary: 'Bathroom re-tile at 14 Albany Rd',
      name: 'Bathroom re-tile',
      customer: 'Sam Whitlock',
      customerName: null,
      meta: { invoiceNumber: 'JP-0142' },
    },
    error: null,
  };
  mockExistingTokenResult = { data: null, error: { code: 'PGRST116' } };
  mockInsertResult = { error: null };
  mockSessionCreate = vi.fn(async () => ({ id: FAKE_SESSION_ID, url: FAKE_SESSION_URL }));
  mockFromImpl = () => makeFromChain();
  vi.clearAllMocks();
});

afterEach(() => {
  clearEnv();
  vi.resetModules();
});

// ─── A. Missing env vars → 500 ───────────────────────────────────────────────

describe('A. Missing env vars → 500', () => {
  it('returns 500 when STRIPE_SECRET_KEY is absent', async () => {
    delete process.env.STRIPE_SECRET_KEY;
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
  });
});

// ─── B. Missing invoiceId → 400 ──────────────────────────────────────────────

describe('B. Missing invoiceId → 400', () => {
  it('returns 400 when body has no invoiceId', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ body: {} }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/invoiceId/i);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'POST', body: 'not json', headers: { authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(400);
  });
});

// ─── C. Missing auth token → 401 ─────────────────────────────────────────────

describe('C. Missing auth token → 401', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ invoiceId: FAKE_INVOICE_ID }), headers: {} });
    expect(res.statusCode).toBe(401);
  });
});

// ─── D. Invalid Supabase token → 401 ─────────────────────────────────────────

describe('D. Invalid Supabase token → 401', () => {
  it('returns 401 when Supabase rejects the token', async () => {
    mockGetUser = vi.fn(async () => ({ data: { user: null }, error: { message: 'Invalid JWT' } }));
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: 'Bearer invalid' }));
    expect(res.statusCode).toBe(401);
  });
});

// ─── E. Trader not connected → 409 ───────────────────────────────────────────

describe('E. Trader not connected → 409 with code NOT_CONNECTED', () => {
  it('returns 409 when stripe_connect_status is disconnected', async () => {
    mockProfileResult = {
      data: { stripe_user_id: null, stripe_connect_status: 'disconnected', business_name: 'Test' },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('NOT_CONNECTED');
  });

  it('returns 409 when stripe_user_id is null even if status says connected', async () => {
    mockProfileResult = {
      data: { stripe_user_id: null, stripe_connect_status: 'connected', business_name: 'Test' },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(409);
  });
});

// ─── F. Invoice not found → 400 ──────────────────────────────────────────────

describe('F. Invoice not found → 400', () => {
  it('returns 400 when the job does not belong to this trader', async () => {
    mockJobResult = { data: null, error: { code: 'PGRST116' } };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/not found|belong/i);
  });
});

// ─── G. Invoice has no amount → 400 ──────────────────────────────────────────

describe('G. Invoice has no amount → 400', () => {
  it('returns 400 when job.amount is 0', async () => {
    mockJobResult = { data: { ...mockJobResult.data, amount: 0, total: 0 }, error: null };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/amount|price/i);
  });

  it('returns 400 when job.amount is null', async () => {
    mockJobResult = { data: { ...mockJobResult.data, amount: null, total: null }, error: null };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(400);
  });
});

// ─── H. Idempotency — existing non-expired token returned ────────────────────

describe('H. Idempotency — existing token returned, no new Stripe session', () => {
  it('returns the existing token without calling stripe.checkout.sessions.create', async () => {
    const EXISTING_TOKEN = 'existingtoken1234';
    mockExistingTokenResult = {
      data: { token: EXISTING_TOKEN, expires_at: new Date(Date.now() + 3600_000).toISOString() },
      error: null,
    };
    // Override single() to return existing token on 3rd call (after profile + job).
    // Simplest: track call count in closure.
    let callCount = 0;
    mockFromImpl = () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn(async () => mockInsertResult),
      single: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return mockProfileResult;
        if (callCount === 2) return mockJobResult;
        return mockExistingTokenResult;
      }),
    });

    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBe(EXISTING_TOKEN);
    expect(body.idempotent).toBe(true);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });
});

// ─── I. Happy path → 200 { token, payUrl } ───────────────────────────────────

describe('I. Happy path', () => {
  it('returns 200 with token and payUrl', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.payUrl).toMatch(/\/p\//);
    expect(body.payUrl).toContain(body.token);
  });

  it('uses APP_URL env var in the payUrl', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.payUrl).toContain(FAKE_APP_URL);
  });
});

// ─── J. No application_fee_amount (decision #1: trader absorbs fee) ──────────

describe('J. No application_fee_amount in Stripe session (decision #1)', () => {
  it('does not pass application_fee_amount to stripe.checkout.sessions.create', async () => {
    const handler = await getHandler();
    await handler(makeEvent());
    expect(mockSessionCreate).toHaveBeenCalledOnce();
    const [sessionParams] = mockSessionCreate.mock.calls[0];
    expect(sessionParams).not.toHaveProperty('application_fee_amount');
  });
});

// ─── K. Metadata set correctly for PR 3 webhook reconciliation ────────────────

describe('K. payment_intent_data.metadata includes all PR 3 reconciliation fields', () => {
  it('sets jobprofit_invoice_id, jobprofit_trader_user_id', async () => {
    const handler = await getHandler();
    await handler(makeEvent());
    const [sessionParams] = mockSessionCreate.mock.calls[0];
    const meta = sessionParams.payment_intent_data?.metadata;
    expect(meta).toBeDefined();
    expect(meta.jobprofit_invoice_id).toBe(FAKE_INVOICE_ID);
    expect(meta.jobprofit_trader_user_id).toBe(FAKE_USER_ID);
  });

  it('passes Stripe-Account header with the connected account ID', async () => {
    const handler = await getHandler();
    await handler(makeEvent());
    // Second arg to stripe.checkout.sessions.create is the options object { stripeAccount }
    const [, options] = mockSessionCreate.mock.calls[0];
    expect(options?.stripeAccount).toBe(FAKE_STRIPE_UID);
  });
});

// ─── L. Method guard ─────────────────────────────────────────────────────────

describe('L. Method guard', () => {
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
