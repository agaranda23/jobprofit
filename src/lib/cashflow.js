// Pure data layer for the Money-tab redesign (PR-M1).
// No React, no DOM, no side effects, no imports from AppShell.
//
// Currency assumption: GBP only. The jobs table has no currency field and the
// app has never supported multi-currency. If that changes, normalise at the
// store layer before passing data here.
//
// Job shape normalisation — both shapes produce the same result:
//   Cloud (store.js mapCloudJobToToday):
//     job.paid          : boolean
//     job.date          : YYYY-MM-DD (already = payment_date ?? date from mapper)
//     job.createdAt     : ISO datetime
//     job.payments      : [] (Phase A placeholder; jobMeta overlay adds real values)
//   Legacy (localStorage via store.js addTodayJob):
//     job.paymentStatus : 'paid' | 'unpaid' | 'awaiting' | 'completed' | ...
//     job.paymentDate   : YYYY-MM-DD | ''
//     job.date          : YYYY-MM-DD
//     job.createdAt     : ISO datetime
//
// Partial payments (PR #15 payments.js):
//   When job.payments[] is non-empty, sum it to determine how much has been
//   received. computeBalance(job) = job.amount - sumPayments tells us the
//   outstanding balance. A job is "partially paid" when computeBalance > 0
//   but payments.length > 0 — it contributes to both paid (amount received)
//   and open (amount outstanding).
//
//   TODO (follow-up): full cash-basis reconciliation where partial-payment
//   jobs split across "paid" and "open" buckets within getCashflowByMonth.
//   Current implementation: a job is treated as fully paid when isPaidJob()
//   returns true, or as open when it returns false. Partial payments on
//   "awaiting" jobs contribute to the open bucket at their full amount.
//   This is conservative and correct for the initial release.

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Returns YYYY-MM-DD in local timezone. Mirrors store.js localDateString().
 */
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parses a YYYY-MM-DD string to a local-midnight Date. Returns null on failure.
 * Never uses new Date(str) directly — that parses as UTC midnight, which drifts
 * to the prior day in GMT+1 (UK summer).
 */
