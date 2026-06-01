/**
 * chaseTierHelpers.js — pure tier/overdue helpers shared between:
 *   - netlify/functions/chase-reminders.js  (scheduled function, server-side)
 *   - src/lib/chaseLadder.js re-exports these via the client build
 *
 * No browser globals, no React, no localStorage — safe to import anywhere.
 *
 * Tier definitions (mirrors chaseLadder.js — single source of truth):
 *   0      — pre-due (daysPastDue < 0)
 *   'grace' — daysPastDue in [0, 1): just flipped Overdue, silent window
 *   1      — daysPastDue in [1, 7)  — light
 *   2      — daysPastDue in [7, 14) — firm
 *   3      — daysPastDue >= 14      — final / heavy
 *
 * The server-side chase-reminders function imports ONLY this file so no
 * browser-only code (localStorage) ever touches the function bundle.
 */

export const DEFAULT_PAYMENT_TERMS_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Calculates days past the invoice due date.
 *
 * Priority: invoiceDueDate → invoiceSentAt + DEFAULT_PAYMENT_TERMS_DAYS.
 * Returns negative for pre-due, 0 for due-today, positive for overdue.
 *
 * @param {object} job
 * @param {Date}   [_now]
 * @returns {number}
 */
export function daysPastDueShared(job, _now = new Date()) {
  if (!job) return 0;

  let dueDate;

  if (job.invoiceDueDate) {
    dueDate = new Date(job.invoiceDueDate);
    dueDate.setHours(0, 0, 0, 0);
  } else if (job.invoiceSentAt) {
    dueDate = new Date(job.invoiceSentAt);
    dueDate.setHours(0, 0, 0, 0);
    dueDate.setDate(dueDate.getDate() + DEFAULT_PAYMENT_TERMS_DAYS);
  } else {
    return 0;
  }

  const today = new Date(_now);
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - dueDate) / MS_PER_DAY);
}

/**
 * Computes the chase tier from the job's overdue age.
 *
 * @param {object} job
 * @param {Date}   [_now]
 * @returns {number|'grace'}
 */
export function computeTierShared(job, _now = new Date()) {
  const days = daysPastDueShared(job, _now);
  if (days >= 14) return 3;
  if (days >= 7)  return 2;
  if (days >= 1)  return 1;
  if (days >= 0)  return 'grace';
  return 0;
}

/**
 * Decides whether to send a push reminder for a job right now.
 *
 * Cadence rules (caller passes current state from jobs.meta):
 *   - Never push for tier 0 or 'grace'.
 *   - Push once per tier escalation: push only if currentTier > lastRemindedTier
 *     (or no reminder has ever been sent for this job).
 *   - Tier 3 re-reminder: once already reminded at tier 3, re-remind at most
 *     weekly (every 7 days) while still unpaid.
 *
 * @param {{
 *   currentTier:      number,          // computed by computeTierShared
 *   chaseRemindedTier: number|null,    // from jobs.meta (null = never reminded)
 *   chaseRemindedAt:   string|null,    // ISO timestamp from jobs.meta (null = never)
 * }} params
 * @param {Date} [_now]
 * @returns {boolean}
 */
export function shouldSendChaseReminder({ currentTier, chaseRemindedTier, chaseRemindedAt }, _now = new Date()) {
  // Never push for non-actionable tiers
  if (currentTier === 0 || currentTier === 'grace') return false;

  // First reminder ever for this job
  if (chaseRemindedTier === null || chaseRemindedTier === undefined) return true;

  // Tier escalated — new tier is higher than last reminded tier
  if (currentTier > chaseRemindedTier) return true;

  // Tier 3 re-reminder: already reminded at tier 3 — re-remind weekly
  if (currentTier === 3 && chaseRemindedTier === 3 && chaseRemindedAt) {
    const lastMs = new Date(chaseRemindedAt).getTime();
    const nowMs  = _now.getTime();
    const daysSince = (nowMs - lastMs) / MS_PER_DAY;
    return daysSince >= 7;
  }

  // Already reminded at this tier (and it's not tier 3 re-remind) — skip
  return false;
}
