/**
 * Tests for netlify/functions/create-deposit-payment-link.js
 *
 * No network calls. Stripe and Supabase are both mocked.
 *
 * Covers:
 *   A. Missing env vars → 500
 *   B. Missing quoteId AND publicQuoteToken → 400
 *   C. Missing auth token (Path A, no publicQuoteToken) → 401
 *   D. Invalid Supabase token → 401
 *   E. Trader not connected → 409 NOT_CONNECTED
 *   F. Quote not found (Path A) → 404
 *   G. Quote has deposit_percent = 0 → 400
 *   H. Deposit already paid → 400 ALREADY_PAID
 *   I. Idempotency — existing non-expired deposit token returned
 *   J. Happy path (Path A — authenticated) — creates session, inserts token, kind='deposit'
 *   K. jp_type = 'deposit' in payment_intent_data.metadata
 *   L. No application_fee_amount (trader absorbs fee, decision #1)
 *   M. Public token path (Path B — unauthenticated) — looks up by meta->publicAccessToken
 *   N. Method guard
 *   O. Consent validation on public path — missing consentGiven → 400
 *   P. Consent fields in Stripe session metadata on public path
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_URL         = 'https://abc.supabase.co';
const FAKE_SRK         = 'service-role-key-fake';
const FAKE_STRIPE_SK   = 'sk_test_fake';
const FAKE_USER_ID     = 'user-uuid-abc';
const FAKE_STRIPE_UID  = 'acct_testfake456';
const FAKE_QUOTE_ID    = 'quote-uuid-123';
const FAKE_SESSION_ID  = 'cs_test_deposit_fake';
const FAKE_APP_URL     = 'https://app.jobprofit.co.uk';
const FAKE_PUBLIC_TOK  = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';

// ── Stripe mock ───────────────────────────────────────────────────────────────
let mockSessionCreate = vi.fn(async () => ({ id: FAKE_SESSION_ID }));

vi.mock('stripe', () => {
  function MockStripe() {
    return {
      checkout: { sessions: { create: (...a) => mockSessionCreate(...a) } },
    };
  }
  return { default: MockStripe };
});

// ── Supabase mock ─────────────────────────────────────────────────────────────
let mockGetUser = vi.fn(async () => ({ data: { user: { id: FAKE_USER_ID } }, error: null }));

let mockProfileResult = {
  data: { stripe_user_id: FAKE_STRIPE_UID, stripe_connect_status: 'connected', business_name: 'Murphy Ltd', first_name: null, last_name: null, plan: 'pro', trial_ends_at: null },
  error: null,
};

let mockJobResult = {
  data: {
    id: FAKE_QUOTE_ID,
    user_id: FAKE_USER_ID,
    // total and name are NOT real DB columns — amount is the column, meta.total is the stored value.
    // customer and customerName are NOT real columns — customer_name is.
    amount: 540,
    summary: 'Bathroom re-tile',
    customer_name: 'Sam Whitlock',
    meta: { publicAccessToken: FAKE_PUBLIC_TOK, total: 540 },
    deposit_percent: 25,
    deposit_amount_pence: null,
    deposit_paid_at: null,
  },
  error: null,
};

let mockTokenIdempotentResult = { data: null, error: { code: 'PGRST116' } };
let mockInsertResult = { error: null };

const mockSingle   = vi.fn();
const mockLimit    = vi.fn(() => ({ single: mockSingle }));
const mockOrder    = vi.fn(() => ({ limit: mockLimit, single: mockSingle }));
const mockGt       = vi.fn(() => ({ order: mockOrder, limit: mockLimit, single: mockSingle }));
const mockEq       = vi.fn();
const mockIn       = vi.fn(() => ({ order: mockOrder, single: mockSingle }));
const mockSelect   = vi.fn(() => ({ eq: mockEq, in: mockIn }));
const mockInsert   = vi.fn(() => ({ error: mockInsertResult.error }));
const mockFrom     = vi.fn(() => ({ select: mockSelect, insert: mockInsert }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: (...a) => mockGetUser(...a) },
    from: (...a) => mockFrom(...a),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(body = {}, headers = {}) {
  return {
    httpMethod: 'POST',
    headers: {
      authorization: `Bearer test-auth-token`,
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function setEnv() {
  process.env.STRIPE_SECRET_KEY = FAKE_STRIPE_SK;
  process.env.VITE_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SRK;
  process.env.APP_URL = FAKE_APP_URL;
}

function clearEnv() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.APP_URL;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('create-deposit-payment-link', () => {
  let handler;

  beforeEach(async () => {
    vi.resetModules();
    setEnv();

    mockSessionCreate = vi.fn(async () => ({ id: FAKE_SESSION_ID }));
    mockGetUser = vi.fn(async () => ({ data: { user: { id: FAKE_USER_ID } }, error: null }));
    mockProfileResult = {
      data: { stripe_user_id: FAKE_STRIPE_UID, stripe_connect_status: 'connected', business_name: 'Murphy Ltd', first_name: null, last_name: null, plan: 'pro', trial_ends_at: null },
      error: null,
    };
    mockJobResult = {
      data: {
        id: FAKE_QUOTE_ID, user_id: FAKE_USER_ID, amount: 540, summary: 'Bathroom re-tile',
        customer_name: 'Sam Whitlock', meta: { publicAccessToken: FAKE_PUBLIC_TOK, total: 540 },
        deposit_percent: 25, deposit_amount_pence: null, deposit_paid_at: null,
      },
      error: null,
    };
    mockTokenIdempotentResult = { data: null, error: { code: 'PGRST116' } };
    mockInsertResult = { error: null };

    // Default eq/single chain for sequential queries: profile → job → idempotency → insert
    let callCount = 0;
    mockSingle.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return mockProfileResult;  // profile
      if (callCount === 2) return mockJobResult;       // job (Path A)
      return mockTokenIdempotentResult;               // idempotency
    });
    mockEq.mockReturnValue({ eq: mockEq, gt: mockGt, single: mockSingle, order: mockOrder });
    mockGt.mockReturnValue({ order: mockOrder, limit: mockLimit, single: mockSingle });
    mockLimit.mockReturnValue({ single: mockSingle });
    mockOrder.mockReturnValue({ limit: mockLimit, single: mockSingle });
    mockFrom.mockReturnValue({ select: mockSelect, insert: mockInsert });
    mockSelect.mockReturnValue({ eq: mockEq, in: mockIn });
    mockIn.mockReturnValue({ order: mockOrder, single: mockSingle });
    mockInsert.mockReturnValue({ error: null });

    const mod = await import('../create-deposit-payment-link.js');
    handler = mod.handler;
  });

  afterEach(() => {
    clearEnv();
    vi.clearAllMocks();
  });

  // ── A. Missing env vars ───────────────────────────────────────────────────
  it('A: returns 500 when STRIPE_SECRET_KEY is missing', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { handler: h } = await import('../create-deposit-payment-link.js');
    const res = await h(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });

  // ── B. Missing body params ────────────────────────────────────────────────
  it('B: returns 400 when neither quoteId nor publicQuoteToken provided', async () => {
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/required/i);
  });

  // ── C. Missing auth token (Path A) ───────────────────────────────────────
  it('C: returns 401 when auth token missing for authenticated path', async () => {
    const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ quoteId: FAKE_QUOTE_ID }) });
    expect(res.statusCode).toBe(401);
  });

  // ── D. Invalid Supabase auth token ────────────────────────────────────────
  it('D: returns 401 when Supabase getUser returns error', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'invalid' } });
    const res = await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(401);
  });

  // ── E. Trader not connected ───────────────────────────────────────────────
  it('E: returns 409 NOT_CONNECTED when trader has no stripe_user_id', async () => {
    // Must include plan:'pro' so the Pro gate passes and NOT_CONNECTED is returned.
    mockSingle.mockImplementationOnce(async () => ({
      data: { stripe_user_id: null, stripe_connect_status: 'disconnected', plan: 'pro', trial_ends_at: null },
      error: null,
    }));
    const res = await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('NOT_CONNECTED');
  });

  // ── E2. G7 — Server-side Pro gate: free user gets 403 PRO_REQUIRED ──────────
  it('E2: returns 403 PRO_REQUIRED when trader is on free plan', async () => {
    mockSingle.mockImplementationOnce(async () => ({
      data: { stripe_user_id: FAKE_STRIPE_UID, stripe_connect_status: 'connected', plan: 'free', trial_ends_at: null },
      error: null,
    }));
    const res = await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('PRO_REQUIRED');
  });

  it('E3: returns 403 PRO_REQUIRED when trader has an expired trial', async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    mockSingle.mockImplementationOnce(async () => ({
      data: { stripe_user_id: FAKE_STRIPE_UID, stripe_connect_status: 'connected', plan: 'trial', trial_ends_at: pastDate },
      error: null,
    }));
    const res = await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('PRO_REQUIRED');
  });

  it('E4: returns 200 when trader is on an active trial', async () => {
    const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();
    mockSingle.mockImplementation(async () => {
      // profile (trial) → job → idempotency
      return [
        { data: { stripe_user_id: FAKE_STRIPE_UID, stripe_connect_status: 'connected', plan: 'trial', trial_ends_at: futureDate, business_name: 'Trial Co', first_name: null, last_name: null }, error: null },
        mockJobResult,
        mockTokenIdempotentResult,
      ].shift() || mockTokenIdempotentResult;
    });
    // Set up sequential mock using call-count approach
    let callCount = 0;
    mockSingle.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return { data: { stripe_user_id: FAKE_STRIPE_UID, stripe_connect_status: 'connected', plan: 'trial', trial_ends_at: futureDate, business_name: 'Trial Co', first_name: null, last_name: null }, error: null };
      if (callCount === 2) return mockJobResult;
      return mockTokenIdempotentResult;
    });
    const res = await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.payUrl).toMatch(/\/p\//);
  });

  // ── F. Quote not found ────────────────────────────────────────────────────
  it('F: returns 404 when quote not found', async () => {
    let callCount = 0;
    mockSingle.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return mockProfileResult;
      return { data: null, error: { code: 'PGRST116' } };
    });
    const res = await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(404);
  });

  // ── G. deposit_percent = 0 ────────────────────────────────────────────────
  it('G: returns 400 when quote has deposit_percent = 0', async () => {
    let callCount = 0;
    mockSingle.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return mockProfileResult;
      if (callCount === 2) return { data: { ...mockJobResult.data, deposit_percent: 0 }, error: null };
      return mockTokenIdempotentResult;
    });
    const res = await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/no deposit/i);
  });

  // ── H. Deposit already paid ───────────────────────────────────────────────
  it('H: returns 400 ALREADY_PAID when deposit_paid_at is set', async () => {
    let callCount = 0;
    mockSingle.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return mockProfileResult;
      if (callCount === 2) return { data: { ...mockJobResult.data, deposit_paid_at: '2026-05-31T10:00:00Z' }, error: null };
      return mockTokenIdempotentResult;
    });
    const res = await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('ALREADY_PAID');
  });

  // ── I. Idempotency ────────────────────────────────────────────────────────
  it('I: returns existing token without creating new Stripe session', async () => {
    const EXISTING_TOKEN = 'existing-deposit-tok';
    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    let callCount = 0;
    mockSingle.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return mockProfileResult;
      if (callCount === 2) return mockJobResult;
      // idempotency: existing token found
      return { data: { token: EXISTING_TOKEN, expires_at: futureDate }, error: null };
    });
    const res = await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBe(EXISTING_TOKEN);
    expect(body.idempotent).toBe(true);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });

  // ── J. Happy path (authenticated) ────────────────────────────────────────
  it('J: happy path returns token and payUrl', async () => {
    const res = await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeTruthy();
    expect(body.payUrl).toMatch(/^https:\/\/app\.jobprofit\.co\.uk\/p\//);
    expect(mockSessionCreate).toHaveBeenCalledOnce();
  });

  // ── K. jp_type = 'deposit' in metadata ───────────────────────────────────
  it('K: Stripe session includes jp_type=deposit in payment_intent_data.metadata', async () => {
    await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    const [[params]] = mockSessionCreate.mock.calls;
    expect(params.payment_intent_data.metadata.jp_type).toBe('deposit');
    expect(params.payment_intent_data.metadata.jobprofit_quote_id).toBe(FAKE_QUOTE_ID);
    expect(params.payment_intent_data.metadata.jobprofit_trader_user_id).toBe(FAKE_USER_ID);
  });

  // ── L. No application_fee_amount (trader absorbs fee) ────────────────────
  it('L: Stripe session has no application_fee_amount (trader absorbs, decision #1)', async () => {
    await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    const [[params]] = mockSessionCreate.mock.calls;
    expect(params.application_fee_amount).toBeUndefined();
  });

  // ── M. Public token path (unauthenticated customer flow) ─────────────────
  it('M: publicQuoteToken path looks up job without auth token', async () => {
    // In public path: no Bearer token, uses publicQuoteToken + consentGiven
    const event = {
      httpMethod: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicQuoteToken: FAKE_PUBLIC_TOK, consentGiven: true }),
    };

    // For public path: single calls are profile → idempotency (job was fetched earlier)
    let callCount = 0;
    mockSingle.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return mockJobResult;        // job by publicAccessToken
      if (callCount === 2) return mockProfileResult;    // profile
      return mockTokenIdempotentResult;                 // idempotency
    });

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.payUrl).toMatch(/\/p\//);
  });

  // ── N. Method guard ───────────────────────────────────────────────────────
  it('N: returns 405 for non-POST', async () => {
    const res = await handler({ httpMethod: 'GET', headers: {}, body: '' });
    expect(res.statusCode).toBe(405);
  });

  // ── O. Consent validation on public path ─────────────────────────────────
  it('O: returns 400 when publicQuoteToken is present but consentGiven is missing', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicQuoteToken: FAKE_PUBLIC_TOK }), // no consentGiven
    };
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/consent/i);
  });

  it('O2: returns 400 when consentGiven is false (not true)', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicQuoteToken: FAKE_PUBLIC_TOK, consentGiven: false }),
    };
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/consent/i);
  });

  it('O3: authenticated path (quoteId only) does NOT require consentGiven', async () => {
    // The trader-initiated path never passes consent — it must not be gated
    const res = await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    expect(res.statusCode).toBe(200);
  });

  // ── P. Consent fields in Stripe metadata on public path ──────────────────
  it('P: public path attaches consent_given/consent_at/consent_policy_version to Stripe metadata', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicQuoteToken: FAKE_PUBLIC_TOK, consentGiven: true }),
    };

    let callCount = 0;
    mockSingle.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return mockJobResult;
      if (callCount === 2) return mockProfileResult;
      return mockTokenIdempotentResult;
    });

    await handler(event);
    const [[params]] = mockSessionCreate.mock.calls;
    const piMeta = params.payment_intent_data.metadata;
    expect(piMeta.consent_given).toBe('true');
    expect(piMeta.consent_at).toBeTruthy();
    expect(piMeta.consent_policy_version).toBe('v1');
  });

  it('P2: authenticated path does NOT attach consent fields to Stripe metadata', async () => {
    await handler(makeEvent({ quoteId: FAKE_QUOTE_ID }));
    const [[params]] = mockSessionCreate.mock.calls;
    const piMeta = params.payment_intent_data.metadata;
    expect(piMeta.consent_given).toBeUndefined();
    expect(piMeta.consent_at).toBeUndefined();
  });

  // ── Q. Regression: public-token path must NOT 404 due to invalid column names ─
  // Previously the select included `customer`, `customerName`, `name`, and `total`
  // which are not real jobs columns. PostgREST returned a 42703 error and the code
  // at `if (error || !data)` short-circuited to 404 "Quote not found", masking the
  // real cause. This test asserts the path reaches at least the Stripe-Connect check
  // (409 NOT_CONNECTED when not provisioned) rather than returning a misleading 404.
  it('Q: public-token path does not 404 when job exists — reaches NOT_CONNECTED gate instead', async () => {
    const event = {
      httpMethod: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicQuoteToken: FAKE_PUBLIC_TOK, consentGiven: true }),
    };

    // Trader profile: Pro but Stripe NOT connected — the expected gate in prod.
    const notConnectedProfile = {
      data: {
        stripe_user_id: null,
        stripe_connect_status: 'not_connected',
        business_name: 'Murphy Tiling',
        first_name: null,
        last_name: null,
        plan: 'pro',
        trial_ends_at: null,
      },
      error: null,
    };

    let callCount = 0;
    mockSingle.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return mockJobResult;       // job by publicAccessToken (uses customer_name, amount)
      if (callCount === 2) return notConnectedProfile; // profile
      return mockTokenIdempotentResult;
    });

    const res = await handler(event);
    // Must NOT be 404 ("Quote not found") — the job was found; we hit the Stripe gate.
    expect(res.statusCode).not.toBe(404);
    // In prod without Stripe Connect, the correct response is 409 NOT_CONNECTED.
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('NOT_CONNECTED');
  });
});
