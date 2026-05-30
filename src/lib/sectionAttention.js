/**
 * sectionAttention.js — Derives which drawer sections need attention.
 *
 * Pure function — no side effects, no React.
 * Called once per render in JobDetailDrawer; results passed as `needsAttention`
 * prop into each CollapsedSectionRow.
 *
 * "Needs attention" means: the Next Step cannot complete without a gap being filled.
 * We read the same state that deriveNextStepContent() uses — no new derivation logic,
 * no growth of nextStepContent.js.
 *
 * Rules (from PRD 2026-05-30, page 3):
 *   Quote:    quote is draft (not yet sent) AND job is past Lead stage
 *   Costs:    job is past Active AND zero costs logged AND job is older than 3 days
 *   Customer: (next step = send invoice AND no email) OR
 *             (next step = chase customer AND no phone)
 *
 * @param {object} job                – full job object
 * @param {object} nextStepContent    – output of deriveNextStepContent()
 * @param {Array}  receipts           – flat receipts array from AppShell
 * @returns {{ quote: boolean, costs: boolean, customer: boolean }}
 */
export function sectionsNeedingAttention(job, nextStepContent, receipts = []) {
  const action = nextStepContent?.primaryCta?.action ?? '';

  // ── Quote attention ────────────────────────────────────────────────────────
  // Quote is a draft (not sent) and the job is past Lead
  const quoteIsDraft = !job.quoteStatus || job.quoteStatus === 'draft';
  const isPastLead = job.status !== 'lead' && !!job.status;
  const quoteAttention = quoteIsDraft && isPastLead;

  // ── Costs attention ────────────────────────────────────────────────────────
  // Soft nudge: past Active stage, zero costs logged, job is older than 3 days
  const isPastActive =
    job.status === 'invoice_sent' ||
    job.status === 'complete' ||
    job.status === 'paid' ||
    job.jobStatus === 'complete' ||
    job.jobStatus === 'paid';

  const jobReceipts = receipts.filter(r => {
    if (!r.jobId) return false;
    return String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId);
  });
  const zeroCosts = jobReceipts.length === 0;

  const jobDateRaw = job.date || job.createdAt || null;
  let olderThan3Days = false;
  if (jobDateRaw) {
    const diffMs = Date.now() - new Date(jobDateRaw).getTime();
    olderThan3Days = diffMs > 3 * 24 * 60 * 60 * 1000;
  }
  const costsAttention = isPastActive && zeroCosts && olderThan3Days;

  // ── Customer attention ─────────────────────────────────────────────────────
  const hasPhone = !!(job.customerPhone || job.phone || job.mobile);
  const hasEmail = !!(job.email || job.customerEmail);

  const needsInvoice = action === 'openInvoiceModal';
  const needsChase   = action === 'handleChase';

  const customerAttention =
    (needsInvoice && !hasEmail) ||
    (needsChase && !hasPhone);

  return {
    quote:    quoteAttention,
    costs:    costsAttention,
    customer: customerAttention,
  };
}
