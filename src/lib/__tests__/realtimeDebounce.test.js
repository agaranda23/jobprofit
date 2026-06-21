/**
 * Realtime debounce — unit tests (fix/robustness-hardening)
 *
 * The AppShell realtime onChange handler debounces refreshFromCloud() with a
 * 2-second trailing timer so a burst of postgres_changes events collapses into
 * one cloud refetch.
 *
 * Testing the debounce inside a mounted React component would require a full
 * AppShell render tree (Supabase, Stripe, 50+ deps).  Instead, we test the
 * debounce behaviour using a plain mirror function that exercises the same
 * setTimeout / clearTimeout pattern used in AppShell.  This matches the
 * established mirror-function convention in realtime.test.js and JobDetailDrawer.test.js.
 *
 * The mirror function accepts a callback and a delay, and returns:
 *   { fire, cancel } — same shape the AppShell useEffect uses.
 *
 * Vitest fake timers are used throughout.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mirror of the debounce pattern used in AppShell's realtime useEffect ──────
//
// Production shape (AppShell, in the handleJobChange closure):
//   clearTimeout(realtimeDebounceRef.current);
//   realtimeDebounceRef.current = setTimeout(() => { refreshFromCloud(); }, 2000);
//
// The mirror below captures this as a reusable helper so we can test it
// without mounting a component.

function makeDebounced(callback, delay) {
  let timer = null;
  function fire() {
    clearTimeout(timer);
    timer = setTimeout(callback, delay);
  }
  function cancel() {
    clearTimeout(timer);
    timer = null;
  }
  return { fire, cancel };
}

const DEBOUNCE_MS = 2000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Core debounce behaviour ──────────────────────────────────────────────────

describe('realtime debounce — burst collapses to one call', () => {
  it('calls the callback once after the debounce window when fired multiple times rapidly', () => {
    const cb = vi.fn();
    const { fire } = makeDebounced(cb, DEBOUNCE_MS);

    fire();
    fire();
    fire();

    // Before window closes — callback should not have been called yet
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(cb).not.toHaveBeenCalled();

    // After window closes — exactly one call
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a single fire also triggers the callback after the window', () => {
    const cb = vi.fn();
    const { fire } = makeDebounced(cb, DEBOUNCE_MS);

    fire();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('resets the timer on each fire (trailing debounce)', () => {
    const cb = vi.fn();
    const { fire } = makeDebounced(cb, DEBOUNCE_MS);

    fire();
    vi.advanceTimersByTime(1500); // 1.5 s in — within window
    fire();                        // reset the timer
    vi.advanceTimersByTime(1500); // only 1.5 s since last fire — still within window
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);  // now 2 s since last fire — window closes
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('fires again if events arrive after the window closes', () => {
    const cb = vi.fn();
    const { fire } = makeDebounced(cb, DEBOUNCE_MS);

    fire();
    vi.advanceTimersByTime(DEBOUNCE_MS); // first burst settles
    expect(cb).toHaveBeenCalledTimes(1);

    fire();
    vi.advanceTimersByTime(DEBOUNCE_MS); // second burst settles
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

// ─── Cancel (unmount cleanup) ─────────────────────────────────────────────────

describe('realtime debounce — cancel clears pending timer', () => {
  it('cancel() prevents a pending callback from firing (unmount cleanup)', () => {
    const cb = vi.fn();
    const { fire, cancel } = makeDebounced(cb, DEBOUNCE_MS);

    fire();
    cancel(); // simulates useEffect cleanup on unmount
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancel() on an idle debounce is a no-op (does not throw)', () => {
    const { cancel } = makeDebounced(vi.fn(), DEBOUNCE_MS);
    expect(() => cancel()).not.toThrow();
  });
});

// ─── Ten rapid events collapses to one call ───────────────────────────────────

describe('realtime debounce — ten rapid events', () => {
  it('ten fires in quick succession produce exactly one callback', () => {
    const cb = vi.fn();
    const { fire } = makeDebounced(cb, DEBOUNCE_MS);

    for (let i = 0; i < 10; i++) {
      fire();
      vi.advanceTimersByTime(50); // 50 ms between events (rapid burst)
    }

    // 500 ms elapsed, all within window — callback not yet called
    expect(cb).not.toHaveBeenCalled();

    // Advance past debounce window from last fire
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
