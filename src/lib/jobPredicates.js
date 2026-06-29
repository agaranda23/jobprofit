/**
 * jobPredicates.js — shared pure predicates for "is this job paid?" and
 * "should this job be excluded from financial aggregations?".
 *
 * Extracted from cashflow.js / chaseList.js / exportCsv.js, which each carried
 * an identical copy. Single source of truth so the definition of "paid" and
 * "excluded" can never drift between the Money tab, the chase list, and exports.
 *
 * Pure functions — no React, no DOM, no side effects.
 */

/**
 * Determines whether a job is paid, normalising across cloud and legacy shapes.
 *
 * Cloud: job.paid === true
 * Legacy: job.paymentStatus === 'paid'
 * applyAutoFlip also sets status='paid' — treat that as paid too.
 */
export function isPaidJob(job) {
  if (!job) return false;
  if (job.paid === true) return true;
  if (job.paymentStatus === 'paid') return true;
  if (job.status === 'paid') return true;
  return false;
}

/**
 * Determines whether a job should be excluded from all aggregations.
 * Cancelled or draft jobs have no financial meaning.
 */
export function isExcludedJob(job) {
  if (!job) return true;
  const s = (job.status || job.jobStatus || '').toLowerCase();
  const ps = (job.paymentStatus || '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled' || s === 'draft') return true;
  if (ps === 'cancelled' || ps === 'canceled') return true;
  return false;
}
