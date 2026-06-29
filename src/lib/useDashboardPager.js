/**
 * useDashboardPager — horizontal swipe pager hook for the 3 dashboard views.
 *
 * Gesture rules:
 *   - Activates only when |dx| > |dy| AND |dx| > LOCK_THRESHOLD (dominantly horizontal)
 *   - Ignores swipes starting within LEFT_EDGE_GUARD px of the left edge (iOS back gesture)
 *   - Rubber-band resistance at first/last page
 *   - Velocity threshold FLICK_VX advances a page even on short drag distance
 *   - Disabled when `locked` is true (AppShell-level overlays open)
 *   - Disabled when body.overlay-open is set (JobDetailDrawer, AddJobModal)
 *   - Disabled when a touch starts inside a horizontal-scrolling element
 *   - prefers-reduced-motion: no animation, snap instantly
 *
 * Fixed-position child safety:
 *   CSS `transform` on an ancestor creates a new containing block for
 *   position:fixed descendants, breaking drawers/modals inside the paged screens.
 *   This hook ONLY applies transform during active drag or the snap animation.
 *   On settle it clears transform and repositions via `left` (negative %) which
 *   does NOT create a containing block.
 *
 * Animation sequence for animateTo(nextIdx) when settled at prevIdx:
 *   Frame A  — disable transition, set transform to current (prevIdx) visual position
 *   Frame B  — (rAF) enable transition, set transform to target (nextIdx) position
 *   transitionend — clear transform, set left to settle position
 *
 * During drag:
 *   left = '' (cleared); transform = translateX(…%) (GPU)
 *
 * Settled:
 *   transform = '' (cleared); left = '-{idx * 100}%'
 */

import { useRef, useCallback, useEffect } from 'react';

