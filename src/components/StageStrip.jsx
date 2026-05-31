/**
 * StageStrip — horizontal scrollable unified segmented-control for the Work tab.
 *
 * Renders an "All" segment first, then one segment per stage
 * (Lead · Quoted · On · Invoiced · Overdue · Paid) with count and total £.
 * All segments live inside a single rounded container (one visual object).
 * Active segment gets a solid fill in its own semantic colour.
 *
 * Extracted from WorkScreen.jsx (PR: polish/jobs-pipeline-stage-strip).
 *
 * Props:
 *   jobs           — full jobs array from AppShell
 *   selectedStage  — currently active stage string
 *   showAll        — true when the "All" segment is active
 *   onSelectStage  — callback(stage: string) — sets a real stage, exits showAll
 *   onSelectAll    — callback() — activates the All segment (sets showAll = true)
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
 * StageStrip — the full unified scrollable bar.
 */
export default function StageStrip({ jobs, selectedStage, showAll, onSelectStage, onSelectAll, deriveStatus, formatAmount }) {
  const scrollRef = useRef(null);
  const tileRefs = useRef({});

  // Aggregate count + total per stage from the live jobs array
  const stageMeta = STAGES.reduce((acc, s) => {
    acc[s] = { count: 0, total: 0 };
    return acc;
  }, {});

  let allCount = 0;
  let allTotal = 0;

  for (const j of jobs) {
    const s = deriveStatus(j);
    if (stageMeta[s]) {
      stageMeta[s].count += 1;
      stageMeta[s].total += Number(j.total ?? j.amount ?? 0) || 0;
    }
    allCount += 1;
    allTotal += Number(j.total ?? j.amount ?? 0) || 0;
  }

  // Auto-scroll active tile into view when selection changes.
  // "All" uses the key 'All'; stage keys match STAGES.
  useEffect(() => {
    const key = showAll ? 'All' : selectedStage;
    const el = tileRefs.current[key];
    if (el && scrollRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [selectedStage, showAll]);

  const allAmountText = allTotal > 0 ? '£' + formatAmount(allTotal) : '—';
  const allAmountClass = allTotal === 0 ? 'stage-tile-amount stage-tile-amount--empty' : 'stage-tile-amount';

  return (
    <div className="stage-strip-wrap">
      <div className="stage-strip" ref={scrollRef} role="group" aria-label="Filter by pipeline stage">
        {/* All segment — leading, activates showAll mode */}
        <button
          ref={el => { tileRefs.current['All'] = el; }}
          type="button"
          className={`stage-tile stage-tile--all${showAll ? ' stage-tile--selected' : ''}`}
          onClick={onSelectAll}
          aria-pressed={showAll}
        >
          <span className="stage-tile-name">ALL</span>
          <span className="stage-tile-count">{allCount} {allCount === 1 ? 'job' : 'jobs'}</span>
          <span className={allAmountClass}>{allAmountText}</span>
        </button>

        {STAGES.map(s => (
          <StageTile
            key={s}
            stage={s}
            count={stageMeta[s].count}
            total={stageMeta[s].total}
            selected={!showAll && selectedStage === s}
            onSelect={onSelectStage}
            tileRef={el => { tileRefs.current[s] = el; }}
            formatAmount={formatAmount}
          />
        ))}
      </div>
    </div>
  );
}
