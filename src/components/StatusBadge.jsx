import { deriveDisplayStatus } from '../lib/jobStatus';
import Icon from './Icon';

// Pill badge sourced from deriveDisplayStatus — the canonical six-stage helper.
// Previously used the legacy deriveStatus (five "internal" states like "draft",
// "invoice_sent") which diverged from the stage words shown in the job tile and
// the StageStrip. Now both sources of truth agree.

// Colour palette mirrors the STAGE_META hues in WorkScreen (explicit hex, no
// color-mix() — keeps Safari 15 compatible).
// fg values that exactly match design tokens use var() — others kept as hex until a token lands.
// bg values are opacity-modulated rgba — no token match; left as-is.
const STAGE_COLORS = {
  Lead:     { bg: 'rgba(59,130,246,0.15)', fg: '#93bbf6' },           // #93bbf6: no token
  Quoted:   { bg: 'rgba(179,240,213,0.18)', fg: '#1E8A5C' },          // #1E8A5C: no token
  On:       { bg: 'rgba(95,217,166,0.18)', fg: 'var(--grn-invoiced)' },  // #28B581 == --grn-invoiced
  Invoiced: { bg: 'rgba(40,181,129,0.18)', fg: 'var(--grn-invoiced)' },  // #28B581 == --grn-invoiced
  Overdue:  { bg: 'rgba(229,72,77,0.15)', fg: '#E5484D' },            // #E5484D ≠ --danger (#ef4444)
  Paid:     { bg: 'rgba(14,107,67,0.20)', fg: 'var(--grn-invoiced)' },   // #28B581 == --grn-invoiced
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