const LOCK_THRESHOLD  = 10;    // px — before we commit to a direction
const SNAP_THRESHOLD  = 0.25;  // fraction of page width needed to advance (responsive)
const FLICK_VX        = 0.4;   // px/ms velocity threshold for a flick
const LEFT_EDGE_GUARD = 20;    // px reserved for iOS system back gesture
const RUBBER_BAND     = 0.25;  // resistance factor past first/last page

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function insideHorizontalScroller(el) {
  let node = el;
  while (node && node !== document.body) {
    try {
      const style = window.getComputedStyle(node);
      const ox = style.overflowX;
      if ((ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth + 2) {
        return true;
      }
    } catch {
      // ignore detached nodes
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Returns true when the touch originates on (or inside) an interactive element
 * — button, anchor, input, select, textarea, or an element with role=button/link
 * or a non-negative tabindex.
 *
 * Why: the pager must not intercept taps on actionable elements.  Without this
 * guard, a slight horizontal wobble (≥ LOCK_THRESHOLD = 10 px) during a tap
 * sets dirLock=true, which causes the native touchmove listener to call
 * e.preventDefault().  iOS Safari then suppresses the synthesised click event,
 * so onClick handlers on buttons inside the pager never fire — even though the
 * gesture was clearly a tap, not a swipe.
 *
 * Trade-off: a swipe gesture that starts on a button no longer changes pages.
 * This is the correct UX: interactive elements take priority over swipe.
 */
function insideInteractiveElement(el) {
  let node = el;
  while (node && node !== document.body) {
    const tag = node.tagName?.toLowerCase();
    if (
      tag === 'button' ||
      tag === 'a'      ||
      tag === 'input'  ||
      tag === 'select' ||
      tag === 'textarea'
    ) return true;
    const role = node.getAttribute?.('role');
    if (role === 'button' || role === 'link' || role === 'checkbox' || role === 'radio') {
      return true;
    }
    const tabindex = node.getAttribute?.('tabindex');
    if (tabindex !== null && tabindex !== undefined && tabindex !== '-1') return true;
    node = node.parentElement;
  }
  return false;
}

/** Set track to settled position: no transform (safe for position:fixed children). */
function settleAt(track, idx) {
  if (!track) return;
  track.style.transition = 'none';
  track.style.transform  = '';
  track.style.left       = `${idx * -100}%`;
  track.style.willChange = 'auto';
}

/** Animate from current visual position to target idx, then settle. */
function animateTo(track, fromIdx, toIdx) {
  if (!track) return;

  if (prefersReducedMotion()) {
    settleAt(track, toIdx);
    return;
  }

  // Clean up any pending transitionend listener from a previous animation.
  // We attach it by name so we can remove it if a new animation supersedes this one.
  if (track._pagerOnEnd) {
    track.removeEventListener('transitionend', track._pagerOnEnd);
    track._pagerOnEnd = null;
  }

  // Frame A: disable transition, place track at the FROM position using transform.
  // Clearing `left` and setting transform ensures the browser sees the correct
  // starting visual position for the upcoming animation.
  track.style.transition = 'none';
  track.style.left       = '';
  track.style.transform  = `translateX(${fromIdx * -100}%)`;
  track.style.willChange = 'transform';

  // Frame B (next rAF): enable transition and move to the TO position.
  // The rAF ensures the browser has committed Frame A before we start animating.
  requestAnimationFrame(() => {
    // Guard: component may have unmounted or a newer animateTo may have fired.
    if (!track.isConnected) return;

    track.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    track.style.transform  = `translateX(${toIdx * -100}%)`;

    function onEnd(e) {
      // transitionend fires for every animated property; only act on 'transform'
      if (e.propertyName !== 'transform') return;
      track.removeEventListener('transitionend', onEnd);
      track._pagerOnEnd = null;
      settleAt(track, toIdx);
    }
    track._pagerOnEnd = onEnd;
    track.addEventListener('transitionend', onEnd);
  });
}

export function useDashboardPager({ pageCount, pageIndex, onPageChange, locked }) {
  const trackRef      = useRef(null);
  const t0            = useRef(null);   // { x, y, t } at touchstart
  const dirLock       = useRef(null);   // null=undecided, true=H, false=V
  const dragging      = useRef(false);
  const baseOffsetPct = useRef(0);      // pageIndex * -100 at drag start
  const lockDx        = useRef(0);      // dx at the moment we lock horizontal — anchors the drag
  // Mutable ref of current settled index — avoids stale closures in handlers.
  const settledIdx    = useRef(pageIndex);
  settledIdx.current  = pageIndex;
  // Tracks the index a swipe-initiated animation is flying to, so jumpTo can
  // detect "already animating to this target" and avoid fighting the animation.
  // -1 means no animation in flight.
  const animatingToIdx = useRef(-1);

  // ─── jumpTo: called from DashboardPager when pageIndex prop changes ──────────
  const jumpTo = useCallback((nextIdx) => {
    const track = trackRef.current;
    if (!track) return;

    // A swipe-initiated animation is already flying to this exact target.
    // The onTouchEnd rAF will settleAt(nextIdx) on transitionend — don't fight it.
    if (animatingToIdx.current === nextIdx) return;

    const from = settledIdx.current;
    if (from === nextIdx) {
      // Already settled at target — ensure settled state is correct (handles
      // SSR/hydration and the initial mount before first paint).
      settleAt(track, nextIdx);
      return;
    }
    animateTo(track, from, nextIdx);
  }, []);

  // ─── Touch handlers ──────────────────────────────────────────────────────────

  const onTouchStart = useCallback((e) => {
    if (locked) return;
    if (e.touches.length > 1) return;   // pinch/multi-touch — leave it to the browser (zoom)
    if (document.body.classList.contains('overlay-open')) return;
    if (insideHorizontalScroller(e.target)) return;
    if (insideInteractiveElement(e.target)) return;  // let buttons/links handle their own tap

    const touch = e.touches[0];
    if (touch.clientX < LEFT_EDGE_GUARD) return;

    // Cancel any in-flight snap animation so the finger takes immediate control.
    const track = trackRef.current;
    if (track) {
      // Cancel pending transitionend listener
      if (track._pagerOnEnd) {
        track.removeEventListener('transitionend', track._pagerOnEnd);
        track._pagerOnEnd = null;
      }
      // Interrupting an in-flight swipe animation: clear the animation guard too,
      // otherwise a later jumpTo (nav tap) to that same index would bail forever
      // and the track would stop responding to taps for that page (B1).
      animatingToIdx.current = -1;
      // Capture the current visual translateX. CRITICAL: when the pager is
      // SETTLED it is positioned via `left: -idx*100%` with NO inline transform,
      // so the transform matrix reads 0. Trusting it then would clear `left` and
      // set translateX(0%) — snapping the track to page 0 (Today) at the start of
      // every drag (the "Today flashes before the target page" bug). Only read
      // the matrix when an inline transform is actually set (mid snap-animation);
      // otherwise derive the position from the settled index.
      let currentPct;
      if (track.style.transform) {
        try {
          const matrix = new DOMMatrix(getComputedStyle(track).transform);
          const w = track.parentElement?.clientWidth || window.innerWidth;
          currentPct = w > 0 ? (matrix.m41 / w) * 100 : settledIdx.current * -100;
        } catch {
          currentPct = settledIdx.current * -100;
        }
      } else {
        currentPct = settledIdx.current * -100;
      }
      track.style.transition = 'none';
      track.style.left       = '';
      track.style.transform  = `translateX(${currentPct}%)`;
      track.style.willChange = 'transform';
      baseOffsetPct.current  = currentPct;
    } else {
      baseOffsetPct.current = settledIdx.current * -100;
    }

    t0.current       = { x: touch.clientX, y: touch.clientY, t: Date.now() };
    dirLock.current  = null;
    dragging.current = false;
  }, [locked]);

  const onTouchMove = useCallback((e) => {
    if (!t0.current) return;
    if (e.touches.length > 1) {   // 2nd finger landed — abort the swipe so the browser can pinch-zoom
      t0.current = null;
      dirLock.current = null;
      settleAt(trackRef.current, settledIdx.current);
      return;
    }
    if (document.body.classList.contains('overlay-open')) {
      t0.current = null;
      return;
    }

    const touch  = e.touches[0];
    const dx = touch.clientX - t0.current.x;
    const dy = touch.clientY - t0.current.y;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (dirLock.current === null) {
      if (absDx < LOCK_THRESHOLD && absDy < LOCK_THRESHOLD) return;
      dirLock.current = absDx > absDy;
      // Anchor the drag at the lock point so the page starts following from 0
      // rather than jumping by the ~10px threshold (premium 1:1 finger feel).
      if (dirLock.current) lockDx.current = dx;
    }

    if (!dirLock.current) return;

    e.preventDefault();
    dragging.current = true;

    const track = trackRef.current;
    if (!track) return;

    const w   = track.parentElement?.clientWidth || window.innerWidth;
    const pct = ((dx - lockDx.current) / w) * 100;
    let offset = baseOffsetPct.current + pct;

    const minOffset = (pageCount - 1) * -100;
    if (offset > 0) {
      offset = offset * RUBBER_BAND;
    } else if (offset < minOffset) {
      offset = minOffset + (offset - minOffset) * RUBBER_BAND;
    }

    track.style.transform = `translateX(${offset}%)`;
  }, [pageCount]);

  const onTouchEnd = useCallback((e) => {
    if (!t0.current) return;

    const wasH   = dirLock.current;
    const startX = t0.current.x;
    const startT = t0.current.t;
    t0.current   = null;
    dirLock.current = null;

    const track = trackRef.current;

    if (!dragging.current || !wasH) {
      dragging.current = false;
      settleAt(track, settledIdx.current);
      return;
    }
    dragging.current = false;
    if (!track) return;

    const touch = e.changedTouches[0];
    const dx    = touch.clientX - startX;
    const dt    = Date.now() - startT;
    const vx    = Math.abs(dx) / Math.max(dt, 1);
    const w     = track.parentElement?.clientWidth || window.innerWidth;
    const frac  = Math.abs(dx) / w;

    const isFlick = vx > FLICK_VX;
    const isSwipe = frac > SNAP_THRESHOLD;

    let next = settledIdx.current;
    if ((isFlick || isSwipe) && dx < 0 && next < pageCount - 1) next++;
    if ((isFlick || isSwipe) && dx > 0 && next > 0)             next--;

    // Snap from current dragged position to target page.
    // We use the current visual offset as the from position.
    const currentTransform = track.style.transform;
    let currentPct;
    try {
      const matrix = new DOMMatrix(getComputedStyle(track).transform);
      const ww = track.parentElement?.clientWidth || window.innerWidth;
      currentPct = ww > 0 ? (matrix.m41 / ww) * 100 : settledIdx.current * -100;
    } catch {
      currentPct = settledIdx.current * -100;
    }
    // Don't use animateTo's from-index approach here — use the exact current offset.
    if (prefersReducedMotion() || next === settledIdx.current) {
      settleAt(track, next);
    } else {
      // Animate from currentPct directly to target.
      // Mark animatingToIdx BEFORE queuing the rAF so that the React re-render
      // triggered by onPageChange(next) below calls jumpTo(next), which sees
      // animatingToIdx===next and bails — preventing it from fighting this animation.
      animatingToIdx.current = next;

      if (track._pagerOnEnd) {
        track.removeEventListener('transitionend', track._pagerOnEnd);
        track._pagerOnEnd = null;
      }
      track.style.transition = 'none';
      track.style.left       = '';
      track.style.transform  = `translateX(${currentPct}%)`;

      // Velocity-matched settle: the snap continues at roughly the speed the
      // finger left at, then eases — so a fast flick lands quickly and a gentle
      // drag settles softly. This momentum feel (not a fixed mechanical 0.3s) is
      // what separates a premium pager from a basic one. easeOutQuint decel curve.
      const targetPct    = next * -100;
      const remainingPct = Math.abs(targetPct - currentPct);
      const vxPct        = (vx / w) * 100;            // release speed, %/ms
      let durMs = vxPct > 0.02 ? remainingPct / vxPct : 320;
      durMs = Math.max(200, Math.min(durMs, 460));    // clamp for taste

      requestAnimationFrame(() => {
        if (!track.isConnected) return;
        track.style.willChange = 'transform';
        track.style.transition = `transform ${durMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        track.style.transform  = `translateX(${next * -100}%)`;

        function onEnd(ev) {
          if (ev.propertyName !== 'transform') return;
          track.removeEventListener('transitionend', onEnd);
          track._pagerOnEnd = null;
          animatingToIdx.current = -1;   // animation complete — jumpTo may proceed again
          settleAt(track, next);
        }
        track._pagerOnEnd = onEnd;
        track.addEventListener('transitionend', onEnd);
      });
    }

    if (next !== settledIdx.current) {
      onPageChange(next);
    }
  }, [pageCount, onPageChange]);

  // ── Non-passive native touchmove listener ────────────────────────────────
  // React 19 attaches synthetic onTouchMove as passive, so e.preventDefault()
  // inside the React handler is a no-op and the browser ignores it. We attach a
  // native listener with { passive: false } on the track's parent (viewport) so
  // we can call preventDefault() and stop native scroll/overscroll during a
  // confirmed horizontal drag. The listener only calls preventDefault when:
  //   1. A touch sequence is active (t0 is set)
  //   2. The direction lock is confirmed horizontal (dirLock === true)
  // This ensures vertical-scroll gestures are never blocked.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const viewport = track.parentElement;
    if (!viewport || typeof viewport.addEventListener !== 'function') return;

    function handleNativeTouchMove(e) {
      // Only block native scroll on a confirmed 1-finger horizontal drag.
      // Never on multi-touch — that's a pinch-zoom and must reach the browser.
      if (!t0.current) return;
      if (e.touches.length > 1) return;
      if (dirLock.current !== true) return;
      e.preventDefault();
    }

    viewport.addEventListener('touchmove', handleNativeTouchMove, { passive: false });
    return () => {
      viewport.removeEventListener('touchmove', handleNativeTouchMove, { passive: false });
    };
  // trackRef is a stable ref — effect only needs to run once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    trackRef,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    jumpTo,
  };
}
