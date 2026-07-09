import { deriveDisplayStatus } from '../lib/jobStatus';
import { stageToFilledCount } from '../lib/pipelineProgress';

/**
 * JobProgressDots — compact 4-segment progress bar for job tiles.
 *
 * Shows where a job sits in the Quote → On → Invoice → Paid pipeline.
 * Overdue is treated as a sub-state of Invoiced (same pipeline position,
 * but the Invoiced segment is coloured red when stage === Overdue).
 *
 * Segment colours are repointed (jobs-premium-pass Phase 2) onto the ONE
 * canonical --stage-* palette (index.css :root) — the same source StatusBadge
 * and StageStrip read from. Previously this map used the legacy --grn-* family
 * (mint/indigo/mint-adjacent hexes with no Overdue entry at all) plus a
 * hardcoded #0E6B43 for Paid that matched nothing else in the app. Explicit
 * var()/hex values still avoid color-mix() for Safari 15 compatibility.
 *
 * NOTE: this component is not currently rendered anywhere in the app
 * (superseded by WorkflowCircles — see the "replaced by WorkflowCircles"
 * comment in WorkScreen.jsx) — verified by grep. Repointed for token hygiene
 * so it isn't a landmine if it's ever reactivated; there is no live visual
 * change from this edit.
 *
 * Props:
 *   job  — raw job record (passed to deriveDisplayStatus)
 */

// Four logical loop steps — matches the "Get Paid loop" framing.
const STEPS = ['Quoted', 'On', 'Invoiced', 'Paid'];

// Colour for each filled segment — canonical --stage-* hues.
const SEGMENT_COLORS = {
  Quoted:   'var(--stage-quoted)',
  On:       'var(--stage-on)',
  Invoiced: 'var(--stage-invoiced)',
  Paid:     'var(--stage-paid)',
};

export default function JobProgressDots({ job }) {
  const stage = deriveDisplayStatus(job);
  const filled = stageToFilledCount(stage);
  const isOverdue = stage === 'Overdue';

  return (
    <div
      className="jp-dots"
      role="img"
      aria-label={`Pipeline: ${stage}`}
      title={stage}
    >
      {STEPS.map((step, idx) => {
        const isFilled = idx < filled;
        // The Invoiced dot (idx 2) gets an overdue colour when stage === Overdue.
        const isOverdueDot = isOverdue && idx === 2;
        let bg;
        if (isOverdueDot) {
          // Repointed red (#E5484D) → canonical --stage-overdue (orange #F97316),
          // jobs-premium-pass Phase 2 — flagged for founder eyeballing: this is a
          // deliberate hue change (danger-red → canonical orange), not a bugfix
          // to an already-orange value. Dead component (see file header) so
          // there is no live visual change from this edit.
          bg = 'var(--stage-overdue)';
        } else if (isFilled) {
          bg = SEGMENT_COLORS[step] || 'var(--accent)';
        } else {
          bg = 'rgba(255,255,255,0.12)';
        }

        return (
          <span
            key={step}
            className={`jp-dot${isFilled ? ' jp-dot--filled' : ''}${isOverdueDot ? ' jp-dot--overdue' : ''}`}
            style={{ background: bg }}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}
