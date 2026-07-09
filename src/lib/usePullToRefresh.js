/**
 * usePullToRefresh — lightweight pull-to-refresh gesture for the dashboard pager.
 *
 * Fires an existing `onRefresh` (AppShell's refreshFromCloud) when the user
 * pulls down past a threshold while scrolled to the very top of the active
 * page. Renders no UI itself — callers read back { pullDistance, progress,
 * armed, refreshing } and draw their own indicator (see
 * components/PullToRefreshIndicator.jsx).
 *
 * Coexistence with useDashboardPager (the horizontal swipe pager):
 *   - This hook only ever engages on a CONFIRMED vertical drag that starts at
 *     scrollTop === 0. The horizontal pager's own direction lock is already
 *     biased hard toward vertical (see H_LOCK_RATIO in useDashboardPager.js),
 *     so a real horizontal swipe never reaches our "vertical pull" branch —
 *     the two gestures are mutually exclusive by construction, not by
 *     coordinating state between the two hooks.
 *   - We never call stopPropagation, so the horizontal pager's own listeners
 *     (bound higher up, on .dp-viewport) keep receiving every touch event
 *     untouched.
 *   - Like useDashboardPager, React 19 attaches synthetic onTouchMove as
 *     passive, so e.preventDefault() inside it is a no-op. We attach a native
 *     { passive: false } touchmove listener (same workaround already used in
 *     useDashboardPager) so we can suppress the native overscroll bounce, but
 *     ONLY once a pull is confirmed — never on an ordinary scroll or on a
 *     horizontal swipe.
 *
 * prefers-reduced-motion: the gesture and refresh trigger are unaffected
 * (they're 1:1 finger tracking, not an independent animation — same
 * philosophy as the drag-follow in useDashboardPager). The CALLER's indicator
 * is responsible for gating its own spin/snap-back animations; see
 * PullToRefreshIndicator.jsx.
 */

import { useRef, useState, useCallback, useEffect } from 'react';

const LOCK_THRESHOLD = 10;   // px before we decide this is a deliberate vertical pull
const MAX_PULL       = 64;   // px cap on visual travel (indicator fully "armed" well before this)
const REFRESH_TRIGGER = 48;  // px pulled at release to trigger a refresh
const RESISTANCE      = 0.5; // rubber-band factor — pull feels heavier than a 1:1 drag

/**
 * @param {object} opts
 * @param {React.RefObject<HTMLElement>} opts.scrollRef - ref to the scrollable
 *   page element (the .dp-page div) whose scrollTop gates the gesture.
 * @param {React.RefObject<HTMLElement>} opts.viewportRef - ref to a STABLE
 *   ancestor (the .dp-viewport div) to attach the native non-passive
 *   touchmove listener to. Stable across the pager's lifetime, unlike
 *   scrollRef which is reassigned as the active page changes.
 * @param {() => (void|Promise<any>)} opts.onRefresh - called on a confirmed
 *   release past REFRESH_TRIGGER. May return a promise; `refreshing` stays
 *   true until it resolves/rejects.
 * @param {boolean} [opts.disabled] - disable the gesture entirely (inactive
 *   page, an overlay is open, or no onRefresh available).
 */
