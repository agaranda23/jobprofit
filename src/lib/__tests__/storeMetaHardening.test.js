/**
 * storeMetaHardening.test.js
 *
 * Regression guard for Fix B: updateJobMetaInCloud column-not-found hardening.
 *
 * Root cause: any Supabase UPDATE that includes a column name not present in
 * the schema returns PGRST204 / 42703. The old code called console.warn and
 * returned { ok: false } — silently dropping the entire write (meta + columns).
 *
 * Fix: on PGRST204 / 42703 (column-not-found), strip the mirror columns and
 * retry with meta-only. Meta-only persistence is correct and sufficient because
 * mapCloudJobToToday reads everything back via select('*') + the meta JSONB.
 * Telemetry is emitted so drift is visible in PostHog.
 *
 * What these tests verify:
 *   A. Happy path — successful UPDATE returns { ok: true }.
 *   B. PGRST204 column-not-found: does NOT silent-drop — retries meta-only
 *      and returns { ok: true } when meta-only succeeds.
 *   C. 42703 column-not-found: same behaviour as PGRST204.
 *   D. Column message variant: triggers the same meta-only retry path.
 *   E. Meta-only retry also fails (genuinely broken): surfaces the error,
 *      does NOT infinite-loop.
 *   F. Network error (catch branch): enqueues via offline fallback, does NOT
 *      swallow silently.
 *   G. Offline (getUserId returns null): enqueues, returns { ok: false, error: 'offline' }.
 *   H. Missing args guard: returns { ok: false, error: 'missing-args' } without hitting Supabase.
 *
 * Uses the mirror pattern (inline copy of the function logic with injected
 * deps) so we never import the real supabase singleton or env vars.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mirror of updateJobMetaInCloud (src/lib/store.js) ───────────────────────
// Mirrors the exact logic after the Fix B patch, with deps injected for
// testability. The real function reads from module-level `supabase` and
// `getUserId()`; we inject those here.

async function updateJobMetaInCloudMirror(
  jobId,
  metaObject,
  { supabase, getUserId, enqueueMetaFallback, logTelemetry },
) {
  if (!jobId || !metaObject) return { ok: false, error: 'missing-args' };

  let user_id;
  try {
    user_id = await getUserId();
  } catch {
    await enqueueMetaFallback(jobId, metaObject);
    return { ok: false, error: 'offline' };
  }

  if (!user_id) {
    await enqueueMetaFallback(jobId, metaObject);
    return { ok: false, error: 'offline' };
  }

  // Build the UPDATE payload — same as the real function.
  const updatePayload = { meta: metaObject };
  if (Array.isArray(metaObject.lineItems)) {
    updatePayload.line_items = metaObject.lineItems;
  }
  if ('customer' in metaObject) {
    updatePayload.customer_name = metaObject.customer || null;
  }
  if ('summary' in metaObject) {
    updatePayload.summary = metaObject.summary || null;
  }
  if ('address' in metaObject) {
    updatePayload.address = metaObject.address || null;
  }
  if ('email' in metaObject) {
    updatePayload.email = metaObject.email || null;
  }
  if ('description' in metaObject) {
    updatePayload.description = metaObject.description || null;
  }

  try {
    const { error } = await supabase
      .from('jobs')
      .update(updatePayload)
      .eq('id', jobId);

    if (error) {
      const isColumnNotFound =
        error.code === 'PGRST204' ||
        error.code === '42703' ||
        (typeof error.message === 'string' &&
          error.message.includes('column') &&
          error.message.includes('does not exist'));

      if (isColumnNotFound) {
        // Emit telemetry (injected; swallow failures)
        try { logTelemetry('store_meta_column_drift', { jobId, code: error.code, message: error.message }); } catch {}

        // Retry with meta-only — no mirror columns
        const { error: metaOnlyError } = await supabase
          .from('jobs')
          .update({ meta: metaObject })
          .eq('id', jobId);

        if (metaOnlyError) {
          return { ok: false, error: metaOnlyError.message };
        }
        return { ok: true };
      }

      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch {
    await enqueueMetaFallback(jobId, metaObject);
    return { ok: false, error: 'offline' };
  }
}

// ── Test helpers ─────────────────────────────────────────────────────────────

function uuid() { return crypto.randomUUID(); }

function makeMeta(overrides = {}) {
  return { status: 'invoiced', paymentStatus: 'unpaid', customer: 'Dave', ...overrides };
}

const noop = async () => {};

/**
 * Builds a Supabase mock where the first .update().eq() call returns firstError,
 * and subsequent calls return subsequentError. This lets us test the meta-only
 * retry path independently of the first call.
 */
