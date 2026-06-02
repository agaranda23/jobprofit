/**
 * Tests for src/lib/generateQuote.js
 *
 * Verifies:
 *   A. Auth — returns { error: 'Not signed in' } when no session
 *   B. Success — returns structured { lineItems, total, vatRegistered, hourlyRate }
 *   C. Quota exceeded — returns { error: 'quota_exceeded', message }
 *   D. Server errors — non-200 response → { error }
 *   E. Network failure → { error }
 *   F. Output shape is compatible with buildQuotePayload (line item { desc, cost })
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Supabase mock ─────────────────────────────────────────────────────────────
let mockGetSession = vi.fn();

vi.mock('../supabase.js', () => ({
  supabase: {
    auth: {
      getSession: (...args) => mockGetSession(...args),
    },
  },
}));

// ── fetch mock ────────────────────────────────────────────────────────────────
let mockFetch = vi.fn();
global.fetch = mockFetch;

async function getGenerateQuote() {
  const mod = await import('../generateQuote.js');
  return mod.generateQuote;
}

const SAMPLE_ITEMS = [
  { desc: 'Labour — 8 hours', cost: 200, provenance: 'labour' },
  { desc: 'Tiles 10m²', cost: 150, provenance: 'history' },
  { desc: 'Adhesive', cost: 40, provenance: 'estimate', lowConfidence: true },
];

beforeEach(() => {
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'test-jwt-token' } },
  });
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      lineItems: SAMPLE_ITEMS,
      total: 390,
      vatRegistered: false,
      hourlyRate: 25,
    }),
  });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetModules();
});

// ─── A. Auth ──────────────────────────────────────────────────────────────────

describe('A. Auth', () => {
  it('returns error when no session', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(result.error).toBe('Not signed in');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns error when getSession throws', async () => {
    mockGetSession.mockRejectedValueOnce(new Error('auth error'));
    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(result.error).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns error when description is empty', async () => {
    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('');
    expect(result.error).toBeTruthy();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends Authorization Bearer header in the request', async () => {
    const generateQuote = await getGenerateQuote();
    await generateQuote('Fit bathroom tiles');
    expect(mockFetch).toHaveBeenCalledOnce();
    const [, opts] = mockFetch.mock.calls[0];
    expect(opts.headers['Authorization']).toBe('Bearer test-jwt-token');
  });
});

// ─── B. Success path ──────────────────────────────────────────────────────────

describe('B. Success path', () => {
  it('returns lineItems array with desc and cost on success', async () => {
    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(result.error).toBeUndefined();
    expect(Array.isArray(result.lineItems)).toBe(true);
    for (const item of result.lineItems) {
      expect(typeof item.desc).toBe('string');
      expect(typeof item.cost).toBe('number');
    }
  });

  it('returns total as a number', async () => {
    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(typeof result.total).toBe('number');
    expect(result.total).toBe(390);
  });

  it('returns vatRegistered flag', async () => {
    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(typeof result.vatRegistered).toBe('boolean');
  });

  it('returns hourlyRate when provided', async () => {
    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(result.hourlyRate).toBe(25);
  });
});

// ─── C. Quota exceeded ────────────────────────────────────────────────────────

describe('C. Quota exceeded', () => {
  it('returns error: quota_exceeded when server returns 402', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 402,
      json: async () => ({
        error: 'quota_exceeded',
        message: "You've used your 3 free AI quotes this month.",
        quota: 3,
        used: 3,
      }),
    });

    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(result.error).toBe('quota_exceeded');
    expect(result.message).toBeTruthy();
    expect(result.quota).toBe(3);
    expect(result.used).toBe(3);
  });

  it('handles quota_exceeded even when status is 200 but error field is quota_exceeded', async () => {
    // Belt-and-braces: server might return 200 with error field
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        error: 'quota_exceeded',
        message: "Quota exceeded.",
      }),
    });

    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(result.error).toBe('quota_exceeded');
  });
});

// ─── D. Server errors ─────────────────────────────────────────────────────────

describe('D. Server errors', () => {
  it('returns error on 401 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' }),
    });

    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(result.error).toBeTruthy();
  });

  it('returns error on 502 response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: 'AI service error' }),
    });

    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(result.error).toBeTruthy();
    expect(result.lineItems).toBeUndefined();
  });

  it('returns error when response JSON has an error field', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ error: 'Something went wrong' }),
    });

    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(result.error).toBeTruthy();
  });

  it('returns error when lineItems is empty', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ lineItems: [], total: 0 }),
    });

    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(result.error).toBeTruthy();
  });
});

// ─── E. Network failure ───────────────────────────────────────────────────────

describe('E. Network failure', () => {
  it('returns error on fetch network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Failed to fetch'));
    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    expect(result.error).toContain('Network failure');
  });
});

// ─── F. buildQuotePayload compatibility ───────────────────────────────────────

describe('F. Output shape compatible with buildQuotePayload', () => {
  it('each lineItem has desc (string) and cost (number) matching the expected shape', async () => {
    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');

    // buildQuotePayload expects lineItems of shape { desc: string, cost: number }
    // and filters with: li.desc.trim() || parseFloat(li.cost) > 0
    for (const item of result.lineItems) {
      expect(typeof item.desc).toBe('string');
      expect(item.desc.trim().length).toBeGreaterThan(0);
      expect(typeof item.cost).toBe('number');
      // cost should be parseable by parseFloat (used in buildQuotePayload)
      expect(parseFloat(item.cost)).toBeGreaterThanOrEqual(0);
    }
  });

  it('total matches the sum of lineItem costs', async () => {
    const generateQuote = await getGenerateQuote();
    const result = await generateQuote('Fit bathroom tiles');
    const sumFromItems = result.lineItems.reduce((s, i) => s + i.cost, 0);
    // Allow tiny floating-point rounding tolerance
    expect(Math.abs(sumFromItems - result.total)).toBeLessThan(0.01);
  });
});
