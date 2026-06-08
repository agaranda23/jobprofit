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
  const padding = size === 'sm' ? '3px 8px' : '5px 12px';
  const fontSize = size === 'sm' ? 11 : 13;
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
      fontSize,
      fontWeight: 700,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
    }}>
      {iconName && <Icon name={iconName} size={12} />}
      {stage}
    </span>
  );
}
