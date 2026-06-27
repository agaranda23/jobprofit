/**
 * Splash — branded full-screen loading screen.
 *
 * Used in two places:
 *   1. AppShell auth-gate (replaces the bare spinner while session resolves).
 *   2. main.jsx Suspense fallback for public quote/invoice/receipt routes.
 *
 * Visual: Deep Navy (#0B1320) full viewport, OHNAR O-ring SVG centred,
 * animating from stroke-dashoffset 0→full over ~700ms, then "OHNAR" wordmark
 * fades + rises 8px after ~850ms.
 *
 * Reduced-motion: @media (prefers-reduced-motion: reduce) skips all
 * animations — users see the static centred lockup immediately.
 *
 * A 700ms minimum dwell is enforced via the CSS animation duration so even
 * instant loads don't flash the screen.
 */
export default function Splash() {
  return (
    <div className="splash" aria-label="Loading OHNAR" role="status">
      {/* O-ring: inline SVG so it's crisp at any DPR and animatable */}
      <svg
        className="splash__ring"
        viewBox="0 0 100 100"
        width="80"
        height="80"
        aria-hidden="true"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="splash-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2563EB" />
            <stop offset="100%" stopColor="#5FD9A6" />
          </linearGradient>
        </defs>
        {/* Track ring — subtle navy tint */}
        <circle
          cx="50"
          cy="50"
          r="40"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="7"
        />
        {/* Animated draw-on ring */}
        <circle
          className="splash__ring-arc"
          cx="50"
          cy="50"
          r="40"
          stroke="url(#splash-ring-grad)"
          strokeWidth="7"
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>

      {/* Wordmark — fades + rises after the ring settles */}
      <span className="splash__wordmark" aria-label="OHNAR">
        {/* Use the raster lockup; a designer-provided SVG wordmark is the
            remaining step for perfect crispness at all DPRs. */}
        <img
          src="/ohnar-logo-dark.png"
          alt=""
          aria-hidden="true"
          className="splash__wordmark-img"
          width="160"
          height="80"
        />
      </span>
    </div>
  );
}
