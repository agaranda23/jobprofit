import { useEffect, useState } from 'react';
import {
  subscribe,
  subscribeToSyncState,
  subscribeToErrorState,
  runSync,
  getQueueLength,
  getMetaQueueLength,
  getPending,
  discardEntry,
} from '../lib/offlineQueue';

// Four visible states:
//   hidden   — queue empty, nothing shown
//   pending  — N jobs waiting, tap triggers a manual sync
//   syncing  — sync in progress, spinner copy
//   stuck    — queue non-empty AND last attempt failed AND > 60s ago
//
// Stuck threshold: 60 seconds since the last failed attempt.
// Placement: fixed at top of screen, below any safe-area inset.
// Disappears the moment the queue empties.

const STUCK_THRESHOLD_MS = 60_000;

export default function SyncBadge() {
  // queueLength is the TOTAL count (new jobs + meta updates) — from subscribe()
  // which already calls getTotalQueueLength() since PR feat/offline-meta-queue.
  const [queueLength, setQueueLength]   = useState(0);
  const [metaCount, setMetaCount]       = useState(0);
  const [syncing, setSyncing]           = useState(false);
  const [errorState, setErrorState]     = useState({ lastError: null, lastAttemptAt: null });
  const [now, setNow]                   = useState(() => Date.now());
  // Action sheet state
  const [sheetOpen, setSheetOpen]       = useState(false);
  const [detailOpen, setDetailOpen]     = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // First queued entry (for discard action)
  const [firstEntry, setFirstEntry]     = useState(null);

  useEffect(() => {
    const unsubQueue   = subscribe(setQueueLength);
    const unsubSyncing = subscribeToSyncState(setSyncing);
    const unsubError   = subscribeToErrorState(setErrorState);

    // Track meta-update count separately so the label can be specific
    // e.g. "2 new jobs + 3 edits waiting" vs the generic total.
    let mounted = true;
    function refreshMetaCount() {
      getMetaQueueLength()
        .then(n => { if (mounted) setMetaCount(n); })
        .catch(() => {});
    }
    refreshMetaCount();
    // Re-read after each total-queue change so the breakdown stays current
    const unsubForMeta = subscribe(() => refreshMetaCount());

    return () => {
      mounted = false;
      unsubQueue();
      unsubSyncing();
      unsubError();
      unsubForMeta();
    };
  }, []);

  // Tick every 5s so the stuck flag re-evaluates without waiting for a user action.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(interval);
  }, []);

  // Load the first pending entry when the action sheet opens (needed for discard).
  useEffect(() => {
    if (sheetOpen) {
      getPending().then(rows => setFirstEntry(rows[0] ?? null)).catch(() => {});
    }
  }, [sheetOpen]);

  // Hidden when queue is empty and not actively syncing
  if (queueLength === 0 && !syncing) return null;

  const isStuck =
    queueLength > 0 &&
    !!errorState.lastError &&
    errorState.lastAttemptAt !== null &&
    (now - errorState.lastAttemptAt) > STUCK_THRESHOLD_MS;

  const handleBadgeTap = () => {
    if (syncing) return;
    if (isStuck) {
      setSheetOpen(true);
      return;
    }
    runSync().catch(() => {});
  };

  const handleRetry = () => {
    setSheetOpen(false);
    runSync().catch(() => {});
  };

  const handleSeeDetails = () => {
    setDetailOpen(true);
  };

  const handleRequestDiscard = () => {
    setConfirmDiscard(true);
  };

  const handleConfirmDiscard = async () => {
    setConfirmDiscard(false);
    setSheetOpen(false);
    if (firstEntry?.id) {
      await discardEntry(firstEntry.id).catch(() => {});
    }
  };

  const handleCancelDiscard = () => {
    setConfirmDiscard(false);
  };

  const timeAgo = errorState.lastAttemptAt
    ? (() => {
        const secs = Math.floor((now - errorState.lastAttemptAt) / 1000);
        if (secs < 60) return `${secs}s ago`;
        const mins = Math.floor(secs / 60);
        if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
        const hours = Math.floor(mins / 60);
        return `${hours} hr${hours === 1 ? '' : 's'} ago`;
      })()
    : 'unknown';

  // Build a human-readable label that breaks down the pending count.
  // New-job count = total minus meta updates (both tracked independently).
  const jobCount  = Math.max(0, queueLength - metaCount);
  const parts     = [];
  if (jobCount > 0)   parts.push(`${jobCount} new job${jobCount  !== 1 ? 's' : ''}`);
  if (metaCount > 0)  parts.push(`${metaCount} edit${metaCount !== 1 ? 's' : ''}`);
  const pendingDescription = parts.length > 0 ? parts.join(' + ') : `${queueLength} change${queueLength !== 1 ? 's' : ''}`;

  const label = syncing
    ? 'Syncing…'
    : isStuck
      ? 'Sync failed — tap for options'
      : `⚡ ${pendingDescription} waiting to sync`;

  return (
    <>
      <button
        className={`sync-badge${syncing ? ' sync-badge--syncing' : ''}${isStuck ? ' sync-badge--stuck' : ''}`}
        onClick={handleBadgeTap}
        disabled={syncing}
        aria-live="polite"
        aria-label={
          syncing
            ? 'Syncing changes'
            : isStuck
              ? 'Sync failed — tap for options'
              : `${pendingDescription} waiting to sync — tap to retry`
        }
        type="button"
      >
        {syncing && <span className="sync-badge__spinner" aria-hidden="true" />}
        {label}
      </button>

      {/* Stuck action sheet */}
      {sheetOpen && !confirmDiscard && !detailOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Sync options">
          <div className="modal-card sync-stuck-sheet">
            <p className="modal-card-title">This job hasn&apos;t synced</p>
            <p className="modal-card-body">
              Last tried {timeAgo}. You can retry, see what went wrong, or discard it.
            </p>
            <div className="modal-card-actions sync-stuck-actions">
              <button
                type="button"
                className="modal-btn modal-btn--secondary"
                onClick={() => setSheetOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--secondary"
                onClick={handleSeeDetails}
              >
                See details
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--danger"
                onClick={handleRequestDiscard}
              >
                Discard
              </button>
              <button
                type="button"
                className="modal-btn"
                style={{ background: 'var(--accent)', color: '#0b1f10' }}
                onClick={handleRetry}
              >
                Retry now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* See details modal */}
      {detailOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Sync error details">
          <div className="modal-card">
            <p className="modal-card-title">Sync error</p>
            <p className="modal-card-body" style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>
              {errorState.lastError?.message || String(errorState.lastError) || 'Unknown error'}
            </p>
            <div className="modal-card-actions">
              <button
                type="button"
                className="modal-btn modal-btn--secondary"
                onClick={() => setDetailOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discard confirmation */}
      {confirmDiscard && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Confirm discard">
          <div className="modal-card">
            <p className="modal-card-title">Discard 1 unsynced job?</p>
            <p className="modal-card-body">You won&apos;t get it back.</p>
            <div className="modal-card-actions">
              <button
                type="button"
                className="modal-btn modal-btn--secondary"
                onClick={handleCancelDiscard}
              >
                Keep
              </button>
              <button
                type="button"
                className="modal-btn modal-btn--danger"
                onClick={handleConfirmDiscard}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
