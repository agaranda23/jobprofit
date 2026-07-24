/**
 * Tests for netlify/functions/campaign-conversions.js (JP-LU9 Phase 3)
 *
 * Internal founder-only report — no Supabase user JWT, gated by a shared
 * secret instead (CAMPAIGN_REPORT_SECRET). No network; Supabase is mocked.
 *
 * Covers:
 *   A. Method / config guards
 *   B. Auth guard — 401 on missing / wrong secret
 *   C. secretsMatch — pure constant-time comparison
 *   D. aggregateByCampaign — pure aggregation math
 *   E. toCsv — pure CSV formatting
 *   F. Handler happy path — JSON response shape
 *   G. Handler — ?format=csv
 *   H. Handler — database error → 502
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { secretsMatch, aggregateByCampaign, toCsv } from '../campaign-conversions.js';

const FAKE_URL     = 'https://test.supabase.co';
const FAKE_SRK     = 'service-role-key-test';
const REPORT_SECRET = 'super-secret-report-token-1234567890';

let mockQueryResult = { data: [], error: null };

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        not: vi.fn(async () => mockQueryResult),
      })),
    })),
  })),
}));

async function getHandler() {
  const mod = await import('../campaign-conversions.js');
  return mod.handler;
}

function makeEvent({ method = 'GET', secret = REPORT_SECRET, query = {} } = {}) {
  return {
    httpMethod: method,
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
    queryStringParameters: query,
  };
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL         = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SRK;
  process.env.CAMPAIGN_REPORT_SECRET    = REPORT_SECRET;
  mockQueryResult = { data: [], error: null };
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CAMPAIGN_REPORT_SECRET;
  vi.resetModules();
});

// ── A. Method / config guards ─────────────────────────────────────────────────

describe('A. Method and config guards', () => {
  it('returns 200 for OPTIONS preflight', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'OPTIONS', headers: {} });
    expect(res.statusCode).toBe(200);
  });

  it('returns 405 for non-GET methods', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ method: 'POST' }));
    expect(res.statusCode).toBe(405);
  });

  it('returns 500 when CAMPAIGN_REPORT_SECRET is not set', async () => {
    delete process.env.CAMPAIGN_REPORT_SECRET;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
  });
});

// ── B. Auth guard ─────────────────────────────────────────────────────────────

describe('B. Auth guard', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ secret: null }));
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when the secret is wrong', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ secret: 'wrong-secret' }));
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 when the secret matches', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
  });
});

// ── C. secretsMatch — pure comparison ─────────────────────────────────────────

describe('C. secretsMatch', () => {
  it('returns true for matching strings', () => {
    expect(secretsMatch('abc123', 'abc123')).toBe(true);
  });
  it('returns false for different strings', () => {
    expect(secretsMatch('abc123', 'abc124')).toBe(false);
  });
  it('returns false for different-length strings', () => {
    expect(secretsMatch('short', 'muchlongersecret')).toBe(false);
  });
  it('returns false for empty/missing values', () => {
    expect(secretsMatch('', 'abc')).toBe(false);
    expect(secretsMatch('abc', '')).toBe(false);
    expect(secretsMatch(null, 'abc')).toBe(false);
    expect(secretsMatch(undefined, undefined)).toBe(false);
  });
});

// ── D. aggregateByCampaign — pure aggregation math ────────────────────────────

function campaignInfo(overrides = {}) {
  return {
    code: 'MITCH60',
    creator_label: 'Mitch @mitchtrades',
    active: true,
    bounty_currency: 'gbp',
    payout_cap_minor: null,
    ...overrides,
  };
}

describe('D. aggregateByCampaign', () => {
  it('counts signups and paid conversions correctly', () => {
    const rows = [
      { campaign_id: 'c1', bounty_status: 'pending', bounty_payment_count: 0, bounty_amount_minor: null, campaigns: campaignInfo() },
      { campaign_id: 'c1', bounty_status: 'pending', bounty_payment_count: 1, bounty_amount_minor: null, campaigns: campaignInfo() },
      { campaign_id: 'c1', bounty_status: 'owed', bounty_payment_count: 2, bounty_amount_minor: 1500, campaigns: campaignInfo() },
    ];
    const result = aggregateByCampaign(rows);
    expect(result).toHaveLength(1);
    expect(result[0].signups).toBe(3);
    expect(result[0].paid_conversions).toBe(2); // rows with bounty_payment_count >= 1
    expect(result[0].bounty_pending).toBe(2);
    expect(result[0].bounty_owed_count).toBe(1);
    expect(result[0].bounty_owed_total_minor).toBe(1500);
  });

  it('separates rows by campaign_id into distinct summary rows', () => {
    const rows = [
      { campaign_id: 'c1', bounty_status: 'owed', bounty_payment_count: 2, bounty_amount_minor: 1000, campaigns: campaignInfo({ code: 'MITCH60' }) },
      { campaign_id: 'c2', bounty_status: 'owed', bounty_payment_count: 2, bounty_amount_minor: 2000, campaigns: campaignInfo({ code: 'DAVE30' }) },
    ];
    const result = aggregateByCampaign(rows);
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.code === 'MITCH60').bounty_owed_total_minor).toBe(1000);
    expect(result.find((r) => r.code === 'DAVE30').bounty_owed_total_minor).toBe(2000);
  });

  it('sums bounty_owed_total_minor across multiple owed rows for the same campaign', () => {
    const rows = [
      { campaign_id: 'c1', bounty_status: 'owed', bounty_payment_count: 2, bounty_amount_minor: 1000, campaigns: campaignInfo() },
      { campaign_id: 'c1', bounty_status: 'owed', bounty_payment_count: 2, bounty_amount_minor: 1500, campaigns: campaignInfo() },
    ];
    const result = aggregateByCampaign(rows);
    expect(result[0].bounty_owed_total_minor).toBe(2500);
    expect(result[0].bounty_owed_count).toBe(2);
  });

  it('counts void bounties separately and excludes them from the owed total', () => {
    const rows = [
      { campaign_id: 'c1', bounty_status: 'void', bounty_payment_count: 2, bounty_amount_minor: 1500, campaigns: campaignInfo() },
    ];
    const result = aggregateByCampaign(rows);
    expect(result[0].bounty_void_count).toBe(1);
    expect(result[0].bounty_owed_count).toBe(0);
    expect(result[0].bounty_owed_total_minor).toBe(0);
  });

  it('skips a row with no embedded campaign info (orphaned FK — defensive)', () => {
    const rows = [{ campaign_id: 'c1', bounty_status: 'owed', bounty_payment_count: 2, bounty_amount_minor: 1500, campaigns: null }];
    const result = aggregateByCampaign(rows);
    expect(result).toHaveLength(0);
  });

  it('returns an empty array for no rows', () => {
    expect(aggregateByCampaign([])).toEqual([]);
    expect(aggregateByCampaign(undefined)).toEqual([]);
  });
});

// ── E. toCsv — pure CSV formatting ────────────────────────────────────────────

describe('E. toCsv', () => {
  it('produces a header row plus one row per campaign', () => {
    const csv = toCsv([
      { code: 'MITCH60', creator_label: 'Mitch', active: true, signups: 3, paid_conversions: 2, bounty_pending: 1, bounty_owed_count: 1, bounty_owed_total_minor: 1500, bounty_void_count: 0, currency: 'gbp', payout_cap_minor: null },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('code,creator_label,active,signups,paid_conversions,bounty_pending,bounty_owed_count,bounty_owed_total_minor,bounty_void_count,currency,payout_cap_minor');
    expect(lines[1]).toBe('MITCH60,Mitch,true,3,2,1,1,1500,0,gbp,');
  });

  it('escapes creator labels containing commas or quotes', () => {
    const csv = toCsv([
      { code: 'MITCH60', creator_label: 'Mitch, "The Trades Guy"', active: true, signups: 1, paid_conversions: 0, bounty_pending: 0, bounty_owed_count: 0, bounty_owed_total_minor: 0, bounty_void_count: 0, currency: 'gbp', payout_cap_minor: null },
    ]);
    expect(csv).toContain('"Mitch, ""The Trades Guy"""');
  });
});

// ── F. Handler happy path ─────────────────────────────────────────────────────

describe('F. Handler happy path', () => {
  it('returns { campaigns: [...] } as JSON by default', async () => {
    mockQueryResult = {
      data: [
        { campaign_id: 'c1', bounty_status: 'owed', bounty_payment_count: 2, bounty_amount_minor: 1500, campaigns: campaignInfo() },
      ],
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.campaigns).toHaveLength(1);
    expect(body.campaigns[0].code).toBe('MITCH60');
  });
});

// ── G. Handler — CSV format ───────────────────────────────────────────────────

describe('G. Handler — ?format=csv', () => {
  it('returns CSV text with the right content type', async () => {
    mockQueryResult = {
      data: [
        { campaign_id: 'c1', bounty_status: 'owed', bounty_payment_count: 2, bounty_amount_minor: 1500, campaigns: campaignInfo() },
      ],
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ query: { format: 'csv' } }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/csv');
    expect(res.body).toContain('MITCH60');
  });
});

// ── H. Handler — database error ───────────────────────────────────────────────

describe('H. Handler — database error', () => {
  it('returns 502 when the query fails', async () => {
    mockQueryResult = { data: null, error: { message: 'connection refused' } };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(502);
  });
});
