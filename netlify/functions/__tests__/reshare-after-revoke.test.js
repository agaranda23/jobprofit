/**
 * reshare-after-revoke — regression tests for A8 (QA smoke checklist).
 *
 * Scenario: trader REVOKES a link → trader RE-SHARES → a fresh token is written
 * to the DB and publicTokenRevokedAt is cleared. The new link must work; the old
 * revoked link must stay dead.
 *
 * Tests here cover the Netlify function side (the lookup + revoke-check logic).
 * The reissuePublicToken helper is exercised in src/lib/__tests__/persistPublicToken.test.js.
 *
 * HOW THE OLD LINK STAYS DEAD:
 *   All four Netlify public-fetch functions look up the job by exact
 *   `meta->>publicAccessToken` match. When re-sharing mints a new UUID,
 *   the old UUID no longer matches any row → the query returns zero rows → 404.
 *   The old link is dead by token-mismatch, not by the revoke flag.
 *   Clearing publicTokenRevokedAt is necessary so the NEW link (fresh UUID) is
 *   not blocked by the revoke check; it does NOT revive the old URL.
 *
 * No network, no Supabase. All DB calls are mocked.
 * Pattern mirrors fetch-public-revoke.test.js.
 *
 * Covers:
 *   A. After re-share: new token resolves → 200 (new link works)
 *   B. After re-share: old (revoked) token no longer matches any row → 404 (old link stays dead)
 *   C. After re-share: publicTokenRevokedAt is absent from job meta (flag was cleared)
 *      so the revoke check doesn't block the new token → 200 (not 404 from revoke check)
 *   D. Re-share without prior revoke: same token still resolves → 200 (non-revoked stable)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Env setup ─────────────────────────────────────────────────────────────────
const FAKE_URL = 'https://abc.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-key-fake';

// Token lifecycle:
const OLD_REVOKED_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_TOKEN         = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STABLE_TOKEN      = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function makeEvent(body, method = 'POST') {
  return { httpMethod: method, body: JSON.stringify(body) };
}

// ── Supabase mock ─────────────────────────────────────────────────────────────
// mockJobResult is set per-test to control what the DB returns for a given token.
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

// Minimal profile row — all functions need a profile to build the 200 response.
function makeProfileRow() {
  return {
    business_name: 'Smith Plumbing',
    address: '1 Test St',
    phone: '07700900000',
    email: 'smith@example.com',
    logo_url: '',
    website: '',
    vat_registered: false,
    vat_number: '',
    utr_number: '',
    quote_validity_days: 30,
    terms_text: '',
    plan: 'pro',
    trial_ends_at: null,
    account_name: '',
    sort_code: '',
    account_number: '',
    bank_details: '',
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

// ── A. New token resolves → 200 (new link works after re-share) ───────────────
//
// The job now stores NEW_TOKEN in meta.publicAccessToken and publicTokenRevokedAt
// is absent (cleared at re-share time). The new link must resolve to 200.

describe('A. new token resolves → 200 (new link works after re-share)', () => {
  it('fetch-public-job: new token → 200', async () => {
    // DB state AFTER re-share: job has new token, revoke flag cleared
    mockJobResult = {
      data: {
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
          publicAccessToken: NEW_TOKEN,
          // publicTokenRevokedAt intentionally absent — cleared at re-share
        },
      },
      error: null,
    };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: NEW_TOKEN }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('job-uuid-1');
  });

  it('fetch-public-quote-profile: new token → 200', async () => {
    mockJobResult = {
      data: {
        id: 'job-uuid-1',
        user_id: 'user-uuid-1',
        meta: { publicAccessToken: NEW_TOKEN },
      },
      error: null,
    };
    mockProfileResult = { data: makeProfileRow(), error: null };
    const { handler } = await import('../fetch-public-quote-profile.js');
    const res = await handler(makeEvent({ token: NEW_TOKEN }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.businessName).toBe('Smith Plumbing');
  });

  it('fetch-public-invoice: new token → 200', async () => {
    mockJobResult = {
      data: {
        id: 'job-uuid-1',
        user_id: 'user-uuid-1',
        meta: { publicAccessToken: NEW_TOKEN },
      },
      error: null,
    };
    mockProfileResult = { data: makeProfileRow(), error: null };
    const { handler } = await import('../fetch-public-invoice.js');
    const res = await handler(makeEvent({ token: NEW_TOKEN }));
    expect(res.statusCode).toBe(200);
  });

  it('fetch-public-receipt: new token → 200', async () => {
    mockJobResult = {
      data: {
        id: 'job-uuid-1',
        user_id: 'user-uuid-1',
        meta: { publicAccessToken: NEW_TOKEN },
      },
      error: null,
    };
    mockProfileResult = { data: makeProfileRow(), error: null };
    const { handler } = await import('../fetch-public-receipt.js');
    const res = await handler(makeEvent({ token: NEW_TOKEN }));
    expect(res.statusCode).toBe(200);
  });
});

// ── B. Old token no longer matches any row → 404 (old link stays dead) ────────
//
// After re-share the DB contains NEW_TOKEN. A query for OLD_REVOKED_TOKEN returns
// zero rows. This is how the old link stays dead — token-mismatch, not the revoke
// flag. Simulated by returning { data: null, error: null } (same as maybeSingle
// finding zero rows).

describe('B. old revoked token no longer in DB → 404 (old link stays dead)', () => {
  it('fetch-public-job: old token → 404 (zero rows — token replaced in DB)', async () => {
    // Simulate: DB has been updated with NEW_TOKEN, so a query for OLD_REVOKED_TOKEN
    // finds no matching row. maybeSingle returns data:null, error:null.
    mockJobResult = { data: null, error: null };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: OLD_REVOKED_TOKEN }));
    expect(res.statusCode).toBe(404);
  });

  it('fetch-public-quote-profile: old token → 404', async () => {
    mockJobResult = { data: null, error: null };
    const { handler } = await import('../fetch-public-quote-profile.js');
    const res = await handler(makeEvent({ token: OLD_REVOKED_TOKEN }));
    expect(res.statusCode).toBe(404);
  });

  it('fetch-public-invoice: old token → 404', async () => {
    mockJobResult = { data: null, error: null };
    const { handler } = await import('../fetch-public-invoice.js');
    const res = await handler(makeEvent({ token: OLD_REVOKED_TOKEN }));
    expect(res.statusCode).toBe(404);
  });

  it('fetch-public-receipt: old token → 404', async () => {
    mockJobResult = { data: null, error: null };
    const { handler } = await import('../fetch-public-receipt.js');
    const res = await handler(makeEvent({ token: OLD_REVOKED_TOKEN }));
    expect(res.statusCode).toBe(404);
  });
});

// ── C. New token with cleared revoke flag passes the revoke check → 200 ───────
//
// Belt-and-suspenders: even if (hypothetically) the old token were somehow still
// in the DB, the revoke flag must be absent for the new link to work.
// This test confirms clearing publicTokenRevokedAt makes the revoke check pass.

describe('C. publicTokenRevokedAt cleared → revoke check passes → 200', () => {
  it('fetch-public-job: job with no revokedAt serves 200 (revoke check does not block new link)', async () => {
    mockJobResult = {
      data: {
        id: 'job-uuid-1',
        user_id: 'user-uuid-1',
        customer_name: 'Jane',
        summary: 'Boiler',
        amount: 200,
        paid: false,
        payment_type: null,
        line_items: [],
        date: '2026-06-01',
        created_at: '2026-06-01T09:00:00.000Z',
        payment_date: null,
        meta: {
          publicAccessToken: NEW_TOKEN,
          // publicTokenRevokedAt: explicitly absent — this is what the re-share write clears
        },
      },
      error: null,
    };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: NEW_TOKEN }));
    expect(res.statusCode).toBe(200);
    // Must not be blocked by the revoke check
    expect(res.statusCode).not.toBe(404);
  });
});

// ── D. Non-revoked re-share: same token still resolves → 200 ──────────────────
//
// When the trader re-sends a link that was never revoked, the token is unchanged
// (reissuePublicToken returns the existing token). Existing customer links keep
// working.

describe('D. non-revoked re-share: same token resolves → 200 (stable link)', () => {
  it('fetch-public-job: existing non-revoked token → 200 after re-share', async () => {
    mockJobResult = {
      data: {
        id: 'job-uuid-2',
        user_id: 'user-uuid-2',
        customer_name: 'Bob Builder',
        summary: 'Roof repair',
        amount: 800,
        paid: false,
        payment_type: null,
        line_items: [],
        date: '2026-06-15',
        created_at: '2026-06-15T08:00:00.000Z',
        payment_date: null,
        meta: {
          publicAccessToken: STABLE_TOKEN,
          // No publicTokenRevokedAt — was never revoked
        },
      },
      error: null,
    };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: STABLE_TOKEN }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('job-uuid-2');
  });
});