function parseLocalDate(str) {
  if (!str || typeof str !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  if (isNaN(d.getTime())) return null;
  return d;
}

import { isPaidJob, isExcludedJob } from './jobPredicates.js';

/**
 * Returns the effective "earned" date for a paid job: payment_date → date.
 * For open jobs, returns the issue/created date for bucketing.
 * Returns null if no usable date.
 */
function jobEarnedDate(job) {
  if (!job) return null;
  // Cloud mapper already collapses payment_date ?? date into job.date when paid
  // Legacy uses job.paymentDate for paid jobs
  const candidates = [
    job.paymentDate,
    job.date,
    job.createdAt,
  ];
  for (const c of candidates) {
    const d = parseLocalDate(typeof c === 'string' ? c.slice(0, 10) : null);
    if (d) return d;
  }
  return null;
}

/**
 * Returns the effective "open/issued" date for an unpaid job.
 * Uses date → createdAt.
 */
function jobIssuedDate(job) {
  if (!job) return null;
  const candidates = [job.date, job.createdAt];
  for (const c of candidates) {
    const d = parseLocalDate(typeof c === 'string' ? c.slice(0, 10) : null);
    if (d) return d;
  }
  return null;
}

/**
 * Returns the deposit amount received for a job (PR 4).
 * Only non-zero when deposit_paid_at is set (webhook confirmed).
 * If the job is also paid in full, the deposit is included in the full payment —
 * callers must NOT double-count. See depositAlreadyInFullPayment() guard below.
 */
function jobDepositReceived(job) {
  if (!job) return 0;
  if (!job.deposit_paid_at) return 0;
  if (job.deposit_amount_pence) return job.deposit_amount_pence / 100;
  // Fallback: calculate from percent
  const total = Number(job.total ?? job.amount ?? 0);
  const pct = Number(job.deposit_percent ?? 0);
  if (!total || !pct) return 0;
  return Math.round(total * pct) / 100;
}

/**
 * Returns the amount received for a job.
 * If job.payments[] is present and non-empty, sums those.
 * Otherwise falls back to job.amount for fully-paid jobs.
 * When the job has a paid deposit but is NOT yet fully paid, adds the deposit
 * as received revenue (decision locked: deposit counts as revenue immediately).
 */
function jobReceivedAmount(job) {
  if (!job) return 0;
  if (Array.isArray(job.payments) && job.payments.length > 0) {
    const explicit = job.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    // Deposit may already be in payments[] if a future payments integration records it.
    // For now, add deposit only when explicit payments don't already cover it.
    return explicit;
  }
  if (isPaidJob(job)) return Number(job.amount ?? 0);
  // Not fully paid: add deposit if present (deposit counts as revenue immediately)
  return jobDepositReceived(job);
}

/**
 * Returns the outstanding balance for a job.
 * Uses payments[] if present; otherwise full amount for unpaid, 0 for paid.
 */
function jobOutstandingAmount(job) {
  if (!job) return 0;
  const amount = Number(job.amount || 0);
  if (Array.isArray(job.payments) && job.payments.length > 0) {
    const paid = job.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    return Math.max(0, amount - paid);
  }
  if (isPaidJob(job)) return 0;
  return amount;
}

// ─── Exported date helpers ───────────────────────────────────────────────────

/**
 * Returns the start of the UK tax year containing `now`.
 * Rule: on/after 6 April → 6 April of the current calendar year;
 *       before 6 April   → 6 April of the previous calendar year.
 * Time is set to 00:00:00 local.
 *
 * Examples:
 *   2026-05-28 → 2026-04-06
 *   2026-02-10 → 2025-04-06
 *   2026-04-06 → 2026-04-06  (on the day — counts as new year)
 *   2026-04-05 → 2025-04-06  (one day before — still last year)
 *
 * @param {Date} [now]
 * @returns {Date}
 */
export function taxYearStart(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const day = now.getDate();
  // On or after 6 April (month >= 3, i.e. April=3, and if month === 3 day >= 6)
  const isOnOrAfterApr6 = month > 3 || (month === 3 && day >= 6);
  const startYear = isOnOrAfterApr6 ? year : year - 1;
  return new Date(startYear, 3, 6); // April = month index 3, day 6
}

/**
 * Returns a human-readable UK tax year label, e.g. "2026/27".
 * The label year is the start year / start year + 1 (last two digits).
 *
 * @param {Date} [now]
 * @returns {string} e.g. "2026/27"
 */
export function taxYearLabel(now = new Date()) {
  const start = taxYearStart(now);
  const startYear = start.getFullYear();
  const endYearShort = String(startYear + 1).slice(-2);
  return `${startYear}/${endYearShort}`;
}

/**
 * Resolves per-job CIS state given the job's meta fields and the user's profile.
 *
 * Rules:
 *   - If profile.is_cis_subcontractor is false/falsy → job is never CIS (rate=0 sentinel).
 *   - If job.cis is explicitly false → this specific job opted out of CIS.
 *   - If job.cis is true or undefined (for CIS users) → CIS applies.
 *   - Rate resolves: job.cisRate ?? profile.cis_default_rate ?? 20.
 *   - Gross (0%) jobs: CIS applies but deduction = £0; their profit still counts
 *     toward the set-aside base (gross subbies owe all tax themselves).
 *
 * Returns { isCisJob: boolean, rate: 0|20|30 }
 * When isCisJob is false, rate is always 0.
 *
 * @param {object} job
 * @param {object} profile
 * @returns {{ isCisJob: boolean, rate: number }}
 */
export function resolveCisStatus(job, profile) {
  if (!profile?.is_cis_subcontractor) return { isCisJob: false, rate: 0 };
  // Explicit per-job opt-out
  if (job.cis === false) return { isCisJob: false, rate: 0 };
  // Gross Payment Status at profile level means CIS applies but 0% rate
  const rate = job.cisRate != null ? Number(job.cisRate) : Number(profile.cis_default_rate ?? 20);
  return { isCisJob: true, rate };
}

/**
 * Aggregates jobs and receipts across the current UK tax year up to `now`.
 * Uses the same paid/earned-date and cost logic as getMonthSummary, so YTD
 * figures reconcile with monthly ones.
 *
 * A paid job earned on taxYearStart(now) counts; one earned on the day before
 * does not (it belongs to last year).
 *
 * When profile.is_cis_subcontractor is true, the function also returns:
 *   cisDeductedYtd   — total CIS already deducted by contractors this year.
 *                      Formula: Σ over paid CIS jobs of max(0, quote−materials) × rate/100.
 *   nonCisProfit     — profit from non-CIS paid jobs (and Gross-0% CIS jobs) that
 *                      the user still owes Self Assessment tax on.
 *   excludedFromTax  — profit excluded from both calcs via job.excludeFromTax.
 * For non-CIS users these are 0 / profit / 0 — identical to the pre-CIS behaviour.
 *
 * @param {object[]} jobs
 * @param {object[]} receipts
 * @param {Date} [now]
 * @param {object} [profile]
 * @returns {{ profit: number, paid: number, cisDeductedYtd: number, nonCisProfit: number, excludedFromTax: number }}
 */
export function getTaxYearSummary(jobs, receipts, now = new Date(), profile = null) {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];

  const start = taxYearStart(now);
  // Normalise `now` to end-of-day so today's records are included.
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  let paid = 0;
  let cost = 0;
  let cisDeductedYtd = 0;
  let nonCisProfit = 0;
  let excludedFromTax = 0;

  // Pre-build a per-job receipt map so we can derive labour for CIS calcs
  // without an O(n²) inner loop.
  const receiptsByJob = new Map();
  for (const receipt of safeReceipts) {
    if (!receipt) continue;
    const keys = [];
    if (receipt.jobId != null) keys.push(String(receipt.jobId));
    for (const k of keys) {
      if (!receiptsByJob.has(k)) receiptsByJob.set(k, 0);
      receiptsByJob.set(k, receiptsByJob.get(k) + Number(receipt.amount || 0));
    }
  }

  for (const job of safeJobs) {
    if (isExcludedJob(job)) continue;
    if (!isPaidJob(job)) continue;
    const d = jobEarnedDate(job);
    if (!d) continue;
    if (d < start || d > end) continue;

    paid += jobReceivedAmount(job);

    // Job materials = sum of receipts linked to this job (same logic as getJobProfit).
    // We look up by both id and cloudId to match the receipt filter used in the UI.
    const jobId = String(job.id ?? '');
    const cloudId = job.cloudId != null ? String(job.cloudId) : null;
    const jobMaterials =
      (receiptsByJob.get(jobId) ?? 0) +
      (cloudId && cloudId !== jobId ? (receiptsByJob.get(cloudId) ?? 0) : 0);

    const quote = Number(job.total ?? job.amount ?? 0);
    const jobProfit = quote - jobMaterials;

    // excludeFromTax: remove from all tax calc buckets.
    // The job still contributes to cashflow (paid is already added above).
    if (job.excludeFromTax) {
      excludedFromTax += jobProfit;
      continue;
    }

    const { isCisJob, rate } = resolveCisStatus(job, profile);

    if (isCisJob && rate > 0) {
      // Deducting-CIS job: the contractor already withheld tax on the labour portion.
      // Labour = max(0, quote − materials). Clamp to 0 when materials exceed quote.
      const labour = Math.max(0, quote - jobMaterials);
      const deduction = labour * (rate / 100);
      cisDeductedYtd += deduction;
      // This job's profit does NOT count toward the set-aside base —
      // the advance deduction already covers it.
    } else {
      // Non-CIS job, explicitly opted-out job, or Gross-0% CIS job:
      // profit counts toward the set-aside base (gross subbies owe all tax themselves).
      nonCisProfit += jobProfit;
    }
  }

  for (const receipt of safeReceipts) {
    if (!receipt) continue;
    const dateStr = receipt.date || (receipt.createdAt ? receipt.createdAt.slice(0, 10) : null);
    const d = parseLocalDate(dateStr);
    if (!d) continue;
    if (d < start || d > end) continue;
    cost += Number(receipt.amount || 0);
  }

  return {
    // profit: overall YTD P&L, unchanged from pre-CIS behaviour.
    // Non-CIS users: cisDeductedYtd=0, nonCisProfit=profit, excludedFromTax=0.
    profit: paid - cost,
    paid,
    cisDeductedYtd,
    // nonCisProfit: per-job profit sum for jobs that belong to the set-aside base.
    // Does not deduct global receipt costs (those are already in profit).
    // Used only for the set-aside base calculation: max(0, nonCisProfit) * pct.
    nonCisProfit,
    excludedFromTax,
  };
}

