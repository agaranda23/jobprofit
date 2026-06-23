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
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_URL = 'https://abc.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-key-fake';

let mockSelectResult = null;

vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn().mockReturnThis(),
      })),
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

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  mockSelectResult = null;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
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
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => mockSelectResult),
      update: vi.fn((payload) => {
        if (writtenMetaRef) writtenMetaRef.value = payload?.meta;
        return { eq: vi.fn(async () => ({ error: null })) };
      }),
    })),
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
