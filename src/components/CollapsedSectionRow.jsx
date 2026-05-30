import React, { useState, useRef, useEffect } from 'react';

/**
 * CollapsedSectionRow — one-liner row that expands in place via accordion.
 *
 * Design A Step 2 (PRD 2026-05-30):
 *   - Whole 48px row is the tap target (no separate chevron tap)
 *   - Multi-expand: parent does not coordinate collapse (each row owns state)
 *   - 180ms ease-out height transition; content fades in over the last 80ms
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
  const panelRef = useRef(null);
  const [height, setHeight] = useState(expanded ? 'auto' : '0px');
  const [visible, setVisible] = useState(expanded);

  // Track reduced-motion preference
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // When needsAttention changes (e.g. gap filled), re-evaluate expanded state
  useEffect(() => {
    if (needsAttention && !expanded) {
      setExpanded(true);
    }
    // We don't collapse when attention is removed — let the user control it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAttention]);

  // Animate height on expand/collapse
  useEffect(() => {
    if (prefersReducedMotion) {
      setHeight(expanded ? 'auto' : '0px');
      setVisible(expanded);
      return;
    }

    if (expanded) {
      setVisible(true);
      // Next frame: measure content height and animate to it
      requestAnimationFrame(() => {
        if (panelRef.current) {
          setHeight(`${panelRef.current.scrollHeight}px`);
        }
      });
      // After animation completes, set to 'auto' so content can reflow
      const t = setTimeout(() => setHeight('auto'), 180);
      return () => clearTimeout(t);
    } else {
      // Snap from 'auto' to measured px so CSS transition fires
      if (panelRef.current) {
        setHeight(`${panelRef.current.scrollHeight}px`);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setHeight('0px');
          });
        });
      } else {
        setHeight('0px');
      }
      const t = setTimeout(() => setVisible(false), 180);
      return () => clearTimeout(t);
    }
  }, [expanded, prefersReducedMotion]);

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

      {/* Panel — always in DOM for measurement; visibility gated by `visible` */}
      <div
        id={panelId}
        ref={panelRef}
        role="region"
        aria-labelledby={triggerId}
        className="jd-csr-panel"
        style={{
          height: prefersReducedMotion ? (expanded ? 'auto' : '0px') : height,
          overflow: 'hidden',
          transition: prefersReducedMotion ? 'none' : 'height 180ms ease-out',
          visibility: visible ? 'visible' : 'hidden',
        }}
      >
        <div
          style={{
            opacity: expanded ? 1 : 0,
            transition: prefersReducedMotion ? 'none' : 'opacity 80ms ease-out 100ms',
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
