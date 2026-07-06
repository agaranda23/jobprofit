/**
 * fetch-books-summary.test.js
 *
 * Tests for the accountant "books link" Netlify function
 * (feat/accountant-books-link). No network, no real Supabase — all DB calls
 * are mocked per-table via a `from(table)` switch, matching the project's
 * mocked-I/O convention (see fetch-public-job-vat-deposit.test.js).
 *
 * Mandatory security coverage (per the QAE brief on this feature):
 *   A. Valid token → 200 with that trader's summary.
 *   B. Malformed token (bad UUID shape) → 400, no DB call made.
 *   C. Unknown token (no profile row matches) → 404, generic body.
 *   D. Revoked token (same as unknown — books_share_token cleared to NULL by
 *      the revoke action, so it simply no longer matches any row) → 404.
 *   E. Pro re-check at FETCH time: a token that matches a FREE-plan trader
 *      (lapsed after the link was minted) → 404, same generic body — no
 *      distinction leaked between "not found" and "downgraded".
 *   F. Cross-trader scoping / param-tampering: a request body that also
 *      includes a foreign user_id/trader_id/profile_id is IGNORED — the jobs/
 *      receipts queries are scoped only by the token-resolved profile id.
 *   G. Response payload NEVER contains sort_code/account_number/account_name/
 *      any stripe_* field, even when those fields are present on the mocked
 *      profile row.
 *   H. Static source guard: the handler file contains zero
 *      .insert(/.update(/.delete(/.upsert( calls — read-only by construction.
 *   I. Method/env-var guards (405 / 500).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const FAKE_URL = 'https://abc.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-key-fake';
const VALID_TOKEN = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const FOREIGN_USER_ID = 'foreign-user-should-be-ignored';

function makeEvent(body, method = 'POST') {
  return { httpMethod: method, body: JSON.stringify(body) };
}

// ── Per-table mock state — set by each test before importing the handler ────
let mockProfileResult = { data: null, error: null };
let mockJobsResult = { data: [], error: null };
let mockReceiptsResult = { data: [], error: null };

// Records the args every .eq() call was made with, per table, so tests can
// assert the jobs/receipts queries were scoped by the resolved profile id
// and NOT by anything supplied in the request body.
let eqCallsByTable;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((...args) => {
            eqCallsByTable.profiles.push(args);
            return {
              maybeSingle: vi.fn(async () => mockProfileResult),
            };
          }),
        };
      }
      if (table === 'jobs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((...args) => {
            eqCallsByTable.jobs.push(args);
            return Promise.resolve(mockJobsResult);
          }),
        };
      }
      if (table === 'receipts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((...args) => {
            eqCallsByTable.receipts.push(args);
            return Promise.resolve(mockReceiptsResult);
          }),
        };
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
  })),
}));

function makeProfileRow(overrides = {}) {
  return {
    id: 'trader-uuid-1',
    business_name: 'Jane the Plumber',
    address: '1 Test St',
    vat_number: 'GB123456789',
    logo_url: '',
    tax_set_aside_pct: 20,
    payment_terms_days: 14,
    plan: 'pro',
    trial_ends_at: null,
    // Secrets that must NEVER reach the response even though they're on the
    // mocked row (the handler's own SELECT is a whitelist and shouldn't ask
    // for these at all — but we include them here to prove even a mistaken
    // future SELECT expansion still couldn't leak them through this test).
    sort_code: '12-34-56',
    account_number: '87654321',
    account_name: 'Jane the Plumber Ltd',
    stripe_user_id: 'acct_fake123',
    stripe_customer_id: 'cus_fake123',
    stripe_subscription_id: 'sub_fake123',
    stripe_connect_status: 'connected',
    ...overrides,
  };
}

function makeJobRow(overrides = {}) {
  return {
    id: 'job-1',
    customer_name: 'Jane Smith',
    summary: 'Fix boiler',
    amount: 240,
    paid: true,
    date: '2026-06-01',
    payment_date: '2026-06-01',
    meta: { invoiceNumber: 'INV-1', total: 240 },
    ...overrides,
  };
}

function makeReceiptRow(overrides = {}) {
  return {
    id: 'r1',
    merchant: 'Screwfix',
    amount: 60,
    vat: 10,
    date: '2026-06-02',
    created_at: '2026-06-02T09:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  mockProfileResult = { data: null, error: null };
  mockJobsResult = { data: [], error: null };
  mockReceiptsResult = { data: [], error: null };
  eqCallsByTable = { profiles: [], jobs: [], receipts: [] };
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.resetModules();
});

// ── A. Valid token ───────────────────────────────────────────────────────────

describe('A. fetch-books-summary — valid token returns the trader summary', () => {
  it('200s with income/expenses/profit/vat/taxEstimate/invoicedJobs/receipts/customers', async () => {
    mockProfileResult = { data: makeProfileRow(), error: null };
    mockJobsResult = { data: [makeJobRow()], error: null };
    mockReceiptsResult = { data: [makeReceiptRow()], error: null };

    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.income.paidTotal).toBe(240);
    expect(body.expenses.total).toBe(60);
    expect(body.profit).toBe(180);
    expect(body.invoicedJobs).toHaveLength(1);
    expect(body.receipts).toHaveLength(1);
    expect(body.customers).toHaveLength(1);
  });
});

// ── B. Malformed token ───────────────────────────────────────────────────────

describe('B. fetch-books-summary — malformed token', () => {
  it('400s and never calls the DB', async () => {
    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({ token: 'not-a-uuid' }));
    expect(res.statusCode).toBe(400);
    expect(eqCallsByTable.profiles).toHaveLength(0);
  });

  it('400s for a missing token', async () => {
    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(400);
  });

  it('400s for an invalid period value', async () => {
    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN, period: 'forever' }));
    expect(res.statusCode).toBe(400);
  });
});

// ── C/D. Unknown / revoked token ─────────────────────────────────────────────

describe('C. fetch-books-summary — unknown token', () => {
  it('404s with a generic "not found" body, zero data', async () => {
    mockProfileResult = { data: null, error: null }; // no row matches
    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.income).toBeUndefined();
    expect(body.invoicedJobs).toBeUndefined();
  });
});

describe('D. fetch-books-summary — revoked token behaves identically to unknown', () => {
  it('404s the same way once books_share_token has been cleared (no matching row)', async () => {
    // Revoking = clearing the column, so the mocked lookup simply finds nothing —
    // this test documents that a revoked link cannot be distinguished from an
    // unknown one by the response shape.
    mockProfileResult = { data: null, error: null };
    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(404);
  });
});

// ── E. Pro re-check at fetch time ────────────────────────────────────────────

describe('E. fetch-books-summary — Pro re-check happens at FETCH time, not just mint time', () => {
  it('404s when the token matches a free-plan trader (lapsed after minting)', async () => {
    mockProfileResult = { data: makeProfileRow({ plan: 'free', trial_ends_at: null }), error: null };
    mockJobsResult = { data: [makeJobRow()], error: null };
    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(404);
    // No jobs/receipts query should even be attempted once the Pro check fails.
    expect(eqCallsByTable.jobs).toHaveLength(0);
    expect(eqCallsByTable.receipts).toHaveLength(0);
  });

  it('404s when the token matches a trader whose trial has expired', async () => {
    mockProfileResult = {
      data: makeProfileRow({ plan: 'trial', trial_ends_at: '2020-01-01T00:00:00Z' }),
      error: null,
    };
    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(404);
  });

  it('200s when the token matches a trader on an active trial', async () => {
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    mockProfileResult = {
      data: makeProfileRow({ plan: 'trial', trial_ends_at: farFuture }),
      error: null,
    };
    mockJobsResult = { data: [], error: null };
    mockReceiptsResult = { data: [], error: null };
    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(200);
  });
});

// ── F. Cross-trader scoping / param tampering ────────────────────────────────

describe('F. fetch-books-summary — scoping is token-derived ONLY, never body-derived', () => {
  it('ignores a foreign user_id/trader_id/profile_id in the body; scopes jobs/receipts by the resolved profile id', async () => {
    const resolvedProfile = makeProfileRow({ id: 'real-trader-id' });
    mockProfileResult = { data: resolvedProfile, error: null };
    mockJobsResult = { data: [makeJobRow()], error: null };
    mockReceiptsResult = { data: [makeReceiptRow()], error: null };

    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({
      token: VALID_TOKEN,
      user_id: FOREIGN_USER_ID,
      trader_id: FOREIGN_USER_ID,
      profile_id: FOREIGN_USER_ID,
    }));

    expect(res.statusCode).toBe(200);
    // jobs/receipts .eq() must have been called with the TOKEN-resolved id,
    // never with the attacker-supplied foreign id.
    const jobsEqArgs = eqCallsByTable.jobs[0];
    const receiptsEqArgs = eqCallsByTable.receipts[0];
    expect(jobsEqArgs).toEqual(['user_id', 'real-trader-id']);
    expect(receiptsEqArgs).toEqual(['user_id', 'real-trader-id']);
    expect(jobsEqArgs).not.toContain(FOREIGN_USER_ID);
    expect(receiptsEqArgs).not.toContain(FOREIGN_USER_ID);
  });
});

// ── G. No secrets in the payload ─────────────────────────────────────────────

describe('G. fetch-books-summary — payload never contains bank/Stripe fields', () => {
  it('the serialized response never contains sort_code/account_number/account_name/stripe_*', async () => {
    mockProfileResult = { data: makeProfileRow(), error: null };
    mockJobsResult = { data: [makeJobRow()], error: null };
    mockReceiptsResult = { data: [makeReceiptRow()], error: null };

    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    const raw = res.body;

    expect(raw).not.toMatch(/sort_code|12-34-56/i);
    expect(raw).not.toMatch(/account_number|87654321/i);
    expect(raw).not.toMatch(/account_name/i);
    expect(raw).not.toMatch(/stripe_/i);
    expect(raw).not.toMatch(/acct_fake123|cus_fake123|sub_fake123/);
    // The trader's internal auth uid must not leak either.
    expect(raw).not.toMatch(/trader-uuid-1/);

    const body = JSON.parse(raw);
    const topLevelKeys = Object.keys(body);
    expect(topLevelKeys).not.toContain('sort_code');
    expect(topLevelKeys).not.toContain('account_number');
    expect(topLevelKeys).not.toContain('account_name');
    expect(Object.keys(body.business || {})).not.toContain('sort_code');
    expect(Object.keys(body.business || {})).not.toContain('account_number');
  });
});

// ── H. Static source guard — read-only by construction ───────────────────────

describe('H. fetch-books-summary — handler source is read-only', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(path.join(__dirname, '..', 'fetch-books-summary.js'), 'utf8');

  it('contains zero .insert(/.update(/.delete(/.upsert( calls', () => {
    expect(source).not.toMatch(/\.insert\(/);
    expect(source).not.toMatch(/\.update\(/);
    expect(source).not.toMatch(/\.delete\(/);
    expect(source).not.toMatch(/\.upsert\(/);
  });

  it('never selects sort_code/account_number/account_name/stripe_ inside a .select() call', () => {
    expect(source).not.toMatch(/\.select\(['"`][^'"`]*sort_code[^'"`]*['"`]\)/i);
    expect(source).not.toMatch(/\.select\(['"`][^'"`]*account_number[^'"`]*['"`]\)/i);
    expect(source).not.toMatch(/\.select\(['"`][^'"`]*account_name[^'"`]*['"`]\)/i);
    expect(source).not.toMatch(/\.select\(['"`][^'"`]*stripe_[^'"`]*['"`]\)/i);
  });

  it('never adds a "TO anon" RLS policy — this file must stay service-role-only', () => {
    expect(source).not.toMatch(/TO anon/i);
  });
});

// ── I. Method / env-var guards ────────────────────────────────────────────────

describe('I. fetch-books-summary — method + env guards', () => {
  it('405s for a non-POST method', async () => {
    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }, 'GET'));
    expect(res.statusCode).toBe(405);
  });

  it('200s for an OPTIONS preflight with no body checks', async () => {
    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler({ httpMethod: 'OPTIONS' });
    expect(res.statusCode).toBe(200);
  });

  it('500s when SUPABASE_SERVICE_ROLE_KEY is missing', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { handler } = await import('../fetch-books-summary.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(500);
  });
});
