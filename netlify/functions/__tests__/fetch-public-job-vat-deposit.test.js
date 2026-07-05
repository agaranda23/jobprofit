/**
 * Tests for fetch-public-job.js's VAT + deposit-due-date fields
 * (fix/quote-public-vat-validity).
 *
 * Bug: the customer-facing quote PDF/WhatsApp message render VAT and the
 * deposit due-date, but the public "view & accept" quote page never received
 * either field from this function — a customer viewing the hosted link saw
 * a different (less complete) picture than the PDF.
 *
 * No network, no Supabase connection. All DB calls are mocked.
 * Pattern: pure-logic + mocked I/O, matches the project's no-DOM test
 * convention (see fetch-public-revoke.test.js).
 *
 * Covers:
 *   A. vat — returns true when meta.vat is true
 *   B. vat — returns false when meta.vat is absent
 *   C. vat — returns false when meta.vat is present but not strictly true
 *   D. deposit_due_date — returns the ISO date when set in meta
 *   E. deposit_due_date — returns null when absent from meta
 *   F. quoteValidUntil — returns the per-quote override when set in meta
 *   G. quoteValidUntil — returns null when absent (renderers fall back to
 *      profile default)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_URL = 'https://abc.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-key-fake';
const VALID_TOKEN = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function makeEvent(body, method = 'POST') {
  return { httpMethod: method, body: JSON.stringify(body) };
}

let mockJobResult = null;

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => mockJobResult),
    })),
  })),
}));

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

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  mockJobResult = null;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.resetModules();
});

// ── A/B/C. vat field ──────────────────────────────────────────────────────

describe('A. fetch-public-job — vat: true when meta.vat is true', () => {
  it('returns vat: true', async () => {
    mockJobResult = { data: makeJobRow({ vat: true }), error: null };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).vat).toBe(true);
  });
});

describe('B. fetch-public-job — vat: false when meta.vat is absent', () => {
  it('returns vat: false (never undefined)', async () => {
    mockJobResult = { data: makeJobRow(), error: null };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    const body = JSON.parse(res.body);
    expect(body.vat).toBe(false);
  });
});

describe('C. fetch-public-job — vat: false for a truthy-but-not-true value', () => {
  it('coerces meta.vat: "yes" to false (strict === true check)', async () => {
    mockJobResult = { data: makeJobRow({ vat: 'yes' }), error: null };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(JSON.parse(res.body).vat).toBe(false);
  });
});

// ── D/E. deposit_due_date field ──────────────────────────────────────────

describe('D. fetch-public-job — deposit_due_date returned when set', () => {
  it('returns the ISO date string from meta', async () => {
    mockJobResult = {
      data: makeJobRow({ deposit_percent: 25, deposit_due_date: '2026-07-10' }),
      error: null,
    };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(JSON.parse(res.body).deposit_due_date).toBe('2026-07-10');
  });
});

describe('E. fetch-public-job — deposit_due_date null when absent', () => {
  it('returns null (not undefined) when meta has no deposit_due_date', async () => {
    mockJobResult = { data: makeJobRow({ deposit_percent: 25 }), error: null };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    const body = JSON.parse(res.body);
    expect('deposit_due_date' in body).toBe(true);
    expect(body.deposit_due_date).toBeNull();
  });
});

// ── F/G. quoteValidUntil field (per-quote "Valid until" override) ────────

describe('F. fetch-public-job — quoteValidUntil returned when set (per-quote override)', () => {
  it('returns the ISO date string from meta', async () => {
    mockJobResult = { data: makeJobRow({ quoteValidUntil: '2026-08-01' }), error: null };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(JSON.parse(res.body).quoteValidUntil).toBe('2026-08-01');
  });
});

describe('G. fetch-public-job — quoteValidUntil null when absent', () => {
  it('returns null so the public page falls back to the profile default', async () => {
    mockJobResult = { data: makeJobRow(), error: null };
    const { handler } = await import('../fetch-public-job.js');
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    const body = JSON.parse(res.body);
    expect('quoteValidUntil' in body).toBe(true);
    expect(body.quoteValidUntil).toBeNull();
  });
});
