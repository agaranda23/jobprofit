/**
 * Splash — branded full-screen loading screen.
 *
 * Used in two places:
 *   1. AppShell auth-gate (replaces the bare spinner while session resolves).
 *   2. main.jsx Suspense fallback for public quote/invoice/receipt routes.
 *
 * Visual: Deep Navy (#0B1320) full viewport, OHNAR O-ring SVG centred,
 * animating from stroke-dashoffset 251.3→0 over ~700ms, then "OHNAR"
 * wordmark fades + rises 8px after ~850ms.
 *
 * The composition here is pixel-identical to #splash-static in index.html
 * (same SVG, same wordmark, same dimensions) so React mounting causes no
 * visible double-O or layout jump — the handoff is invisible.
 *
 * Reduced-motion: @media (prefers-reduced-motion: reduce) skips all
 * animations — users see the static centred lockup immediately.
 *
 * A 700ms minimum dwell is enforced via the CSS animation duration so even
 * instant loads don't flash the screen.
 *
 * NOTE: A designer-provided SVG wordmark would improve crispness at all DPRs.
 * Until then "OHNAR" is rendered as live DM Sans text (already loaded by the
 * page) — correct colour, weight, and spacing without any raster softness.
 */
export default function Splash() {
  return (
    <div className="splash" aria-label="Loading OHNAR" role="status">
      {/* O-ring: inline SVG — crisp at any DPR, animatable via CSS.
          Circumference of r=40 circle ≈ 251.3 (used for stroke-dasharray). */}
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

      {/* Wordmark — live DM Sans text, fades + rises after the ring settles.
          Pixel-identical position and size to #splash-static in index.html. */}
      <span className="splash__wordmark" aria-label="OHNAR">
        OHNAR
      </span>
    </div>
  );
}
