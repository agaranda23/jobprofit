// DEFAULT_PAYMENT_TERMS_DAYS is the single source of truth for net-N default.
// Imported from chaseLadder.js so isOverdue and daysPastDue (chaseLadder)
// can never drift independently when the default changes.
import { DEFAULT_PAYMENT_TERMS_DAYS } from './chaseLadder.js';

// Re-export so callers can reference it from jobStatus if they prefer.
export { DEFAULT_PAYMENT_TERMS_DAYS };

// This file is the single source of truth for job stage display logic.
//
// Canonical pipeline stages (six): Lead · Quoted · On · Invoiced · Overdue · Paid
// These are the stage names shown in the UI (StageStrip, JobDetailDrawer badge,
// job tile chip). All new code must derive stage from deriveDisplayStatus() below.
//
// `deriveStatus(job)` is retained for legacy internal uses that key off the old
// lifecycle model (draft / completed / invoice_sent / awaiting / paid). It is not
// used for any visible UI stage label.
//
// Legacy jobs without the canonical `status` field fall back to subordinate fields
// (paid, paymentStatus, jobStatus, completedAt, invoiceSentAt). This lets old
// records resolve correctly without a DB migration.

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

// -- Six-stage display derivation -------------------------------------------
// Canonical overdue check. Rule:
//   1. If invoiceDueDate is set, compare local-midnight dates (due < today).
//   2. Else fall back to daysSinceInvoice > DEFAULT_PAYMENT_TERMS_DAYS (net-7).
//
// Both use local-time midnight (setHours(0,0,0,0)). At the BST/GMT changeover
// the local clock shifts by 1 hour, which can make "today" land on the wrong
// UTC day for sub-millisecond boundary cases; however both sides of the
// comparison use the SAME local-time rounding so the relative result is stable.
// A pure UTC comparison would not change user-visible behaviour because due dates
// are YYYY-MM-DD calendar dates, not timestamps. Treat this as current behaviour;
// any future change must ship independently with its own test coverage.
export function isOverdue(job) {
  if (job?.invoiceDueDate) {
    const due = new Date(job.invoiceDueDate);
    due.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due < today;
  }
  const days = daysSinceInvoice(job);
  return days !== null && days > DEFAULT_PAYMENT_TERMS_DAYS;
}

/**
 * Derive one of the six pipeline stage labels from a raw job record.
 *
 * Stages: Lead · Quoted · On · Invoiced · Overdue · Paid
 *
 * Priority order:
 *   1. Canonical `status` field — written by stagePatch() on every stage move.
 *   2. Subordinate legacy fields — for records predating the canonical column.
 *
 * Returns 'Lead' for null/undefined jobs (safe default, no throw).
 *
 * This is the single source of truth for stage display. Both WorkScreen tile
 * labels and the JobDetailDrawer badge import from here — they must show the
 * same word as each other and as the pipeline strip.
 */
export function deriveDisplayStatus(job) {
  if (!job) return 'Lead';
  // Canonical status field takes priority — short-circuit before any subordinate
  // field checks so residual jobStatus/paymentStatus from a previous Paid state
  // cannot override a deliberate stage move.
  if (job.status === 'lead') return 'Lead';
  if (job.status === 'quoted') return 'Quoted';
  if (job.status === 'paid') return 'Paid';
  if (job.status === 'active') return 'On';
  if (job.status === 'complete') return 'On';
  if (job.status === 'invoice_sent') {
    if (job.overdue === true) return 'Overdue'; // manual override wins over date-driven check
    if (isOverdue(job)) return 'Overdue';
    return 'Invoiced';
  }
  // Subordinate field fallbacks — for legacy jobs that pre-date the canonical
  // status column and for jobs written by older code paths.
  if (job.paid || job.paymentStatus === 'paid' || job.jobStatus === 'paid') return 'Paid';
  // Overdue must be checked before Invoiced — overdue takes priority
  if (job.invoiceStatus === 'invoiced') {
    if (isOverdue(job)) return 'Overdue';
    return 'Invoiced';
  }
  // complete-but-not-invoiced → On: work done, invoice not sent yet
  if (job.jobStatus === 'complete') return 'On';
  if (job.jobStatus === 'active') return 'On';
  return 'Lead';
}

// -- Price guard (canonical stage model) ------------------------------------
// Used by WorkScreen tile CTAs, StageChipDropdown advance guard, and
// JobDetailDrawer controls -- single definition so the rule can't drift.

/**
 * Returns true when the job has no usable price.
 * Both null/undefined AND 0 are treated as "no price".
 */
export function needsPrice(job) {
  const v = job?.total ?? job?.amount;
  return v == null || Number(v) <= 0;
}

/**
 * Stages that claim or display money. Moving into any of these without a price
 * is a data-integrity error (you'd be quoting, invoicing, or marking paid with
 * no figure attached). "On" is deliberately excluded -- work can start before a
 * price is agreed and the job can be priced later before invoicing.
 */
export const MONEY_STAGES = new Set(['Quoted', 'Invoiced', 'Overdue', 'Paid']);

/**
 * Returns true when moving to `targetStage` requires a price to be set first.
 * Source stage is irrelevant -- the rule is target-only.
 */
export function requiresPriceForStage(job, targetStage) {
  return needsPrice(job) && MONEY_STAGES.has(targetStage);
}

/**
 * Maps a canonical stage name to the status fields the DB expects.
 * Mirrors the stageMap inside StageChipDropdown.moveToStage -- extracted here
 * so the drawer's handleAmountSave can apply a stage advance in a single write.
 *
 * Only ADD new stages here; do not rename existing keys.
 */
export function stagePatch(stage) {
  // Belt-and-braces: non-Paid stages explicitly clear every subordinate paid
  // signal (jobStatus, paymentStatus, paidAt) AND the overdue manual-override
  // flag so moving a job back from Overdue to Invoiced (or any earlier stage)
  // does not leave it stranded on the Overdue tile.
  // Spread order in Overdue entry: ...cleared BEFORE overdue:true so the
  // explicit true wins (later spread key beats earlier -- JS object spread rule).
  const cleared = { jobStatus: null, paymentStatus: null, paidAt: null, overdue: false };
  const map = {
    Lead:     { status: 'lead',         paid: false, invoiceStatus: null, ...cleared },
    Quoted:   { status: 'quoted',        paid: false, invoiceStatus: null, ...cleared },
    On:       { status: 'active',        paid: false, invoiceStatus: null, ...cleared },
    Invoiced: { status: 'invoice_sent',  paid: false, invoiceStatus: 'invoiced', ...cleared },
    Overdue:  { status: 'invoice_sent',  paid: false, invoiceStatus: 'invoiced', ...cleared, overdue: true },
    Paid:     { status: 'paid',          paid: true,  invoiceStatus: 'invoiced', paidAt: new Date().toISOString() },
  };
  return map[stage] ?? {};
}
