import React, { useState, useEffect } from 'react';

/**
 * CollapsedSectionRow — one-liner row that expands in place via accordion.
 *
 * Design A Step 2 (PRD 2026-05-30):
 *   - Whole 48px row is the tap target (no separate chevron tap)
 *   - Multi-expand: parent does not coordinate collapse (each row owns state)
 *   - Instant show/hide with optional opacity fade-in (does NOT affect layout)
 *   - prefers-reduced-motion: no transition (snap)
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
 * Expansion technique: conditional render (children are only in the DOM when expanded)
 *
 *   Collapsed: {expanded ? children : null} renders nothing → panel div is naturally
 *              0-height → .jd-csr container fits only the trigger row (48px).
 *   Expanded:  children are real in-flow DOM → panel grows to its content height →
 *              .jd-csr container grows with it → siblings below (Quote, Costs cards)
 *              are PUSHED DOWN by normal block layout. No overflow, no overlap.
 *
 * Why we abandoned all three previous animation approaches:
 *
 *   1. JS scrollHeight measurement (earliest approach):
 *      Too much resize-observer complexity; abandoned before shipping.
 *
 *   2. CSS grid-template-rows (0fr → 1fr) trick (PR #192):
 *      Four rounds of testing showed the grid trick fails to reveal content in the
 *      production PWA on the devices we tested (375px viewport). Static analysis could
 *      not reproduce the failure, suggesting a browser/PWA cache or rendering-order
 *      interaction.
 *
 *   3. max-height: 0 → 2000px animation (shipped, caused the 8th regression):
 *      This is the definitive root cause. The overflow: hidden on the panel clips
 *      content when collapsed, which requires the .jd-csr container to NOT have
 *      overflow: hidden (that was the 4th regression). But the real problem is deeper:
 *      in the iOS/PWA WebKit target, the .jd-csr container does NOT grow to contain
 *      the expanding panel — it stays at its min-height: 48px layout box. The panel's
 *      revealed content (up to 2000px) renders as VISUAL OVERFLOW spilling below the
 *      48px container, overlapping the next sibling card (Quote), which is laid out
 *      immediately under Schedule's 48px box. Because the panel is overflow (not
 *      in-flow layout), siblings never reflow/push down. Paint order then decides who
 *      shows on top: Quote is later in the DOM and was position: relative (from the
 *      7th fix), so Quote painted over Schedule's spilled panel. Schedule's options
 *      appeared BEHIND the Quote card.
 *
 *      Reproduction: open Schedule while Quote is default-expanded → Schedule options
 *      render behind Quote. Collapse Quote first, then open Schedule → renders fine.
 *      (Collapsing Quote removes its position context; Schedule's overflowing panel
 *      then paints over Quote. Confirms the cause is paint-order on overflow content,
 *      not a z-index value.)
 *
 *      The 5th–7th fixes (position: relative, z-index, opaque panel background) were
 *      treating the SYMPTOM (paint-order / bleed-through). The actual cause was that
 *      the container never grew, so the panel was always overflow. Conditional render
 *      eliminates the overflow entirely — children are real in-flow DOM → container
 *      grows → siblings push down → no stacking-context dependency needed.
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

  // Opacity fade-in on the panel: only affects painting (not layout), so it
  // is safe in the PWA/WebKit target. Gated on prefers-reduced-motion.
  const panelStyle = prefersReducedMotion
    ? {}
    : { transition: 'opacity 180ms ease-out', opacity: expanded ? 1 : 0 };

  return (
    <div className={`jd-csr${expanded ? ' jd-csr--expanded' : ''}${needsAttention ? ' jd-csr--attention' : ''}`}>
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
        Panel — always in DOM so aria-controls target is always valid.
        Children are conditionally rendered: present when expanded, null when collapsed.
        When collapsed: panel div has no children → natural 0 height → .jd-csr
          container stays at trigger-row height → siblings sit immediately below.
        When expanded: children are real in-flow DOM → panel grows to content height →
          .jd-csr container grows with it → siblings are pushed DOWN by block layout.
        No max-height, no overflow:hidden, no layout animation — the container reflows
        naturally, eliminating the overflow-spill-behind-sibling failure mode.
      */}
      <div
        id={panelId}
        role="region"
        aria-labelledby={triggerId}
        className="jd-csr-panel"
        style={panelStyle}
      >
        {expanded ? children : null}
      </div>
    </div>
  );
}
