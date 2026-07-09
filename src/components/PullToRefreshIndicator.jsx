/**
 * PullToRefreshIndicator — branded pull-to-refresh ring.
 *
 * Purely presentational: the gesture/state logic lives in usePullToRefresh.
 * A small O-ring (the OHNAR brand mark — see Splash.jsx's full-size version)
 * that fills as the user pulls, then spins while the refresh is in flight.
 *
 * position: fixed, same tier/anchoring convention as SyncBadge (top of the
 * viewport, safe-area aware) — deliberately NOT nested inside the pager's
 * .dp-viewport/.dp-track so it can never inherit a stray transform/filter
 * containing-block from an in-flight page transition.
 *
 * Reduced-motion: the fill (stroke-dashoffset, driven by `progress`) tracks
 * the finger 1:1 and is not gated — same philosophy as the pager's own drag-
 * follow. Only the independent, finger-detached motion is gated: the
 * spin-while-refreshing animation (CSS, see .ptr-ring--refreshing in
 * index.css) and the snap-back-to-0 transition on release.
 */

const SIZE  = 22;
const R     = 8;
const CIRC  = 2 * Math.PI * R;

export default function PullToRefreshIndicator({ pullDistance, progress, armed, refreshing }) {
  if (pullDistance <= 0 && !refreshing) return null;

  const dashOffset = CIRC * (1 - (refreshing ? 1 : progress));

  return (
    <div
      className={`ptr-ring${refreshing ? ' ptr-ring--refreshing' : ''}${armed ? ' ptr-ring--armed' : ''}`}
      style={{
        opacity: refreshing ? 1 : Math.min(1, progress + 0.15),
        transform: `translateX(-50%) scale(${refreshing ? 1 : 0.7 + progress * 0.3})`,
      }}
      role="status"
      aria-live="polite"
      aria-label={refreshing ? 'Refreshing' : undefined}
      aria-hidden={refreshing ? undefined : 'true'}
    >
      <svg viewBox="0 0 22 22" width={SIZE} height={SIZE} aria-hidden="true">
        <circle cx="11" cy="11" r={R} className="ptr-ring__track" fill="none" strokeWidth="2.5" />
        <circle
          cx="11"
          cy="11"
          r={R}
          className="ptr-ring__arc"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 11 11)"
        />
      </svg>
    </div>
  );
}
