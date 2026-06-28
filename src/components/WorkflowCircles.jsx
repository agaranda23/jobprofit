/**
 * WorkflowCircles — OHNAR six-stage brand-cycle component.
 *
 * Redesigned (feat/workflow-circles-brand-cycle) to match the brand graphic:
 * each stage is a COLOURED RING with its stage ICON inside, in that stage's
 * signature colour. Progress is vivid-vs-muted — reached stages are vivid,
 * future stages are uniformly greyed.
 *
 * Two size variants:
 *   variant="compact"  — Job Card row: coloured rings + stage icons, no text labels.
 *                        Rings are 26px (current=28px) so icons are legible on a
 *                        one-handed mobile tap. Card becomes slightly taller —
 *                        expected; all existing card elements still lay out correctly.
 *   variant="full"     — Job Detail: larger rings + Lucide icons + labels;
 *                        primary status visual at the top of the drawer.
 *
 * Per-stage colours (canonical --stage-* tokens from index.css):
 *   Lead      → --stage-lead     (#2563EB, blue)
 *   Quoted    → --stage-quoted   (#0EA5B7, teal)
 *   On        → --stage-on       (#6366F1, indigo — distinct from Paid green)
 *   Invoiced  → --stage-invoiced (#F59E0B, amber)
 *   Overdue   → --stage-overdue  (#F97316, orange)
 *   Paid      → --stage-paid     (#16A34A, deep green)
 *
 * Each step receives --circle-colour as an inline CSS custom property so the
 * shared state classes (vivid/muted) can resolve the correct hue without extra
 * per-stage class permutations. Future/skipped circles ignore --circle-colour
 * (overridden to --wf-future-ring via !important in the CSS state classes).
 *
 * Circle states (from workflowCircles.js — unchanged):
 *   future      — muted grey ring + muted grey icon (--wf-future-ring/icon)
 *   completed   — vivid coloured ring + icon
 *   current     — vivid coloured ring + icon + scale(1.12) + glow
 *   overdue     — vivid orange ring + icon + scale(1.12) + glow
 *   skipped     — muted dashed ring (Overdue bypassed)
 *   was-overdue — vivid paid-green ring + faint red trace (Paid after overdue)
 *
 * Paid transition: CSS class .wfc__circle--paid-anim triggers ~300ms animation.
 * Respects prefers-reduced-motion (animation: none via CSS media query).
 *
 * Accessibility:
 *   - Outer wrapper has role="img" + aria-label (full stage announced).
 *   - Overdue variant appends "— overdue" to the aria-label.
 *   - Individual circles are aria-hidden.
 */

import { deriveDisplayStatus } from '../lib/jobStatus';
import { deriveCircleStates, deriveConnectorClass, deriveWasOverdue, WORKFLOW_STAGES } from '../lib/workflowCircles';
import Icon from './Icon';

// ── Stage colour tokens — map stage name → CSS custom property ───────────────
// These resolve to the canonical --stage-* tokens defined in index.css.
const STAGE_COLOUR_VAR = {
  Lead:     'var(--stage-lead)',
  Quoted:   'var(--stage-quoted)',
  On:       'var(--stage-on)',
  Invoiced: 'var(--stage-invoiced)',
  Overdue:  'var(--stage-overdue)',
  Paid:     'var(--stage-paid)',
};

// ── Icon map (Lucide names via Icon.jsx REGISTRY) ────────────────────────────
const STAGE_ICONS = {
  Lead:     'user',
  Quoted:   'file',
  On:       'job',
  Invoiced: 'receipt',
  Overdue:  'clock',
  Paid:     'check',
};

// Labels shown only in variant="full"
const STAGE_LABELS = {
  Lead:     'Lead',
  Quoted:   'Quoted',
  On:       'On',
  Invoiced: 'Invoiced',
  Overdue:  'Overdue',
  Paid:     'Paid',
};

/** Build a human-readable aria-label for the whole component. */
function buildAriaLabel(stage) {
  if (stage === 'Overdue') return 'Job stage: Invoiced — overdue';
  return `Job stage: ${stage}`;
}

/**
 * WorkflowCircles
 *
 * Props:
 *   job      {object}  — raw job record; passed to deriveDisplayStatus + deriveWasOverdue
 *   variant  {"compact"|"full"}  — default "compact"
 */
export default function WorkflowCircles({ job, variant = 'compact' }) {
  const stage = deriveDisplayStatus(job);
  const wasOverdue = deriveWasOverdue(job);
  const circles = deriveCircleStates(stage, wasOverdue);
  const isFull = variant === 'full';
  const isPaid = stage === 'Paid';

  return (
    <div
      className={`wfc wfc--${variant}`}
      aria-label={buildAriaLabel(stage)}
      role="img"
    >
      {circles.map(({ stage: s, state }, idx) => {
        const isFirst = idx === 0;
        const colourVar = STAGE_COLOUR_VAR[s];
        const prevState = idx > 0 ? circles[idx - 1].state : null;

        // Icon choice: the stage's own icon for all states, both variants.
        // Compact uses a slightly smaller size so icons sit neatly in the 26px ring.
        const iconName = STAGE_ICONS[s];

        // Paid circle gets the animation class when the job IS paid.
        const paidAnim = (s === 'Paid' && isPaid) ? ' wfc__circle--paid-anim' : '';

        // Icon sizes: full — 16/14px as before; compact — 12/11px (fits 26px ring).
        const isEmphasisState = state === 'current' || state === 'overdue';
        const iconSize = isFull
          ? (isEmphasisState ? 16 : 14)
          : (isEmphasisState ? 12 : 11);

        return (
          <div
            key={s}
            className={`wfc__step wfc__step--${state}`}
            style={{ '--circle-colour': colourVar }}
            aria-hidden="true"
          >
            {/* Connector line before every circle except the first */}
            {!isFirst && (
              <div
                className={`wfc__connector${deriveConnectorClass(prevState, state)}`}
              />
            )}

            {/* Circle — coloured ring with stage icon inside (both variants) */}
            <div className={`wfc__circle wfc__circle--${state}${paidAnim}`}>
              <Icon
                name={iconName}
                size={iconSize}
                variant="inherit"
              />
            </div>

            {/* Label — full variant only */}
            {isFull && (
              <span className="wfc__label">{STAGE_LABELS[s]}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
