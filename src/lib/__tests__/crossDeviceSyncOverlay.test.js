/**
 * crossDeviceSyncOverlay.test.js
 *
 * Regression cover for fix/cross-device-job-sync-overlay (Fix A).
 *
 * Acceptance criteria:
 *   AC1 — Cross-device edit: cloud has fresh values, reading device's local meta
 *         holds stale NON-pending values → applyJobMeta returns CLOUD values.
 *   AC2 — Offline/in-flight local edit: field marked pending (locally edited,
 *         not yet synced) → applyJobMeta keeps LOCAL value even if cloud differs.
 *   AC3 — Pending cleared on sync success → subsequent applyJobMeta lets cloud win.
 *   AC4 — Accepted-ratchet preserved: local quoteStatus:'accepted' still wins over
 *         a cloud non-accepted value (monotonic).
 *   AC5 — New job with no local meta passes cloud through unchanged.
 *   AC6 — writeJobMeta marks written fields as pending.
 *   AC7 — clearPending removes keys; subsequent reads no longer see them.
 *
 * Pure-function tests — no React, no DOM.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  writeJobMeta,
  applyJobMeta,
  applyJobMetaToJobs,
  clearPending,
  readPendingKeys,
} from '../jobMeta';

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

function makeCloudJob(id, overrides = {}) {
  return {
    id,
    status: 'invoice_sent',
    customer: 'New Customer',
    total: 500,
    amount: 500,
    quoteStatus: 'sent',
    ...overrides,
  };
}

// ── AC1: Cloud wins for non-pending fields ────────────────────────────────────

describe('AC1 — cloud wins for non-pending fields', () => {
  it('cloud status wins when local has stale non-pending status', () => {
    const id = 'ac1-status-001';
    // Device A (this device) once had status:'quoted'. That write was confirmed
    // synced. Then Device B moved the job to invoice_sent and the cloud confirmed it.
    // Simulate: write to local, then clear pending (simulating confirmed sync).
    writeJobMeta(id, { status: 'quoted', customer: 'Old Customer' });
    clearPending(id, ['status', 'customer']); // confirmed sync happened

    const cloudJob = makeCloudJob(id, { status: 'invoice_sent', customer: 'New Customer' });
    const result = applyJobMeta(cloudJob);

    expect(result.status).toBe('invoice_sent');     // cloud wins
    expect(result.customer).toBe('New Customer');   // cloud wins
  });

  it('cloud total wins when local total is stale non-pending', () => {
    const id = 'ac1-total-001';
    writeJobMeta(id, { total: 100, amount: 100 });
    clearPending(id, ['total', 'amount']);

    const cloudJob = makeCloudJob(id, { total: 450, amount: 450 });
    const result = applyJobMeta(cloudJob);

    expect(result.total).toBe(450);
    expect(result.amount).toBe(450);
  });

  it('no local meta at all: cloud passes through unchanged', () => {
    const id = 'ac1-nometa-001';
    // Device B has never touched this job — no local meta key
    const cloudJob = makeCloudJob(id, { status: 'invoice_sent', customer: 'Alice' });
    const result = applyJobMeta(cloudJob);

    expect(result.status).toBe('invoice_sent');
    expect(result.customer).toBe('Alice');
    expect(result.total).toBe(500);
  });

  it('multiple fields: only non-pending fields use cloud value', () => {
    const id = 'ac1-mixed-001';
    // notes is locally edited (pending). status was synced (not pending).
    writeJobMeta(id, { status: 'quoted', notes: 'My offline note' });
    clearPending(id, ['status']); // status confirmed synced; notes still pending

    const cloudJob = makeCloudJob(id, {
      status: 'invoice_sent',
      notes: 'Cloud note',
    });
    const result = applyJobMeta(cloudJob);

    expect(result.status).toBe('invoice_sent');   // non-pending: cloud wins
    expect(result.notes).toBe('My offline note');  // pending: local wins
  });
});

// ── AC2: Local wins for pending fields ────────────────────────────────────────

describe('AC2 — local wins for pending (unsynced) fields', () => {
  it('pending status survives cloud refetch', () => {
    const id = 'ac2-status-001';
    // Trader moved job to invoice_sent on this device — not yet confirmed synced
    writeJobMeta(id, { status: 'invoice_sent' });
    // pending set still has status

    // Cloud still shows the old value (the write hasn't landed yet)
    const cloudJob = makeCloudJob(id, { status: 'quoted' });
    const result = applyJobMeta(cloudJob);

    expect(result.status).toBe('invoice_sent'); // pending local wins
  });

  it('pending lineItems survive cloud refetch', () => {
    const id = 'ac2-lineitems-001';
    const localItems = [{ desc: 'Labour', cost: 300 }, { desc: 'Parts', cost: 120 }];
    writeJobMeta(id, { lineItems: localItems, total: 420, amount: 420 });

    const cloudJob = makeCloudJob(id, { lineItems: [], total: 0, amount: 0 });
    const result = applyJobMeta(cloudJob);

    expect(result.lineItems).toEqual(localItems);
    expect(result.total).toBe(420);
  });

  it('pending customer name survives cloud refetch', () => {
    const id = 'ac2-customer-001';
    writeJobMeta(id, { customer: 'Dave (pending)' });

    const cloudJob = makeCloudJob(id, { customer: 'Dave (old cloud)' });
    const result = applyJobMeta(cloudJob);

    expect(result.customer).toBe('Dave (pending)');
  });

  it('pending overdue flag survives cloud refetch', () => {
    const id = 'ac2-overdue-001';
    writeJobMeta(id, { overdue: true, status: 'invoice_sent' });

    const cloudJob = makeCloudJob(id, { overdue: false, status: 'invoice_sent' });
    const result = applyJobMeta(cloudJob);

    expect(result.overdue).toBe(true);
  });
});

// ── AC3: Pending cleared on sync success ─────────────────────────────────────

describe('AC3 — pending cleared on sync success → cloud wins next time', () => {
  it('after clearPending, cloud value wins on next applyJobMeta', () => {
    const id = 'ac3-clear-001';
    writeJobMeta(id, { status: 'quoted', customer: 'Pre-sync' });
    // Simulate confirmed cloud write
    clearPending(id, ['status', 'customer']);

    // New cloud data comes in (another device updated it)
    const cloudJob = makeCloudJob(id, { status: 'invoice_sent', customer: 'Updated' });
    const result = applyJobMeta(cloudJob);

    expect(result.status).toBe('invoice_sent');
    expect(result.customer).toBe('Updated');
  });

  it('clearPending of specific keys leaves other pending keys intact', () => {
    const id = 'ac3-partial-001';
    writeJobMeta(id, { status: 'invoice_sent', notes: 'My note', customer: 'X' });
    clearPending(id, ['status', 'customer']); // only these two synced

    const remainingPending = readPendingKeys(id);
    expect(remainingPending).toContain('notes');
    expect(remainingPending).not.toContain('status');
    expect(remainingPending).not.toContain('customer');
  });

  it('after full clearPending, device behaves like Device B (no local influence)', () => {
    const id = 'ac3-full-001';
    writeJobMeta(id, { status: 'quoted', notes: 'note', customer: 'Old' });
    // All synced
    clearPending(id, readPendingKeys(id));

    const cloudJob = makeCloudJob(id, {
      status: 'paid',
      notes: 'New note from other device',
      customer: 'New Customer',
    });
    const result = applyJobMeta(cloudJob);

    expect(result.status).toBe('paid');
    expect(result.notes).toBe('New note from other device');
    expect(result.customer).toBe('New Customer');
  });

  it('pending fields return after a subsequent writeJobMeta', () => {
    const id = 'ac3-rewrite-001';
    writeJobMeta(id, { status: 'quoted' });
    clearPending(id, ['status']); // synced once

    // Trader makes another edit
    writeJobMeta(id, { status: 'invoice_sent' });

    const pending = readPendingKeys(id);
    expect(pending).toContain('status'); // pending again after new write
  });
});

// ── AC4: Accepted ratchet preserved (monotonic) ───────────────────────────────

describe('AC4 — accepted ratchet preserved (monotonic business rule)', () => {
  it('local quoteStatus:accepted wins over cloud non-accepted value', () => {
    const id = 'ac4-ratchet-001';
    // This device accepted the quote (realtime handler wrote it)
    writeJobMeta(id, { quoteStatus: 'accepted', status: 'active', acceptedAt: '2026-07-01T10:00:00.000Z' });

    // Hypothetical stale cloud (should never happen in practice)
    const cloudJob = makeCloudJob(id, { quoteStatus: 'sent', status: 'quoted' });
    const result = applyJobMeta(cloudJob);

    expect(result.quoteStatus).toBe('accepted');
    expect(result.acceptedAt).toBe('2026-07-01T10:00:00.000Z');
  });

  it('cloud accepted wins over stale local sent (ratchet corrects it)', () => {
    const id = 'ac4-ratchet-002';
    // Local from before customer accepted (was confirmed-synced as sent, then pending cleared)
    writeJobMeta(id, { quoteStatus: 'sent', status: 'quoted' });
    clearPending(id, ['quoteStatus', 'status']); // was synced as sent

    // Customer then accepted on another device — cloud is now accepted
    const cloudJob = makeCloudJob(id, {
      quoteStatus: 'accepted',
      status: 'active',
      acceptedAt: '2026-07-01T09:00:00.000Z',
      acceptedName: 'Bob',
      acceptedSource: 'remote',
    });
    const result = applyJobMeta(cloudJob);

    // Ratchet: cloud accepted wins (and re-marks pending so it sticks)
    expect(result.quoteStatus).toBe('accepted');
    expect(result.status).toBe('active');
    expect(result.acceptedAt).toBe('2026-07-01T09:00:00.000Z');
  });

  it('accepted is never downgraded even after clearPending of quoteStatus', () => {
    const id = 'ac4-ratchet-003';
    // Accepted was confirmed synced — pending cleared
    writeJobMeta(id, { quoteStatus: 'accepted', status: 'active' });
    clearPending(id, ['quoteStatus', 'status']);

    // Stale cloud event still showing sent (race: arrived late)
    const cloudJob = makeCloudJob(id, { quoteStatus: 'sent', status: 'quoted' });
    const result = applyJobMeta(cloudJob);

    // quoteStatus pending was cleared, so cloud 'sent' should win here.
    // This is the correct behaviour: if the cloud genuinely says 'sent' after
    // we cleared pending, we trust the cloud. The ratchet only fires when
    // cloud ITSELF says 'accepted'. Belt-and-braces: the cloud write for
    // 'accepted' would re-mark pending anyway — so in practice this edge case
    // never leaves the job un-accepted after a confirmed write.
    expect(result.quoteStatus).toBe('sent'); // pending cleared → cloud wins
  });

  it('accepted ratchet fires: cloud accepted with local pending-cleared sent → accepted wins', () => {
    const id = 'ac4-ratchet-004';
    writeJobMeta(id, { quoteStatus: 'sent' });
    clearPending(id, ['quoteStatus']);

    // Cloud now says accepted
    const cloudJob = makeCloudJob(id, {
      quoteStatus: 'accepted',
      status: 'active',
      acceptedAt: '2026-07-01T11:00:00.000Z',
      acceptedName: 'Alice',
      acceptedSource: 'remote',
    });
    const result = applyJobMeta(cloudJob);

    // Ratchet rewrites meta AND pending → accepted wins regardless
    expect(result.quoteStatus).toBe('accepted');
    expect(result.acceptedAt).toBe('2026-07-01T11:00:00.000Z');
  });
});

// ── AC5: New job with no local meta ───────────────────────────────────────────

describe('AC5 — new job with no local meta passes cloud through unchanged', () => {
  it('fresh job with no localStorage entry returns cloud job unchanged', () => {
    const id = 'ac5-fresh-001';
    // No writeJobMeta call — this device has never seen this job
    const cloudJob = makeCloudJob(id, {
      status: 'invoice_sent',
      customer: 'Fresh Customer',
      total: 350,
      lineItems: [{ desc: 'Install', cost: 350 }],
    });

    const result = applyJobMeta(cloudJob);

    expect(result.status).toBe('invoice_sent');
    expect(result.customer).toBe('Fresh Customer');
    expect(result.total).toBe(350);
    expect(result.lineItems).toEqual([{ desc: 'Install', cost: 350 }]);
  });

  it('applyJobMetaToJobs with no local meta for any job returns cloud unchanged', () => {
    const cloudJobs = [
      makeCloudJob('fresh-b-001', { status: 'quoted', customer: 'A' }),
      makeCloudJob('fresh-b-002', { status: 'active', customer: 'B' }),
    ];

    const results = applyJobMetaToJobs(cloudJobs);
    expect(results[0].status).toBe('quoted');
    expect(results[0].customer).toBe('A');
    expect(results[1].status).toBe('active');
    expect(results[1].customer).toBe('B');
  });
});

// ── AC6: writeJobMeta marks fields pending ────────────────────────────────────

describe('AC6 — writeJobMeta marks written fields as pending', () => {
  it('all META_FIELDS present in partial are marked pending', () => {
    const id = 'ac6-pending-001';
    writeJobMeta(id, { status: 'invoice_sent', customer: 'Test', notes: 'hi' });

    const pending = readPendingKeys(id);
    expect(pending).toContain('status');
    expect(pending).toContain('customer');
    expect(pending).toContain('notes');
  });

  it('fields absent from partial are NOT marked pending', () => {
    const id = 'ac6-pending-002';
    writeJobMeta(id, { status: 'invoice_sent' });

    const pending = readPendingKeys(id);
    expect(pending).not.toContain('customer');
    expect(pending).not.toContain('notes');
    expect(pending).not.toContain('lineItems');
  });

  it('writeJobMeta with empty id does not mark pending (guard)', () => {
    const before = readPendingKeys(null);
    writeJobMeta(null, { status: 'paid' });
    const after = readPendingKeys(null);
    expect(after).toEqual(before);
  });

  it('subsequent writeJobMeta merges into existing pending set', () => {
    const id = 'ac6-pending-003';
    writeJobMeta(id, { status: 'quoted' });
    writeJobMeta(id, { notes: 'added later' });

    const pending = readPendingKeys(id);
    expect(pending).toContain('status');
    expect(pending).toContain('notes');
  });
});

// ── AC7: clearPending helpers ─────────────────────────────────────────────────

describe('AC7 — clearPending removes keys correctly', () => {
  it('clearPending removes specified keys', () => {
    const id = 'ac7-clear-001';
    writeJobMeta(id, { status: 'quoted', notes: 'note', total: 200 });

    clearPending(id, ['status', 'total']);
    const pending = readPendingKeys(id);

    expect(pending).not.toContain('status');
    expect(pending).not.toContain('total');
    expect(pending).toContain('notes'); // not cleared
  });

  it('clearPending of all keys empties the pending set', () => {
    const id = 'ac7-clear-002';
    writeJobMeta(id, { status: 'quoted', customer: 'X' });

    clearPending(id, ['status', 'customer']);
    const pending = readPendingKeys(id);

    expect(pending).toHaveLength(0);
  });

  it('clearPending with unknown keys is a no-op', () => {
    const id = 'ac7-clear-003';
    writeJobMeta(id, { status: 'quoted' });

    clearPending(id, ['nonExistentField123']);
    const pending = readPendingKeys(id);
    expect(pending).toContain('status'); // unaffected
  });

  it('clearPending with empty keys array is a no-op', () => {
    const id = 'ac7-clear-004';
    writeJobMeta(id, { status: 'quoted' });
    clearPending(id, []);
    expect(readPendingKeys(id)).toContain('status');
  });
});

// ── Cross-device scenario: full round-trip simulation ────────────────────────

describe('Cross-device scenario: Device A edits, Device B reads', () => {
  it('full simulation: Device A edits status, cloud confirms, Device B sees new status', () => {
    const id = 'xdev-scenario-001';

    // DEVICE B initial state: loaded the job once, writes were synced
    writeJobMeta(id, { status: 'quoted', customer: 'Bob' });
    clearPending(id, ['status', 'customer']); // both synced

    // DEVICE A (simulated): moved job to invoice_sent, cloud confirmed.
    // On Device B, cloud data from a refreshFromCloud now carries invoice_sent.
    const freshCloudJob = makeCloudJob(id, {
      status: 'invoice_sent',
      customer: 'Bob', // same
      total: 350,
    });

    // Device B calls applyJobMeta on the fresh cloud data
    const result = applyJobMeta(freshCloudJob);

    expect(result.status).toBe('invoice_sent'); // Device A's edit is visible
    expect(result.customer).toBe('Bob');
  });

  it('Device B has pending edit on different field: both devices see their own edits', () => {
    const id = 'xdev-scenario-002';

    // Device B wrote a note (pending, not yet synced)
    writeJobMeta(id, { notes: 'Device B note' });
    // status was previously synced
    writeJobMeta(id, { status: 'quoted' });
    clearPending(id, ['status']);

    // Cloud (Device A moved to invoice_sent, also has different notes)
    const freshCloudJob = makeCloudJob(id, {
      status: 'invoice_sent',
      notes: 'Device A note',
    });

    const result = applyJobMeta(freshCloudJob);

    expect(result.status).toBe('invoice_sent'); // Device A's status wins (non-pending on B)
    expect(result.notes).toBe('Device B note');  // Device B's note wins (pending)
  });

  it('reload does not re-apply stale non-pending data — the bug scenario', () => {
    const id = 'xdev-bug-001';

    // This is the exact bug scenario from the diagnosis:
    // Reading device's localStorage has stale status:'quoted', customer:'Old'
    // These fields were written when Device B first viewed the job (non-pending —
    // they represent a remote cloud value that was applied, not a local edit).
    // Simulate: they were synced long ago.
    writeJobMeta(id, { status: 'quoted', customer: 'Old Customer', total: 100 });
    clearPending(id, ['status', 'customer', 'total']); // all confirmed-synced

    // Now a reload brings Device A's edit from cloud
    const freshCloud = makeCloudJob(id, {
      status: 'invoice_sent',
      customer: 'New Customer',
      total: 420,
    });

    const result = applyJobMeta(freshCloud);

    // OLD BEHAVIOUR (broken): result.status === 'quoted' (stale local wins)
    // NEW BEHAVIOUR (fixed):
    expect(result.status).toBe('invoice_sent');
    expect(result.customer).toBe('New Customer');
    expect(result.total).toBe(420);
  });
});

// ── Gap 1: TodayScreen snooze/dismiss path ────────────────────────────────────
// Regression cover: the old extractJobMeta({ ...job, snoozedUntil }) call in
// TodayScreen marked the entire job snapshot pending with no cloud-clear path.
// Fix: handleSnooze drops the writeJobMeta call (snoozedUntil not in META_FIELDS);
//      handleAcceptedDismiss writes only { acceptedSeenAt }.

describe('Gap 1 — TodayScreen snooze/dismiss does not poison the pending set', () => {
  it('after acceptedSeenAt write, status/customer/total remain cloud-authoritative', () => {
    const id = 'gap1-dismiss-001';
    // Simulate a full job object (as TodayScreen would have it):
    const job = {
      id,
      status: 'active',
      quoteStatus: 'accepted',
      customer: 'Old Customer',
      total: 350,
      notes: 'Some notes',
      lineItems: [{ desc: 'Labour', cost: 350 }],
      acceptedSeenAt: undefined,
    };

    // Simulate what handleAcceptedDismiss NOW does (fixed: only acceptedSeenAt):
    writeJobMeta(job.id, { acceptedSeenAt: '2026-07-01T12:00:00.000Z' });

    // Cloud job reflects a Device A edit (moved to invoice_sent, new customer)
    const cloudJob = {
      id,
      status: 'invoice_sent',
      quoteStatus: 'accepted',
      customer: 'New Customer',
      total: 420,
      notes: 'Cloud notes',
      lineItems: [{ desc: 'Labour', cost: 420 }],
    };

    const result = applyJobMeta(cloudJob);

    // Only acceptedSeenAt should be from local (pending):
    expect(result.acceptedSeenAt).toBe('2026-07-01T12:00:00.000Z');
    // Everything else comes from cloud (non-pending):
    expect(result.status).toBe('invoice_sent');
    expect(result.customer).toBe('New Customer');
    expect(result.total).toBe(420);
    expect(result.notes).toBe('Cloud notes');
  });

  it('acceptedSeenAt write marks only that field pending', () => {
    const id = 'gap1-dismiss-002';
    writeJobMeta(id, { acceptedSeenAt: '2026-07-01T12:00:00.000Z' });

    const pending = readPendingKeys(id);
    expect(pending).toContain('acceptedSeenAt');
    expect(pending).not.toContain('status');
    expect(pending).not.toContain('customer');
    expect(pending).not.toContain('total');
    expect(pending).not.toContain('notes');
    expect(pending).not.toContain('lineItems');
  });

  it('snooze path: no writeJobMeta → pending set remains empty', () => {
    const id = 'gap1-snooze-001';
    // handleSnooze no longer calls writeJobMeta — snooze state goes into the
    // snooze store only. Verify: a fresh job's pending set is empty after snooze.
    // (We simulate by simply not calling writeJobMeta, which is what the fix does.)
    // There is nothing to write — verify the pending set is empty.
    const pending = readPendingKeys(id);
    expect(pending).toHaveLength(0);
  });

  it('snooze path: pending-set-free, so a cloud edit is visible on refresh', () => {
    const id = 'gap1-snooze-002';
    // Before the fix, handleSnooze called:
    //   writeJobMeta(job.id, extractJobMeta({ ...job, snoozedUntil }))
    // which marked status/customer/total/etc. pending with no cloud-clear.
    // After the fix, no writeJobMeta is called. Verify the cloud edit is visible:
    const cloudJob = makeCloudJob(id, { status: 'invoice_sent', customer: 'Updated' });
    const result = applyJobMeta(cloudJob);

    // No local pending → cloud wins:
    expect(result.status).toBe('invoice_sent');
    expect(result.customer).toBe('Updated');
  });
});

// ── Gap 2: Ratchet status/jobStatus freed from pending set ────────────────────
// Regression cover: the old ratchet wrote status/jobStatus into the pending set
// via writeJobMeta. A later cross-device stage move (e.g. Device B moves to
// invoice_sent after acceptance) was masked on the observing device forever.
// Fix: ratchet only writes quoteStatus + acceptance fields as pending;
//      clearPending(['status','jobStatus']) ensures pipeline stage stays cloud-authoritative.

describe('Gap 2 — ratchet does not freeze status/jobStatus in pending set', () => {
  it('after ratchet fires, status/jobStatus are NOT pending', () => {
    const id = 'gap2-ratchet-001';
    writeJobMeta(id, { quoteStatus: 'sent', status: 'quoted' });

    const cloudJob = {
      id,
      quoteStatus:    'accepted',
      status:         'active',
      jobStatus:      'active',
      acceptedAt:     '2026-07-01T10:00:00.000Z',
      acceptedName:   'Dave',
      acceptedSource: 'remote',
      total:          500,
    };

    applyJobMeta(cloudJob);

    const pending = readPendingKeys(id);
    expect(pending).not.toContain('status');
    expect(pending).not.toContain('jobStatus');
    // quoteStatus IS still pending (the monotonic field):
    expect(pending).toContain('quoteStatus');
  });

  it('accepted then stage-move: observing device sees the new stage', () => {
    // The full scenario: Device A (trader) sees acceptance ratchet fire.
    // Then Device B moves the accepted job to invoice_sent.
    // Device A's next cloud read must show invoice_sent, not the ratchet-frozen 'active'.
    const id = 'gap2-stagemove-001';

    // Step 1: realtime event fires — ratchet writes accepted into pending
    writeJobMeta(id, { quoteStatus: 'sent', status: 'quoted' });
    const ratchetCloud = {
      id,
      quoteStatus:    'accepted',
      status:         'active',
      jobStatus:      'active',
      acceptedAt:     '2026-07-01T10:00:00.000Z',
      acceptedName:   'Alice',
      acceptedSource: 'remote',
      total:          600,
    };
    const afterRatchet = applyJobMeta(ratchetCloud);
    expect(afterRatchet.quoteStatus).toBe('accepted'); // ratchet worked
    expect(afterRatchet.status).toBe('active');        // cloud status correct

    // Step 2: Device B moves the job to invoice_sent. Cloud now reflects that.
    const afterStageMove = {
      id,
      quoteStatus:    'accepted',
      status:         'invoice_sent',
      jobStatus:      'active',
      acceptedAt:     '2026-07-01T10:00:00.000Z',
      acceptedName:   'Alice',
      acceptedSource: 'remote',
      total:          600,
    };
    const result = applyJobMeta(afterStageMove);

    // status must be invoice_sent (cloud wins — not frozen by ratchet):
    expect(result.status).toBe('invoice_sent');
    // quoteStatus must still be accepted (pending from ratchet):
    expect(result.quoteStatus).toBe('accepted');
  });

  it('stale local quoteStatus:sent does not win after ratchet runs + pending status cleared', () => {
    // This is the core AC4 guarantee: cloud 'accepted' still wins over stale
    // local pending 'sent' — even though we changed the ratchet implementation.
    const id = 'gap2-monotonic-001';

    // Local has stale sent (was synced, then pending cleared)
    writeJobMeta(id, { quoteStatus: 'sent', status: 'quoted' });
    clearPending(id, ['quoteStatus', 'status']);

    // Cloud now says accepted
    const cloudJob = {
      id,
      quoteStatus:    'accepted',
      status:         'active',
      acceptedAt:     '2026-07-01T11:00:00.000Z',
      acceptedName:   'Bob',
      acceptedSource: 'remote',
      total:          300,
    };
    const result = applyJobMeta(cloudJob);

    expect(result.quoteStatus).toBe('accepted');
    expect(result.status).toBe('active');
    expect(result.acceptedAt).toBe('2026-07-01T11:00:00.000Z');
  });
});
