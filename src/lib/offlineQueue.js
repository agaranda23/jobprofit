// Offline queue for job writes.
//
// When a Supabase insert fails (no signal, timeout, etc.) the job row is
// written here instead of being silently dropped. A sync runner retries on:
//   (a) app load
//   (b) window 'online' event
//   (c) explicit user tap on the SyncBadge
//
// Storage: raw IndexedDB — no external dependency.
// DB name: 'jp-offline-queue'
// Object stores:
//   'jobs'         — keyPath: 'id'       — new-job inserts (pre-existing)
//   'meta-updates' — keyPath: 'jobId'    — meta UPDATE writes (added v2)
//                    One row per jobId; a second enqueueMetaUpdate for the
//                    same job REPLACES the earlier row (coalesce to latest).
//                    Conflict policy: last-write-wins, matching the existing
//                    cloud meta merge behaviour. True merge is out of scope.
//
// IMPORTANT: Chase pipeline reads from synced cloud state only. Jobs sitting
// in this queue must not trigger chase reminders. The queue writes the row
// with status 'lead' or 'paid'; the chase ladder in chaseLadder.js runs from
// jobs fetched via getJobsFromCloud() — rows that only exist locally will
// never appear there, so the constraint is structurally guaranteed.

const DB_NAME    = 'jp-offline-queue';
const DB_VERSION = 2;          // bumped from 1 → 2 to add meta-updates store
const STORE_NAME = 'jobs';
const META_STORE = 'meta-updates';

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      // v2: meta-updates store — keyPath 'jobId' gives free coalescing
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'jobId' });
      }
    };
    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = (e) => reject(e.target.error);
  });
}

// ─── Subscribers ─────────────────────────────────────────────────────────────

const _subscribers = new Set();

function _notify() {
  getTotalQueueLength().then(n => {
    _subscribers.forEach(cb => {
      try { cb(n); } catch {}
    });
  });
}

/**
 * Subscribe to queue-length changes (new-job queue + meta-update queue combined).
 * Returns an unsubscribe function.
 */
export function subscribe(callback) {
  _subscribers.add(callback);
  // Fire immediately with the current count so callers can initialise.
  getTotalQueueLength().then(n => {
    try { callback(n); } catch {}
  });
  return () => _subscribers.delete(callback);
}

// ─── Error state ─────────────────────────────────────────────────────────────
// Tracks the last sync failure so SyncBadge can surface a "stuck" state when
// the queue has entries AND the last attempt failed more than 60s ago.
//
// These are module-level vars (not stored in IndexedDB) — they reset when the
// page reloads, which is fine: a fresh load triggers runSync() automatically
// and either succeeds (badge gone) or sets lastError again within seconds.

let _lastError = null;      // Error object from the most recent failed runSync
let _lastAttemptAt = null;  // Date.now() timestamp of the most recent runSync call

const _errorSubscribers = new Set();

function _notifyErrorState() {
  _errorSubscribers.forEach(cb => {
    try { cb({ lastError: _lastError, lastAttemptAt: _lastAttemptAt }); } catch {}
  });
}

/**
 * Subscribe to error-state changes ({ lastError, lastAttemptAt }).
 * Fires immediately with current state so callers can initialise.
 * Returns an unsubscribe function.
 */
export function subscribeToErrorState(callback) {
  _errorSubscribers.add(callback);
  try { callback({ lastError: _lastError, lastAttemptAt: _lastAttemptAt }); } catch {}
  return () => _errorSubscribers.delete(callback);
}

/**
 * Removes a single new-job entry from the queue by id (user-initiated discard).
 * Does NOT attempt a cloud write — the entry is silently dropped.
 */
export async function discardEntry(id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
  // Clear error state — discarding the entry resolves the stuck condition.
  _lastError     = null;
  _lastAttemptAt = null;
  _notify();
  _notifyErrorState();
}

// ─── Read — new-job queue ─────────────────────────────────────────────────────

/**
 * Returns all pending new-job rows.
 * Each row is the original payload passed to enqueueJob(), plus
 * a `_queuedAt` timestamp (ms).
 */
export async function getPending() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Returns the number of new-job rows currently queued. */
export async function getQueueLength() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ─── Read — meta-update queue ─────────────────────────────────────────────────

/**
 * Returns all pending meta-update rows.
 * Shape: { jobId, meta, _queuedAt }
 */
export async function getPendingMetaUpdates() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(META_STORE, 'readonly');
    const store = tx.objectStore(META_STORE);
    const req   = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/** Returns the number of pending meta-update rows. */
export async function getMetaQueueLength() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(META_STORE, 'readonly');
    const store = tx.objectStore(META_STORE);
    const req   = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

/**
 * Combined count across both queues. Used by subscribe() so SyncBadge reflects
 * ALL pending writes (new jobs + meta updates), not just new jobs.
 */
export async function getTotalQueueLength() {
  const [jobs, meta] = await Promise.all([getQueueLength(), getMetaQueueLength()]);
  return jobs + meta;
}

// ─── Write — new-job queue ────────────────────────────────────────────────────

/**
 * Adds a job payload to the new-job queue.
 * `jobRow.id` must be a UUID string (client-generated by addJobToCloud).
 */
