/**
 * OhnarWordmark — reusable OHNAR brand lockup.
 *
 * Renders the O-ring logo image as the letter "O", immediately followed by
 * "HNAR" text, so the combined visual reads as the single word "OHNAR".
 *
 * Accessibility: the outer span carries role="img" aria-label="OHNAR" so
 * screen readers announce the brand name exactly once. Both the img and the
 * text span are aria-hidden so they don't double-announce.
 *
 * Sizing: font-size is set via the `size` prop (any CSS length) or inherits
 * from the parent. The O-ring image is scaled via em units so it always matches
 * the cap height of the surrounding text. Pass `className` to override colour
 * or other presentational concerns.
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
      <img
        src="/ohnar-O-tight-512.png"
        className="ohnar-wm__o"
        alt=""
        aria-hidden="true"
      />
      <span className="ohnar-wm__hnar" aria-hidden="true">HNAR</span>
    </span>
  );
}
