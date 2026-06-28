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
 *   pageIndex   {number}   0 | 1 | 2 — current active page
 *   onSwipe     {fn}       called with next pageIndex when user completes a swipe
 *   overlayOpen {bool}     true = any AppShell modal/sheet is open → disable swipe
 *   children    {array}    exactly 3 React elements (one per page)
 */

import { useEffect, useLayoutEffect, useCallback } from 'react';
import { useDashboardPager } from '../lib/useDashboardPager';
import { haptic } from '../lib/haptics.js';

export default function DashboardPager({ pageIndex, onSwipe, overlayOpen, children }) {
  const pages = Array.isArray(children) ? children : [children];

  // Wrap onSwipe so a light haptic fires on every confirmed page-settle.
  const handlePageChange = useCallback((nextIdx) => {
    haptic('light');
    onSwipe?.(nextIdx);
  }, [onSwipe]);

  const { trackRef, onTouchStart, onTouchMove, onTouchEnd, jumpTo } = useDashboardPager({
    pageCount: pages.length,
    pageIndex,
    onPageChange: handlePageChange,
    locked: !!overlayOpen,
  });

  // useLayoutEffect runs before the browser paints, so the track is positioned
  // at the correct page before the user ever sees it (no first-paint flash).
  // On mount it writes the settled left directly; on prop-change it calls jumpTo
  // which is idempotent-guarded against re-running mid swipe-animation.
  useLayoutEffect(() => {
    jumpTo(pageIndex);
  }, [pageIndex, jumpTo]);

  return (
    <div
      className="dp-viewport"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
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
            className="dp-page"
            aria-hidden={i !== pageIndex ? true : undefined}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
