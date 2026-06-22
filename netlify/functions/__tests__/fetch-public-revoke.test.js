/**
 * Tests for public-link revoke behaviour across all three Netlify public-fetch
 * functions: fetch-public-job, fetch-public-quote-profile, fetch-public-invoice,
 * fetch-public-receipt.
 *
 * No network, no Supabase connection. All DB calls are mocked.
 * Pattern: pure-logic + mocked I/O, matches the project's no-DOM test convention.
 *
 * Covers:
 *   A. fetch-public-job — non-revoked token still returns 200 (happy path)
 *   B. fetch-public-job — revoked token returns 404 (not 500)
 *   C. fetch-public-quote-profile — non-revoked token still returns 200
 *   D. fetch-public-quote-profile — revoked token returns 404
 *   E. fetch-public-invoice — non-revoked token still returns 200
 *   F. fetch-public-invoice — revoked token returns 404
 *   G. fetch-public-receipt — non-revoked token still returns 200
 *   H. fetch-public-receipt — revoked token returns 404
 *   I. fetch-public-job — null meta (no JSONB) treated as not revoked
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Env setup ─────────────────────────────────────────────────────────────────
const FAKE_URL = 'https://abc.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-key-fake';
const VALID_TOKEN = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function makeEvent(body, method = 'POST') {
  return { httpMethod: method, body: JSON.stringify(body) };
}

// ── Supabase mock factory ──────────────────────────────────────────────────────
// Each test controls what the first `.select().eq().single()` / `.maybeSingle()`
// call returns by swapping `mockJobResult` / `mockProfileResult`.

let mockJobResult = null;
let mockProfileResult = null;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () =>
        table === 'jobs' ? mockJobResult : mockProfileResult
      ),
      maybeSingle: vi.fn(async () =>
        table === 'jobs' ? mockJobResult : mockProfileResult
      ),
      update: vi.fn().mockReturnThis(),
    })),
  })),
}));

// ── Shared helper rows ────────────────────────────────────────────────────────

function makeJobRow(metaOverrides = {}) {
  return {
    id: 'job-uuid-1',
    user_id: 'user-uuid-1',
    customer_name: 'Jane Smith',
    summary: 'Fix boiler',
    amount: 250,
    paid: false,
    payment_type: null,
    line_items: [],
    date: '2026-06-01',
    created_at: '2026-06-01T09:00:00.000Z',
    payment_date: null,
    meta: {
      publicAccessToken: VALID_TOKEN,
      quoteStatus: 'sent',
      ...metaOverrides,
    },
  };
}

function makeProfileRow() {
  return {
    business_name: 'Smith Plumbing',
    address: '1 Test St',
    phone: '07700900000',
    email: 'smith@example.com',
    logo_url: '',
    website: '',
    // vat_registered does not exist — vatRegistered is derived from !!vat_number
    vat_number: '',
    utr_number: '',
    quote_validity_days: 30,
    terms_text: '',
    plan: 'pro',
    trial_ends_at: null,
    account_name: '',
    sort_code: '',
    account_number: '',
    // bank_details does not exist as a column
    stripe_connect_status: 'not_connected',
    stripe_user_id: null,
    stripe_payment_link: '',
    is_cis_subcontractor: false,
    cis_default_rate: 20,
    itemise_documents: false,
    payment_terms_days: 14,
  };
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  mockJobResult = null;
  mockProfileResult = null;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.resetModules();
});

// ── A. fetch-public-job — non-revoked returns 200 ────────────────────────────

describe('A. fetch-public-job — non-revoked token returns 200', () => {
  it('returns 200 with job data when publicTokenRevokedAt is absent', async () => {
    mockJobResult = { data: makeJobRow(), error: null };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('job-uuid-1');
  });
});

// ── B. fetch-public-job — revoked token returns 404 ──────────────────────────

describe('B. fetch-public-job — revoked token returns 404', () => {
  it('returns 404 when meta.publicTokenRevokedAt is set', async () => {
    mockJobResult = {
      data: makeJobRow({ publicTokenRevokedAt: '2026-06-21T10:00:00.000Z' }),
      error: null,
    };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBeTruthy();
  });

  it('does NOT return 500 when revoked — error shape is 404', async () => {
    mockJobResult = {
      data: makeJobRow({ publicTokenRevokedAt: '2026-06-21T10:00:00.000Z' }),
      error: null,
    };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).not.toBe(500);
    expect(res.statusCode).not.toBe(502);
  });
});

// ── C. fetch-public-quote-profile — non-revoked returns 200 ──────────────────

describe('C. fetch-public-quote-profile — non-revoked token returns 200', () => {
  it('returns 200 with profile data when publicTokenRevokedAt is absent', async () => {
    mockJobResult = { data: { id: 'job-uuid-1', user_id: 'user-uuid-1', meta: { publicAccessToken: VALID_TOKEN } }, error: null };
    mockProfileResult = { data: makeProfileRow(), error: null };
    const { handler } = await import('../fetch-public-quote-profile.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.businessName).toBe('Smith Plumbing');
  });
});

// ── D. fetch-public-quote-profile — revoked returns 404 ──────────────────────

describe('D. fetch-public-quote-profile — revoked token returns 404', () => {
  it('returns 404 when meta.publicTokenRevokedAt is set', async () => {
    mockJobResult = {
      data: {
        id: 'job-uuid-1',
        user_id: 'user-uuid-1',
        meta: { publicAccessToken: VALID_TOKEN, publicTokenRevokedAt: '2026-06-21T10:00:00.000Z' },
      },
      error: null,
    };
    const { handler } = await import('../fetch-public-quote-profile.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBeTruthy();
  });
});

// ── E. fetch-public-invoice — non-revoked returns 200 ────────────────────────

describe('E. fetch-public-invoice — non-revoked token returns 200', () => {
  it('returns 200 with profile data when publicTokenRevokedAt is absent', async () => {
    mockJobResult = { data: { id: 'job-uuid-1', user_id: 'user-uuid-1', meta: { publicAccessToken: VALID_TOKEN } }, error: null };
    mockProfileResult = { data: makeProfileRow(), error: null };
    const { handler } = await import('../fetch-public-invoice.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.businessName).toBe('Smith Plumbing');
  });
});

// ── F. fetch-public-invoice — revoked returns 404 ────────────────────────────

describe('F. fetch-public-invoice — revoked token returns 404', () => {
  it('returns 404 when meta.publicTokenRevokedAt is set', async () => {
    mockJobResult = {
      data: {
        id: 'job-uuid-1',
        user_id: 'user-uuid-1',
        meta: { publicAccessToken: VALID_TOKEN, publicTokenRevokedAt: '2026-06-21T10:00:00.000Z' },
      },
      error: null,
    };
    const { handler } = await import('../fetch-public-invoice.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBeTruthy();
  });
});

// ── G. fetch-public-receipt — non-revoked returns 200 ────────────────────────

describe('G. fetch-public-receipt — non-revoked token returns 200', () => {
  it('returns 200 with profile data when publicTokenRevokedAt is absent', async () => {
    mockJobResult = { data: { id: 'job-uuid-1', user_id: 'user-uuid-1', meta: { publicAccessToken: VALID_TOKEN } }, error: null };
    mockProfileResult = { data: makeProfileRow(), error: null };
    const { handler } = await import('../fetch-public-receipt.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.businessName).toBe('Smith Plumbing');
  });
});

// ── H. fetch-public-receipt — revoked returns 404 ────────────────────────────

describe('H. fetch-public-receipt — revoked token returns 404', () => {
  it('returns 404 when meta.publicTokenRevokedAt is set', async () => {
    mockJobResult = {
      data: {
        id: 'job-uuid-1',
        user_id: 'user-uuid-1',
        meta: { publicAccessToken: VALID_TOKEN, publicTokenRevokedAt: '2026-06-21T10:00:00.000Z' },
      },
      error: null,
    };
    const { handler } = await import('../fetch-public-receipt.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBeTruthy();
  });
});

// ── I. fetch-public-job — null meta treated as not revoked ───────────────────

describe('I. fetch-public-job — null meta treated as not revoked', () => {
  it('returns 200 when meta is null (schema drift / legacy row)', async () => {
    const row = makeJobRow();
    row.meta = null;
    mockJobResult = { data: row, error: null };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(200);
  });
});
