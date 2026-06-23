/**
 * quoteAcceptanceRatchet.test.js
 *
 * Regression cover for: "Signed quote still shows Awaiting after app reopen."
 *
 * Root cause: refreshFromCloud calls applyJobMetaToJobs which overlays
 * readJobMeta(id) on top of the cloud-mapped job. When the local
 * jp.jobMeta.<id> entry still held quoteStatus:'sent' from before the
 * customer signed (and the app was closed so no realtime event fired the
 * writeJobMeta ratchet in handleJobChange), the stale local value shadowed
 * the cloud's quoteStatus:'accepted'.
 *
 * Fix: refreshFromCloud now calls writeJobMeta to sync acceptance state for
 * any cloud job where cloudJob.quoteStatus === 'accepted' but the local
 * meta disagrees — before applyJobMetaToJobs runs. This test validates:
 *
 *   1. applyJobMeta shadows cloud quoteStatus with stale localStorage value
 *      (demonstrates the bug without the fix).
 *   2. After the ratchet writeJobMeta call, applyJobMeta resolves 'accepted'.
 *   3. The ratchet is one-way: a local 'accepted' is never downgraded.
 *   4. Jobs that were never quoted (quoteStatus absent or 'active') are
 *      not touched by the ratchet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeJobMeta, readJobMeta, applyJobMeta, healAcceptedMeta } from '../jobMeta';
import { deriveDisplayStatus } from '../jobStatus';

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

/** Simulate what mapCloudJobToToday returns for a still-quoted job. */
function cloudQuotedJob(id = 'job-uuid-002') {
  return {
    id,
    quoteStatus: 'sent',
    total:       200,
    amount:      200,
  };
}

// ── THE BUG (without fix) ─────────────────────────────────────────────────────

describe('applyJobMeta — stale localStorage shadows cloud acceptance', () => {
  it('demonstrates the pre-fix bug: stale quoteStatus:sent overwrites cloud accepted', () => {
    const id = 'job-uuid-shadow-001';
    // Simulate localStorage holding the pre-signing state (quoteStatus:'sent')
    writeJobMeta(id, { quoteStatus: 'sent' });

    // Cloud job now says accepted (after customer signed while app was closed)
    const cloudJob = { ...cloudAcceptedJob(id) };

    // applyJobMeta overlays localStorage on top of cloud — stale value wins
    const result = applyJobMeta(cloudJob);

    // This is the bug: the stale local meta clobbers the cloud's accepted state
    expect(result.quoteStatus).toBe('sent');
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

// ── healAcceptedMeta — load-time heal (Fix 1 extension) ──────────────────────
// The original inline ratchet only wrote quoteStatus:'accepted' but not
// status:'active'. This left a stale status:'quoted' (or status:'lead') in
// localStorage to win the applyJobMeta overlay, causing deriveDisplayStatus to
// return "Quoted" instead of "On" even after the customer signed.
// healAcceptedMeta writes BOTH quoteStatus AND status so the "On" stage resolves.

describe('healAcceptedMeta — status field is written alongside quoteStatus', () => {
  it('writes status:active when local has stale status:quoted', () => {
    const id = 'heal-001';
    writeJobMeta(id, { quoteStatus: 'sent', status: 'quoted' });

    // G-2 cloud job: no acceptedSignature (button-based acceptance)
    const cloudJobs = [{
      id,
      quoteStatus:    'accepted',
      status:         'active',
      jobStatus:      'active',
      acceptedAt:     '2026-06-22T09:00:00.000Z',
      acceptedName:   'Sarah',
      acceptedSource: 'remote',
      total: 500,
    }];

    healAcceptedMeta(cloudJobs);

    const stored = readJobMeta(id);
    expect(stored.quoteStatus).toBe('accepted');
    expect(stored.status).toBe('active');
  });

  it('after heal, deriveDisplayStatus resolves to "On" (not "Quoted")', () => {
    const id = 'heal-002';
    writeJobMeta(id, { quoteStatus: 'sent', status: 'quoted' });

    const cloudJob = {
      id,
      quoteStatus:    'accepted',
      status:         'active',
      jobStatus:      'active',
      acceptedAt:     '2026-06-22T09:00:00.000Z',
      acceptedName:   'Sarah',
      acceptedSource: 'remote',
      // no acceptedSignature — G-2 button path
      total: 500,
      amount: 500,
    };

    healAcceptedMeta([cloudJob]);

    // applyJobMeta overlays localStorage on top of the cloud job
    const localMeta = readJobMeta(id);
    const healed = { ...cloudJob, ...localMeta };
    expect(deriveDisplayStatus(healed)).toBe('On');
  });

  it('skips jobs where local already has quoteStatus:accepted AND status:active', () => {
    const id = 'heal-003';
    writeJobMeta(id, { quoteStatus: 'accepted', status: 'active', acceptedAt: '2026-06-20T08:00:00.000Z' });

    const cloudJobs = [{ id, quoteStatus: 'accepted', status: 'active', total: 300 }];
    healAcceptedMeta(cloudJobs);

    const stored = readJobMeta(id);
    // Should be unchanged — the pre-existing acceptedAt must still be there
    expect(stored.acceptedAt).toBe('2026-06-20T08:00:00.000Z');
  });

  it('does not touch still-quoted jobs', () => {
    const id = 'heal-004';
    writeJobMeta(id, { quoteStatus: 'sent', status: 'quoted' });

    const cloudJobs = [{ id, quoteStatus: 'sent', status: 'quoted', total: 200 }];
    healAcceptedMeta(cloudJobs);

    const stored = readJobMeta(id);
    // quoteStatus must remain 'sent' — heal must not write 'accepted'
    expect(stored.quoteStatus).toBe('sent');
    expect(stored.status).toBe('quoted');
  });

  it('handles an empty array without throwing', () => {
    expect(() => healAcceptedMeta([])).not.toThrow();
  });

  it('handles null/undefined without throwing', () => {
    expect(() => healAcceptedMeta(null)).not.toThrow();
    expect(() => healAcceptedMeta(undefined)).not.toThrow();
  });

  it('heals local entry that has quoteStatus:accepted but stale status:quoted (partial earlier fix)', () => {
    const id = 'heal-005';
    // This is the partial-fix scenario: old ratchet wrote quoteStatus:'accepted'
    // but missed status — so local has accepted quoteStatus but wrong status.
    writeJobMeta(id, { quoteStatus: 'accepted', status: 'quoted' });

    const cloudJobs = [{
      id,
      quoteStatus: 'accepted',
      status:      'active',
      total:       300,
    }];

    healAcceptedMeta(cloudJobs);

    const stored = readJobMeta(id);
    // status must now be 'active' even though quoteStatus was already 'accepted'
    expect(stored.status).toBe('active');
  });
});
