import { useEffect, useState } from 'react';
import { subscribe, subscribeToSyncState, runSync, getQueueLength } from '../lib/offlineQueue';

// Three visible states:
//   hidden   — queue empty, nothing shown
//   pending  — N jobs waiting, tap triggers a manual sync
//   syncing  — sync in progress, spinner copy
//
// Placement: fixed at top of screen, below any safe-area inset.
// Subtle — not alarming. Disappears the moment the queue empties.

export default function SyncBadge() {
  const [queueLength, setQueueLength] = useState(0);
  const [syncing, setSyncing]         = useState(false);

  useEffect(() => {
    const unsubQueue  = subscribe(setQueueLength);
    const unsubSyncing = subscribeToSyncState(setSyncing);
    return () => {
      unsubQueue();
      unsubSyncing();
    };
  }, []);

  // Hidden when queue is empty and not actively syncing
  if (queueLength === 0 && !syncing) return null;

  const handleTap = () => {
    if (syncing) return;
    runSync().catch(() => {});
  };

  const label = syncing
    ? 'Syncing…'
    : `⚡ ${queueLength} job${queueLength !== 1 ? 's' : ''} waiting to sync`;

  return (
    <button
      className={`sync-badge${syncing ? ' sync-badge--syncing' : ''}`}
      onClick={handleTap}
      disabled={syncing}
      aria-live="polite"
      aria-label={syncing ? 'Syncing jobs' : `${queueLength} job${queueLength !== 1 ? 's' : ''} waiting to sync — tap to retry`}
      type="button"
    >
      {syncing && <span className="sync-badge__spinner" aria-hidden="true" />}
      {label}
    </button>
  );
}
