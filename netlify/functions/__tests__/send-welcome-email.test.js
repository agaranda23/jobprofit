/**
 * Tests for netlify/functions/send-welcome-email.js
 *
 * No network, no Supabase connection. All DB and Resend calls are mocked.
 * Pattern: pure-logic + mocked I/O, matches the project's no-DOM test convention.
 *
 * Covers:
 *   A. No-op without RESEND_API_KEY — must return 200 { skipped: 'no_api_key' }
 *   B. Auth guard — 401 on missing / invalid JWT
 *   C. Skip phone-OTP users — no email address → 200 { skipped: 'no_email' }
 *   D. Idempotency — welcome_email_sent_at already set → skipped: 'already_sent'
 *   E. Claim update failure — DB error on the guarded UPDATE → 502
 *   F. Email payload shape — correct fields sent to Resend
 *   G. Success path — returns 200 { sent: true }
 *   H. Resend API failure — rolls back claim, returns 502
 *   I. Email content helpers — buildEmailHtml / buildEmailText shape validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Constants ─────────────────────────────────────────────────────────────────
const FAKE_URL = 'https://test.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-key-test';
const FAKE_RESEND_KEY = 're_test_abc123';
const FAKE_USER_ID = 'user-uuid-1234-5678-abcd-ef0123456789';
const FAKE_TOKEN = 'valid-jwt-token';

// ── Supabase mock state ───────────────────────────────────────────────────────
// The handler calls:
//   1. adminClient.auth.getUser(token)
//   2. adminClient.from('profiles').select(...).eq(...).single()   — profile fetch
//   3. adminClient.from('profiles').update(...).eq(...).is(...)    — guarded claim
//   4. adminClient.from('profiles').update(...).eq(...) (rollback, only on Resend failure)
//
// We expose mockGetUser, mockProfileResult, and mockUpdateResult as module-level
// variables mutated per test.

let mockGetUser;
let mockProfileResult = null;   // { data, error }
let mockUpdateError   = null;   // error object or null
let mockRollbackError = null;   // error for the rollback update (second update call)
let updateCallCount   = 0;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: (...args) => mockGetUser(...args),
    },
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          is:     vi.fn().mockReturnThis(),
          single: vi.fn(async () => mockProfileResult),
          update: vi.fn((_payload) => ({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn(async () => {
              updateCallCount++;
              // 1st update = claim;  subsequent = rollback
              const err = updateCallCount === 1 ? mockUpdateError : mockRollbackError;
              return { error: err ?? null };
            }),
          })),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        is:     vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({ data: null, error: null })),
        update: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          is: vi.fn(async () => ({ error: null })),
        })),
      };
    }),
  })),
}));

// ── fetch mock (Resend API) ───────────────────────────────────────────────────
let mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Default profile ───────────────────────────────────────────────────────────
const DEFAULT_PROFILE = {
  email: 'tradesperson@example.com',
  first_name: 'Dave',
  welcome_email_sent_at: null,
};

function makeResendSuccess() {
  return { ok: true, json: async () => ({ id: 're_abc123' }) };
}

function makeResendFailure(status = 422) {
  return { ok: false, status, text: async () => 'Unprocessable Entity' };
}

async function getHandler() {
  const mod = await import('../send-welcome-email.js');
  return mod.handler;
}

function makeEvent(authToken = FAKE_TOKEN, method = 'POST') {
  return {
    httpMethod: method,
    headers: { authorization: `Bearer ${authToken}` },
    body: null,
  };
}

function primeHappyPath(profileOverride = {}) {
  mockGetUser = vi.fn().mockResolvedValue({ data: { user: { id: FAKE_USER_ID } }, error: null });
  mockProfileResult = { data: { ...DEFAULT_PROFILE, ...profileOverride }, error: null };
  mockUpdateError = null;
  mockRollbackError = null;
  updateCallCount = 0;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeEach(() => {
  process.env.VITE_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  process.env.RESEND_API_KEY = FAKE_RESEND_KEY;

  primeHappyPath();
  mockFetch.mockResolvedValue(makeResendSuccess());
  vi.clearAllMocks();
  // Re-prime after clearAllMocks wipes mockFetch / mockGetUser implementations
  primeHappyPath();
  mockFetch.mockResolvedValue(makeResendSuccess());
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.RESEND_API_KEY;
  vi.resetModules();
});

// ─── A. No-op without RESEND_API_KEY ─────────────────────────────────────────

describe('A. No-op without RESEND_API_KEY', () => {
  it('returns 200 { skipped: no_api_key } when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('no_api_key');
  });

  it('does not call Supabase or Resend when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY;
    const handler = await getHandler();
    await handler(makeEvent());
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('returns 200 for OPTIONS preflight regardless of API key', async () => {
    delete process.env.RESEND_API_KEY;
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'OPTIONS', headers: {}, body: '' });
    expect(res.statusCode).toBe(200);
  });
});

// ─── B. Auth guard ────────────────────────────────────────────────────────────

describe('B. Auth guard', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'POST', headers: {}, body: null });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/unauthorized/i);
  });

  it('returns 401 when JWT verification fails', async () => {
    mockGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid token' } });
    const handler = await getHandler();
    const res = await handler(makeEvent('bad-token'));
    expect(res.statusCode).toBe(401);
  });

  it('returns 405 for non-POST methods', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent(FAKE_TOKEN, 'GET'));
    expect(res.statusCode).toBe(405);
  });

  it('returns 500 when SUPABASE env vars are missing', async () => {
    delete process.env.VITE_SUPABASE_URL;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });
});

// ─── C. Skip phone-OTP users with no email ───────────────────────────────────

describe('C. Skip phone-OTP users — no email', () => {
  it('returns 200 { skipped: no_email } when profile has no email', async () => {
    primeHappyPath({ email: null });
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('no_email');
  });

  it('returns 200 { skipped: no_email } when email is empty string', async () => {
    primeHappyPath({ email: '' });
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('no_email');
  });

  it('returns 200 { skipped: no_email } when email has no @', async () => {
    primeHappyPath({ email: 'notanemail' });
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('no_email');
  });

  it('does not call Resend when email is absent', async () => {
    primeHappyPath({ email: null });
    const handler = await getHandler();
    await handler(makeEvent());
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── D. Idempotency — already sent ───────────────────────────────────────────

describe('D. Idempotency — already sent', () => {
  it('returns 200 { skipped: already_sent } when welcome_email_sent_at is set', async () => {
    primeHappyPath({ welcome_email_sent_at: '2026-06-01T10:00:00.000Z' });
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('already_sent');
  });

  it('does not call Resend when already_sent', async () => {
    primeHappyPath({ welcome_email_sent_at: '2026-06-01T10:00:00.000Z' });
    const handler = await getHandler();
    await handler(makeEvent());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not attempt the guarded UPDATE when already_sent', async () => {
    primeHappyPath({ welcome_email_sent_at: '2026-06-01T10:00:00.000Z' });
    const handler = await getHandler();
    await handler(makeEvent());
    expect(updateCallCount).toBe(0);
  });
});

// ─── E. Claim update failure ──────────────────────────────────────────────────

describe('E. Claim update DB failure', () => {
  it('returns 502 when the guarded UPDATE returns an error', async () => {
    mockUpdateError = { message: 'column does not exist' };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/database/i);
  });

  it('does not call Resend when the claim UPDATE fails', async () => {
    mockUpdateError = { message: 'constraint violation' };
    const handler = await getHandler();
    await handler(makeEvent());
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── F. Email payload shape ───────────────────────────────────────────────────

describe('F. Email payload shape sent to Resend', () => {
  it('sends to the user email address', async () => {
    let capturedBody = null;
    mockFetch.mockImplementationOnce(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResendSuccess();
    });
    const handler = await getHandler();
    await handler(makeEvent());
    expect(capturedBody).not.toBeNull();
    expect(capturedBody.to).toContain('tradesperson@example.com');
  });

  it('sends from the correct from address', async () => {
    let capturedBody = null;
    mockFetch.mockImplementationOnce(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResendSuccess();
    });
    const handler = await getHandler();
    await handler(makeEvent());
    expect(capturedBody.from).toContain('OHNAR');
  });

  it('uses the expected subject line', async () => {
    let capturedBody = null;
    mockFetch.mockImplementationOnce(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResendSuccess();
    });
    const handler = await getHandler();
    await handler(makeEvent());
    expect(capturedBody.subject).toMatch(/get you paid faster/i);
  });

  it('includes both html and text fields', async () => {
    let capturedBody = null;
    mockFetch.mockImplementationOnce(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResendSuccess();
    });
    const handler = await getHandler();
    await handler(makeEvent());
    expect(typeof capturedBody.html).toBe('string');
    expect(capturedBody.html.length).toBeGreaterThan(100);
    expect(typeof capturedBody.text).toBe('string');
    expect(capturedBody.text.length).toBeGreaterThan(50);
  });

  it('personalises with first_name when available', async () => {
    let capturedBody = null;
    mockFetch.mockImplementationOnce(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResendSuccess();
    });
    const handler = await getHandler();
    await handler(makeEvent());
    expect(capturedBody.html).toContain('Hi Dave,');
    expect(capturedBody.text).toContain('Hi Dave,');
  });

  it('falls back to generic greeting when first_name is null', async () => {
    primeHappyPath({ first_name: null });
    let capturedBody = null;
    mockFetch.mockImplementationOnce(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeResendSuccess();
    });
    const handler = await getHandler();
    await handler(makeEvent());
    expect(capturedBody.html).toContain('Hi there,');
    expect(capturedBody.text).toContain('Hi there,');
  });

  it('posts to the Resend API endpoint', async () => {
    let capturedUrl = null;
    mockFetch.mockImplementationOnce(async (url) => {
      capturedUrl = url;
      return makeResendSuccess();
    });
    const handler = await getHandler();
    await handler(makeEvent());
    expect(capturedUrl).toBe('https://api.resend.com/emails');
  });
});

// ─── G. Success path ──────────────────────────────────────────────────────────

describe('G. Success path', () => {
  it('returns 200 { sent: true } on a clean first send', async () => {
    mockFetch.mockResolvedValueOnce(makeResendSuccess());
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).sent).toBe(true);
  });

  it('sends the Authorization header to Resend with the API key', async () => {
    let capturedHeaders = null;
    mockFetch.mockImplementationOnce(async (_url, opts) => {
      capturedHeaders = opts.headers;
      return makeResendSuccess();
    });
    const handler = await getHandler();
    await handler(makeEvent());
    expect(capturedHeaders['Authorization']).toBe(`Bearer ${FAKE_RESEND_KEY}`);
  });
});

// ─── H. Resend API failure ────────────────────────────────────────────────────

describe('H. Resend API failure', () => {
  it('returns 502 when Resend returns a non-2xx status', async () => {
    mockFetch.mockResolvedValueOnce(makeResendFailure(422));
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/422/);
  });

  it('returns 502 when fetch to Resend throws (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(502);
  });
});

// ─── I. Email content helpers ─────────────────────────────────────────────────

describe('I. buildEmailHtml and buildEmailText shape', () => {
  it('buildEmailHtml contains the spine line', async () => {
    const { buildEmailHtml } = await import('../send-welcome-email.js');
    const html = buildEmailHtml('Dave');
    expect(html).toContain('A spreadsheet tells you what you charged');
    expect(html).toContain('OHNAR tells you what you made');
  });

  it('buildEmailHtml contains the CTA linking to ohnar.co.uk', async () => {
    const { buildEmailHtml } = await import('../send-welcome-email.js');
    const html = buildEmailHtml(null);
    expect(html).toContain('ohnar.co.uk');
  });

  it('buildEmailHtml contains on-brand green colour', async () => {
    const { buildEmailHtml } = await import('../send-welcome-email.js');
    const html = buildEmailHtml(null);
    expect(html).toContain('#2563EB');
  });

  it('buildEmailText contains the spine line', async () => {
    const { buildEmailText } = await import('../send-welcome-email.js');
    const text = buildEmailText('Dave');
    expect(text).toContain('A spreadsheet tells you what you charged');
    expect(text).toContain('OHNAR tells you what you made');
  });

  it('buildEmailText contains the app URL', async () => {
    const { buildEmailText } = await import('../send-welcome-email.js');
    const text = buildEmailText(null);
    expect(text).toContain('ohnar.co.uk');
  });

  it('buildEmailText contains the Founding Member offer', async () => {
    const { buildEmailText } = await import('../send-welcome-email.js');
    const text = buildEmailText(null);
    expect(text).toContain('Founding Member');
  });

  it('buildEmailText contains the sign-off from Alan', async () => {
    const { buildEmailText } = await import('../send-welcome-email.js');
    const text = buildEmailText(null);
    expect(text).toContain('Alan, OHNAR');
  });
});
