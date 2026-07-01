/**
 * quoteAcceptanceRatchet.test.js
 *
 * Regression cover for: "Signed quote still shows Awaiting after app reopen."
 *
 * Root cause (original): refreshFromCloud called applyJobMetaToJobs which overlaid
 * readJobMeta(id) on top of the cloud-mapped job. When the local jp.jobMeta.<id>
 * entry still held quoteStatus:'sent' from before the customer signed (and the app
 * was closed so no realtime event fired the writeJobMeta ratchet in handleJobChange),
 * the stale local value shadowed the cloud's quoteStatus:'accepted'.
 *
 * Fix (JP-LU6): The ratchet is now embedded inside applyJobMeta() itself. When the
 * cloud object carries quoteStatus:'accepted', applyJobMeta() writes both quoteStatus
 * AND status into localStorage BEFORE spreading the local meta on top. This fires on
 * every merge path (initial load, storage-event, and realtime debounced paths) without
 * needing a separate pre-pass like the now-deleted healAcceptedMeta().
 *
 * This test file validates:
 *   1. applyJobMeta now resolves 'accepted' correctly (the bug is fixed).
 *   2. The explicit ratchet writeJobMeta-before-apply pattern still works.
 *   3. The ratchet is one-way: a local 'accepted' is never downgraded.
 *   4. Jobs that were never quoted are not touched.
 *
 * NOTE: the healAcceptedMeta() function was deleted in JP-LU6. Tests for the
 * equivalent behaviour now live in jobMetaRatchet.test.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeJobMeta, readJobMeta, applyJobMeta } from '../jobMeta';

// ── localStorage mock ─────────────────────────────────────────────────────────
function makeLocalStorageMock() {
  let store = {};
  return {
    getItem:    vi.fn(key => store[key] ?? null),
    setItem:    vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear:      vi.fn(() => { store = {}; }),
  };
}
const lsMock = makeLocalStorageMock();
vi.stubGlobal('localStorage', lsMock);

beforeEach(() => {
  lsMock.clear();
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Simulate what mapCloudJobToToday returns after accept-quote writes accepted meta.
 *  Phase G-2: no acceptedSignature field — button-based acceptance stores only the
 *  timestamp, name, source, and consent markers. Historic rows may still carry
 *  acceptedSignature; the ratchet handles that via the conditional spread below.
 */
function cloudAcceptedJob(id = 'job-uuid-001') {
  return {
    id,
    quoteStatus:    'accepted',
    acceptedAt:     '2026-06-21T10:00:00.000Z',
    acceptedName:   'Dave',
    acceptedSource: 'remote',
    // acceptedSignature intentionally absent — G-2 button path
    status:         'active',
    jobStatus:      'active',
    total:          420,
    amount:         420,
  };
}

/** Legacy accepted job fixture — carries a signature PNG from before G-2. */
function legacyCloudAcceptedJob(id = 'job-uuid-legacy') {
  return {
    ...cloudAcceptedJob(id),
    acceptedSignature: 'data:image/png;base64,abc123',
  };
}

// ── THE FIX IS NOW IN applyJobMeta ───────────────────────────────────────────
// JP-LU6: healAcceptedMeta() was deleted. The ratchet now lives inside
// applyJobMeta() itself, so it fires on every merge path automatically.

describe('applyJobMeta — ratchet embedded in applyJobMeta (JP-LU6)', () => {
  it('resolves quoteStatus:accepted even when local has stale :sent (bug is fixed)', () => {
    const id = 'job-uuid-shadow-001';
    // Simulate localStorage holding the pre-signing state (quoteStatus:'sent')
    writeJobMeta(id, { quoteStatus: 'sent' });

    // Cloud job now says accepted (after customer signed while app was closed)
    const cloudJob = { ...cloudAcceptedJob(id) };

    // applyJobMeta now has the ratchet embedded — accepted wins
    const result = applyJobMeta(cloudJob);

    expect(result.quoteStatus).toBe('accepted');
  });
});

// ── THE FIX ───────────────────────────────────────────────────────────────────

