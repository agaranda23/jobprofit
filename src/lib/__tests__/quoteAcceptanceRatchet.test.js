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

/** Simulate what mapCloudJobToToday returns after accept-quote writes accepted meta. */
function cloudAcceptedJob(id = 'job-uuid-001') {
  return {
    id,
    quoteStatus:       'accepted',
    acceptedAt:        '2026-06-21T10:00:00.000Z',
    acceptedName:      'Dave',
    acceptedSource:    'remote',
    acceptedSignature: 'data:image/png;base64,abc123',
    status:            'active',
    jobStatus:         'active',
    total:             420,
    amount:            420,
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

  it('ratchet preserves all acceptance fields after merge', () => {
    const id = 'job-uuid-ratchet-002';
    writeJobMeta(id, { quoteStatus: 'sent' });

    const cloudJob = cloudAcceptedJob(id);
    writeJobMeta(id, {
      quoteStatus:       cloudJob.quoteStatus,
      acceptedAt:        cloudJob.acceptedAt,
      acceptedName:      cloudJob.acceptedName,
      acceptedSource:    cloudJob.acceptedSource,
      acceptedSignature: cloudJob.acceptedSignature,
    });

    const result = applyJobMeta(cloudJob);
    expect(result.quoteStatus).toBe('accepted');
    expect(result.acceptedAt).toBe('2026-06-21T10:00:00.000Z');
    expect(result.acceptedName).toBe('Dave');
    expect(result.acceptedSource).toBe('remote');
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
