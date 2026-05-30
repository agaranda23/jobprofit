// Offline queue for job writes.
//
// When a Supabase insert fails (no signal, timeout, etc.) the job row is
// written here instead of being silently dropped. A sync runner retries on:
//   (a) app load
//   (b) window 'online' event
//   (c) explicit user tap on the SyncBadge
//
// Storage: raw IndexedDB — no external dependency.
// DB name: 'jp-offline-queue', object store: 'jobs', keyPath: 'id'
//
// IMPORTANT: Chase pipeline reads from synced cloud state only. Jobs sitting
// in this queue must not trigger chase reminders. The queue writes the row
// with status 'lead' or 'paid'; the chase ladder in chaseLadder.js runs from
// jobs fetched via getJobsFromCloud() — rows that only exist locally will
// never appear there, so the constraint is structurally guaranteed.

const DB_NAME    = 'jp-offline-queue';
const DB_VERSION = 1;
const STORE_NAME = 'jobs';

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
    };
    req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror    = (e) => reject(e.target.error);
  });
}

// ─── Subscribers ─────────────────────────────────────────────────────────────

const _subscribers = new Set();

function _notify() {
  getQueueLength().then(n => {
    _subscribers.forEach(cb => {
      try { cb(n); } catch {}
    });
  });
}

/**
 * Subscribe to queue-length changes.
 * Returns an unsubscribe function.
 */
export function subscribe(callback) {
  _subscribers.add(callback);
  // Fire immediately with the current count so callers can initialise.
  getQueueLength().then(n => {
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
 * Removes a single entry from the queue by id (user-initiated discard).
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

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns all pending job rows.
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

/** Returns the number of rows currently queued. */
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

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Adds a job payload to the queue.
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
 * Removes a row from the queue after a successful Supabase write.
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
 * Attempts to flush all pending rows to Supabase.
 * Imported lazily inside this function to avoid a circular dependency
 * (store.js imports nothing from here; we import addJobToCloud at call time).
 *
 * Returns { synced, failed } counts.
 */
export async function runSync() {
  if (_syncing) return { synced: 0, failed: 0 };
  const pending = await getPending();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  _setSyncing(true);
  _lastAttemptAt = Date.now();
  let synced = 0;
  let failed = 0;

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