/**
 * Returns a YYYY-MM key for a date. Uses local timezone.
 * @param {Date} d
 * @returns {string} e.g. '2026-03'
 */
export function monthKey(d) {
  if (!d || !(d instanceof Date) || isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Returns a human-readable label for a YYYY-MM key.
 * @param {string} key e.g. '2026-03'
 * @returns {string} e.g. 'Mar 2026'
 */
export function monthLabel(key) {
  if (!key || typeof key !== 'string') return '';
  const [y, m] = key.split('-');
  if (!y || !m) return key;
  const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  if (isNaN(d.getTime())) return key;
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/**
 * Returns a Date set to the first day of the month, N months before `now`.
 * Safe on boundary: monthsAgo(1) on 2026-03-01 returns 2026-02-01.
 *
 * @param {number} monthsBack - 1, 3, 6, or 12
 * @param {Date}   [now]      - injectable for tests; defaults to new Date()
 * @returns {Date} first day of the target month at 00:00:00 local
 */
export function monthsAgo(monthsBack, now = new Date()) {
  const n = Math.max(0, Math.round(monthsBack));
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  // Subtract months from zero-based month index; JS Date handles year rollback.
  return new Date(year, month - n, 1);
}

/**
 * Returns { from, to } for a named range key.
 * `from` is the first day of the start month; `to` is the last day of the
 * current month (end of today's month, not truncated to today).
 *
 * @param {'1M'|'3M'|'6M'|'1Y'} rangeKey
 * @param {Date} [now]
 * @returns {{ from: Date, to: Date }}
 */
export function buildDateRange(rangeKey, now = new Date()) {
  const monthMap = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };
  const n = monthMap[rangeKey] ?? 6;
  const from = monthsAgo(n - 1, now); // include current month, look back n-1 more
  // Last day of current month
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from, to };
}

// ─── Primary aggregation ─────────────────────────────────────────────────────

/**
 * Groups jobs and receipts into calendar months between `from` and `to`.
 * Returns months in ascending chronological order. Months with no activity
 * are still included (all zeroes) so the chart never skips a month.
 *
 * Mode determines which fields are meaningful for the chart:
 *   'paid-vs-open'   → paid, open
 *   'profit-vs-cost' → profit, cost
 *   'cash-in-vs-out' → cashIn, cashOut (functionally same as paid-vs-open for now;
 *                       see comment in eng-plan section 5)
 *
 * Exclusions (all modes):
 *   - cancelled / draft jobs
 *   - future-dated paid jobs (payment_date > today)
 *
 * @param {object[]} jobs     - normalised job objects (cloud or legacy shape)
 * @param {object[]} receipts - normalised receipt objects
 * @param {Date}     from     - inclusive start (first day of first month)
 * @param {Date}     to       - inclusive end (last day of last month)
 * @param {'paid-vs-open'|'profit-vs-cost'|'cash-in-vs-out'} [mode]
 * @returns {Array<{
 *   month: string,
 *   monthLabel: string,
 *   paid: number,
 *   open: number,
 *   profit: number,
 *   cost: number,
 *   cashIn: number,
 *   cashOut: number,
 *   total: number,
 * }>}
 */
export function getCashflowByMonth(jobs, receipts, from, to, mode = 'paid-vs-open') {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];

  // Build the ordered list of YYYY-MM keys between from and to.
  const fromKey = monthKey(from instanceof Date ? from : new Date());
  const toKey = monthKey(to instanceof Date ? to : new Date());

  const months = [];
  {
    // Walk month by month from fromKey to toKey
    const [fy, fm] = fromKey.split('-').map(Number);
    const [ty, tm] = toKey.split('-').map(Number);
    let y = fy, m = fm;
    while (y < ty || (y === ty && m <= tm)) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      months.push(key);
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }

  // Initialise buckets
  const buckets = {};
  for (const mk of months) {
    buckets[mk] = { paid: 0, open: 0, cost: 0 };
  }

  const todayStr = localDateStr();

  // Bucket jobs
  for (const job of safeJobs) {
    if (isExcludedJob(job)) continue;

    if (isPaidJob(job)) {
      const d = jobEarnedDate(job);
      if (!d) continue;
      // Exclude future-dated paid records
      const dStr = localDateStr(d);
      if (dStr > todayStr) continue;
      const mk = monthKey(d);
      if (mk in buckets) {
        buckets[mk].paid += jobReceivedAmount(job);
      }
    } else {
      // Open (unpaid) — bucket by issue/created date
      const d = jobIssuedDate(job);
      if (!d) continue;
      const mk = monthKey(d);
      if (mk in buckets) {
        buckets[mk].open += jobOutstandingAmount(job);
      }
    }
  }

  // Bucket receipts (costs)
  for (const receipt of safeReceipts) {
    if (!receipt) continue;
    const dateStr = receipt.date || (receipt.createdAt ? receipt.createdAt.slice(0, 10) : null);
    const d = parseLocalDate(dateStr);
    if (!d) continue;
    const mk = monthKey(d);
    if (mk in buckets) {
      buckets[mk].cost += Number(receipt.amount || 0);
    }
  }

  // Build output rows
  return months.map(mk => {
    const b = buckets[mk];
    const profit = b.paid - b.cost;
    const total = mode === 'profit-vs-cost'
      ? b.paid // use paid as reference for scale in profit-vs-cost
      : mode === 'cash-in-vs-out'
        ? b.paid + b.cost
        : b.paid + b.open;
    return {
      month: mk,
      monthLabel: monthLabel(mk),
      paid: b.paid,
      open: b.open,
      profit,
      cost: b.cost,
      cashIn: b.paid,
      cashOut: b.cost,
      total,
    };
  });
}

