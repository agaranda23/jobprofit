import { deriveDisplayStatus } from '../lib/jobStatus';
import { stageToFilledCount } from '../lib/pipelineProgress';

/**
 * JobProgressDots — compact 4-segment progress bar for job tiles.
 *
 * Shows where a job sits in the Quote → On → Invoice → Paid pipeline.
 * Overdue is treated as a sub-state of Invoiced (same pipeline position,
 * but the Invoiced segment is coloured red when stage === Overdue).
 *
 * Segment colours mirror the STAGE_META hues from WorkScreen. Explicit hex
 * values avoid color-mix() for Safari 15 compatibility.
 *
 * Props:
 *   job  — raw job record (passed to deriveDisplayStatus)
 */

// Four logical loop steps — matches the "Get Paid loop" framing.
const STEPS = ['Quoted', 'On', 'Invoiced', 'Paid'];

// Colour for each filled segment (matches WorkScreen STAGE_META hues).
// Token mapping verified byte-identical. #0E6B43 ≠ --grn-paid (#18865A) — left as hex until
// the paid dot colour is reconciled with the token palette.
const SEGMENT_COLORS = {
  Quoted:   'var(--grn-quoted)',   // #B3F0D5 == --grn-quoted
  On:       'var(--grn-on)',       // #5FD9A6 == --grn-on
  Invoiced: 'var(--grn-invoiced)', // #28B581 == --grn-invoiced
  Paid:     '#0E6B43',             // no token: #0E6B43 ≠ --grn-paid (#18865A)
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
          bg = '#E5484D';
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
