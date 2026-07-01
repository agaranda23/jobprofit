/**
 * jobMetaRatchet.test.js — JP-LU6 Part B regression cover
 *
 * Tests the one-way status ratchet inside applyJobMeta():
 *
 *   When the cloud job carries quoteStatus:'accepted', applyJobMeta() writes
 *   both quoteStatus AND status into localStorage BEFORE spreading the local
 *   meta on top, so a stale local quoteStatus:'sent' can never shadow the
 *   cloud's accepted state.
 *
 * This ratchet lives in applyJobMeta() (not in refreshFromCloud) so it fires
 * on every merge path: initial getTodayJobs overlay, storage-event path, and
 * the realtime debounced refreshFromCloud path.
 *
 * healAcceptedMeta() was the previous band-aid; it is deleted in this PR.
 * These tests confirm the replacement ratchet carries the same guarantees.
 *
 * Pure-function tests — no React, no DOM.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeJobMeta, readJobMeta, applyJobMeta, applyJobMetaToJobs } from '../jobMeta';

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

// ── Core ratchet: cloud accepted overrides stale local 'sent' ─────────────────

describe('applyJobMeta — cloud quoteStatus:accepted ratchet', () => {
  it('cloud accepted preserves quoteStatus when local has stale sent', () => {
    const id = 'ratchet-001';
    // Stale local state from before the customer accepted
    writeJobMeta(id, { quoteStatus: 'sent', status: 'quoted' });

    const cloudJob = {
      id,
      quoteStatus:    'accepted',
      status:         'active',
      jobStatus:      'active',
      acceptedAt:     '2026-06-22T10:00:00.000Z',
      acceptedName:   'Dave',
      acceptedSource: 'remote',
      total:          500,
    };

    const result = applyJobMeta(cloudJob);
    expect(result.quoteStatus).toBe('accepted');
    expect(result.status).toBe('active');
  });

  it('ratchet writes quoteStatus:accepted; status resolves correctly via cloud overlay (Gap 2 fix)', () => {
    // Gap 2 fix: ratchet no longer writes status/jobStatus into the pending set.
    // Cloud status wins via the overlay — quoteStatus is the only monotonic field.
    const id = 'ratchet-002';
    writeJobMeta(id, { quoteStatus: 'sent', status: 'quoted' });

    const cloudJob = {
      id,
      quoteStatus:    'accepted',
      status:         'active',
      jobStatus:      'active',
      acceptedAt:     '2026-06-22T10:00:00.000Z',
      acceptedName:   'Sarah',
      acceptedSource: 'remote',
      total:          300,
    };

    const result = applyJobMeta(cloudJob);

    // applyJobMeta result must have both correct (cloud overlay for status):
    expect(result.quoteStatus).toBe('accepted');
    expect(result.status).toBe('active');

    // localStorage meta: ratchet updated quoteStatus, but NOT status.
    // status pending was cleared by the ratchet — cloud wins via overlay.
    const stored = readJobMeta(id);
    expect(stored.quoteStatus).toBe('accepted');
    // status in local meta is still 'quoted' (not updated) — that is correct:
    // applyJobMeta reads cloud 'active' because status pending was cleared.
    expect(stored.status).toBe('quoted');
  });

  it('ratchet is one-way: local accepted is never downgraded', () => {
    const id = 'ratchet-003';
    // Local is already correct (e.g. written by the realtime handler)
    writeJobMeta(id, { quoteStatus: 'accepted', status: 'active', acceptedAt: '2026-06-20T08:00:00.000Z' });

    // Stale cloud job (should not happen, but belt-and-braces)
    const stalishCloudJob = { id, quoteStatus: 'sent', status: 'quoted', total: 200 };

    const result = applyJobMeta(stalishCloudJob);
    // Local accepted wins — ratchet only fires when cloud is 'accepted'
    expect(result.quoteStatus).toBe('accepted');
    expect(result.acceptedAt).toBe('2026-06-20T08:00:00.000Z');
  });

  it('ratchet does not fire for non-accepted jobs', () => {
    const id = 'ratchet-004';
    writeJobMeta(id, { quoteStatus: 'sent', status: 'quoted' });

    const cloudJob = { id, quoteStatus: 'sent', status: 'quoted', total: 150 };

    // Before: local has sent
    const before = readJobMeta(id);
    expect(before.quoteStatus).toBe('sent');

    const result = applyJobMeta(cloudJob);

    // Ratchet must not promote 'sent' to 'accepted'
    expect(result.quoteStatus).toBe('sent');
    const after = readJobMeta(id);
    expect(after.quoteStatus).toBe('sent');
  });

  it('ratchet does not fire for quick-add jobs (quoteStatus absent)', () => {
    const id = 'ratchet-005';
    // No localStorage entry for this job at all

    const cloudJob = { id, status: 'active', total: 200 };
    const result = applyJobMeta(cloudJob);

    // No quoteStatus on cloud → no ratchet → result carries cloud values unchanged
    expect(result.quoteStatus).toBeUndefined();
    expect(result.status).toBe('active');
  });
});

// ── Offline writes of OTHER fields still win ──────────────────────────────────

describe('applyJobMeta — offline field writes survive the ratchet', () => {
  it('offline notes edit overrides cloud even when cloud is accepted', () => {
    const id = 'offline-001';
    // User accepted quote, realtime handler wrote accepted state
    writeJobMeta(id, {
      quoteStatus:  'accepted',
      status:       'active',
      notes:        'Updated notes written offline',
    });

    const cloudJob = {
      id,
      quoteStatus:    'accepted',
      status:         'active',
      notes:          'Old notes from cloud',
      total:          400,
    };

    const result = applyJobMeta(cloudJob);
    // Notes: local offline edit must win
    expect(result.notes).toBe('Updated notes written offline');
    // Status: still correctly accepted
    expect(result.quoteStatus).toBe('accepted');
  });

  it('offline lineItems edit overrides cloud after acceptance', () => {
    const id = 'offline-002';
    const localItems = [{ desc: 'Extra labour', cost: 50 }];
    writeJobMeta(id, {
      quoteStatus:  'accepted',
      status:       'active',
      lineItems:    localItems,
    });

    const cloudJob = {
      id,
      quoteStatus:    'accepted',
      status:         'active',
      lineItems:      [],
      total:          500,
    };

    const result = applyJobMeta(cloudJob);
    expect(result.lineItems).toEqual(localItems);
    expect(result.quoteStatus).toBe('accepted');
  });

  it('photos array in localStorage overrides cloud value', () => {
    const id = 'offline-003';
    const localPhotos = [{ path: 'photo/abc.jpg', uploadedAt: '2026-06-22T12:00:00.000Z' }];
    writeJobMeta(id, {
      quoteStatus: 'accepted',
      status:      'active',
      photos:      localPhotos,
    });

    const cloudJob = {
      id,
      quoteStatus: 'accepted',
      status:      'active',
      photos:      [],
      total:       300,
    };

    const result = applyJobMeta(cloudJob);
    expect(result.photos).toEqual(localPhotos);
  });
});

// ── applyJobMetaToJobs batch path ─────────────────────────────────────────────

describe('applyJobMetaToJobs — ratchet applies across a batch of cloud jobs', () => {
  it('heals all accepted jobs in a batch, leaves non-accepted untouched', () => {
    const id1 = 'batch-accepted';
    const id2 = 'batch-quoted';
    const id3 = 'batch-active';

    writeJobMeta(id1, { quoteStatus: 'sent', status: 'quoted' });
    writeJobMeta(id2, { quoteStatus: 'sent', status: 'quoted' });

    const cloudJobs = [
      { id: id1, quoteStatus: 'accepted', status: 'active', total: 100 },
      { id: id2, quoteStatus: 'sent',     status: 'quoted', total: 200 },
      { id: id3, status: 'active',        total: 300 },
    ];

    const results = applyJobMetaToJobs(cloudJobs);

    // Accepted job: ratchet applied
    expect(results[0].quoteStatus).toBe('accepted');
    expect(results[0].status).toBe('active');

    // Still-quoted job: no ratchet
    expect(results[1].quoteStatus).toBe('sent');

    // Quick-add job: no quoteStatus inserted
    expect(results[2].quoteStatus).toBeUndefined();
  });

  it('returns jobs array unchanged when passed a non-array', () => {
    expect(applyJobMetaToJobs(null)).toBe(null);
    expect(applyJobMetaToJobs(undefined)).toBe(undefined);
  });
});