// ─── Headline cards ──────────────────────────────────────────────────────────

/**
 * Returns summary totals for a single calendar month.
 *
 * @param {object[]} jobs
 * @param {object[]} receipts
 * @param {{ month: string }} options - YYYY-MM key for the target month
 * @returns {{ profit: number, paid: number, outstanding: number, jobCount: number }}
 */
export function getMonthSummary(jobs, receipts, { month } = {}) {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];
  const mk = month || monthKey(new Date());

  let paid = 0, outstanding = 0, cost = 0, jobCount = 0;

  for (const job of safeJobs) {
    if (isExcludedJob(job)) continue;
    if (isPaidJob(job)) {
      const d = jobEarnedDate(job);
      if (d && monthKey(d) === mk) {
        paid += jobReceivedAmount(job);
        jobCount++;
      }
    } else {
      const d = jobIssuedDate(job);
      if (d && monthKey(d) === mk) {
        outstanding += jobOutstandingAmount(job);
        jobCount++;
      }
    }
  }

  for (const receipt of safeReceipts) {
    if (!receipt) continue;
    const dateStr = receipt.date || (receipt.createdAt ? receipt.createdAt.slice(0, 10) : null);
    const d = parseLocalDate(dateStr);
    if (d && monthKey(d) === mk) {
      cost += Number(receipt.amount || 0);
    }
  }

  return {
    profit: paid - cost,
    paid,
    outstanding,
    jobCount,
  };
}

