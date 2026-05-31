// Pure helpers for the part-paid tile chip.
// No DOM, no React — safe to import in unit tests without Supabase env vars.
//
// The chip renders on a JobTile when:
//   1. stage is Invoiced or Overdue (awaiting-payment stages only)
//   2. computeAmountPaid(job) > 0  — at least one payment recorded
//   3. computeBalance(job) > 0     — not yet fully cleared
//
// Label format: "70% paid · £300 left"

import { computeAmountPaid, computeBalance } from './payments.js'; // computeBalance used by shouldShowPartPaidChip

const AWAITING_PAYMENT_STAGES = new Set(['Invoiced', 'Overdue']);

/**
 * Returns true when the part-paid chip should render for the given job + stage.
 *
 * @param {object} job
 * @param {string} stage — derived display stage (one of the 6 pipeline stages)
 * @returns {boolean}
 */
export function shouldShowPartPaidChip(job, stage) {
  if (!AWAITING_PAYMENT_STAGES.has(stage)) return false;
  const paid = computeAmountPaid(job);
  if (paid <= 0) return false;
  return computeBalance(job) > 0;
}

/**
 * Formats the part-paid chip label.
 *
 * - percent: Math.round(amountPaid / total * 100)
 * - balance: total - amountPaid, rounded to whole pounds, en-GB comma separator
 *
 * Both percent and balance use the same total (job.total preferred over job.amount)
 * so the figures are always self-consistent on the tile.
 *
 * Example: "70% paid · £300 left"
 *
 * @param {object} job
 * @returns {string}
 */
export function formatPartPaidLabel(job) {
  const total = Number(job.total ?? job.amount ?? 0) || 0;
  const paid = computeAmountPaid(job);
  // Derive balance from the same total used for the percentage — keeps the two
  // figures consistent when job.total and job.amount differ.
  const balance = total - paid;
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  const balanceStr = Math.round(balance).toLocaleString('en-GB', { minimumFractionDigits: 0 });
  return `${pct}% paid · £${balanceStr} left`;
}
