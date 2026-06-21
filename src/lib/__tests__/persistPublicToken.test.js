/**
 * persistPublicToken — unit tests for the fix to the "Quote not found" bug.
 *
 * Root cause: publicAccessToken was written to the cloud fire-and-forget.
 * The customer could open the /q/<token> link before the cloud write landed
 * and see "Quote not found."
 *
 * Fix: persistPublicToken awaits updateJobMetaInCloud before returning,
 * and callers (ReviewSheet/SendInvoiceModal) await it before producing the
 * shareable URL/PDF.
 *
 * No DOM, no React. Supabase is mocked inline — same convention as
 * jobMetaCloud.test.js.
 *
 * Covers:
 *   A. persistPublicToken — happy path returns { ok: true }
 *   B. persistPublicToken — offline path returns { ok: false, offline: true }
 *   C. persistPublicToken — Supabase error returns { ok: false, error: string }
 *   D. fetchPublicJob — token found returns a mapped job object
 *   E. fetchPublicJob — token not found (zero rows) returns null without throwing
 *   F. fetchPublicJob — Supabase query error returns null without throwing
 *   G. publicAccessToken must exist in META_FIELDS (localStorage round-trip)
 *   H. persistPublicToken is called before the link URL is produced (order test)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeJobMeta, readJobMeta, extractJobMeta } from '../jobMeta';

// ── localStorage mock ─────────────────────────────────────────────────────────

function makeLocalStorageMock() {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
}

const lsMock = makeLocalStorageMock();
vi.stubGlobal('localStorage', lsMock);

beforeEach(() => {
  lsMock.clear();
  vi.clearAllMocks();
});

// ── Inline mirrors of the functions under test ────────────────────────────────
// store.js imports supabase at module load and requires env vars — we can't
// import it in unit tests. Instead, we mirror the guard logic exactly and
// inject a mock Supabase client, matching the convention in jobMetaCloud.test.js.

/**
 * Mirrors updateJobMetaInCloud from src/lib/store.js.
 * Same guard logic; Supabase client injected for testability.
 */
async function updateJobMetaInCloudMirror(jobId, metaObject, { supabase, getUserId }) {
  if (!jobId || !metaObject) return { ok: false, error: 'missing-args' };

  let user_id;
  try {
    user_id = await getUserId();
  } catch {
    return { ok: false, error: 'offline' };
  }

  if (!user_id) {
    return { ok: false, error: 'offline' };
  }

  const updatePayload = { meta: metaObject };
  if (Array.isArray(metaObject.lineItems)) {
    updatePayload.line_items = metaObject.lineItems;
  }

  try {
    const { error } = await supabase
      .from('jobs')
      .update(updatePayload)
      .eq('id', jobId);

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

/**
 * Mirrors persistPublicToken from src/lib/store.js.
 */
async function persistPublicTokenMirror(jobId, meta, deps) {
  const result = await updateJobMetaInCloudMirror(jobId, meta, deps);
  if (!result.ok) {
    if (result.error === 'offline') return { ok: false, offline: true };
    return { ok: false, error: result.error };
  }
  return { ok: true };
}

/**
 * Mirrors fetchPublicJob from src/lib/store.js.
 * Uses .maybeSingle() so zero-row results don't produce a PostgREST error.
 */
async function fetchPublicJobMirror(token, supabase) {
  if (!token) return null;
  const { data, error } = await supabase
    .from('jobs')
    .select('id, customer_name, summary, amount, paid, line_items, meta, date, created_at')
    .eq('meta->>publicAccessToken', token)
    .maybeSingle();

  if (error) {
    console.warn('[fetchPublicJob] query error for token', token?.slice(0, 8), error?.message);
    return null;
  }
  if (!data) {
    console.warn('[fetchPublicJob] token not found in jobs.meta', token?.slice(0, 8));
    return null;
  }
  return data;
}

// ── Supabase mock helpers ─────────────────────────────────────────────────────

function makeSupabaseMock({ updateError = null, selectData = null, selectError = null } = {}) {
  const queryBuilder = {
    update: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: selectData, error: selectError }),
  };
  // update chain returns a different terminal
  queryBuilder.update.mockImplementation(() => ({
    eq: vi.fn().mockResolvedValue({ error: updateError }),
  }));

  return {
    from: vi.fn().mockReturnValue(queryBuilder),
    _queryBuilder: queryBuilder,
  };
}

// ── A. persistPublicToken — happy path ────────────────────────────────────────

describe('persistPublicToken — happy path', () => {
  it('returns { ok: true } when cloud write succeeds', async () => {
    const supabase = makeSupabaseMock({ updateError: null });
    const result = await persistPublicTokenMirror(
      'job-uuid-1',
      { publicAccessToken: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quoteStatus: 'sent' },
      { supabase, getUserId: () => Promise.resolve('user-123') },
    );
    expect(result.ok).toBe(true);
    expect(result.offline).toBeUndefined();
  });
});

// ── B. persistPublicToken — offline ──────────────────────────────────────────

