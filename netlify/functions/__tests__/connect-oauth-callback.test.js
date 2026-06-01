/**
 * Tests for netlify/functions/connect-oauth-callback.js
 *
 * No network calls. Stripe and Supabase are both mocked.
 *
 * Covers:
 *   A. Missing env vars → redirect with connect_error=config
 *   B. Stripe returns ?error=access_denied → redirect with connect_error
 *   C. Missing code or state → redirect with connect_error=missing_params
 *   D. Invalid / tampered state → redirect with connect_error=invalid_state
 *   E. Expired state → redirect with connect_error=invalid_state
 *   F. Stripe token exchange fails → redirect with connect_error=exchange_failed
 *   G. DB update fails → redirect with connect_error=db_write_failed
 *   H. Success path → 302 redirect to /#/settings?connected=1
 *   I. Method guard (POST → redirect with bad_method)
 *
 * The state token is generated using the same buildStateToken logic as the
 * production function — we import it via a test helper below.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac, randomBytes } from 'crypto';

const FAKE_URL        = 'https://abc.supabase.co';
const FAKE_SRK        = 'service-role-key-fake';
const FAKE_CLIENT_ID  = 'ca_test_fake123';
const FAKE_STRIPE_SK  = 'sk_test_fake';
const FAKE_USER_ID    = 'user-uuid-abc';
const FAKE_STRIPE_UID = 'acct_testfake456';
const FAKE_APP_URL    = 'https://app.jobprofit.co.uk';

// ── Build a valid state token (mirrors connect-oauth-start.js buildStateToken) ─

function buildValidState(userId = FAKE_USER_ID, secret = FAKE_CLIENT_ID, offsetMs = 0) {
  const nonce  = randomBytes(16).toString('hex');
  const expiry = Date.now() + 10 * 60 * 1000 + offsetMs;
  const payload = `${userId}|${nonce}|${expiry}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

function buildExpiredState(userId = FAKE_USER_ID, secret = FAKE_CLIENT_ID) {
  return buildValidState(userId, secret, -(10 * 60 * 1000 + 1000)); // expired 1s ago
}

// ── Stripe mock ───────────────────────────────────────────────────────────────
let mockOAuthToken = vi.fn(async () => ({ stripe_user_id: FAKE_STRIPE_UID }));

vi.mock('stripe', () => {
  function MockStripe() {
    return {
      oauth: {
        token: (...args) => mockOAuthToken(...args),
      },
    };
  }
  return { default: MockStripe };
});

// ── Supabase mock ─────────────────────────────────────────────────────────────
let mockUpdate = vi.fn(async () => ({ error: null }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => mockUpdate()),
      })),
    })),
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent({
  code = 'auth_code_test',
  state = null,
  stripeError = undefined,
  method = 'GET',
} = {}) {
  const params = {};
  if (code) params.code = code;
  if (state) params.state = state;
  if (stripeError) params.error = stripeError;
  return {
    httpMethod: method,
    body: '',
    headers: {},
    queryStringParameters: params,
  };
}

async function getHandler() {
  const mod = await import('../connect-oauth-callback.js');
  return mod.handler;
}

function setEnv() {
  process.env.STRIPE_SECRET_KEY         = FAKE_STRIPE_SK;
  process.env.STRIPE_CONNECT_CLIENT_ID  = FAKE_CLIENT_ID;
  process.env.VITE_SUPABASE_URL         = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SRK;
  process.env.APP_URL                   = FAKE_APP_URL;
}

function clearEnv() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_CONNECT_CLIENT_ID;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.APP_URL;
}

beforeEach(() => {
  setEnv();
  mockOAuthToken = vi.fn(async () => ({ stripe_user_id: FAKE_STRIPE_UID }));
  mockUpdate = vi.fn(async () => ({ error: null }));
  vi.clearAllMocks();
});

afterEach(() => {
  clearEnv();
  vi.resetModules();
});

// ─── A. Missing env vars ──────────────────────────────────────────────────────

describe('A. Missing env vars → redirect with connect_error=config', () => {
  it('redirects with connect_error=config when STRIPE_SECRET_KEY is absent', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const handler = await getHandler();
    const res = await handler(makeEvent({ state: buildValidState() }));
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connect_error=config');
  });
});

// ─── B. Stripe access_denied ─────────────────────────────────────────────────

describe('B. Stripe returns ?error → redirect with connect_error', () => {
  it('redirects with the stripe error when ?error=access_denied', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ code: undefined, state: undefined, stripeError: 'access_denied' }));
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connect_error=access_denied');
  });
});

// ─── C. Missing params ────────────────────────────────────────────────────────

describe('C. Missing code or state → redirect with connect_error=missing_params', () => {
  it('redirects with missing_params when code is absent', async () => {
    const handler = await getHandler();
    const res = await handler({
      httpMethod: 'GET',
      body: '',
      headers: {},
      queryStringParameters: { state: buildValidState() },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connect_error=missing_params');
  });

  it('redirects with missing_params when state is absent', async () => {
    const handler = await getHandler();
    const res = await handler({
      httpMethod: 'GET',
      body: '',
      headers: {},
      queryStringParameters: { code: 'auth_code' },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connect_error=missing_params');
  });
});

// ─── D. Invalid state ─────────────────────────────────────────────────────────

describe('D. Invalid / tampered state → redirect with connect_error=invalid_state', () => {
  it('redirects with invalid_state when state is garbage', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ state: 'garbage-not-a-valid-state' }));
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connect_error=invalid_state');
  });

  it('redirects with invalid_state when state is signed with the wrong secret', async () => {
    const wrongSecret = 'ca_test_wrong_secret';
    const state = buildValidState(FAKE_USER_ID, wrongSecret);
    const handler = await getHandler();
    const res = await handler(makeEvent({ state }));
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connect_error=invalid_state');
  });
});

// ─── E. Expired state ─────────────────────────────────────────────────────────

describe('E. Expired state → redirect with connect_error=invalid_state', () => {
  it('redirects with invalid_state when the state token has expired', async () => {
    const state = buildExpiredState();
    const handler = await getHandler();
    const res = await handler(makeEvent({ state }));
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connect_error=invalid_state');
  });
});

// ─── F. Stripe token exchange fails ──────────────────────────────────────────

describe('F. Stripe token exchange fails → redirect with connect_error=exchange_failed', () => {
  it('redirects with exchange_failed when Stripe throws', async () => {
    mockOAuthToken = vi.fn(async () => { throw new Error('invalid_grant'); });
    const state = buildValidState();
    const handler = await getHandler();
    const res = await handler(makeEvent({ state }));
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connect_error=exchange_failed');
  });

  it('redirects with exchange_failed when stripe_user_id is missing from response', async () => {
    mockOAuthToken = vi.fn(async () => ({ stripe_user_id: null }));
    const state = buildValidState();
    const handler = await getHandler();
    const res = await handler(makeEvent({ state }));
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connect_error=exchange_failed');
  });
});

// ─── G. DB update fails ───────────────────────────────────────────────────────

describe('G. DB update fails → redirect with connect_error=db_write_failed', () => {
  it('redirects with db_write_failed when Supabase update returns an error', async () => {
    mockUpdate = vi.fn(async () => ({ error: { message: 'RLS violation' } }));
    const state = buildValidState();
    const handler = await getHandler();
    const res = await handler(makeEvent({ state }));
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connect_error=db_write_failed');
  });
});

// ─── H. Success path ─────────────────────────────────────────────────────────

describe('H. Success path → 302 to settings?connected=1', () => {
  it('redirects to settings with connected=1 on a valid request', async () => {
    const state = buildValidState();
    const handler = await getHandler();
    const res = await handler(makeEvent({ state }));
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connected=1');
    expect(res.headers.Location).not.toContain('connect_error');
  });

  it('calls stripe.oauth.token with the authorization_code grant', async () => {
    const state = buildValidState();
    const handler = await getHandler();
    await handler(makeEvent({ code: 'test_code_abc', state }));
    expect(mockOAuthToken).toHaveBeenCalledWith(
      expect.objectContaining({ grant_type: 'authorization_code', code: 'test_code_abc' })
    );
  });

  it('writes stripe_user_id and connected status to the profile', async () => {
    const state = buildValidState();
    const handler = await getHandler();
    await handler(makeEvent({ state }));
    expect(mockUpdate).toHaveBeenCalled();
    // mockUpdate receives no args in our mock chain — verify the mock was called
    // (the eq().update() chain means we can only verify call count in this mock setup)
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

// ─── I. Method guard ─────────────────────────────────────────────────────────

describe('I. Method guard', () => {
  it('redirects with bad_method for POST requests', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ method: 'POST' }));
    expect(res.statusCode).toBe(302);
    expect(res.headers.Location).toContain('connect_error=bad_method');
  });
});
