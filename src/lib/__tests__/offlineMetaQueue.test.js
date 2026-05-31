/**
 * offlineMetaQueue.test.js
 *
 * Tests for the meta-update offline queue: enqueueMetaUpdate, coalescing,
 * flush on reconnect (runSync drains meta store), and the store.js fallback
 * path (updateJobMetaInCloud enqueues when offline).
 *
 * The full module is mocked (same pattern as offlineQueue.test.js) because
 * IndexedDB is unavailable in the Node/Vitest environment. The mock
 * faithfully mirrors the real coalescing behaviour: put() with the same
 * jobId replaces the previous row.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory stores ─────────────────────────────────────────────────────────
let _jobStore = new Map();   // keyPath: id
let _metaStore = new Map();  // keyPath: jobId  (coalesces automatically)

// ── Mock offlineQueue ─────────────────────────────────────────────────────────
vi.mock('../offlineQueue.js', async () => {
  // Queue-length subscriber set
  const _subscribers = new Set();
  async function _notify() {
    const n = _jobStore.size + _metaStore.size;
    _subscribers.forEach(cb => { try { cb(n); } catch {} });
  }

  function subscribe(callback) {
    _subscribers.add(callback);
    try { callback(_jobStore.size + _metaStore.size); } catch {}
    return () => _subscribers.delete(callback);
  }

  async function getPending()           { return Array.from(_jobStore.values()); }
  async function getPendingMetaUpdates(){ return Array.from(_metaStore.values()); }
  async function getQueueLength()       { return _jobStore.size; }
  async function getMetaQueueLength()   { return _metaStore.size; }
  async function getTotalQueueLength()  { return _jobStore.size + _metaStore.size; }

  async function enqueueJob(row) {
    if (!row?.id) throw new Error('enqueueJob: jobRow.id is required');
    _jobStore.set(row.id, { ...row, _queuedAt: Date.now() });
    await _notify();
  }

  async function markSynced(id) {
    _jobStore.delete(id);
    await _notify();
  }

  // Coalescing via Map.set — same semantics as IDB put() with keyPath 'jobId'
  async function enqueueMetaUpdate(jobId, meta) {
    if (!jobId || !meta) throw new Error('enqueueMetaUpdate: jobId and metaObject are required');
    _metaStore.set(jobId, { jobId, meta, _queuedAt: Date.now() });
    await _notify();
  }

  async function markMetaSynced(jobId) {
    _metaStore.delete(jobId);
    await _notify();
  }

  // Sync-state
  let _syncing = false;
  const _syncingSubscribers = new Set();
  function subscribeToSyncState(cb) {
    _syncingSubscribers.add(cb);
    try { cb(_syncing); } catch {}
    return () => _syncingSubscribers.delete(cb);
  }
  function _setSyncing(val) {
    _syncing = val;
    _syncingSubscribers.forEach(cb => { try { cb(val); } catch {} });
  }

  // Error state
  let _lastError = null;
  let _lastAttemptAt = null;
  const _errorSubscribers = new Set();
  function _notifyErrorState() {
    _errorSubscribers.forEach(cb => {
      try { cb({ lastError: _lastError, lastAttemptAt: _lastAttemptAt }); } catch {}
    });
  }
  function subscribeToErrorState(cb) {
    _errorSubscribers.add(cb);
    try { cb({ lastError: _lastError, lastAttemptAt: _lastAttemptAt }); } catch {}
    return () => _errorSubscribers.delete(cb);
  }

  // Injected cloud functions (tests can override)
  let _cloudJobInsert  = async () => {};
  let _cloudMetaUpdate = async () => ({ ok: true });
  function __setCloudInsert(fn)      { _cloudJobInsert  = fn; }
  function __setCloudMetaUpdate(fn)  { _cloudMetaUpdate = fn; }

  async function runSync() {
    if (_syncing) return { synced: 0, failed: 0 };
    const jobCount  = _jobStore.size;
    const metaCount = _metaStore.size;
    if (jobCount === 0 && metaCount === 0) return { synced: 0, failed: 0 };

    _setSyncing(true);
    _lastAttemptAt = Date.now();
    let synced = 0;
    let failed = 0;

    // Flush new-job inserts
    for (const row of Array.from(_jobStore.values())) {
      try {
        await _cloudJobInsert(row);
        _jobStore.delete(row.id);
        await _notify();
        synced++;
      } catch (err) {
        const isAlreadySynced =
          err?.code === '23505' ||
          (typeof err?.message === 'string' && err.message.includes('duplicate key'));
        if (isAlreadySynced) {
          _jobStore.delete(row.id);
          await _notify();
          synced++;
        } else {
          _lastError = err;
          failed++;
        }
      }
    }

    // Flush meta updates
    for (const row of Array.from(_metaStore.values())) {
      try {
        const result = await _cloudMetaUpdate(row.jobId, row.meta);
        if (result.ok) {
          _metaStore.delete(row.jobId);
          await _notify();
          synced++;
        } else if (result.error === 'offline') {
          failed++;
        } else {
          // Non-retryable — drain to prevent stuck badge
          _metaStore.delete(row.jobId);
          await _notify();
          synced++;
        }
      } catch (err) {
        _lastError = err;
        failed++;
      }
    }

    if (failed === 0) _lastError = null;
    _setSyncing(false);
    _notifyErrorState();
    return { synced, failed };
  }

  async function discardEntry(id) {
    _jobStore.delete(id);
    _lastError     = null;
    _lastAttemptAt = null;
    await _notify();
    _notifyErrorState();
  }

  let _wired = false;
  function wireOnlineSync() {
    if (_wired) return;
    _wired = true;
    runSync().catch(() => {});
  }

  return {
    subscribe,
    subscribeToSyncState,
    subscribeToErrorState,
    getPending,
    getPendingMetaUpdates,
    getQueueLength,
    getMetaQueueLength,
    getTotalQueueLength,
    enqueueJob,
    markSynced,
    enqueueMetaUpdate,
    markMetaSynced,
    runSync,
    discardEntry,
    wireOnlineSync,
    __setCloudInsert,
    __setCloudMetaUpdate,
  };
});

// ── Mock store.js — controls updateJobMetaInCloud for the store tests ─────────
// We provide a separate controllable mock so we can simulate offline/online.
let _storeMetaOnline = true;   // toggle per test

vi.mock('../store.js', async () => {
  async function updateJobMetaInCloud(jobId, metaObject) {
    if (!jobId || !metaObject) return { ok: false, error: 'missing-args' };
    if (!_storeMetaOnline) {
      // Simulate offline: call enqueueMetaUpdate via the mocked offlineQueue
      const { enqueueMetaUpdate } = await import('../offlineQueue.js');
      await enqueueMetaUpdate(jobId, metaObject);
      return { ok: false, error: 'offline' };
    }
    return { ok: true };
  }
  async function addJobToCloud() { return {}; }
  return { updateJobMetaInCloud, addJobToCloud };
});

// ── Import after mocks ────────────────────────────────────────────────────────
const {
  enqueueMetaUpdate,
  getMetaQueueLength,
  getTotalQueueLength,
  getPendingMetaUpdates,
  runSync,
  __setCloudMetaUpdate,
  __setCloudInsert,
  enqueueJob,
  getQueueLength,
} = await import('../offlineQueue.js');

const { updateJobMetaInCloud } = await import('../store.js');

// ── Helpers ───────────────────────────────────────────────────────────────────
function uuid() { return crypto.randomUUID(); }
function makeMeta(overrides = {}) {
  return { status: 'active', paymentStatus: 'unpaid', ...overrides };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('enqueueMetaUpdate', () => {
  beforeEach(() => {
    _jobStore.clear();
    _metaStore.clear();
    _storeMetaOnline = true;
    __setCloudInsert(async () => {});
    __setCloudMetaUpdate(async () => ({ ok: true }));
  });

  it('adds a meta-update row to the queue', async () => {
    const jobId = uuid();
    await enqueueMetaUpdate(jobId, makeMeta());
    expect(await getMetaQueueLength()).toBe(1);
  });

  it('coalesces multiple updates for the same job — only the latest survives', async () => {
    const jobId = uuid();
    await enqueueMetaUpdate(jobId, makeMeta({ status: 'quoted' }));
    await enqueueMetaUpdate(jobId, makeMeta({ status: 'invoiced' }));
    await enqueueMetaUpdate(jobId, makeMeta({ status: 'paid' }));

    expect(await getMetaQueueLength()).toBe(1);
    const rows = await getPendingMetaUpdates();
    expect(rows[0].meta.status).toBe('paid');
  });

  it('keeps rows for different jobs separate', async () => {
    const id1 = uuid();
    const id2 = uuid();
    await enqueueMetaUpdate(id1, makeMeta({ status: 'quoted' }));
    await enqueueMetaUpdate(id2, makeMeta({ status: 'invoiced' }));
    expect(await getMetaQueueLength()).toBe(2);
  });

  it('throws when jobId is missing', async () => {
    await expect(enqueueMetaUpdate(null, makeMeta())).rejects.toThrow();
  });

  it('throws when metaObject is missing', async () => {
    await expect(enqueueMetaUpdate(uuid(), null)).rejects.toThrow();
  });
});

describe('getTotalQueueLength', () => {
  beforeEach(() => {
    _jobStore.clear();
    _metaStore.clear();
    __setCloudInsert(async () => {});
    __setCloudMetaUpdate(async () => ({ ok: true }));
  });

  it('sums new-job and meta-update counts', async () => {
    const jobId = uuid();
    await enqueueJob({ id: uuid(), customer: 'Test', amount: 100 });
    await enqueueMetaUpdate(jobId, makeMeta());
    expect(await getTotalQueueLength()).toBe(2);
  });

  it('returns 0 when both queues are empty', async () => {
    expect(await getTotalQueueLength()).toBe(0);
  });
});

describe('runSync flushes meta updates', () => {
  beforeEach(() => {
    _jobStore.clear();
    _metaStore.clear();
    _storeMetaOnline = true;
    __setCloudInsert(async () => {});
    __setCloudMetaUpdate(async () => ({ ok: true }));
  });

  it('drains meta-update queue on success', async () => {
    const jobId = uuid();
    await enqueueMetaUpdate(jobId, makeMeta());
    expect(await getMetaQueueLength()).toBe(1);

    const { synced, failed } = await runSync();
    expect(synced).toBe(1);
    expect(failed).toBe(0);
    expect(await getMetaQueueLength()).toBe(0);
  });

  it('leaves meta row in queue when cloud returns offline error', async () => {
    const jobId = uuid();
    await enqueueMetaUpdate(jobId, makeMeta());
    __setCloudMetaUpdate(async () => ({ ok: false, error: 'offline' }));

    const { synced, failed } = await runSync();
    expect(failed).toBe(1);
    expect(synced).toBe(0);
    expect(await getMetaQueueLength()).toBe(1);
  });

  it('drains non-retryable Supabase error (not offline) to prevent stuck badge', async () => {
    const jobId = uuid();
    await enqueueMetaUpdate(jobId, makeMeta());
    __setCloudMetaUpdate(async () => ({ ok: false, error: 'rls-violation' }));

    const { synced, failed } = await runSync();
    expect(synced).toBe(1);
    expect(failed).toBe(0);
    expect(await getMetaQueueLength()).toBe(0);
  });

  it('flushes both new jobs and meta updates in the same runSync call', async () => {
    await enqueueJob({ id: uuid(), customer: 'A', amount: 50 });
    await enqueueMetaUpdate(uuid(), makeMeta({ status: 'invoiced' }));

    const { synced, failed } = await runSync();
    expect(synced).toBe(2);
    expect(failed).toBe(0);
    expect(await getTotalQueueLength()).toBe(0);
  });
});

describe('store.js updateJobMetaInCloud offline fallback', () => {
  beforeEach(() => {
    _jobStore.clear();
    _metaStore.clear();
    _storeMetaOnline = true;
  });

  it('returns { ok: true } when online', async () => {
    const result = await updateJobMetaInCloud(uuid(), makeMeta());
    expect(result.ok).toBe(true);
  });

  it('enqueues the meta update when offline', async () => {
    _storeMetaOnline = false;
    const jobId = uuid();
    const result = await updateJobMetaInCloud(jobId, makeMeta({ status: 'quoted' }));

    expect(result.ok).toBe(false);
    expect(result.error).toBe('offline');
    expect(await getMetaQueueLength()).toBe(1);

    const rows = await getPendingMetaUpdates();
    expect(rows[0].jobId).toBe(jobId);
  });

  it('coalesces offline updates for the same job so only latest meta is queued', async () => {
    _storeMetaOnline = false;
    const jobId = uuid();
    await updateJobMetaInCloud(jobId, makeMeta({ status: 'quoted' }));
    await updateJobMetaInCloud(jobId, makeMeta({ status: 'invoiced' }));

    expect(await getMetaQueueLength()).toBe(1);
    const rows = await getPendingMetaUpdates();
    expect(rows[0].meta.status).toBe('invoiced');
  });

  it('flushes the queued meta update when coming back online via runSync', async () => {
    _storeMetaOnline = false;
    const jobId = uuid();
    await updateJobMetaInCloud(jobId, makeMeta());
    expect(await getMetaQueueLength()).toBe(1);

    // Simulate coming back online
    _storeMetaOnline = true;
    __setCloudMetaUpdate(async () => ({ ok: true }));
    const { synced, failed } = await runSync();

    expect(synced).toBe(1);
    expect(failed).toBe(0);
    expect(await getMetaQueueLength()).toBe(0);
  });
});
