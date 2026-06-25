/**
 * WorkflowCircles — OHNAR six-stage workflow circle component.
 *
 * Replaces the four-segment JobProgressDots bar with a six-circle horizontal
 * track: Lead · Quoted · On · Invoiced · Overdue · Paid.
 *
 * Two size variants:
 *   variant="compact"  — Job Card row: small circles, no text labels.
 *   variant="full"     — Job Detail: larger circles + Lucide icons + labels;
 *                        primary status visual at the top of the drawer.
 *
 * Circle states (from workflowCircles.js):
 *   future     — white fill, navy outline, navy icon
 *   completed  — success green fill, white checkmark
 *   current    — OHNAR Blue fill, white icon, slight scale + shadow emphasis
 *   overdue    — red fill + exclamation icon
 *   skipped    — muted fill + dashed ring (paid WITHOUT going overdue)
 *   was-overdue — success green fill + faint red outline ring (paid after overdue)
 *
 * Design tokens used (all defined in index.css):
 *   --wf-current, --wf-complete, --wf-future-bg, --wf-future-outline,
 *   --wf-skipped-bg, --wf-skipped-outline, --wf-overdue, --wf-paid,
 *   --wf-was-overdue-ring, --wf-connector, --wf-connector-done
 *
 * Paid transition: CSS class .wfc--paid-anim triggers a ~300ms scale+opacity
 * transition when the job moves into Paid. Applied when the current stage is Paid.
 * Respects prefers-reduced-motion (animation shortened to 0ms via CSS media query).
 *
 * Accessibility:
 *   - Outer wrapper has aria-label announcing the full stage (e.g. "Job stage: Invoiced").
 *   - Overdue variant appends "— overdue" to the aria-label.
 *   - Individual circles are aria-hidden (the wrapper label covers the reading).
 */

import { deriveDisplayStatus } from '../lib/jobStatus';
import { deriveCircleStates, deriveWasOverdue, WORKFLOW_STAGES } from '../lib/workflowCircles';
import Icon from './Icon';

// ── Icon map (semantic names from Icon.jsx REGISTRY) ────────────────────────
// Pick the closest Lucide name for each stage.
const STAGE_ICONS = {
  Lead:     'user',          // User (ClipboardList alias exists as 'lead' too)
  Quoted:   'file',          // FileText
  On:       'job',           // Briefcase
  Invoiced: 'receipt',       // ReceiptText
  Overdue:  'clock',         // Clock (AlertTriangle is warning; clock = time-sensitive)
  Paid:     'check',         // Check
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

/**
 * Build a human-readable aria-label for the whole component.
 * Example: "Job stage: Invoiced — overdue"
 */
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
        const iconName = state === 'completed' ? 'check' : (state === 'overdue' ? 'overdue' : STAGE_ICONS[s]);
        const iconVariant = 'inherit';
        // The Paid circle gets a paid-animation class when the job IS paid
        const paidAnim = (s === 'Paid' && isPaid) ? ' wfc__circle--paid-anim' : '';

        return (
          <div key={s} className={`wfc__step wfc__step--${state}`} aria-hidden="true">
            {/* Connector line before every circle except the first */}
            {!isFirst && (
              <div
                className={`wfc__connector${(state === 'completed' || (state === 'was-overdue') || (state === 'skipped' && idx > 0 && circles[idx - 1]?.state === 'completed')) ? ' wfc__connector--done' : ''}`}
              />
            )}

            {/* Circle */}
            <div className={`wfc__circle wfc__circle--${state}${paidAnim}`}>
              {isFull && (
                <Icon
                  name={iconName}
                  size={state === 'current' ? 16 : 14}
                  variant={iconVariant}
                />
              )}
              {!isFull && state === 'completed' && (
                /* Compact variant: tiny check-mark on completed circles via CSS pseudo only.
                   No icon component rendered here to keep the compact bar lean. */
                null
              )}
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
