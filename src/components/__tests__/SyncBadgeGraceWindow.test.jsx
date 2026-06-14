// @vitest-environment jsdom
/**
 * SyncBadgeGraceWindow.test.jsx
 *
 * Regression for F3 (sync/backup bug fix): SyncBadge must suppress the
 * "not backed up" banner for a short grace window (GRACE_WINDOW_MS = 5s)
 * after a job is first enqueued while a sync attempt is in-flight.
 *
 * After the grace window expires, if the row is still queued, the banner
 * must reappear as normal. The auth-failure copy path must be unaffected.
 *
 * Tests:
 *   1. Banner is suppressed during the grace window (syncing + just enqueued)
 *   2. Banner reappears after the grace window expires
 *   3. Auth-failure path still works even without a grace window
 *   4. Grace window only suppresses when syncing — if NOT syncing, banner shows
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import React from 'react';

// ── Mock offlineQueue ─────────────────────────────────────────────────────────
const queueSubscribers = [];
const mockSubscriptions = {
  syncing:   null,
  error:     null,
  enqueued:  null,
};

vi.mock('../../lib/offlineQueue', () => ({
  subscribe: vi.fn((cb) => {
    queueSubscribers.push(cb);
    return () => {
      const idx = queueSubscribers.indexOf(cb);
      if (idx !== -1) queueSubscribers.splice(idx, 1);
    };
  }),
  subscribeToSyncState:    vi.fn(cb => { mockSubscriptions.syncing  = cb; return () => {}; }),
  subscribeToErrorState:   vi.fn(cb => { mockSubscriptions.error    = cb; return () => {}; }),
  subscribeToLastEnqueued: vi.fn(cb => { mockSubscriptions.enqueued = cb; return () => {}; }),
  runSync:          vi.fn(() => Promise.resolve()),
  getQueueLength:   vi.fn(() => Promise.resolve(0)),
  getMetaQueueLength: vi.fn(() => Promise.resolve(0)),
  getPending:       vi.fn(() => Promise.resolve([])),
  discardEntry:     vi.fn(() => Promise.resolve()),
}));
// ─────────────────────────────────────────────────────────────────────────────

import SyncBadge from '../SyncBadge';

// Helpers — wrapped in act() so React flushes state synchronously
function pushQueue(n)      { act(() => { queueSubscribers.forEach(cb => cb(n)); }); }
function pushSyncing(b)    { act(() => { mockSubscriptions.syncing?.(b);   }); }
function pushEnqueued(ts)  { act(() => { mockSubscriptions.enqueued?.(ts); }); }

const BASE_NOW         = 1_700_000_000_000;
const GRACE_WINDOW_MS  = 5_000;

afterEach(cleanup);
beforeEach(() => {
  queueSubscribers.length        = 0;
  mockSubscriptions.syncing      = null;
  mockSubscriptions.error        = null;
  mockSubscriptions.enqueued     = null;
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('SyncBadge — grace window suppression', () => {
  it('suppresses the banner while syncing and within GRACE_WINDOW_MS of enqueue', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(BASE_NOW);

    const { container } = render(<SyncBadge />);

    // Job enqueued just now (within grace window)
    pushQueue(1);
    pushEnqueued(BASE_NOW);   // enqueued at BASE_NOW
    pushSyncing(true);        // sync started (the immediate runSync fired)

    // now() = BASE_NOW; elapsed since enqueue = 0ms < GRACE_WINDOW_MS
    await vi.waitFor(() => {
      // Banner should be hidden — grace window is active
      expect(container.firstChild).toBeNull();
    });
  });

  it('shows the banner after GRACE_WINDOW_MS when job is still queued', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(BASE_NOW);

    render(<SyncBadge />);

    // Job enqueued 6s ago — past the grace window
    pushQueue(1);
    pushEnqueued(BASE_NOW - GRACE_WINDOW_MS - 1_000);
    pushSyncing(false);  // sync finished but failed — row still in queue

    await vi.waitFor(() => {
      // Banner should reappear: grace window has expired
      expect(screen.getByRole('button', { name: /not backed up yet/i })).toBeInTheDocument();
    });
  });

  it('does NOT suppress the banner when syncing=false (even if recently enqueued)', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(BASE_NOW);

    render(<SyncBadge />);

    // Enqueued just now, but sync is not in-flight (e.g. offline, never started)
    pushQueue(1);
    pushEnqueued(BASE_NOW);
    pushSyncing(false);

    await vi.waitFor(() => {
      // No active sync → grace window does not apply → banner shows
      expect(screen.getByRole('button', { name: /not backed up yet/i })).toBeInTheDocument();
    });
  });

  it('auth-failure copy path is unaffected by the grace window logic', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(BASE_NOW);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);

    render(<SyncBadge />);

    // Auth failure — no grace window in flight
    pushQueue(1);
    pushEnqueued(null); // no recent enqueue
    pushSyncing(false);
    act(() => {
      mockSubscriptions.error?.({
        lastError: new Error('Not signed in'),
        lastAttemptAt: BASE_NOW - 5_000,
      });
    });

    // Should escalate to auth-failure stuck label immediately
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in to back up/i })).toBeInTheDocument();
    });
  });
});