/**
 * Returns outstanding invoice summary across all unpaid jobs.
 * Used by the Hero card.
 *
 * @param {object[]} jobs
 * @returns {{
 *   totalOwed: number,
 *   invoiceCount: number,
 *   oldestAgeDays: number|null,
 *   oldestCustomerName: string|null,
 *   oldestJobId: string|null,
 * }}
 */
export function getOutstandingSummary(jobs) {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let totalOwed = 0;
  let invoiceCount = 0;
  let oldestDate = null;
  let oldestJob = null;

  for (const job of safeJobs) {
    if (isExcludedJob(job)) continue;
    if (isPaidJob(job)) continue;

    const owed = jobOutstandingAmount(job);
    if (owed <= 0) continue;

    totalOwed += owed;
    invoiceCount++;

    const d = jobIssuedDate(job);
    if (d) {
      if (!oldestDate || d < oldestDate) {
        oldestDate = d;
        oldestJob = job;
      }
    }
  }

  let oldestAgeDays = null;
  if (oldestDate) {
    oldestDate.setHours(0, 0, 0, 0);
    oldestAgeDays = Math.floor((today.getTime() - oldestDate.getTime()) / 86400000);
  }

  return {
    totalOwed,
    invoiceCount,
    oldestAgeDays,
    oldestCustomerName: oldestJob
      ? (oldestJob.name || oldestJob.customer || oldestJob.reference || null)
      : null,
    oldestJobId: oldestJob ? (oldestJob.id || null) : null,
  };
}

/**
 * Returns profit-per-hour estimate for the current and previous week.
 *
 * No explicit hours field exists on jobs. Implied hours are estimated as
 * `job.amount / hourlyRate`. This is the same approximation used in the
 * legacy App.jsx insight cards (line ~378). Always treat the result as an
 * estimate — UI must label it "estimated" or "based on your hourly rate".
 *
 * Returns null if hourlyRate is 0, null, undefined, or if no paid jobs
 * exist in either period.
 *
 * @param {object[]} jobs
 * @param {{ hourlyRate: number, weeks?: number }} options
 * @param {Date} [now]
 * @returns {{
 *   value: number|null,
 *   comparisonValue: number|null,
 *   deltaSign: 'up'|'down'|'flat'|null,
 * }}
 */
export function getProfitPerHour(jobs, { hourlyRate, weeks = 1 } = {}, now = new Date()) {
  const rate = Number(hourlyRate);
  if (!rate || rate <= 0) {
    return { value: null, comparisonValue: null, deltaSign: null };
  }

  const safeJobs = Array.isArray(jobs) ? jobs : [];

  // Week boundaries (Monday-based, local midnight)
  function startOfWeek(d) {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    const day = copy.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day);
    copy.setDate(copy.getDate() + diff);
    return copy;
  }

  const thisWeekStart = startOfWeek(now);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7 * weeks);
  const lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
  lastWeekEnd.setHours(23, 59, 59, 999);

  function profitPerHourForPeriod(startDate, endDate) {
    let totalProfit = 0;
    let totalImpliedHours = 0;
    for (const job of safeJobs) {
      if (isExcludedJob(job)) continue;
      if (!isPaidJob(job)) continue;
      const d = jobEarnedDate(job);
      if (!d) continue;
      if (d < startDate || d > endDate) continue;
      const amount = Number(job.amount || 0);
      const impliedHours = amount / rate;
      // Cost for this job: if receipts are linked via job.expenses[], sum them;
      // otherwise treat cost as zero for this estimate (receipts aren't per-job here).
      const cost = Array.isArray(job.expenses)
        ? job.expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0)
        : 0;
      totalProfit += (amount - cost);
      totalImpliedHours += impliedHours;
    }
    if (totalImpliedHours <= 0) return null;
    return totalProfit / totalImpliedHours;
  }

  const thisWeekEnd = new Date(now);
  thisWeekEnd.setHours(23, 59, 59, 999);

  const value = profitPerHourForPeriod(thisWeekStart, thisWeekEnd);
  const comparisonValue = profitPerHourForPeriod(lastWeekStart, lastWeekEnd);

  let deltaSign = null;
  if (value !== null && comparisonValue !== null) {
    if (value > comparisonValue) deltaSign = 'up';
    else if (value < comparisonValue) deltaSign = 'down';
    else deltaSign = 'flat';
  }

  return { value, comparisonValue, deltaSign };
}

