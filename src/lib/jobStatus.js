// Job lifecycle: draft → completed → invoice_sent → awaiting → paid.
//
// `deriveStatus(job)` is the single source of truth. New code writes the
// new `status` field; legacy jobs without it fall back to the old fields
// (paid, paymentStatus, jobStatus, completedAt, invoiceSentAt). This lets
// PRD #3 ship without migrating existing rows.

export const STATUSES = ['draft', 'completed', 'invoice_sent', 'awaiting', 'paid'];

export const STATUS_LABELS = {
  draft: 'Draft',
  completed: 'Ready to invoice',
  invoice_sent: 'Invoice sent',
  awaiting: 'Awaiting payment',
  paid: 'Paid',
};

export function deriveStatus(job) {
  if (!job) return 'draft';
  if (job.status) return job.status;
  if (job.paid || job.paymentStatus === 'paid') return 'paid';
  if (job.invoiceSentAt) return 'awaiting';
  if (job.invoiceStatus === 'invoiced' && job.paymentStatus !== 'paid') return 'awaiting';
  if (job.completedAt || job.jobStatus === 'complete') return 'completed';
  return 'draft';
}

export function isAwaitingPayment(job) {
  const s = deriveStatus(job);
  return s === 'invoice_sent' || s === 'awaiting';
}

export function daysSinceInvoice(job) {
  if (!job?.invoiceSentAt) return null;
  const ms = Date.now() - new Date(job.invoiceSentAt).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
