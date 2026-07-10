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
import { useRef, useEffect, useState } from 'react';
import { STAGES, readCoachmarkSeen, writeCoachmarkSeen } from '../lib/pipelineStages';

/** Map each stage to its canonical --stage-* CSS token for the ring colour. */
const STAGE_TOKEN = {
  Lead:     'var(--stage-lead)',
  Quoted:   'var(--stage-quoted)',
  On:       'var(--stage-on)',
  Invoiced: 'var(--stage-invoiced)',
  Overdue:  'var(--stage-overdue)',
  Paid:     'var(--stage-paid)',
};

/**
 * StageTile — one segment in the unified bar.
 * The Paid tile gets a green finish-line accent (tick + name colour) so the strip
 * visually reads as a journey ending in a win — in both selected and unselected states.
 *
 * Each chip carries a small circular stage marker (mini cycle ring) rendered as an
 * 10px filled dot in the stage's canonical --stage-* colour. The dot uses a white
 * ring outline on selected chips (where the background fills with the stage colour)
 * so it stays visible against the filled background.
 */
function StageTile({ stage, count, total, selected, onSelect, tileRef, formatAmount }) {
  const accentClass = `stage-tile--${stage.toLowerCase()}`;

  // £0 reads as a failure state, so render a faint em-dash instead of "£0".
  // Lead shows its potential value (sum of lead job prices) whenever it's > 0.
  const isEmpty = total === 0;
  const amountText = isEmpty ? '—' : '£' + formatAmount(total);
  const amountClass = isEmpty ? 'stage-tile-amount stage-tile-amount--empty' : 'stage-tile-amount';

  return (
    <button
      ref={tileRef}
      type="button"
      className={`stage-tile ${accentClass}${selected ? ' stage-tile--selected' : ''}${stage === 'Paid' ? ' stage-tile--paid-finish' : ''}`}
      onClick={() => onSelect(stage)}
      aria-pressed={selected}
    >
      <span
        className={`stage-marker${selected ? ' stage-marker--selected' : ''}`}
        aria-hidden="true"
        data-stage={stage.toLowerCase()}
        style={{ '--marker-colour': STAGE_TOKEN[stage] }}
      />
      <span className="stage-tile-name">{stage.toUpperCase()}</span>
      <span className="stage-tile-count">{count} {count === 1 ? 'job' : 'jobs'}</span>
      <span className={amountClass}>{amountText}</span>
    </button>
  );
}

// readCoachmarkSeen / writeCoachmarkSeen / COACHMARK_KEY / STAGES now live in
// src/lib/pipelineStages.js (imported above).

/**
 * StageStrip — the full unified bar (6 equal segments, no "All" tile).
 *
 * Renders a one-time coachmark below the strip on the user's first visit to the
 * Jobs screen. The flag is persisted in localStorage under COACHMARK_KEY.
 * The coachmark auto-dismisses when the user taps any stage tile.
 */
export default function StageStrip({ jobs, selectedStage, showAll, onSelectStage, deriveStatus, formatAmount }) {
  const scrollRef = useRef(null);
  const tileRefs = useRef({});

  // One-time coachmark: initialise from localStorage so the hook is unconditional.
  const [coachmarkVisible, setCoachmarkVisible] = useState(() => !readCoachmarkSeen());

  function dismissCoachmark() {
    setCoachmarkVisible(false);
    writeCoachmarkSeen();
  }

  // Wrap onSelectStage so tapping any stage also dismisses the coachmark.
  function handleSelectStage(stage) {
    if (coachmarkVisible) dismissCoachmark();
    onSelectStage(stage);
  }

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
            onSelect={handleSelectStage}
            tileRef={el => { tileRefs.current[s] = el; }}
            formatAmount={formatAmount}
          />
        ))}
      </div>

      {/* One-time pipeline coachmark — shown only on first Jobs-screen visit.
          Sits below the strip and does NOT cover or overlap the stage tiles.
          Auto-dismissed on first stage tap; also dismissible via "Got it" or ×. */}
      {coachmarkVisible && (
        <div className="pipeline-coachmark" role="note" aria-label="Pipeline tip">
          <span className="pipeline-coachmark__icon" aria-hidden="true">&#x2192;</span>
          <p className="pipeline-coachmark__msg">
            Your jobs run left &rarr; right &mdash; a new Lead at the start, Paid at the finish. Tap a stage to see what&rsquo;s in it.
          </p>
          <div className="pipeline-coachmark__actions">
            <button
              type="button"
              className="pipeline-coachmark__got-it"
              onClick={dismissCoachmark}
            >
              Got it
            </button>
            <button
              type="button"
              className="pipeline-coachmark__dismiss"
              aria-label="Dismiss tip"
              onClick={dismissCoachmark}
            >
              &times;
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