/**
 * Returns the total monthly overhead spend for active items.
 *
 * An item is active when `is_active` is not explicitly `false`
 * (undefined / null / true all count as active — opt-out model).
 *
 * Non-numeric amounts are ignored (treated as 0).
 * Non-array input returns 0 rather than throwing.
 *
 * @param {Array<{ amount: number, is_active?: boolean }>} overheads
 * @returns {number}
 */
export function getOverheadTotal(overheads) {
  if (!Array.isArray(overheads)) return 0;
  return overheads.reduce((sum, item) => {
    if (!item || item.is_active === false) return sum;
    const n = Number(item.amount);
    return sum + (isNaN(n) ? 0 : n);
  }, 0);
}

// ─── Per-job profit ──────────────────────────────────────────────────────────

/**
 * Computes profit, margin, quote, and materials for a single job.
 * Formula mirrors ProfitBarSection in JobDetailDrawer.jsx exactly —
 * any change there must be reflected here (and in the tests).
 *
 * Receipt matching: a receipt belongs to this job when r.jobId matches either
 * job.id (local numeric/string id) or job.cloudId (Supabase UUID). Both are
 * compared as strings to survive mixed number/string shapes.
 *
 * @param {object} job
 * @param {object[]} receipts  — all receipts in the app, not pre-filtered
 * @returns {{ quote: number, materials: number, profit: number, margin: number }}
 */
export function getJobProfit(job, receipts) {
  if (!job) return { quote: 0, materials: 0, profit: 0, margin: 0 };
  const safeReceipts = Array.isArray(receipts) ? receipts : [];

  const quote = Number(job.total ?? job.amount ?? 0);
  const materials = safeReceipts
    .filter(r => r && r.jobId != null && (
      String(r.jobId) === String(job.id) ||
      (job.cloudId != null && String(r.jobId) === String(job.cloudId))
    ))
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const profit = quote - materials;
  const margin = quote > 0 ? Math.round((profit / quote) * 100) : 0;

  return { quote, materials, profit, margin };
}

/**
 * Returns the best and worst jobs by profit within the current UK tax year.
 *
 * "Qualifying" rule — a job must meet ALL of:
 *   1. Not excluded (not cancelled / draft — uses isExcludedJob).
 *   2. Work is done: status signals the job is completed/invoiced/overdue/paid.
 *      Specifically, a job is "done" when:
 *        - isPaidJob() is true (paid in full), OR
 *        - status/jobStatus is one of: completed, invoiced, overdue, sent,
 *          awaiting (work done, awaiting payment — a real outcome worth ranking).
 *      Lead and quoted-only stages are excluded — the job hasn't happened yet.
 *   3. quote > 0 (no revenue means no meaningful margin).
 *   4. The job's effective date falls within the current tax year:
 *        >= taxYearStart(now)  AND  <= end-of-day today.
 *      Date resolution: for paid jobs, the payment/earned date; otherwise the
 *      issue/created date — same logic as jobEarnedDate / jobIssuedDate.
 *
 * @param {object[]} jobs
 * @param {object[]} receipts
 * @param {Date} [now]
 * @returns {{
 *   best:  { id, label, customer, profit, margin } | null,
 *   worst: { id, label, customer, profit, margin } | null,
 * }}
 */
export function getBestWorstJobs(jobs, receipts, now = new Date()) {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];

  const start = taxYearStart(now);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  // Status values that mean "work is done" (case-insensitive match below)
  const DONE_STATUSES = new Set(['completed', 'invoiced', 'overdue', 'sent', 'awaiting', 'paid']);

  const qualifying = [];

  for (const job of safeJobs) {
    if (isExcludedJob(job)) continue;

    // Determine whether work is done
    const status = (job.status || job.jobStatus || '').toLowerCase();
    const paymentStatus = (job.paymentStatus || '').toLowerCase();
    const isDone =
      isPaidJob(job) ||
      DONE_STATUSES.has(status) ||
      DONE_STATUSES.has(paymentStatus);

    if (!isDone) continue;

    const { quote, profit, margin } = getJobProfit(job, safeReceipts);
    if (quote <= 0) continue;

    // Date filter: use earned date for paid jobs, issued date otherwise
    const d = isPaidJob(job) ? jobEarnedDate(job) : jobIssuedDate(job);
    if (!d) continue;
    if (d < start || d > end) continue;

    qualifying.push({
      id: job.id,
      label: job.name || job.customer || job.customerName || 'Job',
      customer: job.customer || job.customerName || job.name || null,
      profit,
      margin,
    });
  }

  if (qualifying.length === 0) return { best: null, worst: null };

  // Sort descending by profit
  qualifying.sort((a, b) => b.profit - a.profit);

  const best = qualifying[0];
  const worst = qualifying.length > 1 ? qualifying[qualifying.length - 1] : null;

  return { best, worst };
}

