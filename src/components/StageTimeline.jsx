/**
 * StageTimeline — milestone timeline for the job detail drawer.
 *
 * Reads timestamps that exist on the job object and renders them as a
 * vertical timeline. Future/not-yet-reached milestones are shown muted.
 *
 * Verified field names against the codebase:
 *   createdAt      — always present (set at insert in store.js addJobToCloud)
 *   quoteSentAt    — set in JobDetailDrawer handleMarkSent / handleSendLink
 *   acceptedAt     — set in JobDetailDrawer on quote acceptance (sigpad + remote)
 *   completedAt    — set in JobDetailDrawer handleEndJob / handleMarkVisitDone (last visit)
 *   invoiceSentAt  — set in ReviewSheet / SendInvoiceModal after invoice send
 *   paidAt         — set in stagePatch('Paid') and markJobPaid
 *
 * Fields that do NOT exist on the job schema and are NOT used here:
 *   — no "quoteCreatedAt" (creation = createdAt)
 *   — no separate "invoiceDraftAt"
 */

/** Format ISO or YYYY-MM-DD to short en-GB date string. Returns '' for falsy. */
function fmtShort(raw) {
  if (!raw) return '';
  try {
    const d = raw.length === 10 ? new Date(raw + 'T00:00:00') : new Date(raw);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}

// Six milestones in pipeline order.
// Each has a label, the job field that holds its timestamp, and a muted hint
// shown when the milestone hasn't been reached yet.
const MILESTONES = [
  { key: 'created',  label: 'Job created',    field: 'createdAt',     hint: '' },
  { key: 'quoted',   label: 'Quote sent',      field: 'quoteSentAt',   hint: 'Not sent yet' },
  { key: 'accepted', label: 'Quote accepted',  field: 'acceptedAt',    hint: 'Not accepted yet' },
  { key: 'active',   label: 'Work started',    field: 'completedAt',   hint: null }, // completedAt proxies job end; start is implicit
  { key: 'invoiced', label: 'Invoice sent',    field: 'invoiceSentAt', hint: 'Not invoiced yet' },
  { key: 'paid',     label: 'Paid',            field: 'paidAt',        hint: 'Not paid yet' },
];

// Overrides for the "active" milestone — we use completedAt as the "work ended"
// marker, but we label it "Work completed" when present and skip it entirely
// when absent (a job can be invoiced without ever setting completedAt — e.g.
// a Quote-to-Invoice path with no explicit "End job" action).
// The `hint: null` above means "don't render a muted future row for this step."

export default function StageTimeline({ job }) {
  if (!job) return null;

  // Filter to milestones that should appear. A milestone appears when:
  //   1. Its timestamp field is set (reached), OR
  //   2. It has a non-null hint (show as future/pending).
  // Milestones with hint:null and no timestamp are silently omitted.
  const visible = MILESTONES.filter(m => {
    const ts = job[m.field];
    if (ts) return true;
    return m.hint !== null;
  });

  // Don't render anything if only "Job created" is present with no activity.
  if (visible.length <= 1) return null;

  return (
    <div className="stage-timeline" aria-label="Job history timeline" role="list">
      {visible.map((m, idx) => {
        const ts = job[m.field];
        const isReached = !!ts;
        const isFirst = idx === 0;

        return (
          <div
            key={m.key}
            className={`stage-timeline__item${isReached ? ' stage-timeline__item--reached' : ' stage-timeline__item--future'}`}
            role="listitem"
          >
            {/* Connector line — before every item except the first */}
            {!isFirst && (
              <div
                className={`stage-timeline__line${isReached ? ' stage-timeline__line--reached' : ''}`}
                aria-hidden="true"
              />
            )}

            {/* Dot */}
            <div
              className={`stage-timeline__dot${isReached ? ' stage-timeline__dot--reached' : ''}`}
              aria-hidden="true"
            />

            {/* Content */}
            <div className="stage-timeline__content">
              <span className={`stage-timeline__label${!isReached ? ' stage-timeline__label--muted' : ''}`}>
                {m.label}
              </span>
              {isReached ? (
                <span className="stage-timeline__date">{fmtShort(ts)}</span>
              ) : (
                <span className="stage-timeline__hint">{m.hint}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
