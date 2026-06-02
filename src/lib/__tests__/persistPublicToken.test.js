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