/**
 * Returns week-over-week margin trend.
 * Margin = (paid - cost) / paid * 100, per period.
 * Returns zeros and 'flat' when no paid jobs exist.
 *
 * @param {object[]} jobs
 * @param {object[]} receipts
 * @param {{ weeks?: number }} options
 * @param {Date} [now]
 * @returns {{
 *   thisWeek: number,
 *   lastWeek: number,
 *   deltaPct: number,
 *   deltaSign: 'up'|'down'|'flat',
 * }}
 */
export function getMarginTrend(jobs, receipts, { weeks = 1 } = {}, now = new Date()) {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];

  function startOfWeek(d) {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    const day = copy.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    copy.setDate(copy.getDate() + diff);
    return copy;
  }

  const thisWeekStart = startOfWeek(now);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7 * weeks);
  const lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
  lastWeekEnd.setHours(23, 59, 59, 999);
  const thisWeekEnd = new Date(now);
  thisWeekEnd.setHours(23, 59, 59, 999);

  function marginForPeriod(startDate, endDate) {
    let paid = 0;
    for (const job of safeJobs) {
      if (isExcludedJob(job)) continue;
      if (!isPaidJob(job)) continue;
      const d = jobEarnedDate(job);
      if (!d || d < startDate || d > endDate) continue;
      paid += jobReceivedAmount(job);
    }
    let cost = 0;
    for (const receipt of safeReceipts) {
      if (!receipt) continue;
      const dateStr = receipt.date || (receipt.createdAt ? receipt.createdAt.slice(0, 10) : null);
      const d = parseLocalDate(dateStr);
      if (!d || d < startDate || d > endDate) continue;
      cost += Number(receipt.amount || 0);
    }
    if (paid <= 0) return 0;
    return ((paid - cost) / paid) * 100;
  }

  const thisWeek = marginForPeriod(thisWeekStart, thisWeekEnd);
  const lastWeek = marginForPeriod(lastWeekStart, lastWeekEnd);

  let deltaPct = 0;
  if (lastWeek !== 0) {
    deltaPct = thisWeek - lastWeek;
  }

  let deltaSign = 'flat';
  if (deltaPct > 0.01) deltaSign = 'up';
  else if (deltaPct < -0.01) deltaSign = 'down';

  return { thisWeek, lastWeek, deltaPct, deltaSign };
}

// ─── Data-trust nudge ────────────────────────────────────────────────────────

/**
 * Returns the single most important data-quality hint for the Money tab, or
 * null when the data looks complete enough to trust.
 *
 * Priority (first match wins):
 *   1. markPaid  — completed/invoiced jobs with unpaid amounts exist this tax year.
 *                  Profit is understated because money is sitting in "open".
 *   2. noCosts   — there IS paid revenue this tax year but zero costs recorded
 *                  (no receipts in range AND overheads total is zero).
 *                  Profit may be overstated.
 *   3. null      — data looks complete enough; show nothing.
 *
 * @param {object[]} jobs
 * @param {object[]} receipts
 * @param {object}   profile    — expects profile.overheads (JSONB array)
 * @param {Date}     [now]
 * @returns {{ type: 'markPaid'|'noCosts', amount?: number, message: string, cta: string } | null}
 */
export function getDataTrustHint(jobs, receipts, profile, now = new Date()) {
  const safeJobs     = Array.isArray(jobs)     ? jobs     : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];

  const start = taxYearStart(now);
  const end   = new Date(now);
  end.setHours(23, 59, 59, 999);

  // Status values that mean "work is done but not yet paid"
  const DONE_STATUSES = new Set(['completed', 'invoiced', 'overdue', 'sent', 'awaiting']);

  // 1. Unpaid completed work this tax year
  let openAmount = 0;
  let paidRevenue = 0;

  for (const job of safeJobs) {
    if (isExcludedJob(job)) continue;

    const d = isPaidJob(job) ? jobEarnedDate(job) : jobIssuedDate(job);
    if (!d || d < start || d > end) continue;

    if (isPaidJob(job)) {
      paidRevenue += jobReceivedAmount(job);
    } else {
      const status        = (job.status        || job.jobStatus      || '').toLowerCase();
      const paymentStatus = (job.paymentStatus || '').toLowerCase();
      const isDone        = DONE_STATUSES.has(status) || DONE_STATUSES.has(paymentStatus);
      if (isDone) {
        openAmount += jobOutstandingAmount(job);
      }
    }
  }

  if (openAmount > 0) {
    return {
      type:    'markPaid',
      amount:  openAmount,
      message: 'Mark jobs paid to see your true profit',
      cta:     'Go to Jobs',
    };
  }

  // 2. Revenue logged but no costs at all
  if (paidRevenue > 0) {
    const overheads = Array.isArray(profile?.overheads) ? profile.overheads : [];
    const hasOverheads = getOverheadTotal(overheads) > 0;

    const hasReceiptsInYear = safeReceipts.some(r => {
      if (!r) return false;
      const dateStr = r.date || (r.createdAt ? r.createdAt.slice(0, 10) : null);
      const d = parseLocalDate(dateStr);
      return d && d >= start && d <= end;
    });

    if (!hasOverheads && !hasReceiptsInYear) {
      return {
        type:    'noCosts',
        message: "It's only counting job costs. Add your monthly bills — van, insurance, phone — and we'll show what you actually keep.",
        cta:     'Add monthly bills →',
      };
    }
  }

  return null;
}

