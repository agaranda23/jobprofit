/**
 * postPaidCost.js — back-off / mute engine for the post-paid cost-capture prompt.
 *
 * The £0 honesty check fires on the cost-capture surface when a job is marked
 * paid with no costs logged. This module encapsulates every decision about whether
 * the prompt should fire, and updates back-off state when the user dismisses it.
 *
 * All state lives in localStorage so it survives page reload and works offline.
 * No React, no DOM — pure functions the UI calls.
 *
 * Storage keys
 * ─────────────
 *   jp.costPrompt.mutedJobs    JSON array of job IDs that have already shown
 *                              the prompt (once-per-job cap).
 *
 *   jp.costPrompt.lastDayShown YYYY-MM-DD — the date the prompt last fired.
 *                              Used for the ~once-per-day cap.
 *
 *   jp.costPrompt.dismissals   Integer — consecutive dismissals without any
 *                              cost added. Resets to 0 on a cost save.
 *                              Reaches 3 → auto-mute (remind_job_costs → false).
 */

// ── Constants ──────────────────────────────────────────────────────────────────

export const COST_PROMPT_INCOME_FLOOR = 100;   // £100 minimum income
const MAX_CONSECUTIVE_DISMISSALS = 3;          // auto-mute threshold

const KEY_MUTED_JOBS  = 'jp.costPrompt.mutedJobs';
const KEY_LAST_DAY    = 'jp.costPrompt.lastDayShown';
const KEY_DISMISSALS  = 'jp.costPrompt.dismissals';

// ── localStorage helpers ───────────────────────────────────────────────────────

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getMutedJobs() {
  try { return JSON.parse(localStorage.getItem(KEY_MUTED_JOBS) || '[]'); }
  catch { return []; }
}

function addMutedJob(jobId) {
  const list = getMutedJobs();
  if (!list.includes(jobId)) {
    list.push(jobId);
    try { localStorage.setItem(KEY_MUTED_JOBS, JSON.stringify(list)); } catch { /* quota */ }
  }
}

function getLastDayShown() {
  return localStorage.getItem(KEY_LAST_DAY) || '';
}

function setLastDayShown(dateStr) {
  try { localStorage.setItem(KEY_LAST_DAY, dateStr); } catch { /* quota */ }
}

export function getDismissalCount() {
  return parseInt(localStorage.getItem(KEY_DISMISSALS) || '0', 10);
}

function setDismissalCount(n) {
  try { localStorage.setItem(KEY_DISMISSALS, String(n)); } catch { /* quota */ }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Determines whether the £0 honesty check should display.
 *
 * @param {object} params
 * @param {string} params.jobId         — the job that was just paid
 * @param {number} params.jobIncome     — the job's income value (£)
 * @param {number} params.jobCostTotal  — sum of costs already logged against the job (£)
 * @param {boolean} params.remindJobCosts — profile.remind_job_costs (default true)
 * @param {boolean} [params.isPartialPayment] — true when only a deposit/partial was recorded
 * @param {boolean} [params.isBulkPaid]       — true when from bulk mark-paid action
 *
 * @returns {boolean}
 */
export function shouldShowCostPrompt({
  jobId,
  jobIncome,
  jobCostTotal,
  remindJobCosts,
  isPartialPayment = false,
  isBulkPaid = false,
}) {
  // Hard-off gates — V1 scope
  if (isPartialPayment) return false;
  if (isBulkPaid) return false;

  // User has switched the reminder off
  if (remindJobCosts === false) return false;

  // Income floor
  if (jobIncome < COST_PROMPT_INCOME_FLOOR) return false;

  // Job already has costs → show "+ Add more" variant, not the £0 question
  // This gate is checked here so callers can derive `variant` themselves;
  // shouldShowCostPrompt returns true either way when costs exist — the caller
  // checks jobCostTotal > 0 to pick the right copy.
  // (If costs exist, we still show the prompt but with different copy — no gate.)

  // Once-per-job cap
  if (getMutedJobs().includes(jobId)) return false;

  // ~Once-per-day cap
  if (getLastDayShown() === today()) return false;

  return true;
}

/**
 * Called immediately before showing the prompt so state is recorded correctly
 * even if the user navigates away without tapping anything.
 */
export function recordPromptShown(jobId) {
  addMutedJob(jobId);
  setLastDayShown(today());
}

/**
 * Called when the user dismisses without adding a cost ("Nothing to add" /
 * "This one's labour-only" / backdrop dismiss / snackbar ✕).
 *
 * Returns the new dismissal count. When count reaches MAX_CONSECUTIVE_DISMISSALS,
 * the caller must write `remind_job_costs: false` to the profile.
 *
 * @returns {{ count: number, shouldAutoMute: boolean }}
 */
export function recordDismissal() {
  const prev = getDismissalCount();
  const next = prev + 1;
  setDismissalCount(next);
  return {
    count: next,
    shouldAutoMute: next >= MAX_CONSECUTIVE_DISMISSALS,
  };
}

/**
 * Called when the user successfully saves a cost.
 * Resets the consecutive dismissal counter.
 */
export function recordCostSaved() {
  setDismissalCount(0);
}

/**
 * Returns the correct variant for the prompt surface:
 *   'zero'     — job has £0 costs, fire the honesty check copy
 *   'add_more' — job already has costs, show the lighter "+ Add more" copy
 *
 * Callers only render the prompt when shouldShowCostPrompt() returned true.
 */
export function costPromptVariant(jobCostTotal) {
  return jobCostTotal > 0 ? 'add_more' : 'zero';
}
