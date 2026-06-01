import React, { useState, useEffect } from 'react';

/**
 * CollapsedSectionRow — one-liner row that expands in place via accordion.
 *
 * Design A Step 2 (PRD 2026-05-30):
 *   - Whole 48px row is the tap target (no separate chevron tap)
 *   - Multi-expand: parent does not coordinate collapse (each row owns state)
 *   - 220ms ease-out height transition via max-height animation
 *   - prefers-reduced-motion: instant snap, no transition
 *   - When needsAttention is true: amber left-border, amber "Fix" pill, default-expanded
 *
 * Props:
 *   id              – unique string id (used for aria-controls)
 *   icon            – emoji or character for the left icon
 *   title           – section name ("Quote", "Costs", "Customer")
 *   meta            – one-line summary shown in collapsed state (e.g. "£1,450 · sent 3d")
 *   needsAttention  – boolean; when true the row goes amber and forces expanded
 *   defaultExpanded – boolean; initial open state (can be overridden by needsAttention)
 *   children        – full section body rendered when expanded
 *
 * Expansion technique: max-height animation
 *   Collapsed: max-height: 0  → overflow:hidden clips content to nothing
 *   Expanded:  max-height: 2000px → large enough for any panel (Quote with many
 *              line items, Costs with many receipts). The CSS transition animates
 *              between these values. The 2000px ceiling is intentionally over-sized
 *              so it never clips real content; the actual rendered height is always
 *              smaller. Animation timing feels slightly faster on short panels because
 *              the transition covers less of the 2000px range — acceptable trade-off
 *              for zero JS layout measurement and universal browser support.
 *
 * Why we abandoned the CSS grid-template-rows (0fr → 1fr) trick (PR #192):
 *   Four rounds of testing showed the grid trick fails to reveal content in the
 *   production PWA on the devices we tested (375px viewport). Static analysis could
 *   not reproduce the failure, suggesting a browser/PWA cache or rendering-order
 *   interaction. The max-height pattern has been the industry standard for 10+ years,
 *   works in every browser, and requires no inner wrapper div.
 */
export default function CollapsedSectionRow({
  id,
  icon,
  title,
  meta,
  needsAttention = false,
  defaultExpanded = false,
  children,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded || needsAttention);

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // When needsAttention changes to true (e.g. a gap appears), force-expand.
  // We do not collapse when attention is removed — let the user control it.
  useEffect(() => {
    if (needsAttention && !expanded) {
      setExpanded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAttention]);

  const panelId = `jd-csr-panel-${id}`;
  const triggerId = `jd-csr-trigger-${id}`;

  return (
    <div className={`jd-csr${needsAttention ? ' jd-csr--attention' : ''}`}>
      <button
        id={triggerId}
        type="button"
        className="jd-csr-row"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
      >
        <span className="jd-csr-icon" aria-hidden="true">{icon}</span>
        <span className="jd-csr-title">{title}</span>
        {!expanded && meta && (
          <span className="jd-csr-meta">{meta}</span>
        )}
        {needsAttention && !expanded && (
          <span className="jd-csr-attention-pill" aria-label="Needs attention">Fix</span>
        )}
        <span className="jd-csr-chev" aria-hidden="true">
          {expanded ? '▴' : '›'}
        </span>
      </button>

      {/*
        Panel — always in DOM (no conditional render) so aria-controls target exists.
        max-height transitions between 0 (collapsed) and 2000px (expanded).
        overflow:hidden clips content when max-height is 0.
        Children render directly — no inner wrapper div needed.
      */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        className="jd-csr-panel"
        style={{
          maxHeight: expanded ? '2000px' : '0',
          overflow: 'hidden',
          transition: prefersReducedMotion ? 'none' : 'max-height 220ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