// ─── VAT helpers ─────────────────────────────────────────────────────────────

import { splitVatInclusive } from './vatUtils.js';

/**
 * VAT rate used throughout the app.
 * Shared with invoiceMessage.js and invoicePDF.js via splitVatInclusive().
 * If the rate ever changes, update vatUtils.js only.
 */
export const VAT_RATE = 0.2;

/**
 * Returns the start and end of the current UK calendar VAT quarter, plus a
 * human-readable label.
 *
 * Calendar quarters (v1 assumption — cash-accounting basis):
 *   Q1: Jan–Mar   Q2: Apr–Jun   Q3: Jul–Sep   Q4: Oct–Dec
 *
 * Note: HMRC VAT stagger dates vary by business (some quarters start Feb or Mar).
 * This uses simple calendar quarters for a v1 estimate. The UI carries a
 * "confirm with your accountant" disclaimer.
 *
 * `start` — local midnight of the first day of the quarter.
 * `end`   — end-of-day of `now` (we only count up to today within the quarter).
 * `label` — e.g. "Apr–Jun 2026".
 *
 * @param {Date} [now]
 * @returns {{ start: Date, end: Date, label: string }}
 */
export function vatQuarterRange(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based

  // Determine quarter start month (0-based): 0, 3, 6, or 9
  const quarterStartMonth = Math.floor(month / 3) * 3;

  const start = new Date(year, quarterStartMonth, 1); // midnight

  // End = end-of-day today, not end of quarter, so we only count to now
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  // Quarter end month (0-based) for the label
  const quarterEndMonth = quarterStartMonth + 2;

  const startName = new Date(year, quarterStartMonth, 1)
    .toLocaleDateString('en-GB', { month: 'short' });
  const endName = new Date(year, quarterEndMonth, 1)
    .toLocaleDateString('en-GB', { month: 'short' });
  const label = `${startName}–${endName} ${year}`;

  return { start, end, label };
}

/**
 * Returns a VAT summary for the current calendar quarter (cash-accounting basis).
 *
 * Cash-accounting: VAT is accounted on money actually received (paid jobs), not
 * on invoices issued. This is the standard basis for most small traders on the
 * flat-rate or standard scheme. Document this assumption in the UI disclaimer.
 *
 * Prices entered in the app are VAT-INCLUSIVE (gross). We derive net and VAT
 * from the gross using splitVatInclusive() — we never add VAT on top of an
 * entered price. Decision locked: ACC, 2026-06-21.
 *
 * @param {object[]} jobs
 * @param {object[]} receipts
 * @param {Date} [now]
 * @returns {{
 *   grossSales: number,  — total gross (VAT-inclusive) sales this quarter
 *   outputVat:  number,  — VAT portion of grossSales (derived, never added on top)
 *   inputVat:   number,  — VAT reclaimable from receipts this quarter
 *   netVat:     number,  — outputVat − inputVat (positive = owe HMRC)
 *   netSales:   number,  — net (ex-VAT) sales this quarter (= grossSales − outputVat)
 * }}
 */
export function getVatSummary(jobs, receipts, now = new Date()) {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];

  const { start, end } = vatQuarterRange(now);

  let grossSales = 0;

  for (const job of safeJobs) {
    if (isExcludedJob(job)) continue;
    if (!isPaidJob(job)) continue;
    const d = jobEarnedDate(job);
    if (!d) continue;
    if (d < start || d > end) continue;
    grossSales += Number(job.total ?? job.amount ?? 0);
  }

  // Derive net and output VAT from the VAT-inclusive gross total.
  // Using the rate-generic form so 5%/0% rates survive if added later.
  const { net: netSales, vat: outputVat } = splitVatInclusive(grossSales, VAT_RATE);

  let inputVat = 0;

  for (const receipt of safeReceipts) {
    if (!receipt) continue;
    const dateStr = receipt.date || (receipt.createdAt ? receipt.createdAt.slice(0, 10) : null);
    const d = parseLocalDate(dateStr);
    if (!d) continue;
    if (d < start || d > end) continue;
    inputVat += Number(receipt.vat) || 0;
  }

  const netVat = outputVat - inputVat;

  return { grossSales, outputVat, inputVat, netVat, netSales };
}
