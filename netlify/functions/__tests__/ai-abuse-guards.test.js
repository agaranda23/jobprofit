/**
 * ai.js — abuse guard tests (FIX 2 — stress-test-batch-1)
 *
 * Covers:
 *   A. Body size cap — payloads > 500,000 chars return 413 before JSON.parse
 *   B. Model allowlist — unknown models are coerced to default haiku, not rejected
 *   C. max_tokens cap — values > 1500 are clamped server-side
 *   D. Per-user rate limit — 61st request within 60 s returns 429
 *   E. JWT still required — unauthenticated requests return 401 before guards run
 *   F. Normal voice-parse and receipt-OCR payloads pass through unblocked
 *
 * No real network calls. All Supabase and fetch calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Env vars ─────────────────────────────────────────────────────────────────
process.env.VITE_SUPABASE_URL        = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-test';
process.env.ANTHROPIC_API_KEY         = 'sk-ant-test-key';

// ── Supabase mock ─────────────────────────────────────────────────────────────
let mockGetUser = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: (...args) => mockGetUser(...args) },
  })),
}));

// ── fetch mock (Anthropic API) ────────────────────────────────────────────────
let mockFetch = vi.fn();
global.fetch = mockFetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

const AUTH_HEADER = { authorization: 'Bearer valid-token' };

// Successful Anthropic response shape (minimal)
function anthropicOk() {
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: '{"name":"Job"}' }] }),
  };
}

// Build a minimal valid voice-parse payload
function voiceParseBody(overrides = {}) {
  return {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 160,
    system: 'Extract job info',
    messages: [{ role: 'user', content: 'Bathroom tiles £380 cash' }],
    ...overrides,
  };
}

// Build a POST event as Netlify would pass it
function makeEvent(body, headers = AUTH_HEADER) {
  return {
    httpMethod: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

// ── Module import — done AFTER mocks are set up ───────────────────────────────
// We re-import the handler each describe block to get a fresh module (and fresh
// rate-limit map) because vitest caches modules across tests in the same file.
// Using a dynamic import inside beforeEach avoids stale closure issues.

describe('ai.js — A. body size cap', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mockFetch.mockResolvedValue(anthropicOk());
  });

  it('returns 413 when body exceeds 500,000 chars (checked before JWT)', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    const oversized = 'x'.repeat(500_001);
    const res = await handler({ httpMethod: 'POST', headers: AUTH_HEADER, body: oversized });
    expect(res.statusCode).toBe(413);
    expect(JSON.parse(res.body).error).toMatch(/too large/i);
  });

  it('allows a body of exactly 500,000 chars through', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    // Build a valid JSON payload padded to 500,000 chars with whitespace in the message
    const padding = ' '.repeat(500_000 - JSON.stringify(voiceParseBody()).length);
    const body = voiceParseBody({ messages: [{ role: 'user', content: 'Job' + padding }] });
    const bodyStr = JSON.stringify(body);
    // Ensure it's exactly at or under the limit
    expect(bodyStr.length).toBeLessThanOrEqual(500_000);
    const res = await handler(makeEvent(body));
    expect(res.statusCode).toBe(200);
  });
});

describe('ai.js — B. model allowlist (coerce to default)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-b' } }, error: null });
  });

  it('coerces an unknown model to claude-haiku-4-5-20251001 instead of rejecting', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    let capturedBody;
    mockFetch.mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return anthropicOk();
    });
    const body = voiceParseBody({ model: 'gpt-4o-never-allowed' });
    const res = await handler(makeEvent(body));
    expect(res.statusCode).toBe(200);
    expect(capturedBody.model).toBe('claude-haiku-4-5-20251001');
  });

  it('forwards claude-haiku-4-5-20251001 unchanged', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    let capturedBody;
    mockFetch.mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return anthropicOk();
    });
    const res = await handler(makeEvent(voiceParseBody({ model: 'claude-haiku-4-5-20251001' })));
    expect(res.statusCode).toBe(200);
    expect(capturedBody.model).toBe('claude-haiku-4-5-20251001');
  });

  it('forwards claude-sonnet-4-5-20250929 unchanged (receiptOCR legacy)', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    let capturedBody;
    mockFetch.mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return anthropicOk();
    });
    const res = await handler(makeEvent(voiceParseBody({ model: 'claude-sonnet-4-5-20250929', max_tokens: 800 })));
    expect(res.statusCode).toBe(200);
    expect(capturedBody.model).toBe('claude-sonnet-4-5-20250929');
  });

  it('forwards claude-sonnet-4-6 unchanged', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    let capturedBody;
    mockFetch.mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return anthropicOk();
    });
    const res = await handler(makeEvent(voiceParseBody({ model: 'claude-sonnet-4-6', max_tokens: 300 })));
    expect(res.statusCode).toBe(200);
    expect(capturedBody.model).toBe('claude-sonnet-4-6');
  });
});

describe('ai.js — C. max_tokens cap', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-c' } }, error: null });
  });

  it('clamps max_tokens from 99999 down to 1500', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    let capturedBody;
    mockFetch.mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return anthropicOk();
    });
    const res = await handler(makeEvent(voiceParseBody({ max_tokens: 99_999 })));
    expect(res.statusCode).toBe(200);
    expect(capturedBody.max_tokens).toBe(1500);
  });

  it('passes max_tokens of 160 through unchanged (well under cap)', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    let capturedBody;
    mockFetch.mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return anthropicOk();
    });
    const res = await handler(makeEvent(voiceParseBody({ max_tokens: 160 })));
    expect(res.statusCode).toBe(200);
    expect(capturedBody.max_tokens).toBe(160);
  });

  it('passes max_tokens of exactly 1500 through unchanged', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    let capturedBody;
    mockFetch.mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return anthropicOk();
    });
    const res = await handler(makeEvent(voiceParseBody({ max_tokens: 1500 })));
    expect(res.statusCode).toBe(200);
    expect(capturedBody.max_tokens).toBe(1500);
  });

  it('defaults missing max_tokens to 1500', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    let capturedBody;
    mockFetch.mockImplementation(async (_url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return anthropicOk();
    });
    const body = voiceParseBody();
    delete body.max_tokens;
    const res = await handler(makeEvent(body));
    expect(res.statusCode).toBe(200);
    expect(capturedBody.max_tokens).toBe(1500);
  });
});

describe('ai.js — D. per-user rate limit', () => {
  it('returns 429 on the 61st request within the 60-second window', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    // Use a unique user id so the counter starts at zero for this test
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-rate-test' } }, error: null });
    mockFetch.mockResolvedValue(anthropicOk());

    // Fire 60 requests — all should succeed
    for (let i = 0; i < 60; i++) {
      const res = await handler(makeEvent(voiceParseBody()));
      expect(res.statusCode).toBe(200);
    }
    // 61st should hit the rate limit
    const res = await handler(makeEvent(voiceParseBody()));
    expect(res.statusCode).toBe(429);
    expect(JSON.parse(res.body).error).toMatch(/too many requests/i);
  });

  it('allows requests from different users to proceed independently', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    mockFetch.mockResolvedValue(anthropicOk());

    // Exhaust the limit for user-A
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-A-isolated' } }, error: null });
    for (let i = 0; i < 60; i++) {
      await handler(makeEvent(voiceParseBody()));
    }
    // user-A is rate limited
    const resA = await handler(makeEvent(voiceParseBody()));
    expect(resA.statusCode).toBe(429);

    // user-B should still be allowed through
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-B-isolated' } }, error: null });
    const resB = await handler(makeEvent(voiceParseBody()));
    expect(resB.statusCode).toBe(200);
  });
});

describe('ai.js — E. JWT still required (guards after 413, before rate limit)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 401 when no Authorization header is present', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    const res = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(voiceParseBody()) });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when JWT verification fails', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid token' } });
    const res = await handler(makeEvent(voiceParseBody()));
    expect(res.statusCode).toBe(401);
  });
});

describe('ai.js — F. normal caller payloads are unblocked', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-normal' } }, error: null });
    mockFetch.mockResolvedValue(anthropicOk());
  });

  it('voice-parse payload (haiku, 160 tokens) passes through', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    const res = await handler(makeEvent(voiceParseBody()));
    expect(res.statusCode).toBe(200);
  });

  it('estimatorParse payload (haiku, 300 tokens) passes through', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    const body = voiceParseBody({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: '6 by 6 patio single skin' }] });
    const res = await handler(makeEvent(body));
    expect(res.statusCode).toBe(200);
  });

  it('receiptOCR payload (sonnet, 800 tokens, image content) passes through', async () => {
    vi.resetModules();
    const { handler } = await import('../ai.js');
    const body = {
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 800,
      system: 'You read UK trade receipts.',
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'abc123' } },
          { type: 'text', text: 'Extract the receipt data as JSON.' },
        ],
      }],
    };
    const res = await handler(makeEvent(body));
    expect(res.statusCode).toBe(200);
  });
});
