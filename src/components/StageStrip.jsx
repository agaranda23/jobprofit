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

/** localStorage key — set once, never cleared, so the coachmark only ever shows once. */
export const COACHMARK_KEY = 'jp.jobs_pipeline_coachmark_seen';

export const STAGES = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

/**
 * StageTile — one segment in the unified bar.
 * The Paid tile gets a green finish-line accent (tick + name colour) so the strip
 * visually reads as a journey ending in a win — in both selected and unselected states.
 */
function StageTile({ stage, count, total, selected, onSelect, tileRef, formatAmount }) {
  const accentClass = `stage-tile--${stage.toLowerCase()}`;
  const isPaid = stage === 'Paid';

  // Lead has no £ value; £0 reads as a failure state — both render a faint em-dash instead
  const isEmpty = stage === 'Lead' || total === 0;
  const amountText = isEmpty ? '—' : '£' + formatAmount(total);
  const amountClass = isEmpty ? 'stage-tile-amount stage-tile-amount--empty' : 'stage-tile-amount';

  return (
    <button
      ref={tileRef}
      type="button"
      className={`stage-tile ${accentClass}${selected ? ' stage-tile--selected' : ''}${isPaid ? ' stage-tile--paid-finish' : ''}`}
      onClick={() => onSelect(stage)}
      aria-pressed={selected}
    >
      {/* Paid tile: small tick sits above the stage name as a finish-line cue */}
      {isPaid && (
        <svg
          className="stage-tile-paid-tick"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
        >
          <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {stage === 'Overdue' && (
        <span className="stage-tile-alert-dot" aria-hidden="true" />
      )}
      <span className="stage-tile-name">{stage.toUpperCase()}</span>
      <span className="stage-tile-count">{count} {count === 1 ? 'job' : 'jobs'}</span>
      <span className={amountClass}>{amountText}</span>
    </button>
  );
}

/**
 * readCoachmarkSeen — pure function so tests can call it directly.
 * Returns true when the localStorage flag is present.
 */
export function readCoachmarkSeen() {
  try {
    return !!localStorage.getItem(COACHMARK_KEY);
  } catch {
    return false; // localStorage unavailable (private browsing / SSR)
  }
}

/**
 * writeCoachmarkSeen — persists the flag; idempotent.
 */
export function writeCoachmarkSeen() {
  try {
    localStorage.setItem(COACHMARK_KEY, '1');
  } catch {
    // private mode / storage full — silently swallow; the coachmark will reappear
    // on the next visit but that's an acceptable edge case.
  }
}

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
