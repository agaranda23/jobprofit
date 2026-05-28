/**
 * StageStrip — horizontal scrollable pipeline rail for the Work tab.
 *
 * Renders one StageTile per stage (Lead · Quoted · On · Invoiced · Overdue · Paid)
 * with job count and total £ at stake. A connector rail (hairline + dots) sits beneath
 * the tiles to make the pipeline read as a sequence.
 *
 * Extracted from WorkScreen.jsx because WorkScreen exceeded 500 lines after the
 * Stage Strip + Advance Button redesign (PR: polish/jobs-pipeline-stage-strip).
 *
 * Props:
 *   jobs           — full jobs array from AppShell
 *   selectedStage  — currently active stage string
 *   onSelectStage  — callback(stage: string)
 *   deriveStatus   — function(job) → stage string (passed in to avoid a circular import)
 *   formatAmount   — function(val) → string (passed in for the same reason)
 */
import { useRef, useEffect } from 'react';

export const STAGES = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

/**
 * StageTile — one tile in the strip.
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
 * StageStrip — the full scrollable rail.
 */
export default function StageStrip({ jobs, selectedStage, onSelectStage, deriveStatus, formatAmount }) {
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

  // Auto-scroll selected tile into view when selection changes
  useEffect(() => {
    const el = tileRefs.current[selectedStage];
    if (el && scrollRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedStage]);

  return (
    <div className="stage-strip-wrap">
      <div className="stage-strip" ref={scrollRef} role="group" aria-label="Filter by pipeline stage">
        {STAGES.map(s => (
          <StageTile
            key={s}
            stage={s}
            count={stageMeta[s].count}
            total={stageMeta[s].total}
            selected={selectedStage === s}
            onSelect={onSelectStage}
            tileRef={el => { tileRefs.current[s] = el; }}
            formatAmount={formatAmount}
          />
        ))}
      </div>
      {/* Connector rail — hairline + dots. Each dot wrapped in a flex cell that
           mirrors the tile's flex: 1 1 0, so dots sit centred under their tile. */}
      <div className="stage-rail" aria-hidden="true">
        {STAGES.map(s => (
          <div key={s} className="stage-rail-cell">
            <span
              className={`stage-rail-dot stage-rail-dot--${s.toLowerCase()}${selectedStage === s ? ' stage-rail-dot--active' : ''}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
