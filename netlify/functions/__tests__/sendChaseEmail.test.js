/**
 * Tests for netlify/functions/_lib/sendChaseEmail.js
 *
 * No network, no Supabase connection. All DB and Resend calls are mocked.
 *
 * Covers:
 *   A. No-op returns { skipped: 'no_api_key' } when RESEND_API_KEY absent
 *   B. Calls Resend with the correct subject + deep-link URL in the body
 *   C. Swallows a Resend 4xx without throwing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendChaseEmail } from '../_lib/sendChaseEmail.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const FAKE_USER_ID = 'user-uuid-test-1234-abcd';
const FAKE_JOB_ID = 'job-uuid-test-5678-efgh';
const FAKE_TRADER_EMAIL = 'trader@example.com';
const FAKE_RESEND_KEY = 're_test_sendchaseemail_abc123';

// ── Supabase mock ─────────────────────────────────────────────────────────────

function makeAdminClient(email = FAKE_TRADER_EMAIL) {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: { email }, error: null })),
    })),
  };
}

function makeAdminClientWithNoEmail() {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: { email: null }, error: null })),
    })),
  };
}

// ── fetch mock ────────────────────────────────────────────────────────────────

let mockFetch;

beforeEach(() => {
  mockFetch = vi.fn(async () => ({ ok: true, text: async () => '' }));
  vi.stubGlobal('fetch', mockFetch);
  // Ensure RESEND_API_KEY is unset by default; set per-test where needed
  delete process.env.RESEND_API_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

// ── Test fixtures ─────────────────────────────────────────────────────────────

const BASE_JOB = {
  id: FAKE_JOB_ID,
  customer_name: 'Jane Smith',
  amount: 450,
  meta: {},
};

// ── A. No-op when RESEND_API_KEY absent ──────────────────────────────────────

describe('sendChaseEmail — A: no-op when RESEND_API_KEY absent', () => {
  it('returns { skipped: "no_api_key" } when env var is not set', async () => {
    const result = await sendChaseEmail({
      userId: FAKE_USER_ID,
      adminClient: makeAdminClient(),
      job: BASE_JOB,
      dpd: 5,
      currentTier: 1,
    });

    expect(result).toEqual({ skipped: 'no_api_key' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── B. Calls Resend with correct subject + deep-link URL ─────────────────────

describe('sendChaseEmail — B: calls Resend with correct subject + deep-link', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = FAKE_RESEND_KEY;
  });

  it('sends to Resend with the correct subject line', async () => {
    await sendChaseEmail({
      userId: FAKE_USER_ID,
      adminClient: makeAdminClient(),
      job: BASE_JOB,
      dpd: 7,
      currentTier: 2,
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');

    const body = JSON.parse(options.body);
    // Subject must contain the customer name and days overdue
    expect(body.subject).toContain('Jane Smith');
    expect(body.subject).toContain('7 days overdue');
    // Amount in subject
    expect(body.subject).toContain('£450');
    // Sent to the trader
    expect(body.to).toContain(FAKE_TRADER_EMAIL);
    // FROM is always OHNAR
    expect(body.from).toContain('alan@ohnar.co.uk');
    // Replies route to the founder's inbox, not the sending address
    expect(body.reply_to).toBe('getohnar@gmail.com');
  });

  it('includes the deep-link URL in the plain-text body', async () => {
    await sendChaseEmail({
      userId: FAKE_USER_ID,
      adminClient: makeAdminClient(),
      job: BASE_JOB,
      dpd: 3,
      currentTier: 1,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    // APP_BASE_URL reads process.env.URL at runtime; in tests it is unset so
    // the fallback 'https://ohnar.co.uk' is used.
    const expectedLink = `https://ohnar.co.uk/?job=${encodeURIComponent(FAKE_JOB_ID)}#/work`;
    expect(body.text).toContain(expectedLink);
  });

  it('sends to the TRADER email, not the customer', async () => {
    await sendChaseEmail({
      userId: FAKE_USER_ID,
      adminClient: makeAdminClient('myemail@trade.co.uk'),
      job: BASE_JOB,
      dpd: 5,
      currentTier: 1,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.to).toEqual(['myemail@trade.co.uk']);
    // Customer name appears in the body text for context, not as a recipient
    expect(body.text).toContain('Jane Smith');
  });

  it('skips sending and returns { skipped: "no_email" } when trader has no email', async () => {
    const result = await sendChaseEmail({
      userId: FAKE_USER_ID,
      adminClient: makeAdminClientWithNoEmail(),
      job: BASE_JOB,
      dpd: 5,
      currentTier: 1,
    });

    expect(result).toEqual({ skipped: 'no_email' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── C. Swallows Resend 4xx without throwing ───────────────────────────────────

describe('sendChaseEmail — C: swallows Resend 4xx without throwing', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = FAKE_RESEND_KEY;
  });

  it('returns { error } and does not throw on Resend 422', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: async () => 'Unprocessable Entity',
    });

    // Call directly — if this throws, Vitest will fail the test automatically.
    // We want to confirm it does NOT throw and returns { error }.
    const result = await sendChaseEmail({
      userId: FAKE_USER_ID,
      adminClient: makeAdminClient(),
      job: BASE_JOB,
      dpd: 5,
      currentTier: 1,
    });

    expect(result).toMatchObject({ error: expect.stringContaining('422') });
  });

  it('returns { error } and does not throw on Resend 500', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    const result = await sendChaseEmail({
      userId: FAKE_USER_ID,
      adminClient: makeAdminClient(),
      job: BASE_JOB,
      dpd: 5,
      currentTier: 1,
    });

    expect(result).toMatchObject({ error: expect.stringContaining('500') });
  });

  it('returns { error } and does not throw when fetch itself rejects (network error)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network timeout'));

    const result = await sendChaseEmail({
      userId: FAKE_USER_ID,
      adminClient: makeAdminClient(),
      job: BASE_JOB,
      dpd: 5,
      currentTier: 1,
    });

    expect(result).toMatchObject({ error: expect.any(String) });
  });
});
