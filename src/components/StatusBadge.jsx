import { deriveDisplayStatus } from '../lib/jobStatus';
import Icon from './Icon';

// Pill badge sourced from deriveDisplayStatus — the canonical six-stage helper.
// Previously used the legacy deriveStatus (five "internal" states like "draft",
// "invoice_sent") which diverged from the stage words shown in the job tile and
// the StageStrip. Now both sources of truth agree.

// Colour palette mirrors the STAGE_META hues in WorkScreen (explicit hex, no
// color-mix() — keeps Safari 15 compatible).
const STAGE_COLORS = {
  Lead:     { bg: 'rgba(59,130,246,0.15)', fg: '#93bbf6' },
  Quoted:   { bg: 'rgba(179,240,213,0.18)', fg: '#1E8A5C' },
  On:       { bg: 'rgba(95,217,166,0.18)', fg: '#28B581' },
  Invoiced: { bg: 'rgba(40,181,129,0.18)', fg: '#28B581' },
  Overdue:  { bg: 'rgba(229,72,77,0.15)', fg: '#E5484D' },
  Paid:     { bg: 'rgba(14,107,67,0.20)', fg: '#28B581' },
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
  // Stage-label token: both sm and default now resolve to --fs-stage (13px / 0.8125rem).
  // Previously 11px (sm) / 13px (lg) — the floor rule collapses these to the same token.
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
      borderRadius: 999,
      background: bg,
      color: fg,
      fontSize: 'var(--fs-stage)',
      fontWeight: 'var(--fw-stage)',
      lineHeight: 'var(--lh-stage)',
      whiteSpace: 'nowrap',
    }}>
      {iconName && <Icon name={iconName} size={12} />}
      {stage}
    </span>
  );
}
