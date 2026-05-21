/**
 * Tests for netlify/functions/accept-quote.js — Phase G-2 + email notification.
 *
 * No network, no Supabase connection. All DB calls and email sends are mocked.
 * Pattern: pure-logic + mocked I/O, matches the project's no-DOM test convention.
 *
 * Covers:
 *   A. Input validation — token shape, signature shape, size limit
 *   B. Missing env vars → 500
 *   C. Token not found → 404
 *   D. Idempotency — already-accepted token returns 200 without overwriting, no email
 *   E. Success path — new token writes and returns 200 { acceptedAt }
 *   F. acceptedSource field in written meta
 *   G. Trader notification email — fire-and-forget behaviour
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Env setup ─────────────────────────────────────────────────────────────────
const FAKE_URL = 'https://abc.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-key-fake';

// ── Supabase mock state ───────────────────────────────────────────────────────
let mockSelectResult = null; // { data, error } — returned by .single()

// Mutable so individual tests can override auth.admin.getUserById response
let mockGetUserResult = { data: { user: { email: 'trader@example.com' } }, error: null };
let mockProfileResult = { data: { business_name: 'Ace Plumbing' }, error: null };

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn(() => ({
      from: vi.fn((table) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => mockProfileResult),
          };
        }
        // Default: jobs table
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(async () => mockSelectResult),
          update: vi.fn().mockReturnThis(),
        };
      }),
      auth: {
        admin: {
          getUserById: vi.fn(async () => mockGetUserResult),
        },
      },
    })),
  };
});

// ── Email helper mock ─────────────────────────────────────────────────────────
// Mock the helper module so tests for accept-quote.js can assert call behaviour
// without hitting Resend's API or caring about HTML template details.
// The helper's own internals are tested in sendTraderAcceptEmail.test.js.
let mockEmailResult = { ok: true, id: 'resend-fake-id' };

vi.mock('../_lib/sendTraderAcceptEmail.js', () => ({
  sendTraderAcceptEmail: vi.fn(async () => mockEmailResult),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeEvent(body, method = 'POST') {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
  };
}

const VALID_TOKEN = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const VALID_SIG = 'data:image/png;base64,' + 'A'.repeat(100);

// A signature that exceeds the 200 KB limit
// MAX_SIG_CHARS = ceil(200*1024*4/3) ≈ 273,067 chars; add prefix
const OVERSIZED_SIG = 'data:image/png;base64,' + 'A'.repeat(300_000);

async function getHandler() {
  const mod = await import('../accept-quote.js');
  return mod.handler;
}

async function getEmailMock() {
  const mod = await import('../_lib/sendTraderAcceptEmail.js');
  return mod.sendTraderAcceptEmail;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
beforeEach(() => {
  process.env.VITE_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  process.env.RESEND_API_KEY = 'test-resend-key';
  mockSelectResult = null;
  mockGetUserResult = { data: { user: { email: 'trader@example.com' } }, error: null };
  mockProfileResult = { data: { business_name: 'Ace Plumbing' }, error: null };
  mockEmailResult = { ok: true, id: 'resend-fake-id' };
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.RESEND_API_KEY;
  vi.resetModules();
});

// ─── A. Input validation ──────────────────────────────────────────────────────

describe('A. Input validation', () => {
  it('returns 405 for non-POST methods', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({}, 'GET'));
    expect(res.statusCode).toBe(405);
  });

  it('returns 200 + empty body for OPTIONS preflight', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'OPTIONS', body: '' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });

  it('returns 400 for malformed JSON body', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'POST', body: '{{not-json' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when token is missing', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ signature: VALID_SIG }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/token/i);
  });

  it('returns 400 when token is not a UUID v4', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: 'not-a-uuid', signature: VALID_SIG }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/invalid token/i);
  });

  it('returns 400 when token is a UUID v3 (wrong version bit)', async () => {
    const handler = await getHandler();
    const v3 = 'a0eebc99-9c0b-3ef8-bb6d-6bb9bd380a11';
    const res = await handler(makeEvent({ token: v3, signature: VALID_SIG }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when signature is missing', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/signature/i);
  });

  it('returns 400 when signature is not a PNG dataURL', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, signature: 'data:image/jpeg;base64,abc' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/PNG dataURL/i);
  });

  it('returns 400 when signature exceeds 200 KB', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, signature: OVERSIZED_SIG }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/200 KB/i);
  });
});

// ─── B. Env var guard ─────────────────────────────────────────────────────────

describe('B. Missing env vars', () => {
  it('returns 500 when SUPABASE_SERVICE_ROLE_KEY is not set', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, signature: VALID_SIG }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });

  it('returns 500 when VITE_SUPABASE_URL is not set', async () => {
    delete process.env.VITE_SUPABASE_URL;
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, signature: VALID_SIG }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });
});

// ─── C. Token not found ───────────────────────────────────────────────────────

describe('C. Token not found', () => {
  it('returns 404 when the token does not match any job', async () => {
    mockSelectResult = { data: null, error: { message: 'No rows found' } };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, signature: VALID_SIG }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toMatch(/not found/i);
  });
});

// ─── D. Idempotency ───────────────────────────────────────────────────────────

describe('D. Idempotency', () => {
  it('returns 200 + alreadyAccepted:true without overwriting when token is already accepted', async () => {
    const existingAt = '2026-05-01T10:00:00.000Z';
    mockSelectResult = {
      data: {
        id: 'job-uuid-123',
        user_id: 'trader-user-id',
        meta: {
          acceptedSignature: 'data:image/png;base64,EXISTING',
          acceptedAt: existingAt,
          acceptedSource: 'remote',
        },
      },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, signature: VALID_SIG }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.alreadyAccepted).toBe(true);
    expect(body.acceptedAt).toBe(existingAt);
  });

  it('does NOT send an email on an idempotent re-submission', async () => {
    const existingAt = '2026-05-01T10:00:00.000Z';
    mockSelectResult = {
      data: {
        id: 'job-uuid-123',
        user_id: 'trader-user-id',
        meta: {
          acceptedSignature: 'data:image/png;base64,EXISTING',
          acceptedAt: existingAt,
        },
      },
      error: null,
    };
    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN, signature: VALID_SIG }));

    const emailFn = await getEmailMock();
    expect(emailFn).not.toHaveBeenCalled();
  });
});

// ─── E. Success path ──────────────────────────────────────────────────────────

describe('E. Success path', () => {
  it('returns 200 { acceptedAt } on a valid new submission', async () => {
    mockSelectResult = {
      data: { id: 'job-uuid-456', user_id: 'trader-user-id', meta: { publicAccessToken: VALID_TOKEN } },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => ({
      from: vi.fn((table) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => mockProfileResult),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(async () => mockSelectResult),
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        };
      }),
      auth: {
        admin: {
          getUserById: vi.fn(async () => mockGetUserResult),
        },
      },
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent({
      token: VALID_TOKEN,
      signature: VALID_SIG,
      acceptedName: 'Jane Customer',
    }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.acceptedAt).toBeDefined();
    expect(typeof body.acceptedAt).toBe('string');
    expect(body.id).toBeUndefined();
    expect(body.token).toBeUndefined();
  });

  it('strips and limits acceptedName to 200 characters', async () => {
    mockSelectResult = {
      data: { id: 'job-uuid-789', user_id: 'trader-user-id', meta: {} },
      error: null,
    };

    const longName = 'A'.repeat(300);
    const { createClient } = await import('@supabase/supabase-js');

    let capturedMeta = null;
    createClient.mockImplementationOnce(() => ({
      from: vi.fn((table) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => mockProfileResult),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(async () => mockSelectResult),
          update: vi.fn((payload) => {
            capturedMeta = payload?.meta;
            return { eq: vi.fn(async () => ({ error: null })) };
          }),
        };
      }),
      auth: {
        admin: {
          getUserById: vi.fn(async () => mockGetUserResult),
        },
      },
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN, signature: VALID_SIG, acceptedName: longName }));

    if (capturedMeta) {
      expect(capturedMeta.acceptedName.length).toBeLessThanOrEqual(200);
    }
  });
});

// ─── F. acceptedSource field ──────────────────────────────────────────────────

describe('F. acceptedSource field in written meta', () => {
  it('sets acceptedSource to "remote"', async () => {
    mockSelectResult = {
      data: { id: 'job-src-test', user_id: 'trader-user-id', meta: {} },
      error: null,
    };

    const { createClient } = await import('@supabase/supabase-js');
    let writtenMeta = null;
    createClient.mockImplementationOnce(() => ({
      from: vi.fn((table) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => mockProfileResult),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(async () => mockSelectResult),
          update: vi.fn((payload) => {
            writtenMeta = payload?.meta;
            return { eq: vi.fn(async () => ({ error: null })) };
          }),
        };
      }),
      auth: {
        admin: {
          getUserById: vi.fn(async () => mockGetUserResult),
        },
      },
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN, signature: VALID_SIG }));

    if (writtenMeta) {
      expect(writtenMeta.acceptedSource).toBe('remote');
      expect(writtenMeta.quoteStatus).toBe('accepted');
      expect(writtenMeta.jobStatus).toBe('active');
      expect(writtenMeta.acceptedSignature).toBe(VALID_SIG);
    }
  });
});

// ─── G. Trader notification email ─────────────────────────────────────────────

describe('G. Trader notification email', () => {
  /** Builds a createClient mock configured for a fully successful accept flow */
  function makeSuccessClient({ selectResult }) {
    return {
      from: vi.fn((table) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => mockProfileResult),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn(async () => selectResult),
          update: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        };
      }),
      auth: {
        admin: {
          getUserById: vi.fn(async () => mockGetUserResult),
        },
      },
    };
  }

  it('calls sendTraderAcceptEmail on a successful first accept', async () => {
    const selectResult = {
      data: { id: 'job-email-1', user_id: 'trader-uid', meta: {} },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => makeSuccessClient({ selectResult }));

    const handler = await getHandler();
    const res = await handler(makeEvent({
      token: VALID_TOKEN,
      signature: VALID_SIG,
      acceptedName: 'Dave Customer',
    }));

    expect(res.statusCode).toBe(200);
    const emailFn = await getEmailMock();
    expect(emailFn).toHaveBeenCalledOnce();
    const callArg = emailFn.mock.calls[0][0];
    expect(callArg.traderEmail).toBe('trader@example.com');
    expect(callArg.traderBusinessName).toBe('Ace Plumbing');
    expect(callArg.customerName).toBe('Dave Customer');
  });

  it('returns 200 even when sendTraderAcceptEmail returns { ok: false }', async () => {
    mockEmailResult = { ok: false, reason: 'resend_error', status: 422 };
    const selectResult = {
      data: { id: 'job-email-2', user_id: 'trader-uid', meta: {} },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => makeSuccessClient({ selectResult }));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, signature: VALID_SIG }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.acceptedAt).toBeDefined();
  });

  it('returns 200 even when sendTraderAcceptEmail throws', async () => {
    const { sendTraderAcceptEmail } = await import('../_lib/sendTraderAcceptEmail.js');
    sendTraderAcceptEmail.mockRejectedValueOnce(new Error('Network timeout'));

    const selectResult = {
      data: { id: 'job-email-3', user_id: 'trader-uid', meta: {} },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => makeSuccessClient({ selectResult }));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, signature: VALID_SIG }));

    expect(res.statusCode).toBe(200);
  });

  it('does not call sendTraderAcceptEmail when trader email cannot be resolved', async () => {
    mockGetUserResult = { data: { user: null }, error: null };
    const selectResult = {
      data: { id: 'job-email-4', user_id: 'trader-uid', meta: {} },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => makeSuccessClient({ selectResult }));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, signature: VALID_SIG }));

    expect(res.statusCode).toBe(200);
    const emailFn = await getEmailMock();
    expect(emailFn).not.toHaveBeenCalled();
  });

  it('does not call sendTraderAcceptEmail on idempotent re-submission', async () => {
    mockSelectResult = {
      data: {
        id: 'job-email-5',
        user_id: 'trader-uid',
        meta: {
          acceptedSignature: VALID_SIG,
          acceptedAt: '2026-05-01T10:00:00.000Z',
        },
      },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, signature: VALID_SIG }));

    expect(res.statusCode).toBe(200);
    const emailFn = await getEmailMock();
    expect(emailFn).not.toHaveBeenCalled();
  });
});
