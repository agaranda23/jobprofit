import { deriveStatus, STATUS_LABELS } from '../lib/jobStatus';

// Single badge per job, sourced from deriveStatus. Replaces the legacy
// dual-badge pattern (jobStatus + paymentStatus side by side) which often
// duplicated information. Inline color values rather than T.* tokens —
// the existing token set doesn't have a complete 5-state palette and
// scope creep into the design tokens belongs in a follow-up.
const STATUS_COLORS = {
  draft:        { bg: '#E5E7EB', fg: '#374151' }, // grey
  completed:    { bg: '#FEF3C7', fg: '#92400E' }, // yellow — action needed
  invoice_sent: { bg: '#DBEAFE', fg: '#1E40AF' }, // blue
  awaiting:     { bg: '#FED7AA', fg: '#9A3412' }, // orange — getting urgent
  paid:         { bg: '#D1FAE5', fg: '#065F46' }, // green
};

export default function StatusBadge({ job, size = 'sm' }) {
  const status = deriveStatus(job);
  const { bg, fg } = STATUS_COLORS[status] || STATUS_COLORS.draft;
  const label = STATUS_LABELS[status] || status;
  const padding = size === 'sm' ? '3px 8px' : '5px 12px';
  const fontSize = size === 'sm' ? 11 : 13;

  return (
    <span style={{
      display: 'inline-block',
      padding,
      borderRadius: 999,
      background: bg,
      color: fg,
      fontSize,
      fontWeight: 700,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}
