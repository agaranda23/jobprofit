// @vitest-environment jsdom
/**
 * usePullToRefresh.test.js — unit tests for the pull-to-refresh gesture hook.
 *
 * Mirrors the testing approach in dashboardPager.test.js: exercise the touch
 * handlers directly against mock DOM elements (scrollRef.current needs only
 * a `scrollTop` number; viewportRef.current needs only add/removeEventListener
 * spies), no full component render needed.
 *
 * Covered:
 *   - No-op when not at scrollTop 0 (gesture only engages at the very top)
 *   - A confirmed downward pull raises pullDistance/progress
 *   - A horizontal-dominant drag at scrollTop 0 is NOT treated as a pull
 *     (mirrors useDashboardPager's own vertical-bias direction lock, so the
 *     two gestures stay mutually exclusive)
 *   - armed flips true once pulled past the trigger threshold
 *   - release while armed calls onRefresh and toggles refreshing
 *   - release while NOT armed does not call onRefresh
 *   - disabled blocks the gesture entirely
 *   - onTouchCancel resets pull state
 *   - the native (non-passive) touchmove listener only preventDefaults once
 *     a pull is confirmed
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePullToRefresh } from '../usePullToRefresh';

function makeScrollEl(scrollTop = 0) {
  return { scrollTop };
}

function makeViewport() {
  return { addEventListener: vi.fn(), removeEventListener: vi.fn() };
}

function makeTouch(x, y) {
  return { clientX: x, clientY: y };
}

function touchEvent(touches = []) {
  return { touches, preventDefault: vi.fn() };
}

describe('usePullToRefresh', () => {
  let scrollEl;
  let viewport;
  let onRefresh;

  beforeEach(() => {
    scrollEl = makeScrollEl(0);
    viewport = makeViewport();
    onRefresh = vi.fn(() => Promise.resolve());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupHook({ disabled = false } = {}) {
    return renderHook(({ dis }) => {
      const scrollRef = { current: scrollEl };
      const viewportRef = { current: viewport };
      const result = usePullToRefresh({ scrollRef, viewportRef, onRefresh, disabled: dis });
      return result;
    }, { initialProps: { dis: disabled } });
  }

  it('does nothing when the scroll element is not at the top', () => {
    scrollEl.scrollTop = 40;
    const hook = setupHook();
    const { onTouchStart, onTouchMove } = hook.result.current;

    act(() => { onTouchStart(touchEvent([makeTouch(200, 100)])); });
    act(() => { onTouchMove(touchEvent([makeTouch(200, 160)])); });

    expect(hook.result.current.pullDistance).toBe(0);
  });

  it('raises pullDistance/progress on a confirmed downward pull at scrollTop 0', () => {
    const hook = setupHook();
    const { onTouchStart, onTouchMove } = hook.result.current;

    act(() => { onTouchStart(touchEvent([makeTouch(200, 100)])); });
    act(() => { onTouchMove(touchEvent([makeTouch(200, 140)])); }); // dy=40, dominant vertical

    expect(hook.result.current.pullDistance).toBeGreaterThan(0);
    expect(hook.result.current.progress).toBeGreaterThan(0);
  });

  it('does NOT engage on a horizontal-dominant drag (stays mutually exclusive with the swipe pager)', () => {
    const hook = setupHook();
    const { onTouchStart, onTouchMove } = hook.result.current;

    act(() => { onTouchStart(touchEvent([makeTouch(200, 100)])); });
    // dx=40, dy=5 — clearly horizontal, not our gesture.
    act(() => { onTouchMove(touchEvent([makeTouch(240, 105)])); });

    expect(hook.result.current.pullDistance).toBe(0);
  });

  it('arms once pulled past the refresh trigger threshold', () => {
    const hook = setupHook();
    const { onTouchStart, onTouchMove } = hook.result.current;

    act(() => { onTouchStart(touchEvent([makeTouch(200, 100)])); });
    act(() => { onTouchMove(touchEvent([makeTouch(200, 260)])); }); // dy=160 — well past trigger

    expect(hook.result.current.armed).toBe(true);
    expect(hook.result.current.progress).toBe(1);
  });

  it('calling onTouchEnd while armed triggers onRefresh and toggles refreshing', async () => {
    const hook = setupHook();

    act(() => { hook.result.current.onTouchStart(touchEvent([makeTouch(200, 100)])); });
    act(() => { hook.result.current.onTouchMove(touchEvent([makeTouch(200, 260)])); });
    expect(hook.result.current.armed).toBe(true);

    await act(async () => { hook.result.current.onTouchEnd(); });

    expect(onRefresh).toHaveBeenCalledTimes(1);
    // Refresh promise resolves synchronously (mock returns Promise.resolve()),
    // so by the time the awaited act() flushes, refreshing has settled back to false.
    expect(hook.result.current.refreshing).toBe(false);
    expect(hook.result.current.pullDistance).toBe(0);
  });

  it('calling onTouchEnd while NOT armed does not trigger onRefresh', () => {
    const hook = setupHook();

    act(() => { hook.result.current.onTouchStart(touchEvent([makeTouch(200, 100)])); });
    act(() => { hook.result.current.onTouchMove(touchEvent([makeTouch(200, 115)])); }); // small pull, below trigger
    expect(hook.result.current.armed).toBe(false);

    act(() => { hook.result.current.onTouchEnd(); });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('disabled blocks the gesture entirely', () => {
    const hook = setupHook({ disabled: true });
    const { onTouchStart, onTouchMove } = hook.result.current;

    act(() => { onTouchStart(touchEvent([makeTouch(200, 100)])); });
    act(() => { onTouchMove(touchEvent([makeTouch(200, 260)])); });

    expect(hook.result.current.pullDistance).toBe(0);
    expect(hook.result.current.armed).toBe(false);
  });

  it('onTouchCancel resets pull state', () => {
    const hook = setupHook();

    act(() => { hook.result.current.onTouchStart(touchEvent([makeTouch(200, 100)])); });
    act(() => { hook.result.current.onTouchMove(touchEvent([makeTouch(200, 260)])); });
    expect(hook.result.current.pullDistance).toBeGreaterThan(0);

    act(() => { hook.result.current.onTouchCancel(); });

    expect(hook.result.current.pullDistance).toBe(0);
    expect(hook.result.current.armed).toBe(false);
  });

  it('registers a non-passive native touchmove listener on the viewport', () => {
    setupHook();
    expect(viewport.addEventListener).toHaveBeenCalledWith(
      'touchmove',
      expect.any(Function),
      { passive: false },
    );
  });

  it('the native touchmove listener only preventDefaults once a pull is confirmed', () => {
    const hook = setupHook();
    const nativeHandler = viewport.addEventListener.mock.calls.find(
      (call) => call[0] === 'touchmove',
    )[1];

    // No gesture in progress yet — must not preventDefault.
    const evBeforeStart = touchEvent([makeTouch(200, 140)]);
    nativeHandler(evBeforeStart);
    expect(evBeforeStart.preventDefault).not.toHaveBeenCalled();

    // Start + confirm a vertical pull via the React-level handlers.
    act(() => { hook.result.current.onTouchStart(touchEvent([makeTouch(200, 100)])); });
    act(() => { hook.result.current.onTouchMove(touchEvent([makeTouch(200, 140)])); });

    const evDuringPull = touchEvent([makeTouch(200, 150)]);
    nativeHandler(evDuringPull);
    expect(evDuringPull.preventDefault).toHaveBeenCalled();
  });
});
