/**
 * Skeleton — reusable loading placeholder.
 *
 * Renders a muted rounded block with an optional shimmer sweep.
 * Shimmer is gated behind prefers-reduced-motion: under reduce-motion
 * the block is static (just the muted background).
 *
 * Props:
 *   w          — CSS width string e.g. "100%", "80px". Default: "100%"
 *   h          — CSS height string e.g. "20px", "2rem". Default: "1em"
 *   radius     — CSS border-radius. Default: "var(--radius-sm)"
 *   className  — extra class names
 *   style      — inline style overrides
 */
export default function Skeleton({ w = '100%', h = '1em', radius = 'var(--radius-sm)', className = '', style = {} }) {
  return (
    <span
      className={`skeleton${className ? ' ' + className : ''}`}
      style={{ width: w, height: h, borderRadius: radius, display: 'block', ...style }}
      aria-hidden="true"
    />
  );
}
