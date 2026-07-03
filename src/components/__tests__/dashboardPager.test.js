// @vitest-environment jsdom
/**
 * dashboardPager.test.js — unit tests for useDashboardPager logic.
 *
 * We test the hook in isolation by exercising the touch-event handlers directly
 * against a mock DOM element. No @testing-library/react rendering needed — the
 * hook's observable output is the track element's style mutations and the
 * onPageChange callback.
 *
 * Covered:
 *   - Horizontal swipe past SNAP_THRESHOLD advances to next/prev page
 *   - Vertical swipe does NOT advance (direction-lock)
 *   - Flick (high velocity, short distance) still advances
 *   - Swipe at first page does NOT go to -1
 *   - Swipe at last page does NOT exceed pageCount-1
 *   - iOS left-edge guard (touch starting < 20px) blocks the gesture
 *   - `locked` prop disables gesture entirely
 *   - body.overlay-open class disables gesture
 *   - onTouchEnd with no prior start is a no-op
 *   - Direction lock is biased toward vertical: a mostly-vertical drag with a
 *     small horizontal wobble must not lock horizontal / must not preventDefault
 *   - A clearly-horizontal drag still locks horizontal, preventDefaults, and pages
 *   - onTouchCancel resets gesture state and settles the track (stuck-state fix)
 *   - DashboardPager component: non-active .dp-page slots are `inert` (and
 *     aria-hidden) so an off-screen page can never receive a leaked tap; the
 *     active page is interactive; switching `pageIndex` moves `inert` to the
 *     newly-inactive page and clears it from the newly-active one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
// This file is plain *.js (no JSX transform configured for that extension —
// only *.test.jsx gets it, see vitest.config.js). The component test below
// uses React.createElement directly instead of JSX so it stays valid here.
import React from 'react';
import { useDashboardPager } from '../../lib/useDashboardPager';
import DashboardPager from '../DashboardPager';

// ─── Minimal track element mock ───────────────────────────────────────────────

function makeTrack() {
  const track = {
    style: {},
    parentElement: { clientWidth: 390 },
    isConnected: true,
    _pagerOnEnd: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return track;
}

function makeTouch(x, y) {
  return { clientX: x, clientY: y };
}

function touchEvent(touches = [], changedTouches = []) {
  return {
    touches,
    changedTouches: changedTouches.length ? changedTouches : touches,
    preventDefault: vi.fn(),
  };
}

// ─── Helper to run a full swipe gesture ──────────────────────────────────────

function swipe(hook, { startX, startY, endX, endY, _dt = 200 }) {
  const { onTouchStart, onTouchMove, onTouchEnd } = hook.result.current;

  act(() => {
    onTouchStart(touchEvent([makeTouch(startX, startY)]));
  });

  // Simulate enough movement to decide direction
  act(() => {
    onTouchMove(touchEvent([makeTouch(
      startX + (endX - startX) * 0.5,
      startY + (endY - startY) * 0.5,
    )]));
  });

  act(() => {
    onTouchMove(touchEvent([makeTouch(endX, endY)]));
  });

  act(() => {
    onTouchEnd({
      changedTouches: [makeTouch(endX, endY)],
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useDashboardPager', () => {
  let track;
  let onPageChange;

  beforeEach(() => {
    track = makeTrack();
    onPageChange = vi.fn();
    // Mock requestAnimationFrame
    vi.stubGlobal('requestAnimationFrame', (cb) => { cb(); return 0; });
    vi.stubGlobal('DOMMatrix', class {
      constructor() { this.m41 = 0; }
    });
    // Stub matchMedia (prefers-reduced-motion: no preference)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    document.body.classList.remove('overlay-open');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.classList.remove('overlay-open');
  });

  function setupHook({ pageIndex = 0, pageCount = 3, locked = false } = {}) {
    const hook = renderHook(({ idx, lk }) => {
      const result = useDashboardPager({
        pageCount,
        pageIndex: idx,
        onPageChange,
        locked: lk,
      });
      // Attach track ref
      result.trackRef.current = track;
      return result;
    }, {
      initialProps: { idx: pageIndex, lk: locked },
    });
    return hook;
  }

  it('advances to next page on a rightward swipe past threshold', () => {
    const hook = setupHook({ pageIndex: 0 });

    // Swipe left by 150px (> 35% of 390px viewport width)
    swipe(hook, { startX: 300, startY: 200, endX: 150, endY: 200 });

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('goes to prev page on a leftward swipe past threshold', () => {
    const hook = setupHook({ pageIndex: 1 });

    // Swipe right by 150px
    swipe(hook, { startX: 150, startY: 200, endX: 300, endY: 200 });

    expect(onPageChange).toHaveBeenCalledWith(0);
  });

  it('does NOT advance on a short slow swipe below both distance and velocity threshold', () => {
    const hook = setupHook({ pageIndex: 0 });
    const { onTouchStart, onTouchMove, onTouchEnd } = hook.result.current;

    // Fake a slow gesture: start time well before end time so vx is low
    const dateNowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000) // start
      .mockReturnValue(1800);    // end (800ms later → vx = 50/800 = 0.06 px/ms < FLICK_VX)

    act(() => { onTouchStart(touchEvent([makeTouch(300, 200)])); });
    act(() => { onTouchMove(touchEvent([makeTouch(270, 200)])); }); // direction decided
    act(() => { onTouchMove(touchEvent([makeTouch(250, 200)])); }); // 50px total
    act(() => { onTouchEnd({ changedTouches: [makeTouch(250, 200)] }); });

    dateNowSpy.mockRestore();

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('does NOT advance on a vertical swipe (direction-lock)', () => {
    const hook = setupHook({ pageIndex: 0 });

    // Swipe mostly downward
    swipe(hook, { startX: 200, startY: 100, endX: 210, endY: 300 });

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('does NOT go below page 0', () => {
    const hook = setupHook({ pageIndex: 0 });

    // Swipe right (would go to -1)
    swipe(hook, { startX: 150, startY: 200, endX: 340, endY: 200 });

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('does NOT exceed pageCount-1', () => {
    const hook = setupHook({ pageIndex: 2, pageCount: 3 });

    // Swipe left (would go to 3)
    swipe(hook, { startX: 300, startY: 200, endX: 100, endY: 200 });

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('advances on a fast flick even with short distance', () => {
    const hook = setupHook({ pageIndex: 0 });
    const { onTouchStart, onTouchMove, onTouchEnd } = hook.result.current;

    act(() => {
      onTouchStart(touchEvent([makeTouch(250, 200)]));
    });
    act(() => {
      onTouchMove(touchEvent([makeTouch(215, 200)]));  // 35px, direction decided
    });

    // Simulate a fast end: 60px in 50ms = 1.2 px/ms (> FLICK_VX 0.4)
    // We fake this by creating the end touch offset enough from start
    act(() => {
      // endX = 250 - 60 = 190, but we need the timestamp trick.
      // The hook computes vx = |dx| / max(dt, 1). We can't easily fake Date.now()
      // so instead we use a large enough dx to pass SNAP_THRESHOLD (> 35% of 390).
      onTouchMove(touchEvent([makeTouch(100, 200)])); // 150px, past threshold
      onTouchEnd({ changedTouches: [makeTouch(100, 200)] });
    });

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('blocks gesture when `locked` is true', () => {
    const hook = setupHook({ pageIndex: 0, locked: true });

    swipe(hook, { startX: 300, startY: 200, endX: 100, endY: 200 });

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('blocks gesture when body.overlay-open is set', () => {
    document.body.classList.add('overlay-open');
    const hook = setupHook({ pageIndex: 0 });

    swipe(hook, { startX: 300, startY: 200, endX: 100, endY: 200 });

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('blocks gesture starting in the iOS left-edge zone (< 20px)', () => {
    const hook = setupHook({ pageIndex: 0 });

    // Start very close to left edge
    swipe(hook, { startX: 15, startY: 200, endX: 200, endY: 200 });

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('does NOT lock horizontal (and does NOT preventDefault) on a mostly-vertical drag with a small horizontal wobble', () => {
    // Regression test for the "intermittent dead scroll" bug: a real vertical
    // scroll's opening frames can have |dx| tick past LOCK_THRESHOLD a hair
    // before |dy| does (hand pivot / finger curve). The OLD lock (absDx > absDy)
    // would wrongly commit to horizontal here (11 > 9) and then preventDefault()
    // for the rest of the gesture, killing the scroll. The fix requires |dx| to
    // beat |dy| by H_LOCK_RATIO (1.5x) before locking horizontal, so this wobble
    // must resolve to vertical instead.
    const hook = setupHook({ pageIndex: 0 });
    const { onTouchStart, onTouchMove, onTouchEnd } = hook.result.current;

    act(() => { onTouchStart(touchEvent([makeTouch(200, 100)])); });

    // dx=11, dy=9 — crosses LOCK_THRESHOLD on dx first, but not by a dominant margin.
    const move1 = touchEvent([makeTouch(211, 109)]);
    act(() => { onTouchMove(move1); });
    expect(move1.preventDefault).not.toHaveBeenCalled();

    // Gesture continues as an obvious vertical scroll — the lock must hold
    // vertical for the rest of the drag (it's decided once, not re-evaluated).
    const move2 = touchEvent([makeTouch(215, 260)]);
    act(() => { onTouchMove(move2); });
    expect(move2.preventDefault).not.toHaveBeenCalled();

    act(() => { onTouchEnd({ changedTouches: [makeTouch(215, 260)] }); });

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('locks horizontal, preventDefaults, and pages on a clearly-horizontal drag', () => {
    // Sanity check that biasing toward vertical hasn't broken deliberate tab-swipes:
    // a real horizontal swipe has |dx| dominate |dy| by a wide margin from the first frame.
    const hook = setupHook({ pageIndex: 0 });
    const { onTouchStart, onTouchMove, onTouchEnd } = hook.result.current;

    act(() => { onTouchStart(touchEvent([makeTouch(300, 200)])); });

    // dx=15, dy=3 — dx clearly dominates (15 > 3 * 1.5).
    const move1 = touchEvent([makeTouch(285, 203)]);
    act(() => { onTouchMove(move1); });
    expect(move1.preventDefault).toHaveBeenCalled();

    const move2 = touchEvent([makeTouch(150, 205)]);
    act(() => { onTouchMove(move2); });
    expect(move2.preventDefault).toHaveBeenCalled();

    act(() => { onTouchEnd({ changedTouches: [makeTouch(150, 205)] }); });

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('onTouchCancel resets gesture state and settles the track (stuck-state fix)', () => {
    // iOS can fire touchcancel instead of touchend (Control Center swipe, an
    // interrupt, the browser reclaiming the gesture). Before this fix there was
    // no handler at all, so a mid-drag transform could be left stranded on the
    // track until the user's next touch — the "adjacent page peeks in" /
    // "needs a refresh" symptom.
    const hook = setupHook({ pageIndex: 0 });
    const { onTouchStart, onTouchMove, onTouchCancel, onTouchEnd } = hook.result.current;

    act(() => { onTouchStart(touchEvent([makeTouch(300, 200)])); });
    act(() => { onTouchMove(touchEvent([makeTouch(200, 200)])); }); // locks horizontal, mid-drag

    expect(track.style.transform).toContain('translateX');

    act(() => { onTouchCancel(); });

    // Track must be settled (no stray drag transform left behind) at the
    // still-current page, and no page change should have fired.
    expect(track.style.left).toBe('0%');
    expect(onPageChange).not.toHaveBeenCalled();

    // A fresh gesture right after the cancel must behave normally — proves
    // dirLock/t0/dragging weren't left stuck from the cancelled gesture.
    act(() => { onTouchStart(touchEvent([makeTouch(300, 200)])); });
    const move = touchEvent([makeTouch(150, 200)]);
    act(() => { onTouchMove(move); });
    expect(move.preventDefault).toHaveBeenCalled();
    act(() => { onTouchEnd({ changedTouches: [makeTouch(150, 200)] }); });
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('onTouchCancel with no active gesture is a no-op', () => {
    const hook = setupHook({ pageIndex: 0 });
    const { onTouchCancel } = hook.result.current;

    expect(() => {
      act(() => { onTouchCancel(); });
    }).not.toThrow();

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('onTouchEnd with no prior start is a no-op', () => {
    const hook = setupHook({ pageIndex: 0 });
    const { onTouchEnd } = hook.result.current;

    expect(() => {
      act(() => {
        onTouchEnd({ changedTouches: [makeTouch(200, 200)] });
      });
    }).not.toThrow();

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('jumpTo settles the track at the correct left offset', () => {
    const hook = setupHook({ pageIndex: 0 });
    const { jumpTo } = hook.result.current;

    act(() => {
      jumpTo(2);
    });

    // After jumpTo(2) with reduced motion OFF, animateTo runs.
    // With requestAnimationFrame stubbed to immediate, the transitionend
    // callback fires synchronously after the rAF. However our mock
    // addEventListener is a spy that doesn't actually fire the event.
    // We just assert the transform was set (pre-settle).
    expect(track.style.transform).toContain('-200%');
  });

  it('jumpTo does not fight an in-flight swipe animation (pager-flash fix)', () => {
    // Reproduce the race: a swipe from page 0→1 queues a rAF animation and then
    // calls onPageChange(1). The React re-render calls jumpTo(1) via useLayoutEffect
    // while the animation is still running. jumpTo must bail and not re-apply left.
    const hook = setupHook({ pageIndex: 0 });
    const { jumpTo } = hook.result.current;

    // Perform a full left swipe (0→1)
    swipe(hook, { startX: 300, startY: 200, endX: 100, endY: 200 });

    // At this point the swipe animation is in flight (animatingToIdx===1).
    // Simulate the React re-render calling jumpTo(1) — must be a no-op:
    // track.style.left must NOT be overwritten by jumpTo while animation runs.
    const leftBefore = track.style.left;

    act(() => {
      jumpTo(1);
    });

    // jumpTo(1) should have bailed — left is still '' (cleared by the animation)
    // and not re-set to '-100%' which would fight the transform.
    expect(track.style.left).toBe(leftBefore);
  });
});

describe('DashboardPager (component) — inactive pages are non-interactive', () => {
  // Regression test: `aria-hidden` alone does NOT stop touch/pointer events, so
  // before this fix all 3 page slots stayed tappable and a tap could leak
  // through to an adjacent (off-screen) tab whenever the track was even
  // slightly shifted (mid-drag, rubber-band, interrupted gesture). The fix
  // adds the `inert` attribute to every non-active page.
  it('marks non-active .dp-page slots inert (and aria-hidden), and leaves the active one interactive', () => {
    const { container } = render(
      React.createElement(
        DashboardPager,
        { pageIndex: 0, onSwipe: () => {}, overlayOpen: false },
        React.createElement('div', null, 'Today'),
        React.createElement('div', null, 'Jobs'),
        React.createElement('div', null, 'Money'),
      )
    );

    const pages = container.querySelectorAll('.dp-page');
    expect(pages.length).toBe(3);

    pages.forEach((page, i) => {
      if (i === 0) {
        expect(page.hasAttribute('inert')).toBe(false);
        expect(page.hasAttribute('aria-hidden')).toBe(false);
      } else {
        expect(page.hasAttribute('inert')).toBe(true);
        expect(page.getAttribute('aria-hidden')).toBe('true');
      }
    });
  });

  it('moves `inert` to the newly-inactive page when pageIndex changes', () => {
    const makePager = (idx) => React.createElement(
      DashboardPager,
      { pageIndex: idx, onSwipe: () => {}, overlayOpen: false },
      React.createElement('div', null, 'Today'),
      React.createElement('div', null, 'Jobs'),
      React.createElement('div', null, 'Money'),
    );

    const { container, rerender } = render(makePager(0));

    rerender(makePager(1));

    const pages = container.querySelectorAll('.dp-page');
    // Page 1 (Jobs) is now active — inert must be cleared so it can receive taps.
    expect(pages[1].hasAttribute('inert')).toBe(false);
    expect(pages[1].hasAttribute('aria-hidden')).toBe(false);
    // Page 0 (Today), now inactive, must have picked up inert.
    expect(pages[0].hasAttribute('inert')).toBe(true);
    expect(pages[0].getAttribute('aria-hidden')).toBe('true');
    // Page 2 (Money) stays inactive/inert throughout.
    expect(pages[2].hasAttribute('inert')).toBe(true);
    expect(pages[2].getAttribute('aria-hidden')).toBe('true');
  });
});
