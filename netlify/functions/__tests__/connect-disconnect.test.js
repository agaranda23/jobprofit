/**
 * Tests for netlify/functions/connect-disconnect.js
 *
 * No network calls. Stripe and Supabase are both mocked.
 *
 * Covers:
 *   A. Missing env vars → 500
 *   B. Missing/invalid auth token → 401
 *   C. Invalid Supabase token → 401
 *   D. No connected Stripe account (no stripe_user_id) → 404
 *   E. Stripe deauthorize throws → still clears DB (treat as already disconnected)
 *   F. DB update fails → 502
 *   G. Success path → 200 { disconnected: true, activeLinkCount: 0 }
 *   H. Method guard
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_URL        = 'https://abc.supabase.co';
const FAKE_SRK        = 'service-role-key-fake';
const FAKE_CLIENT_ID  = 'ca_test_fake123';
const FAKE_STRIPE_SK  = 'sk_test_fake';
const FAKE_USER_ID    = 'user-uuid-abc';
const FAKE_STRIPE_UID = 'acct_testfake456';

// ── Stripe mock ───────────────────────────────────────────────────────────────
let mockDeauthorize = vi.fn(async () => ({}));

vi.mock('stripe', () => {
  function MockStripe() {
    return {
      oauth: {
        deauthorize: (...args) => mockDeauthorize(...args),
      },
    };
  }
  return { default: MockStripe };
});

// ── Supabase mock ─────────────────────────────────────────────────────────────
let mockGetUser  = vi.fn(async () => ({
  data: { user: { id: FAKE_USER_ID } },
  error: null,
}));
let mockProfileResult = {
  data: { stripe_user_id: FAKE_STRIPE_UID },
  error: null,
};
let mockUpdateResult = { error: null };

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: (...args) => mockGetUser(...args),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      update: vi.fn(() => ({
        eq: vi.fn(async () => mockUpdateResult),
      })),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => mockProfileResult),
    })),
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent({ token = 'Bearer tok' } = {}) {
  return {
    httpMethod: 'POST',
    body: '{}',
    headers: { authorization: token },
  };
}

async function getHandler() {
  const mod = await import('../connect-disconnect.js');
  return mod.handler;
}

function setEnv() {
  process.env.STRIPE_SECRET_KEY         = FAKE_STRIPE_SK;
  process.env.STRIPE_CONNECT_CLIENT_ID  = FAKE_CLIENT_ID;
  process.env.VITE_SUPABASE_URL         = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SRK;
}

function clearEnv() {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_CONNECT_CLIENT_ID;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

beforeEach(() => {
  setEnv();
  mockGetUser = vi.fn(async () => ({
    data: { user: { id: FAKE_USER_ID } },
    error: null,
  }));
  mockProfileResult = { data: { stripe_user_id: FAKE_STRIPE_UID }, error: null };
  mockUpdateResult = { error: null };
  mockDeauthorize = vi.fn(async () => ({}));
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

  it('returns 500 when STRIPE_CONNECT_CLIENT_ID is absent', async () => {
    delete process.env.STRIPE_CONNECT_CLIENT_ID;
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
});

// ─── C. Invalid Supabase token → 401 ─────────────────────────────────────────

describe('C. Invalid Supabase token → 401', () => {
  it('returns 401 when Supabase rejects the token', async () => {
    mockGetUser = vi.fn(async () => ({
      data: { user: null },
      error: { message: 'Invalid JWT' },
    }));
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: 'Bearer invalid' }));
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/invalid|expired/i);
  });
});

// ─── D. No connected account → 404 ───────────────────────────────────────────

describe('D. No connected Stripe account → 404', () => {
  it('returns 404 when stripe_user_id is null on the profile', async () => {
    mockProfileResult = { data: { stripe_user_id: null }, error: null };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toMatch(/not found|no connected/i);
  });

  it('returns 404 when profile has no stripe_user_id field', async () => {
    mockProfileResult = { data: {}, error: null };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(404);
  });
});

// ─── E. Stripe deauthorize throws → still clears DB ─────────────────────────

describe('E. Stripe deauthorize throws → still clears DB (no-op, already disconnected)', () => {
  it('returns 200 even when Stripe deauthorize throws (already disconnected)', async () => {
    mockDeauthorize = vi.fn(async () => { throw new Error('account not connected'); });
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.disconnected).toBe(true);
  });
});

// ─── F. DB update fails → 502 ────────────────────────────────────────────────

describe('F. DB update fails → 502', () => {
  it('returns 502 when Supabase update fails', async () => {
    mockUpdateResult = { error: { message: 'DB error' } };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/could not update|try again/i);
  });
});

// ─── G. Success path → 200 { disconnected: true, activeLinkCount: 0 } ────────

describe('G. Success path', () => {
  it('returns 200 with disconnected: true', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.disconnected).toBe(true);
  });

  it('returns activeLinkCount: 0 (placeholder until PR 2)', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    const body = JSON.parse(res.body);
    expect(body.activeLinkCount).toBe(0);
  });

  it('calls stripe.oauth.deauthorize with the correct args', async () => {
    const handler = await getHandler();
    await handler(makeEvent());
    expect(mockDeauthorize).toHaveBeenCalledWith({
      client_id: FAKE_CLIENT_ID,
      stripe_user_id: FAKE_STRIPE_UID,
    });
  });
});

// ─── H. Method guard ─────────────────────────────────────────────────────────

describe('H. Method guard', () => {
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
