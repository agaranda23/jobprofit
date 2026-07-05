/**
 * todayPulse.js — pure helpers for the Today "pulse" dopamine cards.
 *
 * Three glanceable, REAL-DATA-ONLY status cards shown at the top of Today:
 *   1. Waiting to collect — total £ across sent-but-unpaid invoices
 *   2. Jobs on           — count of jobs currently in progress ("On" stage)
 *   3. Week-over-week    — this week's paid total vs last week's, ONLY shown
 *      when there's a genuine prior week to compare against, and only when
 *      it's a real improvement — never a fabricated or negative "win".
 *
 * Every figure is computed directly from the jobs array already loaded into
 * TodayScreen. No invented numbers, no placeholder zeros dressed up as data —
 * see project memory: ad-safe-feature-truth (never fabricate a metric). Each
 * card is deliberately left OUT of the row (not shown with a fake £0 / "0
 * jobs" figure) when there isn't real, meaningful data behind it — that's a
 * product decision made here, in one place, rather than scattered through
 * TodayScreen's render.
 */
import { isAwaitingPayment, deriveDisplayStatus } from './jobStatus';
import { jobAmount } from './nextBestAction';

const DAY_MS = 86400000;

/**
 * Total £ across every job currently invoiced-and-unpaid (sent but not yet
 * paid) — broader than the Tier-1 "overdue" pool used elsewhere on Today,
 * this is the full "money that's out there" figure, due or not yet due.
 *
 * @param {Array} jobs
 * @returns {number}
 */
export function waitingToCollectTotal(jobs = []) {
  return jobs.filter(isAwaitingPayment).reduce((sum, j) => sum + jobAmount(j), 0);
}

/**
 * Count of jobs currently "On" (active / in-progress) — the canonical single
 * source of truth for this stage is deriveDisplayStatus (see jobStatus.js),
 * so this stays in lockstep with the Jobs-tab pipeline labels.
 *
 * @param {Array} jobs
 * @returns {number}
 */
export function jobsOnCount(jobs = []) {
  return jobs.filter(j => deriveDisplayStatus(j) === 'On').length;
}

function jobTimestamp(job) {
  return new Date(job?.date || job?.createdAt || 0).getTime();
}

function paidAmount(job) {
  if (job?.paid === false) return 0;
  return jobAmount(job);
}

/**
 * This-week vs last-week paid totals.
 *
 * hasComparison is false whenever there's no job at all dated in the PRIOR
 * 7-day window — a brand-new trader (or one who only started this week) has
 * no real "last week" to be compared against, and showing "£0 ahead of last
 * week" in that case would be comparing against a week that never happened
 * for them. Callers must hide the card rather than fabricate a baseline.
 *
 * @param {Array} jobs
 * @param {Date} [now]
 * @returns {{ thisWeekTotal: number, lastWeekTotal: number, delta: number, hasComparison: boolean }}
 */
export function weekOverWeek(jobs = [], now = new Date()) {
  const nowMs = now.getTime();
  const thisWeekStart = nowMs - 7 * DAY_MS;
  const lastWeekStart = nowMs - 14 * DAY_MS;

  const thisWeekJobs = jobs.filter(j => {
    const t = jobTimestamp(j);
    return t >= thisWeekStart && t <= nowMs;
  });
  const lastWeekJobs = jobs.filter(j => {
    const t = jobTimestamp(j);
    return t >= lastWeekStart && t < thisWeekStart;
  });

  const thisWeekTotal = thisWeekJobs.reduce((s, j) => s + paidAmount(j), 0);
  const lastWeekTotal = lastWeekJobs.reduce((s, j) => s + paidAmount(j), 0);

  return {
    thisWeekTotal,
    lastWeekTotal,
    delta: thisWeekTotal - lastWeekTotal,
    hasComparison: lastWeekJobs.length > 0,
  };
}
