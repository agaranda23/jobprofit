/**
 * DashboardPager — horizontal swipe pager for the 3 main dashboard views.
 *
 * Page order: Today (0) | Jobs/Work (1) | Money/Finance (2)
 *
 * Layout: a fixed-size .dp-viewport clips a 300%-wide .dp-track.
 * Each .dp-page slot is exactly one viewport width wide.
 *
 * Positioning strategy (see useDashboardPager for detail):
 *   - Settled:  track.style.left = '-{idx*100}%'  (no transform → no fixed-child breakage)
 *   - Dragging: track.style.transform = 'translateX(…%)'  (GPU, 60fps)
 *   - Animating to snap: transform for the transition, then swap to left on transitionend
 *
 * Props:
 *   pageIndex        {number}   0 | 1 | 2 — current active page
 *   onSwipe          {fn}       called with next pageIndex when user completes a swipe
 *   overlayOpen      {bool}     true = any AppShell modal/sheet is open → disable swipe
 *   onPullToRefresh  {fn}       optional — pull-to-refresh trigger (AppShell's
 *                               refreshFromCloud). Omit to disable PTR entirely.
 *   children         {array}    exactly 3 React elements (one per page)
 *
 * Pull-to-refresh (see usePullToRefresh.js for the gesture/coexistence detail):
 *   Attached to every .dp-page (all 3 are mounted simultaneously; only the
 *   active one is ever reachable — the other two are `inert` + pointer-events:
 *   none, see below). scrollRef is (re)pointed at whichever .dp-page is
 *   currently active via a conditional ref, so the hook always checks the
 *   RIGHT page's scrollTop even as pageIndex changes. The indicator itself is
 *   rendered as a SIBLING of .dp-viewport (not nested inside .dp-track), so it
 *   can never inherit a stray transform containing-block from an in-flight
 *   page transition.
 */

import { useLayoutEffect, useCallback, useRef } from 'react';
import { useDashboardPager } from '../lib/useDashboardPager';
import { usePullToRefresh } from '../lib/usePullToRefresh';
import { haptic } from '../lib/haptics.js';
import PullToRefreshIndicator from './PullToRefreshIndicator';

export default function DashboardPager({ pageIndex, onSwipe, overlayOpen, onPullToRefresh, children }) {
  const pages = Array.isArray(children) ? children : [children];

  // Wrap onSwipe so a light haptic fires on every confirmed page-settle.
  const handlePageChange = useCallback((nextIdx) => {
    haptic('light');
    onSwipe?.(nextIdx);
  }, [onSwipe]);

  const { trackRef, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, jumpTo } = useDashboardPager({
    pageCount: pages.length,
    pageIndex,
    onPageChange: handlePageChange,
    locked: !!overlayOpen,
  });

  const viewportRef = useRef(null);   // stable — .dp-viewport, never reassigned
  const activePageRef = useRef(null); // (re)pointed at whichever .dp-page is active

  const {
    pullDistance,
    progress: pullProgress,
    armed: pullArmed,
    refreshing: pullRefreshing,
    onTouchStart: onPtrTouchStart,
    onTouchMove: onPtrTouchMove,
    onTouchEnd: onPtrTouchEnd,
    onTouchCancel: onPtrTouchCancel,
  } = usePullToRefresh({
    scrollRef: activePageRef,
    viewportRef,
    onRefresh: onPullToRefresh,
    disabled: !onPullToRefresh || !!overlayOpen,
  });

  // useLayoutEffect runs before the browser paints, so the track is positioned
  // at the correct page before the user ever sees it (no first-paint flash).
  // On mount it writes the settled left directly; on prop-change it calls jumpTo
  // which is idempotent-guarded against re-running mid swipe-animation.
  useLayoutEffect(() => {
    jumpTo(pageIndex);
  }, [pageIndex, jumpTo]);

  return (
    <>
      <div
        ref={viewportRef}
        className="dp-viewport"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
      >
        {/*
          NO inline left here. Track position is 100% JS-owned via jumpTo/settleAt.
          A React-controlled `left` would re-apply on every pageIndex re-render and
          compose with an in-flight swipe transform → double-offset flash (the bug).
          The track starts unstyled; useLayoutEffect above writes left before paint.
        */}
        <div
          ref={trackRef}
          className="dp-track"
        >
          {pages.map((child, i) => (
            <div
              key={i}
              ref={i === pageIndex ? activePageRef : undefined}
              className="dp-page"
              aria-hidden={i !== pageIndex ? true : undefined}
              // `aria-hidden` alone only affects screen readers — it does NOT stop
              // touch/pointer events. Without `inert`, an off-screen page slot stays
              // fully tappable, so a tap during/after a partially-shifted track (a
              // rubber-band, an interrupted drag, a mid-animation frame) can land on
              // the NEIGHBOURING page's controls instead of the visible one. `inert`
              // disables pointer events, focus and interaction on the whole subtree.
              // It clears itself on the very next render once `pageIndex` changes
              // (the swipe/nav-tap flow already re-renders this component then), so
              // the freshly-active page is interactive well before the user's next tap.
              // The same guard means the pull-to-refresh handlers below are only
              // ever reachable on the active page — inert/pointer-events:none
              // block touches on the other two.
              inert={i !== pageIndex ? true : undefined}
              onTouchStart={onPtrTouchStart}
              onTouchMove={onPtrTouchMove}
              onTouchEnd={onPtrTouchEnd}
              onTouchCancel={onPtrTouchCancel}
            >
              {child}
            </div>
          ))}
        </div>
      </div>

      {onPullToRefresh && (
        <PullToRefreshIndicator
          pullDistance={pullDistance}
          progress={pullProgress}
          armed={pullArmed}
          refreshing={pullRefreshing}
        />
      )}
    </>
  );
}
