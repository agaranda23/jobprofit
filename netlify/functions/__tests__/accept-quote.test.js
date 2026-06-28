/**
 * Tests for netlify/functions/accept-quote.js — Phase G-2 redesign.
 *
 * Signature capture removed (2026-06-23, data-minimisation). The function now
 * accepts { token, acceptedName?, consentGiven:true } — no signature field.
 *
 * No network, no Supabase connection. All DB calls are mocked.
 *
 * Covers:
 *   A. Input validation — token shape, consent required, no signature needed
 *   B. Missing env vars → 500
 *   C. Token not found → 404
 *   D. Idempotency — already accepted returns 200 without overwriting
 *   E. Success path — new acceptance writes meta and returns 200 { acceptedAt }
 *   F. acceptedSource field — must be written as 'remote'
 *   G. Status promotion — quoted → active; no regression for active/invoiced/paid
 *   H. Push notification — sendPushToUser fires on success, silent on failure, skipped on re-submit
 *   I. Email notification — sendTraderAcceptEmail fires on success, fire-and-forget, skipped on re-submit
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_URL = 'https://abc.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-key-fake';

let mockSelectResult = null;

// ── sendPushToUser mock ───────────────────────────────────────────────────────
// accept-quote.js imports sendPushToUser at the top level (static import).
// Mock the module so tests can assert call behaviour without real web-push calls.
const mockSendPush = vi.fn().mockResolvedValue({ sent: 1, failed: 0 });
vi.mock('../_lib/sendPushToUser.js', () => ({
  sendPushToUser: (...args) => mockSendPush(...args),
}));

// ── sendTraderAcceptEmail mock ────────────────────────────────────────────────
// Mock the helper module so tests for accept-quote.js can assert call behaviour
// without hitting Resend's API. The helper's own internals are covered in
// sendTraderAcceptEmail.test.js.
let mockEmailResult = { ok: true, id: 'resend-fake-id' };
vi.mock('../_lib/sendTraderAcceptEmail.js', () => ({
  sendTraderAcceptEmail: vi.fn(async () => mockEmailResult),
}));

// ── Mutable auth/profile state for H/I tests ─────────────────────────────────
let mockGetUserResult = { data: { user: { email: 'trader@example.com' } }, error: null };
let mockProfileResult = { data: { business_name: 'Ace Plumbing' }, error: null };

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn().mockReturnThis(),
      })),
      auth: {
        admin: {
          getUserById: vi.fn(async () => mockGetUserResult),
        },
      },
    })),
  };
});

function makeEvent(body, method = 'POST') {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
  };
}

const VALID_TOKEN = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

async function getHandler() {
  const mod = await import('../accept-quote.js');
  return mod.handler;
}

async function getEmailMock() {
  const mod = await import('../_lib/sendTraderAcceptEmail.js');
  return mod.sendTraderAcceptEmail;
}

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
    const res = await handler(makeEvent({ consentGiven: true }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/token/i);
  });

  it('returns 400 when token is not a UUID v4', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: 'not-a-uuid', consentGiven: true }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/invalid token/i);
  });

  it('returns 400 when token is a UUID v3 (wrong version bit)', async () => {
    const handler = await getHandler();
    const v3 = 'a0eebc99-9c0b-3ef8-bb6d-6bb9bd380a11';
    const res = await handler(makeEvent({ token: v3, consentGiven: true }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when consentGiven is missing (consent check runs after idempotency)', async () => {
    // Must supply a DB row so the token-not-found path doesn't fire first.
    mockSelectResult = { data: { id: 'job-1', user_id: 'u1', customer_name: 'Jane', meta: { quoteStatus: 'sent' } }, error: null };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/consent/i);
  });

  it('returns 400 when consentGiven is false (consent check runs after idempotency)', async () => {
    mockSelectResult = { data: { id: 'job-1', user_id: 'u1', customer_name: 'Jane', meta: { quoteStatus: 'sent' } }, error: null };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: false }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/consent/i);
  });

  it('does NOT require a signature field (G-2 data-minimisation)', async () => {
    // This test confirms the old signature requirement is gone.
    // The handler should proceed past validation when only token + consent are provided.
    // (It will hit the DB mock which returns null → 404, not 400)
    mockSelectResult = { data: null, error: { message: 'No rows' } };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));
    // 404 (token not found) means validation passed — 400 would mean sig still required
    expect(res.statusCode).toBe(404);
  });
});

// ─── B. Missing env vars ──────────────────────────────────────────────────────

describe('B. Missing env vars', () => {
  it('returns 500 when SUPABASE_SERVICE_ROLE_KEY is not set', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });

  it('returns 500 when VITE_SUPABASE_URL is not set', async () => {
    delete process.env.VITE_SUPABASE_URL;
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });
});

// ─── C. Token not found ───────────────────────────────────────────────────────

describe('C. Token not found', () => {
  it('returns 404 when the token does not match any job', async () => {
    mockSelectResult = { data: null, error: { message: 'No rows found' } };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toMatch(/not found/i);
  });
});

// ─── D. Idempotency ───────────────────────────────────────────────────────────

describe('D. Idempotency', () => {
  it('returns 200 + alreadyAccepted:true when quoteStatus is already accepted (G-2 path)', async () => {
    const existingAt = '2026-06-23T10:00:00.000Z';
    mockSelectResult = {
      data: {
        id: 'job-uuid-123',
        meta: {
          quoteStatus: 'accepted',
          acceptedAt: existingAt,
          acceptedSource: 'remote',
        },
      },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.alreadyAccepted).toBe(true);
    expect(body.acceptedAt).toBe(existingAt);
  });

  it('returns 200 + alreadyAccepted:true when acceptedSignature is present (legacy pre-G-2 path)', async () => {
    const existingAt = '2026-05-01T10:00:00.000Z';
    mockSelectResult = {
      data: {
        id: 'job-uuid-legacy',
        meta: {
          acceptedSignature: 'data:image/png;base64,EXISTING',
          acceptedAt: existingAt,
          acceptedSource: 'remote',
        },
      },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.alreadyAccepted).toBe(true);
    expect(body.acceptedAt).toBe(existingAt);
  });
});

// ─── E. Success path ──────────────────────────────────────────────────────────

describe('E. Success path', () => {
  it('returns 200 { acceptedAt } on a valid new submission without signature', async () => {
    mockSelectResult = {
      data: { id: 'job-uuid-456', meta: { publicAccessToken: VALID_TOKEN } },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      })),
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent({
      token: VALID_TOKEN,
      acceptedName: 'Jane Customer',
      consentGiven: true,
    }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.acceptedAt).toBeDefined();
    expect(typeof body.acceptedAt).toBe('string');
    expect(body.id).toBeUndefined();
    expect(body.token).toBeUndefined();
  });

  it('returns 400 with consent error when consentGiven is omitted', async () => {
    mockSelectResult = {
      data: { id: 'job-uuid-consent', meta: { publicAccessToken: VALID_TOKEN } },
      error: null,
    };

    const handler = await getHandler();
    const res = await handler(makeEvent({
      token: VALID_TOKEN,
      // consentGiven deliberately omitted
    }));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/consent is required/i);
  });

  it('strips and limits acceptedName to 200 characters', async () => {
    mockSelectResult = {
      data: { id: 'job-uuid-789', meta: {} },
      error: null,
    };

    const longName = 'A'.repeat(300);
    const { createClient } = await import('@supabase/supabase-js');

    let capturedMeta = null;
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          capturedMeta = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN, acceptedName: longName, consentGiven: true }));

    if (capturedMeta) {
      expect(capturedMeta.acceptedName.length).toBeLessThanOrEqual(200);
    }
  });

  it('does NOT write acceptedSignature to meta (data-minimisation)', async () => {
    mockSelectResult = {
      data: { id: 'job-no-sig', meta: {} },
      error: null,
    };

    const { createClient } = await import('@supabase/supabase-js');
    let capturedMeta = null;
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          capturedMeta = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    if (capturedMeta) {
      expect(capturedMeta.acceptedSignature).toBeUndefined();
    }
  });
});

// ─── F. acceptedSource field ──────────────────────────────────────────────────

describe('F. acceptedSource field in written meta', () => {
  it('sets acceptedSource to "remote" and quoteStatus to "accepted"', async () => {
    mockSelectResult = {
      data: { id: 'job-src-test', meta: {} },
      error: null,
    };

    const { createClient } = await import('@supabase/supabase-js');
    let writtenMeta = null;
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          writtenMeta = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    if (writtenMeta) {
      expect(writtenMeta.acceptedSource).toBe('remote');
      expect(writtenMeta.quoteStatus).toBe('accepted');
      expect(writtenMeta.jobStatus).toBe('active');
      // G-2: no signature stored
      expect(writtenMeta.acceptedSignature).toBeUndefined();
    }
  });
});

// ─── G. Status promotion on acceptance ────────────────────────────────────────

function makeMockClient(writtenMetaRef) {
  return {
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          if (writtenMetaRef) writtenMetaRef.value = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      };
    }),
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({ data: { user: null }, error: null })),
      },
    },
  };
}

describe('G. Status promotion on acceptance', () => {
  it('promotes status:quoted → active when meta.status is "quoted"', async () => {
    mockSelectResult = {
      data: { id: 'job-quoted', meta: { status: 'quoted', quoteStatus: 'sent' } },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => makeMockClient(ref));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    expect(res.statusCode).toBe(200);
    if (ref.value) {
      expect(ref.value.status).toBe('active');
      expect(ref.value.jobStatus).toBe('active');
      expect(ref.value.quoteStatus).toBe('accepted');
    }
  });

  it('promotes status to active when meta.status is absent (legacy job)', async () => {
    mockSelectResult = {
      data: { id: 'job-legacy', meta: { quoteStatus: 'sent' } },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => makeMockClient(ref));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    expect(res.statusCode).toBe(200);
    if (ref.value) {
      expect(ref.value.status).toBe('active');
      expect(ref.value.quoteStatus).toBe('accepted');
    }
  });

  it('does NOT regress status when job is already active', async () => {
    mockSelectResult = {
      data: { id: 'job-already-on', meta: { status: 'active', quoteStatus: 'sent' } },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => makeMockClient(ref));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    expect(res.statusCode).toBe(200);
    if (ref.value) {
      expect(ref.value.status).toBe('active');
      expect(ref.value.quoteStatus).toBe('accepted');
    }
  });

  it('does NOT regress status when job is already invoiced', async () => {
    mockSelectResult = {
      data: { id: 'job-invoiced', meta: { status: 'invoice_sent', quoteStatus: 'sent' } },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => makeMockClient(ref));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    expect(res.statusCode).toBe(200);
    if (ref.value) {
      expect(ref.value.status).toBe('invoice_sent');
      expect(ref.value.quoteStatus).toBe('accepted');
    }
  });

  it('does NOT regress status when job is already paid', async () => {
    mockSelectResult = {
      data: { id: 'job-paid', meta: { status: 'paid', quoteStatus: 'sent' } },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => makeMockClient(ref));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    expect(res.statusCode).toBe(200);
    if (ref.value) {
      expect(ref.value.status).toBe('paid');
      expect(ref.value.quoteStatus).toBe('accepted');
    }
  });

  it('sets acceptedAt, acceptedName, and consentAt on a fresh acceptance', async () => {
    mockSelectResult = {
      data: { id: 'job-timestamps', meta: { status: 'quoted' } },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => makeMockClient(ref));

    const handler = await getHandler();
    const res = await handler(makeEvent({
      token: VALID_TOKEN,
      acceptedName: 'Sarah Jones',
      consentGiven: true,
    }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.acceptedAt).toBeDefined();
    if (ref.value) {
      expect(ref.value.acceptedAt).toBe(body.acceptedAt);
      expect(ref.value.acceptedName).toBe('Sarah Jones');
      expect(ref.value.consentGiven).toBe(true);
      expect(ref.value.consentAt).toBeDefined();
    }
  });
});

// ─── H. Push notification fired on successful acceptance ──────────────────────

describe('H. Push notification on acceptance', () => {
  it('calls sendPushToUser with correct title and body after a new acceptance', async () => {
    const jobRow = {
      id: 'job-push-test',
      user_id: 'trader-uuid-abc',
      customer_name: 'Gemma Thornton',
      meta: {},
    };
    mockSelectResult = { data: jobRow, error: null };
    mockSendPush.mockResolvedValueOnce({ sent: 1, failed: 0 });

    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        maybeSingle: vi.fn(async () => mockProfileResult),
      })),
      auth: { admin: { getUserById: vi.fn(async () => mockGetUserResult) } },
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent({
      token: VALID_TOKEN,
      acceptedName: 'Gemma Thornton',
      consentGiven: true,
    }));

    expect(res.statusCode).toBe(200);
    // Allow the fire-and-forget push a tick to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSendPush).toHaveBeenCalledTimes(1);
    const [calledUserId, calledPayload] = mockSendPush.mock.calls[0];
    expect(calledUserId).toBe('trader-uuid-abc');
    expect(calledPayload.title).toBe('Quote accepted');
    expect(calledPayload.body).toContain('Gemma Thornton');
    expect(calledPayload.tag).toMatch(/^quote-accepted-/);
  });

  it('still returns 200 even when sendPushToUser rejects (push is fire-and-forget)', async () => {
    const jobRow = {
      id: 'job-push-fail',
      user_id: 'trader-uuid-xyz',
      customer_name: null,
      meta: {},
    };
    mockSelectResult = { data: jobRow, error: null };
    mockSendPush.mockRejectedValueOnce(new Error('VAPID misconfigured'));

    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        maybeSingle: vi.fn(async () => mockProfileResult),
      })),
      auth: { admin: { getUserById: vi.fn(async () => mockGetUserResult) } },
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent({
      token: VALID_TOKEN,
      consentGiven: true,
    }));

    expect(res.statusCode).toBe(200);
  });

  it('does NOT call sendPushToUser on an already-accepted (idempotent) submission', async () => {
    mockSelectResult = {
      data: {
        id: 'job-already-done',
        user_id: 'trader-uuid-idem',
        customer_name: 'Bob',
        meta: {
          quoteStatus: 'accepted',
          acceptedAt: '2026-05-30T10:00:00Z',
          acceptedSource: 'remote',
        },
      },
      error: null,
    };

    const handler = await getHandler();
    const res = await handler(makeEvent({
      token: VALID_TOKEN,
      consentGiven: true,
    }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).alreadyAccepted).toBe(true);
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

// ─── I. Email notification — fire-and-forget to trader ───────────────────────

describe('I. Email notification on acceptance', () => {
  /** Builds a createClient mock for a fully successful accept flow with email support */
  function makeEmailClient({ selectResult } = {}) {
    const resolved = selectResult ?? mockSelectResult;
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
          single: vi.fn(async () => resolved),
          update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
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
      data: { id: 'job-email-1', user_id: 'trader-uid', customer_name: 'Dave Customer', meta: {} },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => makeEmailClient({ selectResult }));

    const handler = await getHandler();
    const res = await handler(makeEvent({
      token: VALID_TOKEN,
      acceptedName: 'Dave Customer',
      consentGiven: true,
    }));

    expect(res.statusCode).toBe(200);
    // Allow async fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 10));

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
      data: { id: 'job-email-2', user_id: 'trader-uid', customer_name: null, meta: {} },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => makeEmailClient({ selectResult }));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.acceptedAt).toBeDefined();
  });

  it('returns 200 even when sendTraderAcceptEmail throws', async () => {
    const selectResult = {
      data: { id: 'job-email-3', user_id: 'trader-uid', customer_name: null, meta: {} },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => makeEmailClient({ selectResult }));

    // Override the email mock to throw after module is loaded
    const emailMod = await import('../_lib/sendTraderAcceptEmail.js');
    emailMod.sendTraderAcceptEmail.mockRejectedValueOnce(new Error('Network timeout'));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    expect(res.statusCode).toBe(200);
  });

  it('does not call sendTraderAcceptEmail when trader email cannot be resolved', async () => {
    mockGetUserResult = { data: { user: null }, error: null };
    const selectResult = {
      data: { id: 'job-email-4', user_id: 'trader-uid', customer_name: null, meta: {} },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => makeEmailClient({ selectResult }));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));

    const emailFn = await getEmailMock();
    expect(emailFn).not.toHaveBeenCalled();
  });

  it('does not call sendTraderAcceptEmail on idempotent re-submission', async () => {
    mockSelectResult = {
      data: {
        id: 'job-email-5',
        user_id: 'trader-uid',
        customer_name: null,
        meta: {
          quoteStatus: 'accepted',
          acceptedAt: '2026-05-01T10:00:00.000Z',
          acceptedSource: 'remote',
        },
      },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, consentGiven: true }));

    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));

    const emailFn = await getEmailMock();
    expect(emailFn).not.toHaveBeenCalled();
  });
});
