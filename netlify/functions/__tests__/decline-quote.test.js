/**
 * Tests for netlify/functions/decline-quote.js — Phase G-2.
 *
 * Decline replaces the old signature-pad rejection path. The function accepts
 * { token, declinedName?, declineReason? } — no consent field required
 * (declining is a negative action; no consent gate needed).
 *
 * No network, no Supabase connection, no real push. All external calls mocked.
 *
 * Covers:
 *   A. Input validation — token shape; missing/invalid token rejected
 *   B. Missing env / Supabase config guard → 500
 *   C. Unknown quote (token not in DB) → 404
 *   D. Already-accepted quote cannot be declined — acceptance wins, blocked with alreadyAccepted
 *   E. Already-declined is idempotent — returns existing declinedAt, no double-notify
 *   F. Success path — writes quoteStatus:'declined' + declinedAt, does NOT touch canonical status
 *   G. declineReason sanitisation — truncated at 500 chars; omitted cleanly when absent (no null key)
 *   H. Trader push notification fires on a genuine (first) decline
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const FAKE_URL = 'https://abc.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-key-fake';

let mockSelectResult = null;

// Mock @supabase/supabase-js — same pattern as accept-quote.test.js.
// The default mock gives .select().eq().single() from mockSelectResult and a
// chainable .update().eq() that resolves { error: null }.
vi.mock('@supabase/supabase-js', () => {
  return {
    createClient: vi.fn(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        // update must return an object whose .eq() is an async function that
        // resolves { error: null } — not a chainable mockReturnThis() — so the
        // handler's `await .update(...).eq(...)` gets a real resolved value.
        update: vi.fn().mockReturnValue({ eq: vi.fn(async () => ({ error: null })) }),
      })),
    })),
  };
});

// sendPushToUser is a fire-and-forget push helper. We mock it so tests can
// assert it was called without touching the network or requiring VAPID keys.
const mockSendPush = vi.fn(async () => ({ sent: 1, failed: 0 }));
vi.mock('../_lib/sendPushToUser.js', () => ({
  sendPushToUser: (...args) => mockSendPush(...args),
}));

// ── test helpers ──────────────────────────────────────────────────────────────

function makeEvent(body, method = 'POST') {
  return {
    httpMethod: method,
    body: JSON.stringify(body),
  };
}

const VALID_TOKEN = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

async function getHandler() {
  const mod = await import('../decline-quote.js');
  return mod.handler;
}

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  mockSelectResult = null;
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.resetModules();
});

// ─── A. Input validation ──────────────────────────────────────────────────────

describe('A. Input validation', () => {
  it('returns 405 for non-POST methods', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({}, 'GET'));
    expect(res.statusCode).toBe(405);
  });

  it('returns 200 + empty body for OPTIONS preflight', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'OPTIONS', body: '' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
  });

  it('returns 400 for malformed JSON body', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'POST', body: '{{not-json' });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when token is missing', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ declineReason: 'Too expensive' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/invalid token/i);
  });

  it('returns 400 when token is not a UUID v4', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: 'not-a-uuid' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/invalid token/i);
  });

  it('returns 400 when token is a UUID v3 (wrong version bit)', async () => {
    const handler = await getHandler();
    const v3 = 'a0eebc99-9c0b-3ef8-bb6d-6bb9bd380a11';
    const res = await handler(makeEvent({ token: v3 }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/invalid token/i);
  });
});

// ─── B. Missing env / Supabase config guard ───────────────────────────────────

describe('B. Missing env vars', () => {
  it('returns 500 when SUPABASE_SERVICE_ROLE_KEY is not set', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });

  it('returns 500 when VITE_SUPABASE_URL is not set', async () => {
    delete process.env.VITE_SUPABASE_URL;
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });
});

// ─── C. Unknown quote (token not found) ──────────────────────────────────────

describe('C. Token not found', () => {
  it('returns 404 when the token does not match any job', async () => {
    mockSelectResult = { data: null, error: { message: 'No rows found' } };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN }));
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toMatch(/not found/i);
  });
});

// ─── D. Already-accepted quote cannot be declined ────────────────────────────

describe('D. Already-accepted quote — acceptance wins', () => {
  it('returns 200 + alreadyAccepted:true when quoteStatus is "accepted" (G-2 path)', async () => {
    const existingAt = '2026-06-23T10:00:00.000Z';
    mockSelectResult = {
      data: {
        id: 'job-uuid-123',
        user_id: 'trader-uuid-1',
        customer_name: 'Jane',
        meta: {
          quoteStatus: 'accepted',
          acceptedAt: existingAt,
          acceptedSource: 'remote',
        },
      },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, declineReason: 'Changed my mind' }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.alreadyAccepted).toBe(true);
    expect(body.acceptedAt).toBe(existingAt);
  });

  it('returns 200 + alreadyAccepted:true when acceptedSignature is present (legacy pre-G-2 path)', async () => {
    const existingAt = '2026-05-01T10:00:00.000Z';
    mockSelectResult = {
      data: {
        id: 'job-uuid-legacy',
        user_id: 'trader-uuid-1',
        customer_name: 'Jane',
        meta: {
          acceptedSignature: 'data:image/png;base64,EXISTING',
          acceptedAt: existingAt,
          acceptedSource: 'remote',
        },
      },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.alreadyAccepted).toBe(true);
    expect(body.acceptedAt).toBe(existingAt);
  });

  it('does NOT call sendPushToUser when blocked by a prior acceptance', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-accepted',
        user_id: 'trader-uuid-1',
        customer_name: 'Jane',
        meta: { quoteStatus: 'accepted', acceptedAt: '2026-06-20T09:00:00.000Z' },
      },
      error: null,
    };
    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN }));
    // Settle fire-and-forget microtasks — consistent with H tests (push never
    // scheduled on this path, but the settle makes the assertion timing-safe if
    // the early-return logic ever becomes async).
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

// ─── E. Already-declined idempotency ─────────────────────────────────────────

describe('E. Already-declined — idempotent', () => {
  it('returns 200 + alreadyDeclined:true with the original declinedAt', async () => {
    const originalDeclinedAt = '2026-06-22T08:30:00.000Z';
    mockSelectResult = {
      data: {
        id: 'job-uuid-declined',
        user_id: 'trader-uuid-2',
        customer_name: 'Bob',
        meta: {
          quoteStatus: 'declined',
          declinedAt: originalDeclinedAt,
          declineReason: 'Too pricey',
        },
      },
      error: null,
    };
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN, declineReason: 'Still too expensive' }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.alreadyDeclined).toBe(true);
    expect(body.declinedAt).toBe(originalDeclinedAt);
  });

  it('does NOT call sendPushToUser on a repeat decline (no double-notify)', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-already-declined',
        user_id: 'trader-uuid-2',
        customer_name: 'Bob',
        meta: { quoteStatus: 'declined', declinedAt: '2026-06-22T08:30:00.000Z' },
      },
      error: null,
    };
    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN }));
    // Settle fire-and-forget microtasks — consistent with H tests (push never
    // scheduled on this path, but the settle makes the assertion timing-safe if
    // the early-return logic ever becomes async).
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendPush).not.toHaveBeenCalled();
  });
});

// ─── F. Success path ──────────────────────────────────────────────────────────

describe('F. Success path — writes decline, does not touch canonical status', () => {
  it('returns 200 { declinedAt } on a valid first decline', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-fresh',
        user_id: 'trader-uuid-3',
        customer_name: 'Sam',
        meta: { quoteStatus: 'sent', status: 'quoted' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      })),
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN }));

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.declinedAt).toBeDefined();
    expect(typeof body.declinedAt).toBe('string');
    // No internal IDs or tokens leaked in the response
    expect(body.id).toBeUndefined();
    expect(body.token).toBeUndefined();
  });

  it('writes quoteStatus:"declined" and declinedAt into meta', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-meta-check',
        user_id: 'trader-uuid-3',
        customer_name: 'Sam',
        meta: { quoteStatus: 'sent', status: 'quoted' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          ref.value = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN }));

    expect(res.statusCode).toBe(200);
    // ref.value must be non-null — if update was never called, the mock wiring
    // has broken and this test must fail rather than silently pass.
    expect(ref.value).not.toBeNull();
    expect(ref.value.quoteStatus).toBe('declined');
    expect(ref.value.declinedAt).toBeDefined();
    expect(typeof ref.value.declinedAt).toBe('string');
  });

  it('does NOT advance the canonical status field — trader can reopen', async () => {
    // The canonical status (meta.status) must remain unchanged so the trader
    // can reopen and resend. Decline must never push status to a terminal value.
    mockSelectResult = {
      data: {
        id: 'job-uuid-status-guard',
        user_id: 'trader-uuid-3',
        customer_name: 'Sam',
        meta: { quoteStatus: 'sent', status: 'quoted' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          ref.value = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN }));

    // ref.value must be non-null — this is the critical-invariant test.
    // A null ref means .update() was never called, which is itself a bug.
    expect(ref.value).not.toBeNull();
    // status must stay 'quoted' — not changed to anything else
    expect(ref.value.status).toBe('quoted');
    // jobStatus must not be written by this function
    expect(ref.value.jobStatus).toBeUndefined();
  });

  it('preserves existing meta fields when writing decline', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-preserve',
        user_id: 'trader-uuid-3',
        customer_name: 'Sam',
        meta: {
          quoteStatus: 'sent',
          status: 'quoted',
          publicAccessToken: VALID_TOKEN,
          totalValue: 1200,
        },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          ref.value = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN }));

    // ref.value must be non-null — update must have been called with the merged payload.
    expect(ref.value).not.toBeNull();
    expect(ref.value.totalValue).toBe(1200);
    expect(ref.value.publicAccessToken).toBe(VALID_TOKEN);
  });
});

// ─── G. declineReason / declinedName sanitisation ────────────────────────────

describe('G. declineReason and declinedName sanitisation', () => {
  it('truncates declineReason to 500 characters', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-reason',
        user_id: 'trader-uuid-4',
        customer_name: 'Alex',
        meta: { quoteStatus: 'sent' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          ref.value = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const longReason = 'R'.repeat(700);
    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN, declineReason: longReason }));

    expect(ref.value).not.toBeNull();
    expect(ref.value.declineReason).toBeDefined();
    expect(ref.value.declineReason.length).toBeLessThanOrEqual(500);
  });

  it('omits declineReason key entirely when not supplied — no explicit null', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-no-reason',
        user_id: 'trader-uuid-4',
        customer_name: 'Alex',
        meta: { quoteStatus: 'sent' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          ref.value = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN }));

    expect(ref.value).not.toBeNull();
    // Key must be absent — not null, not undefined-valued; absence is the contract.
    expect(Object.prototype.hasOwnProperty.call(ref.value, 'declineReason')).toBe(false);
  });

  it('omits declinedName key entirely when not supplied', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-no-name',
        user_id: 'trader-uuid-4',
        customer_name: 'Alex',
        meta: { quoteStatus: 'sent' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          ref.value = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN }));

    expect(ref.value).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(ref.value, 'declinedName')).toBe(false);
  });

  it('trims leading/trailing whitespace from declineReason', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-trim',
        user_id: 'trader-uuid-4',
        customer_name: 'Alex',
        meta: { quoteStatus: 'sent' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          ref.value = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN, declineReason: '  Too expensive  ' }));

    expect(ref.value).not.toBeNull();
    expect(ref.value.declineReason).toBe('Too expensive');
  });

  it('truncates declinedName to 200 characters', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-name-truncate',
        user_id: 'trader-uuid-4',
        customer_name: 'Alex',
        meta: { quoteStatus: 'sent' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          ref.value = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const longName = 'N'.repeat(300);
    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN, declinedName: longName }));

    expect(ref.value).not.toBeNull();
    expect(ref.value.declinedName.length).toBeLessThanOrEqual(200);
  });

  it('omits declineReason when an empty string is supplied', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-empty-reason',
        user_id: 'trader-uuid-4',
        customer_name: 'Alex',
        meta: { quoteStatus: 'sent' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    const ref = { value: null };
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn((payload) => {
          ref.value = payload?.meta;
          return { eq: vi.fn(async () => ({ error: null })) };
        }),
      })),
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN, declineReason: '' }));

    expect(ref.value).not.toBeNull();
    // Empty string sanitises to falsy → should be omitted, not stored as ''
    expect(Object.prototype.hasOwnProperty.call(ref.value, 'declineReason')).toBe(false);
  });
});

// ─── H. Trader push notification ─────────────────────────────────────────────

describe('H. Trader push notification on genuine decline', () => {
  it('calls sendPushToUser with the trader user_id on a first decline', async () => {
    const traderId = 'trader-uuid-push-test';
    mockSelectResult = {
      data: {
        id: 'job-uuid-push',
        user_id: traderId,
        customer_name: 'Chris',
        meta: { quoteStatus: 'sent', status: 'quoted' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      })),
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN }));

    expect(res.statusCode).toBe(200);
    // Allow for async fire-and-forget to settle before asserting
    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendPush).toHaveBeenCalledTimes(1);
    expect(mockSendPush).toHaveBeenCalledWith(
      traderId,
      expect.objectContaining({
        title: expect.stringMatching(/declined/i),
      })
    );
  });

  it('includes the declineReason snippet in the push body', async () => {
    const traderId = 'trader-uuid-push-reason';
    mockSelectResult = {
      data: {
        id: 'job-uuid-push-reason',
        user_id: traderId,
        customer_name: 'Dana',
        meta: { quoteStatus: 'sent', status: 'quoted' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      })),
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN, declineReason: 'Price is too high' }));

    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendPush).toHaveBeenCalledWith(
      traderId,
      expect.objectContaining({
        body: expect.stringContaining('Price is too high'),
      })
    );
  });

  it('push body uses customer_name from the job row when available', async () => {
    const traderId = 'trader-uuid-push-name';
    mockSelectResult = {
      data: {
        id: 'job-uuid-push-name',
        user_id: traderId,
        customer_name: 'Jordan Smith',
        meta: { quoteStatus: 'sent' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      })),
    }));

    const handler = await getHandler();
    await handler(makeEvent({ token: VALID_TOKEN }));

    await new Promise((r) => setTimeout(r, 10));
    expect(mockSendPush).toHaveBeenCalledWith(
      traderId,
      expect.objectContaining({
        body: expect.stringContaining('Jordan Smith'),
      })
    );
  });
});

// ─── I. DB update error ───────────────────────────────────────────────────────

describe('I. DB update error — 502 on write failure', () => {
  it('returns 502 when the update query returns an error', async () => {
    mockSelectResult = {
      data: {
        id: 'job-uuid-update-fail',
        user_id: 'trader-uuid-5',
        customer_name: 'Pat',
        meta: { quoteStatus: 'sent', status: 'quoted' },
      },
      error: null,
    };
    const { createClient } = await import('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(async () => mockSelectResult),
        update: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: { message: 'DB write failed' } })),
        })),
      })),
    }));

    const handler = await getHandler();
    const res = await handler(makeEvent({ token: VALID_TOKEN }));

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/save|decision/i);
  });
});
