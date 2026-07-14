/**
 * isSwipeBlockedTarget — guard for JobDetailDrawer's header swipe-to-dismiss.
 *
 * The whole .job-detail-header is a deliberately large drag surface (mobile-first,
 * "one hand on a kerb" — see the "Live drag area is the whole header" note in
 * JobDetailDrawer.jsx). A pointerdown that lands on one of these targets must NOT
 * start a dismiss drag:
 *   - genuinely interactive controls: button / a / input / [role="button"], and
 *     the kebab menu + its wrapper (an absolutely-positioned overflow menu that
 *     geometry alone wouldn't exclude).
 *   - read-only chips that LOOK tappable but aren't: the coloured money chips
 *     (.jd-money-chip — paid / overdue / due) and the hero price figure
 *     (.jd-hero-price). In read-only mode these render as plain <div>s, so without
 *     this guard a press-and-hold that drifts >10px down would arm the drag, slide
 *     the sheet, fade the backdrop, and briefly reveal the Jobs list behind the
 *     (non-portaled) drawer — rubber-banding back on a sub-threshold release. That
 *     false-trigger on the price/status chip was the reported "press-and-hold a
 *     non-clickable part → peeks the Jobs tab → snaps back" bug.
 *
 * Kept as a standalone pure helper (rather than a closure inside the 5k-line
 * drawer) so the exclusion contract is unit-testable without mounting the whole
 * component — see src/components/__tests__/jobDetailSwipeGuard.test.js.
 *
 * @param {EventTarget|null|undefined} el - the pointer event's target
 * @returns {boolean} true if a drag must NOT start from this target
 */
export const isSwipeBlockedTarget = (el) =>
  !!el?.closest?.(
    'button, a, input, [role="button"], .jd-kebab-menu, .jd-kebab-wrap, .jd-money-chip, .jd-hero-price'
  );
