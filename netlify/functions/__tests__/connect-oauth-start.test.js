/**
 * Tests for netlify/functions/connect-oauth-start.js
 *
 * No network calls. Supabase is mocked. The function generates a Stripe
 * Connect OAuth URL — no Stripe SDK call required (the URL is built locally).
 *
 * Covers:
 *   A. Missing env vars → 500
 *   B. Missing/invalid auth token → 401
 *   C. Invalid Supabase token → 401
 *   D. Success path → 200 { url } with expected Stripe OAuth structure
 *   E. Method guard (GET → 405, OPTIONS → 200)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_URL        = 'https://abc.supabase.co';
const FAKE_SRK        = 'service-role-key-fake';
const FAKE_CLIENT_ID  = 'ca_test_fake123';
const FAKE_STRIPE_SK  = 'sk_test_fake';
const FAKE_USER_ID    = 'user-uuid-abc';

// ── Supabase mock ─────────────────────────────────────────────────────────────
let mockGetUser = vi.fn(async () => ({
  data: { user: { id: FAKE_USER_ID, email: 'trader@example.com' } },
  error: null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: (...args) => mockGetUser(...args),
    },
  })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent({ token = 'Bearer tok', origin = 'https://ohnar.co.uk' } = {}) {
  return {
    httpMethod: 'POST',
    body: '{}',
    headers: {
      authorization: token,
      origin,
    },
  };
}

async function getHandler() {
  const mod = await import('../connect-oauth-start.js');
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
    data: { user: { id: FAKE_USER_ID, email: 'trader@example.com' } },
    error: null,
  }));
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
    const res = await handler({
      httpMethod: 'POST',
      body: '{}',
      headers: { authorization: 'Basic abc' },
    });
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

// ─── D. Success path → 200 { url } ───────────────────────────────────────────

describe('D. Success path', () => {
  it('returns 200 with a url field', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.url).toBe('string');
    expect(body.url.length).toBeGreaterThan(0);
  });

  it('url starts with the Stripe Connect OAuth endpoint', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    const { url } = JSON.parse(res.body);
    expect(url).toMatch(/^https:\/\/connect\.stripe\.com\/oauth\/authorize/);
  });

  it('url includes client_id matching the env var', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    const { url } = JSON.parse(res.body);
    expect(url).toContain(`client_id=${FAKE_CLIENT_ID}`);
  });

  it('url includes a non-empty state param', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    const { url } = JSON.parse(res.body);
    const parsed = new URL(url);
    const state = parsed.searchParams.get('state');
    expect(state).toBeTruthy();
    expect(state.length).toBeGreaterThan(10);
  });

  it('url includes response_type=code and scope=read_write', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    const { url } = JSON.parse(res.body);
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=read_write');
  });

  it('generates a different state token on each call (CSRF nonce)', async () => {
    const handler = await getHandler();
    const [res1, res2] = await Promise.all([handler(makeEvent()), handler(makeEvent())]);
    const url1 = JSON.parse(res1.body).url;
    const url2 = JSON.parse(res2.body).url;
    const state1 = new URL(url1).searchParams.get('state');
    const state2 = new URL(url2).searchParams.get('state');
    expect(state1).not.toBe(state2);
  });
});

// ─── E. Method guard ─────────────────────────────────────────────────────────

describe('E. Method guard', () => {
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
