/**
 * chaseList.js — builds the sorted "needs chasing" list for the Chase
 * Reminders Settings panel.
 *
 * A job qualifies when ALL of:
 *   1. It has an invoice sent (invoiceSentAt is set OR invoiceStatus === 'invoiced'
 *      OR status === 'invoice_sent' OR the legacy awaiting/overdue paymentStatus).
 *   2. It is NOT paid (isPaidJob returns false).
 *   3. It is NOT cancelled/draft.
 *   4. daysPastDue(job) >= 1 — the grace window (day 0) is silent per chaseLadder spec.
 *      Jobs due in the future or in the 24h grace window are excluded.
 *
 * Sort: most urgent first = highest daysPastDue first. Ties broken by
 * outstanding amount descending (largest debt wins).
 *
 * Each output row carries:
 *   id, customer, summary, outstanding, daysPastDue, tier
 *
 * "outstanding" = job.total ?? job.amount (pre-payment-partial-pay simplification).
 * The partial-payments TODO in cashflow.js applies here too — for a Tier-2 PR
 * use computeBalance(job) once that's reliably populated on all job shapes.
 *
 * Pure function — no React, no DOM, no side effects. Unit-testable.
 */

import { daysPastDue, computeTier } from './chaseLadder.js';
import { isPaidJob, isExcludedJob as isExcluded } from './jobPredicates.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if the job has had an invoice sent, regardless of which shape
 * the job record uses (cloud canonical, legacy, or interim).
 */
function hasInvoiceSent(job) {
  if (!job) return false;
  if (job.invoiceSentAt) return true;
  if (job.status === 'invoice_sent') return true;
  if (job.invoiceStatus === 'invoiced') return true;
  // Legacy paymentStatus shapes
  const ps = (job.paymentStatus || '').toLowerCase();
  if (ps === 'awaiting' || ps === 'overdue') return true;
  // Overdue manual override flag
  if (job.overdue === true) return true;
  return false;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * @typedef {object} ChaseRow
 * @property {string|number} id
 * @property {string} customer
 * @property {string} summary
 * @property {number} outstanding
 * @property {number} daysPastDue
 * @property {number|'grace'} tier
 */

/**
 * Builds the sorted chase list from all jobs.
 *
 * @param {object[]} jobs
 * @param {Date}     [_now]  — injectable for tests
 * @returns {ChaseRow[]}
 */
export function buildChaseList(jobs, _now = new Date()) {
  const safeJobs = Array.isArray(jobs) ? jobs : [];

  const rows = [];

  for (const job of safeJobs) {
    if (isExcluded(job)) continue;
    if (isPaidJob(job)) continue;
    if (!hasInvoiceSent(job)) continue;

    const dpd = daysPastDue(job, _now);
    // Exclude pre-due (negative) and grace window (0 = just flipped overdue today)
    if (dpd < 1) continue;

    const tier = computeTier(job, _now);

    rows.push({
      id: job.id,
      customer: job.customer || job.name || job.customerName || 'Customer',
      summary: job.summary || '',
      outstanding: Number(job.total ?? job.amount ?? 0) || 0,
      daysPastDue: dpd,
      tier,
    });
  }

  // Most urgent first: highest daysPastDue; ties by outstanding descending
  rows.sort((a, b) => {
    if (b.daysPastDue !== a.daysPastDue) return b.daysPastDue - a.daysPastDue;
    return b.outstanding - a.outstanding;
  });

  return rows;
}