export async function enqueueJob(jobRow) {
  if (!jobRow?.id) throw new Error('enqueueJob: jobRow.id is required');
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.put({ ...jobRow, _queuedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
  _notify();
}

/**
 * Removes a new-job row from the queue after a successful Supabase write.
 */
export async function markSynced(id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
  _notify();
}

// ─── Write — meta-update queue ────────────────────────────────────────────────

/**
 * Enqueues a meta UPDATE for an existing job.
 *
 * Coalesces automatically: the IDB keyPath is 'jobId', so calling this twice
 * for the same job replaces the first row with the latest meta object.
 * This is safe because meta writes are always a full snapshot (not a patch),
 * so the most recent enqueue is a strict superset of any earlier one.
 *
 * @param {string} jobId      – Supabase UUID of the job row
 * @param {object} metaObject – the full meta snapshot from extractJobMeta()
 */
export async function enqueueMetaUpdate(jobId, metaObject) {
  if (!jobId || !metaObject) throw new Error('enqueueMetaUpdate: jobId and metaObject are required');
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx    = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    // put() replaces any existing row with the same jobId — free coalescing.
    const req   = store.put({ jobId, meta: metaObject, _queuedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
  _notify();
}

/**
 * Removes a meta-update row after a successful Supabase write.
 */
export async function markMetaSynced(jobId) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx    = db.transaction(META_STORE, 'readwrite');
    const store = tx.objectStore(META_STORE);
    const req   = store.delete(jobId);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
  _notify();
}

// ─── Sync runner ─────────────────────────────────────────────────────────────

// Prevent concurrent sync runs.
let _syncing = false;

// Sync-state subscribers (used by SyncBadge to show "Syncing…" state).
const _syncingSubscribers = new Set();

export function subscribeToSyncState(callback) {
  _syncingSubscribers.add(callback);
  try { callback(_syncing); } catch {}
  return () => _syncingSubscribers.delete(callback);
}

function _setSyncing(val) {
  _syncing = val;
  _syncingSubscribers.forEach(cb => { try { cb(val); } catch {} });
}

/**
 * Flushes all pending meta-update rows to Supabase.
 * Called from runSync() — do not call directly.
 *
 * Returns { synced, failed } counts for meta rows only.
 */
async function runMetaSync() {
  const pending = await getPendingMetaUpdates();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  // Dynamic import avoids circular dep: store -> offlineQueue -> store
  const { updateJobMetaInCloud } = await import('./store.js');

  let synced = 0;
  let failed = 0;

  for (const row of pending) {
    try {
      const result = await updateJobMetaInCloud(row.jobId, row.meta);
      if (result.ok) {
        await markMetaSynced(row.jobId);
        synced++;
      } else if (result.error === 'offline') {
        // Still offline — leave the row, will retry on next runSync
        failed++;
      } else {
        // Supabase returned a non-network error (e.g. RLS violation).
        // Log it and drain the entry to avoid permanent stuck badge.
        console.warn('Offline meta sync: non-retryable error for', row.jobId, result.error);
        await markMetaSynced(row.jobId).catch(() => {});
        synced++;
      }
    } catch (err) {
      console.warn('Offline meta sync failed for job', row.jobId, err);
      _lastError = err;
      failed++;
    }
  }

  return { synced, failed };
}

/**
 * Attempts to flush all pending rows (new jobs + meta updates) to Supabase.
 * Imported lazily inside this function to avoid a circular dependency
 * (store.js imports nothing from here; we import addJobToCloud at call time).
 *
 * Returns { synced, failed } counts (combined across both queues).
 */
export async function runSync() {
  if (_syncing) return { synced: 0, failed: 0 };
  const [jobCount, metaCount] = await Promise.all([getQueueLength(), getMetaQueueLength()]);
  if (jobCount === 0 && metaCount === 0) return { synced: 0, failed: 0 };

  _setSyncing(true);
  _lastAttemptAt = Date.now();
  let synced = 0;
  let failed = 0;

  // ── 1. Flush new-job inserts ──────────────────────────────────────────────
  const pending = await getPending();

  // Dynamic import avoids circular dep: store -> offlineQueue -> store
  const { addJobToCloud } = await import('./store.js');

  for (const row of pending) {
    try {
      // Pass the pre-generated UUID so addJobToCloud reuses it (not a new one).
      await addJobToCloud(row);
      await markSynced(row.id);
      synced++;
    } catch (err) {
      // Postgres unique-violation (code 23505) means the row already exists in
      // Supabase — a previous sync attempt inserted it but markSynced was never
      // called (e.g. the app closed between the two awaits, or IndexedDB threw).
      // Treat this as "already synced" and drain the queue entry so the badge
      // stops showing a permanently stuck count.
      const isAlreadySynced =
        err?.code === '23505' ||          // Supabase/PostgREST error code
        err?.details?.includes('already exists') ||
        (typeof err?.message === 'string' && err.message.includes('duplicate key'));
      if (isAlreadySynced) {
        console.info('Offline queue: row already in cloud — draining', row.id);
        await markSynced(row.id).catch(() => {});
        synced++;
      } else {
        console.warn('Offline sync failed for job', row.id, err);
        _lastError = err;
        failed++;
      }
    }
  }

  // ── 2. Flush meta updates ─────────────────────────────────────────────────
  const metaResult = await runMetaSync();
  synced += metaResult.synced;
  failed += metaResult.failed;

  // Clear lastError if everything drained successfully.
  if (failed === 0) _lastError = null;
  _setSyncing(false);
  _notifyErrorState();
  return { synced, failed };
}

// ─── Lifecycle wiring ─────────────────────────────────────────────────────────

let _wired = false;

/**
 * Call once at app startup. Wires the 'online' event listener and runs an
 * initial sync attempt. Safe to call multiple times (idempotent).
 */
export function wireOnlineSync() {
  if (_wired) return;
  _wired = true;

  // Attempt sync immediately (catches jobs queued in a previous session).
  runSync().catch(() => {});

  window.addEventListener('online', () => {
    runSync().catch(() => {});
  });
}
