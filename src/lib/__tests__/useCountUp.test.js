// @vitest-environment jsdom
/**
 * useCountUp unit tests.
 *
 * Tests the hook logic in isolation using fake timers + requestAnimationFrame.
 * We verify:
 *  1. It returns 0 on first mount and reaches the target.
 *  2. It honours prefers-reduced-motion by returning the target immediately.
 *  3. On target change, it re-animates from the current value.
 *  4. It cleans up the rAF on unmount (no setState after unmount).
 */

import { renderHook, act } from '@testing-library/react';
import { useCountUp } from '../useCountUp';

// Fake rAF/cAF implementation that runs synchronously when we advance time.
// This replaces the real browser rAF for deterministic tests.
let rafCallbacks = [];
let rafId = 0;
let fakeNow = 0;

function installFakeRaf() {
  fakeNow = 0;
  rafCallbacks = [];
  rafId = 0;

  globalThis.requestAnimationFrame = (cb) => {
    const id = ++rafId;
    rafCallbacks.push({ id, cb });
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    rafCallbacks = rafCallbacks.filter(r => r.id !== id);
  };
}

function flushRafsAt(timestampMs) {
  fakeNow = timestampMs;
  const toRun = [...rafCallbacks];
  rafCallbacks = [];
  toRun.forEach(({ cb }) => cb(timestampMs));
}

function uninstallFakeRaf() {
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
}

// Helper: run the full 650ms animation in discrete steps
// Returns the final value the hook settles on.
function runFullAnimation(result) {
  // Start frame: t=0
  act(() => { flushRafsAt(0); });
  // Mid-point
  act(() => { flushRafsAt(325); });
  // End frame: at or past 650ms
  act(() => { flushRafsAt(650); });
  return result.current;
}

describe('useCountUp', () => {
  beforeEach(() => {
    installFakeRaf();
    // Default: reduced-motion OFF
    Object.defineProperty(globalThis, 'matchMedia', {
      writable: true,
      value: (query) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  });

  afterEach(() => {
    uninstallFakeRaf();
  });

  it('starts at 0 and reaches the target after the full animation', () => {
    const { result } = renderHook(() => useCountUp(500));

    // Before any rAF fires, value is still the initial state (target, set in useState)
    // but we care that when rAF starts it counts from 0.
    // First rAF tick at t=0 → easeOut(0) = 0 → displayed = 0
    act(() => { flushRafsAt(0); });
    expect(result.current).toBeCloseTo(0, 0);

    // Mid-point at 325ms: easeOut(0.5) = 0.75 → displayed ≈ 375
    act(() => { flushRafsAt(325); });
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(500);

    // End: at 650ms → snaps to exactly 500
    act(() => { flushRafsAt(650); });
    expect(result.current).toBe(500);
  });

  it('returns the target immediately when prefers-reduced-motion is set', () => {
    globalThis.matchMedia = (query) => ({
      matches: query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    });

    const { result } = renderHook(() => useCountUp(1200));
    // No rAF fired; value should already be the target
    expect(result.current).toBe(1200);
  });

  it('re-animates from current value when target changes', () => {
    const { result, rerender } = renderHook(({ target }) => useCountUp(target), {
      initialProps: { target: 500 },
    });

    // Run first animation to completion
    runFullAnimation(result);
    expect(result.current).toBe(500);

    // Change target to 1000 — should animate from 500 to 1000
    rerender({ target: 1000 });

    // Immediately after rerender (before new rAF tick) value hasn't jumped to 0
    // (it should still be ≈500, not restart from scratch)
    const afterRerender = result.current;
    expect(afterRerender).toBeGreaterThanOrEqual(500);

    // Run the new animation to completion
    act(() => { flushRafsAt(700); });    // reset time > 650ms → completes
    act(() => { flushRafsAt(1400); });
    expect(result.current).toBe(1000);
  });

  it('handles a target of 0 without NaN', () => {
    const { result } = renderHook(() => useCountUp(0));
    act(() => { flushRafsAt(0); });
    act(() => { flushRafsAt(650); });
    expect(result.current).toBe(0);
    expect(Number.isNaN(result.current)).toBe(false);
  });

  it('handles negative targets', () => {
    const { result } = renderHook(() => useCountUp(-300));
    act(() => { flushRafsAt(0); });
    act(() => { flushRafsAt(650); });
    expect(result.current).toBe(-300);
  });

  it('cancels the rAF on unmount without throwing', () => {
    const { result, unmount } = renderHook(() => useCountUp(800));
    // Start animation
    act(() => { flushRafsAt(0); });
    act(() => { flushRafsAt(200); });
    // Unmount mid-animation — no pending rAF should call setState
    expect(() => {
      act(() => { unmount(); });
      // Flush any remaining callbacks — they should have been cancelled
      flushRafsAt(650);
    }).not.toThrow();
  });
});