function makeSequentialSupabaseMock(firstError, subsequentError = null) {
  let callCount = 0;
  return {
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve({
            error: callCount === 1 ? firstError : subsequentError,
          });
        }),
      })),
    }),
  };
}

// ── Default deps ──────────────────────────────────────────────────────────────
let enqueueCalled;
let telemetryCalled;

function makeDeps(supabase, { userId = 'user-abc', getUserIdThrows = false } = {}) {
  enqueueCalled = false;
  telemetryCalled = false;
  return {
    supabase,
    getUserId: getUserIdThrows
      ? () => { throw new Error('network'); }
      : () => Promise.resolve(userId),
    enqueueMetaFallback: async () => { enqueueCalled = true; },
    logTelemetry: () => { telemetryCalled = true; },
  };
}

// ── A. Happy path ─────────────────────────────────────────────────────────────

describe('Fix B — updateJobMetaInCloud happy path', () => {
  it('returns { ok: true } when Supabase UPDATE succeeds', async () => {
    const supabase = makeSequentialSupabaseMock(null);
    const result = await updateJobMetaInCloudMirror(uuid(), makeMeta(), makeDeps(supabase));
    expect(result.ok).toBe(true);
  });

  it('does not enqueue or emit telemetry on success', async () => {
    const supabase = makeSequentialSupabaseMock(null);
    const deps = makeDeps(supabase);
    await updateJobMetaInCloudMirror(uuid(), makeMeta(), deps);
    expect(enqueueCalled).toBe(false);
    expect(telemetryCalled).toBe(false);
  });
});

// ── B. PGRST204 — meta-only retry succeeds ────────────────────────────────────

describe('Fix B — PGRST204 column-not-found: strips mirror columns, retries meta-only', () => {
  it('retries with meta-only and returns { ok: true } when retry succeeds', async () => {
    const columnError = { code: 'PGRST204', message: 'column "invoice_sent_at" does not exist' };
    // First call (full payload) → PGRST204. Second call (meta-only) → success.
    const supabase = makeSequentialSupabaseMock(columnError, null);
    const result = await updateJobMetaInCloudMirror(uuid(), makeMeta(), makeDeps(supabase));
    expect(result.ok).toBe(true);
  });

  it('emits telemetry on PGRST204 so drift is visible in PostHog', async () => {
    const columnError = { code: 'PGRST204', message: 'column does not exist' };
    const supabase = makeSequentialSupabaseMock(columnError, null);
    const deps = makeDeps(supabase);
    await updateJobMetaInCloudMirror(uuid(), makeMeta(), deps);
    expect(telemetryCalled).toBe(true);
  });

  it('does NOT enqueue on PGRST204 when meta-only retry succeeds (no offline queue pollution)', async () => {
    const columnError = { code: 'PGRST204', message: 'column does not exist' };
    const supabase = makeSequentialSupabaseMock(columnError, null);
    const deps = makeDeps(supabase);
    await updateJobMetaInCloudMirror(uuid(), makeMeta(), deps);
    expect(enqueueCalled).toBe(false);
  });
});

// ── C. 42703 — meta-only retry succeeds ───────────────────────────────────────

describe('Fix B — 42703 column-not-found (Postgres error code)', () => {
  it('retries meta-only on 42703 and returns { ok: true }', async () => {
    const columnError = { code: '42703', message: 'column "description" of relation "jobs" does not exist' };
    const supabase = makeSequentialSupabaseMock(columnError, null);
    const result = await updateJobMetaInCloudMirror(uuid(), makeMeta(), makeDeps(supabase));
    expect(result.ok).toBe(true);
  });

  it('emits telemetry on 42703', async () => {
    const columnError = { code: '42703', message: 'column does not exist' };
    const supabase = makeSequentialSupabaseMock(columnError, null);
    const deps = makeDeps(supabase);
    await updateJobMetaInCloudMirror(uuid(), makeMeta(), deps);
    expect(telemetryCalled).toBe(true);
  });
});

// ── D. Column message variant ──────────────────────────────────────────────────

