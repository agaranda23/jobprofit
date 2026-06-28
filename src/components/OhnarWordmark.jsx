/**
 * OhnarWordmark — OHNAR full logo lockup (blue O + wordmark in one image).
 *
 * Assets (crisp vector SVG, ~4.5:1 tight viewBox — sharp at every DPR):
 *   Light theme → /ohnar-logo.svg      (blue O + navy "OHNAR" text)
 *   Dark  theme → /ohnar-logo-dark.svg (blue O + white "OHNAR" text)
 *
 * Theme-swap is CSS-only: both imgs are always in the DOM; the dark variant
 * is hidden by default and revealed under [data-theme="dark"]. This avoids
 * any JS theme-detection and works regardless of when the theme attribute
 * is set on <html>.
 *
 * Accessibility: the outer span carries role="img" aria-label="OHNAR" so
 * screen readers announce the brand name exactly once. The two img elements
 * carry alt="" and aria-hidden so they are treated as decorative.
 *
 * Sizing: font-size is set via the `size` prop (any CSS length) or inherits
 * from the parent. The lockup height is controlled by the .ohnar-lk__img
 * CSS rule (height: 0.78em matches the previous wordmark cap height). The
 * width follows automatically from the ~2:1 aspect ratio.
 *
 * Props:
 *   size      {string} CSS font-size to apply (e.g. "36px", "1.5rem").
 *             Omit to inherit from the parent element.
 *   className {string} Extra class names merged onto the root span.
 */
export default function OhnarWordmark({ size, className = '' }) {
  return (
    <span
      className={`ohnar-wm${className ? ' ' + className : ''}`}
      role="img"
      aria-label="OHNAR"
      style={size ? { fontSize: size } : undefined}
    >
      {/* Light-theme lockup — hidden under [data-theme="dark"] via CSS */}
      <img
        src="/ohnar-logo.svg"
        className="ohnar-wm__lockup ohnar-wm__lockup--light"
        alt=""
        aria-hidden="true"
        width={573}
        height={127}
        decoding="async"
      />
      {/* Dark-theme lockup — shown only under [data-theme="dark"] via CSS */}
      <img
        src="/ohnar-logo-dark.svg"
        className="ohnar-wm__lockup ohnar-wm__lockup--dark"
        alt=""
        aria-hidden="true"
        width={573}
        height={127}
        decoding="async"
      />
    </span>
  );
}
