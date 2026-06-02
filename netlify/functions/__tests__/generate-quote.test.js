/**
 * Tests for netlify/functions/generate-quote.js — AI Quote Builder (V1)
 *
 * No real network, no Supabase connection. All DB and Anthropic calls mocked.
 *
 * Covers:
 *   A. Authentication — unauthenticated → 401; valid JWT → proceeds
 *   B. Input validation — missing/short/long description
 *   C. PII guard — customer contact fields are never sent to Anthropic
 *   D. Quota gating — free 3/month + monthly reset; Pro unlimited
 *   E. Structured output — returned lineItems converge to expected shape
 *   F. Error handling — Anthropic failure → graceful 502; DB failure → safe defaults
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Env setup ─────────────────────────────────────────────────────────────────
const FAKE_URL = 'https://test.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-key-test';
const FAKE_ANTHROPIC_KEY = 'sk-ant-test-key';

// ── Supabase mock ─────────────────────────────────────────────────────────────
// The function uses adminClient.auth.getUser(token) for JWT verification,
// and adminClient.from(...) for profiles + jobs reads.
let mockGetUser = vi.fn();
let mockProfileResult = null; // { data, error }
let mockJobsResult = null;    // { data, error }
let mockUpdateResult = null;  // { error }

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
          single: vi.fn(async () => mockProfileResult),
          update: vi.fn((payload) => ({
            eq: vi.fn(async () => mockUpdateResult ?? { error: null }),
          })),
        };
      }
      if (table === 'jobs') {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          not:    vi.fn().mockReturnThis(),
          order:  vi.fn().mockReturnThis(),
          limit:  vi.fn(async () => mockJobsResult ?? { data: [], error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        single: vi.fn(async () => ({ data: null, error: null })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
        not:    vi.fn().mockReturnThis(),
        order:  vi.fn().mockReturnThis(),
        limit:  vi.fn(async () => ({ data: [], error: null })),
      };
    }),
  })),
}));

// ── Global fetch mock (Anthropic API) ─────────────────────────────────────────
let mockFetch = vi.fn();
global.fetch = mockFetch;

// Helper: valid Anthropic tool-use response
function makeAnthropicSuccess(lineItems, total) {
  return {
    ok: true,
    json: async () => ({
      content: [
        {
          type: 'tool_use',
          name: 'build_quote',
          input: { lineItems, total },
        },
      ],
    }),
  };
}

async function getHandler() {
  const mod = await import('../generate-quote.js');
  return mod.handler;
}

function makeEvent(body = {}, authToken = 'valid-token') {
  return {
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${authToken}` },
    body: JSON.stringify(body),
  };
}

const SAMPLE_ITEMS = [
  { desc: 'Labour — 8 hours', cost: 200, provenance: 'labour' },
  { desc: 'Tiles (10m²)', cost: 150, provenance: 'history' },
  { desc: 'Adhesive and grout', cost: 40, provenance: 'estimate', lowConfidence: true },
];

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  process.env.ANTHROPIC_API_KEY = FAKE_ANTHROPIC_KEY;

  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-abc' } }, error: null });
  mockProfileResult = {
    data: { hourly_rate: 25, vat_number: null, plan: 'free', ai_quote_builds_count: 0, ai_quote_builds_period: null },
    error: null,
  };
  mockJobsResult = { data: [], error: null };
  mockUpdateResult = { error: null };
  mockFetch.mockResolvedValue(makeAnthropicSuccess(SAMPLE_ITEMS, 390));
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  vi.resetModules();
});

// ─── A. Authentication ─────────────────────────────────────────────────────────

describe('A. Authentication', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ description: 'Fit bathroom' }) });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toMatch(/unauthorized/i);
  });

  it('returns 401 when JWT verification fails', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'invalid token' } });
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit bathroom' }, 'bad-token'));
    expect(res.statusCode).toBe(401);
  });

  it('proceeds when JWT is valid', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit bathroom tiles' }));
    expect(res.statusCode).toBe(200);
  });

  it('returns 200 for OPTIONS preflight', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'OPTIONS', headers: {}, body: '' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 405 for non-POST methods', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'GET', headers: {}, body: '' });
    expect(res.statusCode).toBe(405);
  });
});

// ─── B. Input validation ──────────────────────────────────────────────────────

describe('B. Input validation', () => {
  it('returns 400 when description is missing', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({}));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/description/i);
  });

  it('returns 400 when description is too short', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'ab' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when description exceeds 1000 characters', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'x'.repeat(1001) }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit bathroom tiles' }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });
});

// ─── C. PII guard — customer contact fields must NOT appear in Anthropic payload ─

describe('C. PII guard — customer data excluded from Anthropic payload', () => {
  it('does not include customer_name in the Anthropic request body', async () => {
    // The function selects from profiles and jobs — neither query selects
    // customer_name / phone / email / address from jobs.
    // We verify the fetch call to Anthropic never contains those fields.

    let capturedBody = null;
    mockFetch.mockImplementationOnce(async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return makeAnthropicSuccess(SAMPLE_ITEMS, 390);
    });

    // Simulate jobs having customer data in the row (which the function should NOT select)
    mockJobsResult = {
      data: [
        {
          line_items: [{ desc: 'Plastering', cost: 300 }],
          meta: { lineItems: [{ desc: 'Plastering', cost: 300 }] },
          // These fields should never appear in the Anthropic payload:
          customer_name: 'Mrs Smith',
          phone: '07700 900000',
          email: 'smith@example.com',
          address: '1 Test Lane',
        },
      ],
      error: null,
    };

    const handler = await getHandler();
    await handler(makeEvent({ description: 'Fit bathroom tiles' }));

    expect(capturedBody).not.toBeNull();
    const payloadStr = JSON.stringify(capturedBody);

    // PII fields must not appear anywhere in the Anthropic request
    expect(payloadStr).not.toContain('Mrs Smith');
    expect(payloadStr).not.toContain('07700 900000');
    expect(payloadStr).not.toContain('smith@example.com');
    expect(payloadStr).not.toContain('1 Test Lane');

    // Pricing history (non-PII) should be present
    expect(payloadStr).toContain('Plastering');
  });

  it('sends job description and hourly rate to Anthropic but nothing PII', async () => {
    let capturedSystemPrompt = null;
    mockFetch.mockImplementationOnce(async (url, opts) => {
      const b = JSON.parse(opts.body);
      capturedSystemPrompt = b.system;
      return makeAnthropicSuccess(SAMPLE_ITEMS, 390);
    });

    mockProfileResult = {
      data: { hourly_rate: 30, vat_number: null, plan: 'free', ai_quote_builds_count: 0, ai_quote_builds_period: null },
      error: null,
    };

    const handler = await getHandler();
    await handler(makeEvent({ description: 'Kitchen refurb' }));

    expect(capturedSystemPrompt).toContain('£30/hr');
    // System prompt must not contain actual PII values (names, numbers, emails)
    // It may contain instructional words like "personal data" — that's fine.
    expect(capturedSystemPrompt).not.toContain('Mrs Smith');
    expect(capturedSystemPrompt).not.toContain('07700');
    expect(capturedSystemPrompt).not.toContain('@example.com');
  });
});

// ─── D. Quota gating ──────────────────────────────────────────────────────────

describe('D. Quota gating', () => {
  const CURRENT_PERIOD = new Date().toISOString().slice(0, 7);

  it('allows build when free user has used 0 of 3 this month', async () => {
    mockProfileResult = {
      data: { hourly_rate: 25, vat_number: null, plan: 'free', ai_quote_builds_count: 0, ai_quote_builds_period: CURRENT_PERIOD },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit bathroom tiles' }));
    expect(res.statusCode).toBe(200);
  });

  it('allows build when free user has used 2 of 3 this month', async () => {
    mockProfileResult = {
      data: { hourly_rate: 25, vat_number: null, plan: 'free', ai_quote_builds_count: 2, ai_quote_builds_period: CURRENT_PERIOD },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit bathroom tiles' }));
    expect(res.statusCode).toBe(200);
  });

  it('returns 402 quota_exceeded when free user has used 3 of 3 this month', async () => {
    mockProfileResult = {
      data: { hourly_rate: 25, vat_number: null, plan: 'free', ai_quote_builds_count: 3, ai_quote_builds_period: CURRENT_PERIOD },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit bathroom tiles' }));
    expect(res.statusCode).toBe(402);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('quota_exceeded');
    expect(body.message).toBeTruthy();
  });

  it('resets the counter when the stored period is a past month', async () => {
    // Period is last month — counter should be treated as 0
    mockProfileResult = {
      data: { hourly_rate: 25, vat_number: null, plan: 'free', ai_quote_builds_count: 3, ai_quote_builds_period: '2026-04' },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit bathroom tiles' }));
    // Should succeed because the period doesn't match — count resets to 0
    expect(res.statusCode).toBe(200);
  });

  it('allows unlimited builds for Pro users regardless of count', async () => {
    mockProfileResult = {
      data: { hourly_rate: 25, vat_number: null, plan: 'pro', ai_quote_builds_count: 999, ai_quote_builds_period: CURRENT_PERIOD },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit bathroom tiles' }));
    expect(res.statusCode).toBe(200);
  });

  it('does not call Anthropic when quota is exceeded', async () => {
    mockProfileResult = {
      data: { hourly_rate: 25, vat_number: null, plan: 'free', ai_quote_builds_count: 3, ai_quote_builds_period: CURRENT_PERIOD },
      error: null,
    };
    const handler = await getHandler();
    await handler(makeEvent({ description: 'Fit bathroom tiles' }));
    // fetch should not have been called (quota gate fires before AI call)
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── E. Structured output — lineItems shape ───────────────────────────────────

describe('E. Structured output', () => {
  it('returns 200 with lineItems array and total', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit bathroom tiles' }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.lineItems)).toBe(true);
    expect(body.lineItems.length).toBeGreaterThan(0);
    expect(typeof body.total).toBe('number');
  });

  it('returns lineItems with required desc and cost fields', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit bathroom tiles' }));
    const { lineItems } = JSON.parse(res.body);
    for (const item of lineItems) {
      expect(typeof item.desc).toBe('string');
      expect(item.desc.length).toBeGreaterThan(0);
      expect(typeof item.cost).toBe('number');
      expect(item.cost).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns lowConfidence flag on uncertain items', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicSuccess([
      { desc: 'Labour', cost: 200, provenance: 'labour' },
      { desc: 'Unknown specialist part', cost: 50, provenance: 'estimate', lowConfidence: true },
    ], 250));

    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit some specialist thing' }));
    const { lineItems } = JSON.parse(res.body);
    const uncertain = lineItems.find(i => i.lowConfidence === true);
    expect(uncertain).toBeDefined();
    expect(uncertain.desc).toBe('Unknown specialist part');
  });

  it('sanitises desc to max 200 characters', async () => {
    mockFetch.mockResolvedValueOnce(makeAnthropicSuccess([
      { desc: 'x'.repeat(300), cost: 100 },
    ], 100));

    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Some job description' }));
    const { lineItems } = JSON.parse(res.body);
    expect(lineItems[0].desc.length).toBeLessThanOrEqual(200);
  });

  it('returned total matches sum of lineItems costs (rounded to 2dp)', async () => {
    const items = [
      { desc: 'Labour', cost: 200 },
      { desc: 'Materials', cost: 150.5 },
    ];
    mockFetch.mockResolvedValueOnce(makeAnthropicSuccess(items, 350.5));

    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit tiles' }));
    const body = JSON.parse(res.body);
    const sumFromItems = body.lineItems.reduce((s, i) => s + i.cost, 0);
    expect(Math.round(sumFromItems * 100) / 100).toBe(body.total);
  });

  it('sets vatRegistered based on profile.vat_number', async () => {
    mockProfileResult = {
      data: { hourly_rate: 25, vat_number: 'GB123456789', plan: 'free', ai_quote_builds_count: 0, ai_quote_builds_period: null },
      error: null,
    };

    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit tiles' }));
    const body = JSON.parse(res.body);
    expect(body.vatRegistered).toBe(true);
  });
});

// ─── F. Error handling ─────────────────────────────────────────────────────────

describe('F. Error handling', () => {
  it('returns 502 when Anthropic API returns non-200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 529,
      text: async () => 'overloaded',
    });

    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit tiles' }));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toBeTruthy();
  });

  it('returns 502 when Anthropic fetch throws (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));

    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit tiles' }));
    expect(res.statusCode).toBe(502);
  });

  it('returns 502 when Anthropic response has no tool_use block', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Hello' }] }),
    });

    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit tiles' }));
    expect(res.statusCode).toBe(502);
  });

  it('returns safe defaults when profile fetch fails (uses empty history, null rate)', async () => {
    mockProfileResult = { data: null, error: { message: 'column does not exist' } };
    // Should not throw — should proceed with safe defaults and still call Anthropic
    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit bathroom tiles' }));
    // Either succeeds or fails gracefully — must not 500 with a stack trace
    expect([200, 502]).toContain(res.statusCode);
    const body = JSON.parse(res.body);
    // Must not expose a raw JS TypeError stack trace — either no error or a friendly message
    if (body.error) {
      expect(body.error).not.toMatch(/TypeError|Cannot read/i);
    }
  });

  it('quota increment failure does not affect the 200 response', async () => {
    // Simulate the UPDATE failing (fire-and-forget — should not affect the result)
    mockUpdateResult = { error: { message: 'update failed' } };

    const handler = await getHandler();
    const res = await handler(makeEvent({ description: 'Fit tiles' }));
    // Result should still be 200 — the increment is fire-and-forget
    expect(res.statusCode).toBe(200);
  });
});
