/**
 * StageStrip — fixed-width unified segmented-control for the Work tab.
 *
 * 6 equal segments: Lead · Quoted · On · Invoiced · Overdue · Paid.
 * All 6 segments share the strip width equally — no horizontal scroll.
 * Active segment gets a solid fill in its own semantic colour.
 * "Show all" is a separate toggle in the controls row (WorkScreen.jsx), not a segment.
 *
 * Extracted from WorkScreen.jsx (PR: polish/jobs-pipeline-stage-strip).
 *
 * Props:
 *   jobs           — full jobs array from AppShell
 *   selectedStage  — currently active stage string
 *   showAll        — true when show-all mode is active (all segments light up in their own colours)
 *   onSelectStage  — callback(stage: string) — sets a real stage, exits showAll
 *   deriveStatus   — function(job) → stage string (passed in to avoid a circular import)
 *   formatAmount   — function(val) → string (passed in for the same reason)
 */
import { useRef, useEffect } from 'react';

export const STAGES = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

/**
 * StageTile — one segment in the unified bar.
 */
function StageTile({ stage, count, total, selected, onSelect, tileRef, formatAmount }) {
  const accentClass = `stage-tile--${stage.toLowerCase()}`;

  // Lead has no £ value; £0 reads as a failure state — both render a faint em-dash instead
  const isEmpty = stage === 'Lead' || total === 0;
  const amountText = isEmpty ? '—' : '£' + formatAmount(total);
  const amountClass = isEmpty ? 'stage-tile-amount stage-tile-amount--empty' : 'stage-tile-amount';

  return (
    <button
      ref={tileRef}
      type="button"
      className={`stage-tile ${accentClass}${selected ? ' stage-tile--selected' : ''}`}
      onClick={() => onSelect(stage)}
      aria-pressed={selected}
    >
      <span className="stage-tile-name">{stage.toUpperCase()}</span>
      <span className="stage-tile-count">{count} {count === 1 ? 'job' : 'jobs'}</span>
      <span className={amountClass}>{amountText}</span>
    </button>
  );
}

/**
 * StageStrip — the full unified bar (6 equal segments, no "All" tile).
 */
export default function StageStrip({ jobs, selectedStage, showAll, onSelectStage, deriveStatus, formatAmount }) {
  const scrollRef = useRef(null);
  const tileRefs = useRef({});

  // Aggregate count + total per stage from the live jobs array
  const stageMeta = STAGES.reduce((acc, s) => {
    acc[s] = { count: 0, total: 0 };
    return acc;
  }, {});

  for (const j of jobs) {
    const s = deriveStatus(j);
    if (stageMeta[s]) {
      stageMeta[s].count += 1;
      stageMeta[s].total += Number(j.total ?? j.amount ?? 0) || 0;
    }
  }

  // Auto-scroll active tile into view — guarded: only fires if the strip actually
  // overflows (it won't with flex:1 equal segments, but keeps the effect harmless
  // in any edge case where the container is unexpectedly too narrow).
  useEffect(() => {
    const strip = scrollRef.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    if (showAll) return; // no segment to scroll to in show-all mode
    const el = tileRefs.current[selectedStage];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [selectedStage, showAll]);

  return (
    <div className="stage-strip-wrap">
      <div className="stage-strip" ref={scrollRef} role="group" aria-label="Filter by pipeline stage">
        {STAGES.map(s => (
          <StageTile
            key={s}
            stage={s}
            count={stageMeta[s].count}
            total={stageMeta[s].total}
            selected={showAll || selectedStage === s}
            onSelect={onSelectStage}
            tileRef={el => { tileRefs.current[s] = el; }}
            formatAmount={formatAmount}
          />
        ))}
      </div>
    </div>
  );
}
