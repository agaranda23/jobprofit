import { deriveDisplayStatus } from '../lib/jobStatus';
import Icon from './Icon';

// Pill badge sourced from deriveDisplayStatus — the canonical six-stage helper.
// Previously used the legacy deriveStatus (five "internal" states like "draft",
// "invoice_sent") which diverged from the stage words shown in the job tile and
// the StageStrip. Now both sources of truth agree.

// Colour palette — repointed (jobs-premium-pass Phase 2) onto the ONE canonical
// --stage-* palette (index.css :root), the same source StatusBadge, StageStrip
// and WorkScreen's tile rail now all read from. Previously this map had its own
// hardcoded hexes that disagreed with the pipeline (e.g. Quoted rendered green
// here, teal in StageStrip) — the exact "parallel palette" bug this pass exists
// to remove. Quoted is now teal, Overdue is orange (never red/green), On is
// indigo, Paid is the one true green.
// bg: the static --stage-tint-* tint scale (Phase 0/1) — precomputed per-theme
// rgba, NOT color-mix() (Safari 15 drops an invalid color-mix() background
// entirely, so every load-bearing tint here is a literal rgba via a CSS var).
// fg: the canonical solid --stage-* hue, reused as-is rather than inventing a
// second per-stage/per-theme pastel ink matrix (that duplication is exactly
// what the palette unification is trying to collapse). NOTE: this component
// is not currently rendered anywhere in the app (superseded by WorkflowCircles
// / .jt-stage-name) — verified by grep, so this repoint is unverified-in-browser
// token hygiene; re-check contrast with a real render before wiring it back up.
const STAGE_COLORS = {
  Lead:     { bg: 'var(--stage-tint-lead)',     fg: 'var(--stage-lead)' },
  Quoted:   { bg: 'var(--stage-tint-quoted)',   fg: 'var(--stage-quoted)' },
  On:       { bg: 'var(--stage-tint-on)',       fg: 'var(--stage-on)' },
  Invoiced: { bg: 'var(--stage-tint-invoiced)', fg: 'var(--stage-invoiced)' },
  Overdue:  { bg: 'var(--stage-tint-overdue)',  fg: 'var(--stage-overdue)' },
  Paid:     { bg: 'var(--stage-tint-paid)',     fg: 'var(--stage-paid)' },
};

const STAGE_ICON = {
  Lead:     'lead',
  Quoted:   'quote-sent',
  On:       'active-job',
  Invoiced: 'invoice',
  Overdue:  'overdue',
  Paid:     'paid',
};

export default function StatusBadge({ job, size = 'sm' }) {
  const stage = deriveDisplayStatus(job);
  const { bg, fg } = STAGE_COLORS[stage] || STAGE_COLORS.Lead;
  // Stage-label token: both sm and default use --fs-label (13px / 0.8125rem).
  // Previously --fs-stage (same value, now merged into --fs-label to remove the duplicate).
  // CSS custom properties are picked up automatically because fontSize is expressed as a
  // CSS var() string; the browser resolves it against the element's computed style.
  const padding = size === 'sm' ? '3px 10px' : '5px 12px';
  const iconName = STAGE_ICON[stage];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding,
      borderRadius: 'var(--radius-pill)',
      background: bg,
      color: fg,
      fontSize: 'var(--fs-label)',
      fontWeight: 'var(--fw-stage)',
      lineHeight: 'var(--lh-stage)',
      whiteSpace: 'nowrap',
    }}>
      {iconName && <Icon name={iconName} size={12} />}
      {stage}
    </span>
  );
}