describe('ratchet fix: writeJobMeta before applyJobMetaToJobs', () => {
  it('after ratchet writeJobMeta, applyJobMeta resolves quoteStatus as accepted', () => {
    const id = 'job-uuid-ratchet-001';

    // Stale localStorage state from before the customer signed
    writeJobMeta(id, { quoteStatus: 'sent' });

    const cloudJob = cloudAcceptedJob(id);

    // This is the ratchet logic extracted from refreshFromCloud
    const localMeta = readJobMeta(id);
    if (localMeta.quoteStatus !== 'accepted') {
      writeJobMeta(id, {
        quoteStatus:    cloudJob.quoteStatus,
        acceptedAt:     cloudJob.acceptedAt     ?? null,
        acceptedName:   cloudJob.acceptedName   ?? null,
        acceptedSource: cloudJob.acceptedSource ?? null,
        ...(cloudJob.acceptedSignature
          ? { acceptedSignature: cloudJob.acceptedSignature }
          : {}),
      });
    }

    const result = applyJobMeta(cloudJob);
    expect(result.quoteStatus).toBe('accepted');
  });

  it('ratchet preserves all acceptance fields after merge (G-2 button path, no signature)', () => {
    const id = 'job-uuid-ratchet-002';
    writeJobMeta(id, { quoteStatus: 'sent' });

    const cloudJob = cloudAcceptedJob(id);
    writeJobMeta(id, {
      quoteStatus:    cloudJob.quoteStatus,
      acceptedAt:     cloudJob.acceptedAt,
      acceptedName:   cloudJob.acceptedName,
      acceptedSource: cloudJob.acceptedSource,
      ...(cloudJob.acceptedSignature
        ? { acceptedSignature: cloudJob.acceptedSignature }
        : {}),
    });

    const result = applyJobMeta(cloudJob);
    expect(result.quoteStatus).toBe('accepted');
    expect(result.acceptedAt).toBe('2026-06-21T10:00:00.000Z');
    expect(result.acceptedName).toBe('Dave');
    expect(result.acceptedSource).toBe('remote');
    // G-2 path: no acceptedSignature collected
    expect(result.acceptedSignature).toBeUndefined();
  });

  it('ratchet preserves acceptedSignature when present on legacy cloud job', () => {
    const id = 'job-uuid-ratchet-002b';
    writeJobMeta(id, { quoteStatus: 'sent' });

    const cloudJob = legacyCloudAcceptedJob(id);
    writeJobMeta(id, {
      quoteStatus:       cloudJob.quoteStatus,
      acceptedAt:        cloudJob.acceptedAt,
      acceptedName:      cloudJob.acceptedName,
      acceptedSource:    cloudJob.acceptedSource,
      acceptedSignature: cloudJob.acceptedSignature,
    });

    const result = applyJobMeta(cloudJob);
    expect(result.acceptedSignature).toBe('data:image/png;base64,abc123');
  });

  it('ratchet is one-way: local accepted is never downgraded to sent', () => {
    const id = 'job-uuid-ratchet-003';

    // localStorage already has accepted (e.g. written by realtime handler)
    writeJobMeta(id, { quoteStatus: 'accepted', acceptedAt: '2026-06-20T08:00:00.000Z' });

    // Hypothetical cloud job where quoteStatus is somehow still 'sent' (should not happen,
    // but belt-and-braces: the ratchet must not downgrade)
    const stalishCloudJob = { id, quoteStatus: 'sent', total: 200, amount: 200 };

    // Ratchet: only fires when localMeta.quoteStatus !== 'accepted'
    const localMeta = readJobMeta(id);
    if (localMeta.quoteStatus !== 'accepted') {
      writeJobMeta(id, { quoteStatus: stalishCloudJob.quoteStatus });
    }

    const result = applyJobMeta(stalishCloudJob);
    // Local accepted wins — ratchet correctly skipped because local was already accepted
    expect(result.quoteStatus).toBe('accepted');
  });

  it('ratchet does not touch jobs that were never quoted', () => {
    const id = 'job-uuid-ratchet-004';

    // Job added as a quick-add (quoteStatus absent in localStorage)
    // No writeJobMeta call at all — localStorage has nothing for this job

    const cloudJob = { id, quoteStatus: 'active', total: 150, amount: 150 };

    // Ratchet condition: cloud.quoteStatus !== 'accepted' so loop body never runs
    if (cloudJob.quoteStatus === 'accepted') {
      const localMeta = readJobMeta(id);
      if (localMeta.quoteStatus !== 'accepted') {
        writeJobMeta(id, { quoteStatus: 'accepted' });
      }
    }

    const result = applyJobMeta(cloudJob);
    expect(result.quoteStatus).toBe('active');
  });

  it('ratchet skips acceptedSignature when cloud does not carry it', () => {
    const id = 'job-uuid-ratchet-005';
    writeJobMeta(id, { quoteStatus: 'sent' });

    // Cloud accepted but signature was not fetched (e.g. partial select)
    const cloudJobNoSig = {
      id,
      quoteStatus:    'accepted',
      acceptedAt:     '2026-06-21T10:00:00.000Z',
      acceptedName:   'Dave',
      acceptedSource: 'remote',
      // acceptedSignature intentionally absent
    };

    writeJobMeta(id, {
      quoteStatus:    cloudJobNoSig.quoteStatus,
      acceptedAt:     cloudJobNoSig.acceptedAt  ?? null,
      acceptedName:   cloudJobNoSig.acceptedName ?? null,
      acceptedSource: cloudJobNoSig.acceptedSource ?? null,
      ...(cloudJobNoSig.acceptedSignature
        ? { acceptedSignature: cloudJobNoSig.acceptedSignature }
        : {}),
    });

    const stored = readJobMeta(id);
    expect(stored.quoteStatus).toBe('accepted');
    // acceptedSignature must not be written as undefined/null when absent from cloud
    expect('acceptedSignature' in stored).toBe(false);
  });
});

// ── healAcceptedMeta deleted (JP-LU6) ────────────────────────────────────────
// The ratchet that healAcceptedMeta() provided is now baked into applyJobMeta().
// Tests for the equivalent guarantees live in jobMetaRatchet.test.js.
// This section is intentionally empty — do not re-add healAcceptedMeta calls here.
