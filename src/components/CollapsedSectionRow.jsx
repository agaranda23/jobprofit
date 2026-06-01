import React, { useState, useEffect } from 'react';

/**
 * CollapsedSectionRow — one-liner row that expands in place via accordion.
 *
 * Design A Step 2 (PRD 2026-05-30):
 *   - Whole 48px row is the tap target (no separate chevron tap)
 *   - Multi-expand: parent does not coordinate collapse (each row owns state)
 *   - 220ms ease-out height transition via CSS grid row expansion (no scrollHeight
 *     measurement — the grid trick is layout-engine-driven and never returns 0)
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
 * Expansion technique: CSS grid row height
 *   Collapsed: grid-template-rows: 0fr  → inner div min-height:0 clips to 0
 *   Expanded:  grid-template-rows: 1fr  → inner div grows to fit content
 *   No JS layout measurement needed; browser layout engine handles all heights.
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

  const transition = prefersReducedMotion
    ? 'none'
    : 'grid-template-rows 220ms ease-out';

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

        Outer div: display:grid with animated grid-template-rows.
          Collapsed → 0fr  (inner div collapses to 0 via min-height:0)
          Expanded  → 1fr  (inner div grows to fit content)

        Inner div: overflow:hidden + min-height:0 are both required by the grid trick.
          overflow:hidden clips content during animation so it doesn't bleed out.
          min-height:0 lets the grid shrink the div below its intrinsic height.
      */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        className="jd-csr-panel"
        style={{
          display: 'grid',
          gridTemplateRows: expanded ? '1fr' : '0fr',
          transition,
        }}
      >
        <div style={{ overflow: 'hidden', minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
