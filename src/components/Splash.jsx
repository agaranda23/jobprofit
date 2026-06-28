/**
 * Splash — branded full-screen loading screen.
 *
 * Used in two places:
 *   1. AppShell auth-gate (replaces the bare spinner while session resolves).
 *   2. main.jsx Suspense fallback for public quote/invoice/receipt routes.
 *
 * Visual: Deep Navy (#0B1320) full viewport. The OHNAR lockup is the O-ring
 * (which IS the brand "O") followed by the "HNAR" wordmark — together reading
 * "OHNAR" — laid out HORIZONTALLY to match the real logo (ohnar-logo.png).
 * The ring draws from stroke-dashoffset 251.3→0 over ~700ms, then "HNAR"
 * fades + rises 8px after ~850ms. (Earlier this rendered the full word
 * "OHNAR" beside the ring, which showed the O twice — fixed.)
 *
 * Premium motion sequence (all gated behind prefers-reduced-motion: no-preference):
 *   0.05s  — ring begins drawing (dashoffset 251.3→0, cubic-bezier(.4,0,.2,1))
 *   ~0.75s — ring finishes; lockup snaps in with a micro-overshoot beat (scale .96→1.01→1)
 *   ~0.75s — Success-Green sheen sweeps across the lockup (~0.4s, low opacity)
 *   ~0.85s — wordmark fades + rises into place
 * Total motion ≤ ~1.0s.
 *
 * The composition here is pixel-identical to #splash-static in index.html
 * (same SVG, same wordmark, same dimensions) so React mounting causes no
 * visible double-O or layout jump — the handoff is invisible.
 *
 * Reduced-motion: @media (prefers-reduced-motion: reduce) skips all
 * animations — users see the static centred lockup immediately.
 *
 * The "HNAR" wordmark uses the REAL OHNAR logo letterforms (custom A & R) as
 * an inline SVG (public/ohnar-hnar-white.svg) — razor-sharp at any DPR and an
 * exact match for the header logo, not a DM Sans approximation.
 */
export default function Splash({ exiting = false }) {
  return (
    <div
      className={`splash${exiting ? ' splash--exiting' : ''}`}
      aria-label="Loading OHNAR"
      role="status"
    >
      {/* Lockup wrapper — receives the lock-in beat (scale micro-overshoot)
          and the Success-Green sheen sweep after the ring finishes drawing. */}
      <div className="splash__lockup">
        {/* O-ring: inline SVG — crisp at any DPR, animatable via CSS.
            Circumference of r=40 circle ≈ 251.3 (used for stroke-dasharray). */}
        <svg
          className="splash__ring"
          viewBox="0 0 100 100"
          width="44"
          height="44"
          aria-hidden="true"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Blue gradient — brightened top stop (#60A5FA) for legibility
                on a sunlit navy screen; bottom stays in the brand-blue family. */}
            <linearGradient id="splash-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#60A5FA" />
              <stop offset="100%" stopColor="#2563EB" />
            </linearGradient>
          </defs>
          {/* Track ring — subtle navy tint */}
          <circle
            cx="50"
            cy="50"
            r="40"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="11"
          />
          {/* Animated draw-on ring */}
          <circle
            className="splash__ring-arc"
            cx="50"
            cy="50"
            r="40"
            stroke="url(#splash-ring-grad)"
            strokeWidth="11"
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
          />
        </svg>

        {/* Wordmark — "HNAR" from the REAL OHNAR logo letterforms (custom A & R),
            white for the dark splash. The ring to its left is the brand "O";
            together they read "OHNAR". Fades + rises after the ring settles.
            The .splash wrapper carries aria-label "Loading OHNAR" for screen
            readers. Matches #splash-static in index.html. */}
        <img
          className="splash__wordmark"
          src="/ohnar-hnar-white.svg"
          alt=""
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