describe('Fix B — column-not-found detected via error message content', () => {
  it('triggers meta-only retry when message contains "column" and "does not exist"', async () => {
    const columnError = { code: null, message: 'column "stripe_connect_account_id" does not exist' };
    const supabase = makeSequentialSupabaseMock(columnError, null);
    const result = await updateJobMetaInCloudMirror(uuid(), makeMeta(), makeDeps(supabase));
    expect(result.ok).toBe(true);
  });

  it('does NOT trigger meta-only retry for unrelated errors (e.g. RLS violation)', async () => {
    const rlsError = { code: 'PGRST301', message: 'JWT expired' };
    const supabase = makeSequentialSupabaseMock(rlsError, null);
    const result = await updateJobMetaInCloudMirror(uuid(), makeMeta(), makeDeps(supabase));
    // Not a column error — returns the original error without retrying.
    expect(result.ok).toBe(false);
    expect(result.error).toBe('JWT expired');
  });
});

// ── E. Meta-only retry also fails — surface error, no infinite loop ────────────

describe('Fix B — meta-only retry fails: surfaces error without infinite loop', () => {
  it('returns { ok: false, error } when both full update and meta-only update fail', async () => {
    const columnError   = { code: 'PGRST204', message: 'column does not exist' };
    const metaOnlyError = { code: 'PGRST100', message: 'meta column type mismatch' };
    const supabase = makeSequentialSupabaseMock(columnError, metaOnlyError);
    const result = await updateJobMetaInCloudMirror(uuid(), makeMeta(), makeDeps(supabase));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('meta column type mismatch');
  });

  it('does NOT enqueue when meta-only retry also fails with a non-network error', async () => {
    const columnError   = { code: 'PGRST204', message: 'column does not exist' };
    const metaOnlyError = { code: 'PGRST100', message: 'something else broke' };
    const supabase = makeSequentialSupabaseMock(columnError, metaOnlyError);
    const deps = makeDeps(supabase);
    await updateJobMetaInCloudMirror(uuid(), makeMeta(), deps);
    // Must NOT queue — the error is from Supabase, not a network failure.
    // Queuing would cause infinite retry of a bad payload.
    expect(enqueueCalled).toBe(false);
  });
});

// ── F. Network error (catch path) — enqueue, do not swallow ──────────────────

describe('Fix B — network error: enqueues for retry, returns offline', () => {
  it('enqueues the meta update when the network throws during UPDATE', async () => {
    const throwingSupabase = {
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockRejectedValue(new Error('fetch failed')),
        }),
      }),
    };
    const deps = makeDeps(throwingSupabase);
    const result = await updateJobMetaInCloudMirror(uuid(), makeMeta(), deps);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('offline');
    expect(enqueueCalled).toBe(true);
  });
});

// ── G. Offline (getUserId returns null) — enqueue ─────────────────────────────

describe('Fix B — offline (getUserId null): enqueues without hitting Supabase', () => {
  it('enqueues when getUserId returns null', async () => {
    const supabase = makeSequentialSupabaseMock(null); // would succeed if called
    const deps = makeDeps(supabase, { userId: null });
    const result = await updateJobMetaInCloudMirror(uuid(), makeMeta(), deps);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('offline');
    expect(enqueueCalled).toBe(true);
    // Supabase must NOT have been touched (no point writing with no auth)
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('enqueues when getUserId throws (network unavailable during auth)', async () => {
    const supabase = makeSequentialSupabaseMock(null);
    const deps = makeDeps(supabase, { getUserIdThrows: true });
    const result = await updateJobMetaInCloudMirror(uuid(), makeMeta(), deps);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('offline');
    expect(enqueueCalled).toBe(true);
  });
});

// ── H. Missing args guard ─────────────────────────────────────────────────────

describe('Fix B — missing args: early return without hitting Supabase', () => {
  const supabase = makeSequentialSupabaseMock(null);
  const deps = makeDeps(supabase);

  it('returns missing-args when jobId is falsy', async () => {
    const result = await updateJobMetaInCloudMirror(null, makeMeta(), deps);
    expect(result).toEqual({ ok: false, error: 'missing-args' });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns missing-args when metaObject is falsy', async () => {
    const result = await updateJobMetaInCloudMirror(uuid(), null, deps);
    expect(result).toEqual({ ok: false, error: 'missing-args' });
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