describe('persistPublicToken — offline', () => {
  it('returns { ok: false, offline: true } when getUserId throws', async () => {
    const supabase = makeSupabaseMock();
    const result = await persistPublicTokenMirror(
      'job-uuid-2',
      { publicAccessToken: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      { supabase, getUserId: () => { throw new Error('Network Error'); } },
    );
    expect(result.ok).toBe(false);
    expect(result.offline).toBe(true);
  });

  it('returns { ok: false, offline: true } when getUserId returns null (not signed in)', async () => {
    const supabase = makeSupabaseMock();
    const result = await persistPublicTokenMirror(
      'job-uuid-3',
      { publicAccessToken: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      { supabase, getUserId: () => Promise.resolve(null) },
    );
    expect(result.ok).toBe(false);
    expect(result.offline).toBe(true);
  });

  it('returns { ok: false, offline: true } when network throws during update', async () => {
    const queryBuilder = {
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockRejectedValue(new Error('fetch failed')),
      }),
    };
    const supabase = { from: vi.fn().mockReturnValue(queryBuilder) };
    const result = await persistPublicTokenMirror(
      'job-uuid-4',
      { publicAccessToken: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      { supabase, getUserId: () => Promise.resolve('user-123') },
    );
    expect(result.ok).toBe(false);
    expect(result.offline).toBe(true);
  });
});

// ── C. persistPublicToken — Supabase error ────────────────────────────────────

describe('persistPublicToken — Supabase error', () => {
  it('returns { ok: false, error: string } when Supabase returns a non-network error', async () => {
    const supabase = makeSupabaseMock({ updateError: { message: 'row-level security violation' } });
    const result = await persistPublicTokenMirror(
      'job-uuid-5',
      { publicAccessToken: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
      { supabase, getUserId: () => Promise.resolve('user-123') },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('row-level security violation');
    expect(result.offline).toBeUndefined();
  });
});

// ── D. fetchPublicJob — token found ──────────────────────────────────────────

describe('fetchPublicJob — token found', () => {
  it('returns the mapped job data when a row matches the token', async () => {
    const mockRow = {
      id: 'cloud-job-uuid',
      customer_name: 'Jane Bloggs',
      summary: 'Fix leaking tap',
      amount: 180,
      paid: false,
      line_items: [{ desc: 'Labour', cost: 180 }],
      meta: { publicAccessToken: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', quoteStatus: 'sent' },
      date: '2026-06-01',
      created_at: '2026-06-01T10:00:00.000Z',
    };

    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
    };
    const supabase = { from: vi.fn().mockReturnValue(queryBuilder) };

    const result = await fetchPublicJobMirror('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', supabase);

    expect(result).not.toBeNull();
    expect(result.id).toBe('cloud-job-uuid');
    expect(result.meta.publicAccessToken).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ── E. fetchPublicJob — token not found (zero rows) ──────────────────────────

describe('fetchPublicJob — token not found', () => {
  it('returns null without throwing when maybeSingle finds no rows', async () => {
    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const supabase = { from: vi.fn().mockReturnValue(queryBuilder) };

    const result = await fetchPublicJobMirror('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', supabase);
    expect(result).toBeNull();
  });

  it('returns null when token is falsy', async () => {
    const supabase = makeSupabaseMock();
    expect(await fetchPublicJobMirror('', supabase)).toBeNull();
    expect(await fetchPublicJobMirror(null, supabase)).toBeNull();
    expect(await fetchPublicJobMirror(undefined, supabase)).toBeNull();
  });
});

// ── F. fetchPublicJob — Supabase error ───────────────────────────────────────

describe('fetchPublicJob — Supabase query error', () => {
  it('returns null without throwing when Supabase returns an error', async () => {
    const queryBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'connection refused' },
      }),
    };
    const supabase = { from: vi.fn().mockReturnValue(queryBuilder) };

    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await fetchPublicJobMirror('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', supabase);
    expect(result).toBeNull();
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});

// ── G. publicAccessToken in META_FIELDS (localStorage round-trip) ─────────────

describe('publicAccessToken persists through writeJobMeta → readJobMeta', () => {
  it('token survives the localStorage round-trip via extractJobMeta', () => {
    const job = {
      id: 'j-persist-1',
      publicAccessToken: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      quoteStatus: 'sent',
      status: 'lead',
    };
    const meta = extractJobMeta(job);
    expect(meta.publicAccessToken).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');

    writeJobMeta(job.id, meta);
    const stored = readJobMeta(job.id);
    expect(stored.publicAccessToken).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });

  it('token is absent from localStorage when not set on the job', () => {
    const job = { id: 'j-persist-2', quoteStatus: 'active' };
    writeJobMeta(job.id, extractJobMeta(job));
    const stored = readJobMeta(job.id);
    expect(stored.publicAccessToken).toBeUndefined();
  });
});

// ── I. reissuePublicToken — revoke → re-share produces a new token ────────────
//
// Verifies the fix for the "dead link after revoke + re-share" bug (A8).
// The helper lives in store.js but is tested here (same file pattern as the
// other persistPublicToken-adjacent helpers, no DOM required).
//
// We mirror reissuePublicToken's pure logic inline rather than importing the
// real store.js (which requires Supabase env vars at module load).

function reissuePublicTokenMirror(job) {
  // Mirrors src/lib/store.js reissuePublicToken exactly.
  const wasRevoked = !!job?.publicTokenRevokedAt;
  if (wasRevoked || !job?.publicAccessToken) {
    return { token: crypto.randomUUID(), wasRevoked };
  }
  return { token: job.publicAccessToken, wasRevoked: false };
}

// Crypto.randomUUID is available in Node 19+. Vitest runs in Node so this is fine.
// If the environment doesn't have it, shim it.
if (typeof crypto === 'undefined' || !crypto.randomUUID) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

describe('I. reissuePublicToken — revoke → re-share', () => {
  it('(a) revoke → re-share: produces a NEW token and wasRevoked=true', () => {
    const revokedJob = {
      id: 'j-revoked',
      publicAccessToken: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      publicTokenRevokedAt: '2026-06-20T10:00:00.000Z',
    };
    const { token, wasRevoked } = reissuePublicTokenMirror(revokedJob);

    // Must be a fresh token — not the old revoked one
    expect(token).not.toBe(revokedJob.publicAccessToken);
    // Must be a valid UUID v4
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)).toBe(true);
    // wasRevoked flag tells callers to clear publicTokenRevokedAt in their meta patch
    expect(wasRevoked).toBe(true);
  });

  it('(a) revoke → re-share: each call produces a DIFFERENT fresh token (no UUID collision)', () => {
    const revokedJob = {
      id: 'j-revoked-2',
      publicAccessToken: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      publicTokenRevokedAt: '2026-06-20T10:00:00.000Z',
    };
    const { token: t1 } = reissuePublicTokenMirror(revokedJob);
    const { token: t2 } = reissuePublicTokenMirror(revokedJob);
    expect(t1).not.toBe(t2);
  });

  it('(b) non-revoked re-share: same token returned, wasRevoked=false', () => {
    const nonRevokedJob = {
      id: 'j-active',
      publicAccessToken: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      // No publicTokenRevokedAt
    };
    const { token, wasRevoked } = reissuePublicTokenMirror(nonRevokedJob);

    expect(token).toBe(nonRevokedJob.publicAccessToken);
    expect(wasRevoked).toBe(false);
  });

  it('(b) non-revoked job with publicTokenRevokedAt=undefined treated as not revoked', () => {
    const job = {
      id: 'j-not-revoked',
      publicAccessToken: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      publicTokenRevokedAt: undefined,
    };
    const { token, wasRevoked } = reissuePublicTokenMirror(job);
    expect(token).toBe(job.publicAccessToken);
    expect(wasRevoked).toBe(false);
  });

  it('job with no existing token gets a fresh mint (initial share)', () => {
    const freshJob = { id: 'j-new' };
    const { token, wasRevoked } = reissuePublicTokenMirror(freshJob);
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)).toBe(true);
    // wasRevoked is false for initial mints (no prior revoke)
    expect(wasRevoked).toBe(false);
  });

  it('meta patch after re-share: new token written and publicTokenRevokedAt cleared', () => {
    const revokedJob = {
      id: 'j-patch-test',
      publicAccessToken: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      publicTokenRevokedAt: '2026-06-20T12:00:00.000Z',
    };
    const { token, wasRevoked } = reissuePublicTokenMirror(revokedJob);

    // This simulates what ReviewSheet / SendInvoiceModal / ReceiptModal do:
    const updatedJob = {
      ...revokedJob,
      publicAccessToken: token,
      ...(wasRevoked ? { publicTokenRevokedAt: undefined } : {}),
    };

    expect(updatedJob.publicAccessToken).toBe(token);
    expect(updatedJob.publicAccessToken).not.toBe(revokedJob.publicAccessToken);
    // publicTokenRevokedAt must be absent from the patch so the Netlify functions
    // don't block the new link — writeJobMeta drops undefined values during JSON serialise
    expect(updatedJob.publicTokenRevokedAt).toBeUndefined();
  });
});

// ── H. persistPublicToken is called BEFORE the URL is used (order test) ───────

describe('token persistence order — cloud write must complete before URL is produced', () => {
  it('persistPublicToken resolves before the caller proceeds with the URL', async () => {
    const callOrder = [];

    const supabase = makeSupabaseMock({ updateError: null });
    const deps = {
      supabase,
      getUserId: () => {
        callOrder.push('getUserId');
        return Promise.resolve('user-abc');
      },
    };

    // Simulate the send handler: persist token first, then build URL
    const persistResult = await persistPublicTokenMirror('job-1', { publicAccessToken: 'tok' }, deps);
    callOrder.push('url_built');

    expect(persistResult.ok).toBe(true);
    expect(callOrder).toEqual(['getUserId', 'url_built']);
    expect(callOrder.indexOf('getUserId')).toBeLessThan(callOrder.indexOf('url_built'));
  });
});
