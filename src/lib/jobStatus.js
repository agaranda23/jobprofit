// TODO(stage-cleanup): This file uses a legacy lifecycle model
// (draft → completed → invoice_sent → awaiting → paid) that disagrees with
// the canonical stage model used in StageStrip.jsx and JobsScreen.jsx
// (Lead → Quoted → On → Invoiced → Overdue → Paid).
// Do NOT use this file for tile rendering or stage display logic.
// Clean up in a dedicated follow-up PR — do not touch in the tile redesign branch.
//
// `deriveStatus(job)` is the single source of truth for legacy code. New code writes the
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

// ── Price guard (canonical stage model) ─────────────────────────────────────
// Used by WorkScreen tile CTAs, StageChipDropdown advance guard, and
// JobDetailDrawer controls — single definition so the rule can't drift.

/**
 * Returns true when the job has no usable price.
 * Both null/undefined AND 0 are treated as "no price".
 */
export function needsPrice(job) {
  const v = job?.total ?? job?.amount;
  return v == null || Number(v) <= 0;
}

/**
 * Maps a canonical stage name to the status fields the DB expects.
 * Mirrors the stageMap inside StageChipDropdown.moveToStage — extracted here
 * so the drawer's handleAmountSave can apply a stage advance in a single write.
 *
 * Only ADD new stages here; do not rename existing keys.
 */
export function stagePatch(stage) {
  const map = {
    Lead:     { status: 'lead',         paid: false, invoiceStatus: null },
    Quoted:   { status: 'quoted',        paid: false, invoiceStatus: null },
    On:       { status: 'active',        paid: false, invoiceStatus: null },
    Invoiced: { status: 'invoice_sent',  paid: false, invoiceStatus: 'invoiced' },
    Overdue:  { status: 'invoice_sent',  paid: false, invoiceStatus: 'invoiced', overdue: true },
    Paid:     { status: 'paid',          paid: true,  invoiceStatus: 'invoiced', paidAt: new Date().toISOString() },
  };
  return map[stage] ?? {};
}
