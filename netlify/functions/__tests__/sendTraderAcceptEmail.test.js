/**
 * Tests for netlify/functions/_lib/sendTraderAcceptEmail.js
 *
 * Covers:
 *   A. No-op when RESEND_API_KEY is unset
 *   B. Calls Resend with correct headers and body shape
 *   C. Returns { ok: true } on Resend 200
 *   D. Returns { ok: false } and does not throw on Resend 4xx
 *   E. Returns { ok: false } and does not throw when fetch times out / throws
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_KEY = 'resend-fake-key';

const BASE_ARGS = {
  traderEmail: 'trader@example.com',
  traderBusinessName: 'Ace Plumbing Ltd',
  customerName: 'Jane Customer',
  jobDescription: 'Bathroom refit',
  amount: '1200.00',
  acceptedAt: '2026-05-21T10:30:00.000Z',
};

async function getHelper() {
  const mod = await import('../_lib/sendTraderAcceptEmail.js');
  return mod.sendTraderAcceptEmail;
}

beforeEach(() => {
  process.env.RESEND_API_KEY = FAKE_KEY;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.APP_BASE_URL;
  vi.resetModules();
  vi.restoreAllMocks();
});

// ─── A. No API key ────────────────────────────────────────────────────────────

describe('A. RESEND_API_KEY not set', () => {
  it('returns { ok: false, reason: "no_api_key" } and makes no fetch call', async () => {
    delete process.env.RESEND_API_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const fn = await getHelper();
    const result = await fn(BASE_ARGS);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_api_key');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ─── B. Correct Resend request shape ─────────────────────────────────────────

describe('B. Resend request shape', () => {
  it('POSTs to the Resend endpoint with Bearer auth header', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'test-id' }), { status: 200 })
    );

    const fn = await getHelper();
    await fn(BASE_ARGS);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe(`Bearer ${FAKE_KEY}`);
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends the correct from, to, subject fields', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'test-id' }), { status: 200 })
    );

    const fn = await getHelper();
    await fn(BASE_ARGS);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.from).toContain('onboarding@resend.dev');
    expect(body.to).toBe('trader@example.com');
    expect(body.subject).toContain('Jane Customer');
    expect(body.subject).toContain('1200.00');
    expect(body.html).toBeDefined();
    expect(body.text).toBeDefined();
  });

  it('uses APP_BASE_URL env var in the email body when set', async () => {
    process.env.APP_BASE_URL = 'https://staging.jobprofit.netlify.app';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'test-id' }), { status: 200 })
    );

    const fn = await getHelper();
    await fn(BASE_ARGS);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.html).toContain('staging.jobprofit.netlify.app');
    expect(body.text).toContain('staging.jobprofit.netlify.app');
  });

  it('defaults to jobprofit.netlify.app when APP_BASE_URL is unset', async () => {
    delete process.env.APP_BASE_URL;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'test-id' }), { status: 200 })
    );

    const fn = await getHelper();
    await fn(BASE_ARGS);

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.html).toContain('jobprofit.netlify.app');
  });
});

// ─── C. Resend 200 success ────────────────────────────────────────────────────

describe('C. Resend success response', () => {
  it('returns { ok: true, id } when Resend returns 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'abc-123' }), { status: 200 })
    );

    const fn = await getHelper();
    const result = await fn(BASE_ARGS);

    expect(result.ok).toBe(true);
    expect(result.id).toBe('abc-123');
  });
});

// ─── D. Resend 4xx/5xx ───────────────────────────────────────────────────────

describe('D. Resend error responses', () => {
  it('returns { ok: false, reason: "resend_error" } on 422 and does not throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"message":"Invalid to address"}', { status: 422 })
    );

    const fn = await getHelper();
    const result = await fn(BASE_ARGS);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('resend_error');
    expect(result.status).toBe(422);
  });

  it('returns { ok: false, reason: "resend_error" } on 500 and does not throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 })
    );

    const fn = await getHelper();
    const result = await fn(BASE_ARGS);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('resend_error');
  });
});

// ─── E. Network failures ──────────────────────────────────────────────────────

describe('E. Network / timeout failures', () => {
  it('returns { ok: false } and does not throw when fetch rejects (timeout / network)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new DOMException('The operation was aborted', 'AbortError')
    );

    const fn = await getHelper();
    const result = await fn(BASE_ARGS);

    expect(result.ok).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('handles null/undefined customerName gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'ok-id' }), { status: 200 })
    );

    const fn = await getHelper();
    const result = await fn({ ...BASE_ARGS, customerName: null });

    expect(result.ok).toBe(true);
  });

  it('handles null jobDescription gracefully', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'ok-id' }), { status: 200 })
    );

    const fn = await getHelper();
    const result = await fn({ ...BASE_ARGS, jobDescription: null });

    expect(result.ok).toBe(true);
  });
});