export function usePullToRefresh({ scrollRef, viewportRef, onRefresh, disabled }) {
  const [pullDistance, setPullDistance] = useState(0);
  const [armed, setArmed]               = useState(false);
  const [refreshing, setRefreshing]     = useState(false);

  const t0        = useRef(null);   // { x, y } at touchstart
  const tracking  = useRef(false);  // a touch sequence is active
  const dirLock   = useRef(null);   // null=undecided, true=confirmed vertical pull, false=not a pull
  const refreshingRef = useRef(false);
  // Mirrors the `disabled` prop into a ref so an in-flight gesture aborts
  // immediately if an overlay opens mid-drag (e.g. another trigger opens a
  // modal while the finger is still down) — the touch callbacks themselves
  // are memoised once per identity and wouldn't otherwise see the new value.
  // Written in an effect (not during render) — refs must not be mutated
  // while rendering.
  const disabledRef = useRef(disabled);
  useEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  const reset = useCallback(() => {
    t0.current      = null;
    tracking.current = false;
    dirLock.current  = null;
    setPullDistance(0);
    setArmed(false);
  }, []);

  const onTouchStart = useCallback((e) => {
    if (disabled || refreshingRef.current) return;
    if (e.touches.length > 1) return;
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) return;

    const touch = e.touches[0];
    t0.current       = { x: touch.clientX, y: touch.clientY };
    dirLock.current  = null;
    tracking.current = true;
  }, [disabled, scrollRef]);

  const onTouchMove = useCallback((e) => {
    if (!tracking.current || !t0.current) return;
    if (disabledRef.current) { reset(); return; }
    const el = scrollRef.current;
    // Content scrolled away from the top mid-gesture (e.g. a vertical scroll
    // that started elsewhere and only now bubbles here) — abandon the pull,
    // let the browser scroll normally.
    if (!el || el.scrollTop > 0) { reset(); return; }
    if (e.touches.length > 1) { reset(); return; }

    const touch = e.touches[0];
    const dx = touch.clientX - t0.current.x;
    const dy = touch.clientY - t0.current.y;

    if (dirLock.current === null) {
      if (Math.abs(dx) < LOCK_THRESHOLD && Math.abs(dy) < LOCK_THRESHOLD) return;
      // Same conservative bias as useDashboardPager's own lock: only commit
      // once the vertical component clearly dominates. Anything ambiguous
      // (or horizontal) is NOT our gesture — bail out entirely so the pager
      // and/or native scroll handle it untouched.
      dirLock.current = dy > LOCK_THRESHOLD && dy > Math.abs(dx);
      if (!dirLock.current) { reset(); return; }
    }
    if (!dirLock.current) return;

    if (dy <= 0) {
      // Finger moved back up past the start point — collapse the indicator
      // but stay tracking in case they pull down again within the same touch.
      setPullDistance(0);
      setArmed(false);
      return;
    }

    const eased = Math.min(MAX_PULL, dy * RESISTANCE);
    setPullDistance(eased);
    setArmed(eased >= REFRESH_TRIGGER);
  }, [scrollRef, reset]);

  const onTouchEnd = useCallback(() => {
    if (!tracking.current) return;
    const wasArmed   = armed;
    tracking.current = false;
    dirLock.current  = null;
    t0.current       = null;

    if (!wasArmed) {
      setPullDistance(0);
      setArmed(false);
      return;
    }

    refreshingRef.current = true;
    setRefreshing(true);
    setArmed(false);
    setPullDistance(REFRESH_TRIGGER);

    Promise.resolve()
      .then(() => onRefresh?.())
      .catch(() => {}) // best-effort — refreshFromCloud already swallows its own errors
      .finally(() => {
        refreshingRef.current = false;
        setRefreshing(false);
        setPullDistance(0);
      });
  }, [armed, onRefresh]);

  const onTouchCancel = useCallback(() => {
    if (refreshingRef.current) return; // let an in-flight refresh finish its own cleanup
    reset();
  }, [reset]);

  // Native non-passive touchmove — mirrors useDashboardPager's own workaround
  // for the same React-19-synthetic-listeners-are-passive reason. Attached to
  // the STABLE viewport (not scrollRef, which is reassigned as the active
  // page changes) and reads tracking/dirLock refs fresh on every call, so it
  // never goes stale even though the effect itself only runs once.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof viewport.addEventListener !== 'function') return;

    function handleNativeTouchMove(e) {
      if (!tracking.current) return;
      if (e.touches.length > 1) return;
      if (dirLock.current !== true) return;
      // Only suppress the native bounce once we've confirmed this exact
      // gesture as a top-of-scroll pull — never for an ordinary scroll or a
      // horizontal swipe (dirLock is only ever true here in the pull case).
      e.preventDefault();
    }

    viewport.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
    return () => viewport.removeEventListener('touchmove', handleNativeTouchMove, { passive: false });
  }, [viewportRef]);

  return {
    pullDistance,
    progress: Math.min(1, pullDistance / REFRESH_TRIGGER),
    armed,
    refreshing,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  };
}
