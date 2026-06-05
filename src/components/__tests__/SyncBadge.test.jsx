// @vitest-environment jsdom
/**
 * SyncBadge — unit tests for label copy, aria-label, className, and escalation logic.
 *
 * These tests exercise the four visible states:
 *   hidden   — queue empty
 *   pending  — N items waiting, tap-to-back-up affordance in label
 *   syncing  — in-flight
 *   stuck    — generic amber (60s threshold) + auth-failure red (immediate)
 *
 * The component depends on offlineQueue imports. We mock the entire module so
 * tests remain fast and deterministic without real IndexedDB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';

// --- Mock offlineQueue -----------------------------------------------------------
// The component calls subscribe() twice in its useEffect:
//   1. subscribe(setQueueLength)              — the primary queue-length watcher
//   2. subscribe(() => refreshMetaCount())    — re-reads meta count on every change
//
// A single-slot mockSubscriptions.queue would be overwritten by the second call,
// so pushQueue() would trigger refreshMetaCount() instead of setQueueLength().
// We store ALL queue subscribers in an array and broadcast to every one of them,
// mirroring the fan-out behaviour of the real subscribe() implementation.
const queueSubscribers = [];
const mockSubscriptions = { syncing: null, error: null };

vi.mock('../../lib/offlineQueue', () => ({
  subscribe: vi.fn((cb) => {
    queueSubscribers.push(cb);
    return () => {
      const idx = queueSubscribers.indexOf(cb);
      if (idx !== -1) queueSubscribers.splice(idx, 1);
    };
  }),
  subscribeToSyncState: vi.fn((cb) => { mockSubscriptions.syncing = cb; return () => {}; }),
  subscribeToErrorState: vi.fn((cb) => { mockSubscriptions.error = cb; return () => {}; }),
  runSync: vi.fn(() => Promise.resolve()),
  getQueueLength: vi.fn(() => Promise.resolve(0)),
  getMetaQueueLength: vi.fn(() => Promise.resolve(0)),
  getPending: vi.fn(() => Promise.resolve([])),
  discardEntry: vi.fn(() => Promise.resolve()),
}));
// ---------------------------------------------------------------------------------

import SyncBadge from '../SyncBadge';

// Helpers to push state into the component via the subscription callbacks.
// Wrapped in act() so React flushes state updates synchronously before
// assertions run — required when calling setState outside a React event handler.
function pushQueue(n) { act(() => { queueSubscribers.forEach(cb => cb(n)); }); }
function pushSyncing(b) { act(() => { mockSubscriptions.syncing?.(b); }); }
function pushError(state) { act(() => { mockSubscriptions.error?.(state); }); }

// Override Date.now so time-based stuck calculations are deterministic
const BASE_NOW = 1_700_000_000_000;
const STUCK_THRESHOLD_MS = 60_000;

// Explicit cleanup after every test — belt-and-suspenders on top of the
// globals:true auto-cleanup in vitest.config.js. Prevents rendered component
// instances accumulating in the DOM across tests.
afterEach(cleanup);

// Reset shared subscription references so a new render always gets a fresh slot
beforeEach(() => {
  queueSubscribers.length = 0;
  mockSubscriptions.syncing = null;
  mockSubscriptions.error = null;
});

describe('SyncBadge — hidden state', () => {
  it('renders nothing when queue is empty and not syncing', () => {
    const { container } = render(<SyncBadge />);
    expect(container.firstChild).toBeNull();
  });
});

describe('SyncBadge — pending state (queue > 0, no error)', () => {
  it('shows the tap-to-back-up label for a single job', async () => {
    const { rerender } = render(<SyncBadge />);
    // Start with queue=1, metaCount=0 → 1 job
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    rerender(<SyncBadge />);
    // Allow the async metaCount refresh to settle
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /not backed up yet/i }).textContent).toContain('not backed up — tap to back up');
    });
  });

  it('shows plural form for 3 jobs', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(3);
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /not backed up yet/i }).textContent).toContain('3 jobs not backed up');
    });
  });

  it('shows mixed breakdown for 2 jobs + 1 edit', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(1);
    pushQueue(3); // total=3, meta=1 → jobCount=2
    await vi.waitFor(() => {
      const text = screen.getByRole('button', { name: /not backed up yet/i }).textContent;
      expect(text).toContain('2 jobs + 1 edit');
      expect(text).toContain('not backed up — tap to back up');
    });
  });

  it('does NOT contain the word "new" in the label', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(2);
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /not backed up yet/i }).textContent).not.toMatch(/\bnew\b/i);
    });
  });

  it('aria-label says "not backed up yet — tap to back up now"', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    await vi.waitFor(() => {
      const btn = screen.getByRole('button', { name: /not backed up yet/i });
      expect(btn.getAttribute('aria-label')).toContain('not backed up yet — tap to back up now');
    });
  });

  it('does NOT apply stuck or stuck-auth class', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    await vi.waitFor(() => {
      const btn = screen.getByRole('button', { name: /not backed up yet/i });
      expect(btn.className).not.toContain('sync-badge--stuck');
    });
  });
});

describe('SyncBadge — syncing state', () => {
  it('shows "Backing up…" when syncing', async () => {
    render(<SyncBadge />);
    pushQueue(1);
    pushSyncing(true);
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Backing up your changes' }).textContent).toContain('Backing up…');
    });
  });

  it('aria-label says "Backing up your changes" when syncing', async () => {
    render(<SyncBadge />);
    pushQueue(1);
    pushSyncing(true);
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Backing up your changes' }).getAttribute('aria-label')).toBe('Backing up your changes');
    });
  });

  it('does NOT say "Syncing…" (old copy removed)', async () => {
    render(<SyncBadge />);
    pushQueue(1);
    pushSyncing(true);
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: 'Backing up your changes' }).textContent).not.toContain('Syncing');
    });
  });
});

describe('SyncBadge — stuck state: generic (60s threshold)', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(BASE_NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows amber stuck label after 60s with a non-auth error', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('Network timeout'),
      lastAttemptAt: BASE_NOW - STUCK_THRESHOLD_MS - 1,
    });
    await vi.waitFor(() => {
      const btn = screen.getByRole('button', { name: /failed to back up/i });
      expect(btn.textContent).toContain("didn't back up — tap to fix");
    });
  });

  it('applies sync-badge--stuck class (not sync-badge--stuck-auth)', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('Network timeout'),
      lastAttemptAt: BASE_NOW - STUCK_THRESHOLD_MS - 1,
    });
    await vi.waitFor(() => {
      const btn = screen.getByRole('button', { name: /failed to back up/i });
      expect(btn.className).toContain('sync-badge--stuck');
      expect(btn.className).not.toContain('sync-badge--stuck-auth');
    });
  });

  it('does NOT escalate a non-auth error before 60s', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('Network timeout'),
      lastAttemptAt: BASE_NOW - 30_000, // only 30s ago
    });
    await vi.waitFor(() => {
      const text = screen.getByRole('button', { name: /not backed up yet/i }).textContent;
      // Should still show the pending label, not stuck
      expect(text).toContain('not backed up — tap to back up');
    });
  });

  it('action sheet title is "This job isn\'t backed up" for generic stuck', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('RLS error'),
      lastAttemptAt: BASE_NOW - STUCK_THRESHOLD_MS - 1,
    });
    await vi.waitFor(() => screen.getByRole('button', { name: /failed to back up/i }));
    fireEvent.click(screen.getByRole('button', { name: /failed to back up/i }));
    expect(screen.getByText("This job isn't backed up")).toBeInTheDocument();
  });

  it('action sheet shows "Retry now" for generic stuck', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('RLS error'),
      lastAttemptAt: BASE_NOW - STUCK_THRESHOLD_MS - 1,
    });
    await vi.waitFor(() => screen.getByRole('button', { name: /failed to back up/i }));
    fireEvent.click(screen.getByRole('button', { name: /failed to back up/i }));
    expect(screen.getByText('Retry now')).toBeInTheDocument();
    expect(screen.queryByText('Sign in')).toBeNull();
  });
});

describe('SyncBadge — stuck state: auth failure (immediate escalation)', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(BASE_NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('escalates immediately (before 60s) when error is "Not signed in"', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('Not signed in'),
      lastAttemptAt: BASE_NOW - 5_000, // only 5s ago — well within the 60s threshold
    });
    await vi.waitFor(() => {
      const text = screen.getByRole('button', { name: /sign in to back up/i }).textContent;
      expect(text).toContain('Sign in to back up');
    });
  });

  it('applies sync-badge--stuck-auth class (not sync-badge--stuck)', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('Not signed in'),
      lastAttemptAt: BASE_NOW - 5_000,
    });
    await vi.waitFor(() => {
      const btn = screen.getByRole('button', { name: /sign in to back up/i });
      expect(btn.className).toContain('sync-badge--stuck-auth');
      expect(btn.className).not.toContain('sync-badge--stuck-auth sync-badge--stuck');
    });
  });

  it('does NOT treat "Not signed in — please sign out" as an auth failure (exact match)', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    // This longer message comes from SettingsScreen — should NOT trigger auth escalation
    pushError({
      lastError: new Error('Not signed in — please sign out and back in then try again.'),
      lastAttemptAt: BASE_NOW - 5_000,
    });
    await vi.waitFor(() => {
      const text = screen.getByRole('button', { name: /not backed up yet/i }).textContent;
      // Still pending (not stuck) because 5s < 60s threshold and it's not an exact match
      expect(text).toContain('not backed up — tap to back up');
    });
  });

  it('auth action sheet title is "Sign in to save this job"', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('Not signed in'),
      lastAttemptAt: BASE_NOW - 5_000,
    });
    await vi.waitFor(() => screen.getByRole('button', { name: /sign in to back up/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign in to back up/i }));
    expect(screen.getByText('Sign in to save this job')).toBeInTheDocument();
  });

  it('auth action sheet shows "Sign in" button, not "Retry now"', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('Not signed in'),
      lastAttemptAt: BASE_NOW - 5_000,
    });
    await vi.waitFor(() => screen.getByRole('button', { name: /sign in to back up/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign in to back up/i }));
    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.queryByText('Retry now')).toBeNull();
  });

  it('calls onSignIn prop when "Sign in" is tapped', async () => {
    const onSignIn = vi.fn();
    render(<SyncBadge onSignIn={onSignIn} />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('Not signed in'),
      lastAttemptAt: BASE_NOW - 5_000,
    });
    await vi.waitFor(() => screen.getByRole('button', { name: /sign in to back up/i }));
    fireEvent.click(screen.getByRole('button', { name: /sign in to back up/i }));
    fireEvent.click(screen.getByText('Sign in'));
    expect(onSignIn).toHaveBeenCalledOnce();
  });

  it('auth label includes the pending count', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(3);
    pushError({
      lastError: new Error('Not signed in'),
      lastAttemptAt: BASE_NOW - 5_000,
    });
    await vi.waitFor(() => {
      const text = screen.getByRole('button', { name: /sign in to back up/i }).textContent;
      expect(text).toContain('Sign in to back up 3 jobs');
    });
  });
});

describe('SyncBadge — discard modal', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(BASE_NOW);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('discard title is count-aware (singular)', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('Network timeout'),
      lastAttemptAt: BASE_NOW - STUCK_THRESHOLD_MS - 1,
    });
    await vi.waitFor(() => screen.getByRole('button', { name: /failed to back up/i }));
    fireEvent.click(screen.getByRole('button', { name: /failed to back up/i }));
    fireEvent.click(screen.getByText('Discard'));
    expect(screen.getByText('Discard 1 unsaved job?')).toBeInTheDocument();
  });

  it('discard title is count-aware (plural)', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(3);
    pushError({
      lastError: new Error('Network timeout'),
      lastAttemptAt: BASE_NOW - STUCK_THRESHOLD_MS - 1,
    });
    await vi.waitFor(() => screen.getByRole('button', { name: /failed to back up/i }));
    fireEvent.click(screen.getByRole('button', { name: /failed to back up/i }));
    fireEvent.click(screen.getByText('Discard'));
    expect(screen.getByText('Discard 3 unsaved jobs?')).toBeInTheDocument();
  });

  it('discard body states job only exists on this phone', async () => {
    render(<SyncBadge />);
    const { getMetaQueueLength } = await import('../../lib/offlineQueue');
    getMetaQueueLength.mockResolvedValue(0);
    pushQueue(1);
    pushError({
      lastError: new Error('Network timeout'),
      lastAttemptAt: BASE_NOW - STUCK_THRESHOLD_MS - 1,
    });
    await vi.waitFor(() => screen.getByRole('button', { name: /failed to back up/i }));
    fireEvent.click(screen.getByRole('button', { name: /failed to back up/i }));
    fireEvent.click(screen.getByText('Discard'));
    expect(screen.getByText(/only exists on this phone/i)).toBeInTheDocument();
    expect(screen.getByText(/gone for good/i)).toBeInTheDocument();
  });
});
