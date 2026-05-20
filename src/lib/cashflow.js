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

/**
 * Determines whether a job is paid, normalising across cloud and legacy shapes.
 *
 * Cloud: job.paid === true
 * Legacy: job.paymentStatus === 'paid'
 * applyAutoFlip also sets status='paid' — treat that as paid too.
 */
function isPaidJob(job) {
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
function isExcludedJob(job) {
  if (!job) return true;
  const s = (job.status || job.jobStatus || '').toLowerCase();
  const ps = (job.paymentStatus || '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled' || s === 'draft') return true;
  if (ps === 'cancelled' || ps === 'canceled') return true;
  return false;
}

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
 * Returns the amount received for a job.
 * If job.payments[] is present and non-empty, sums those.
 * Otherwise falls back to job.amount for fully-paid jobs.
 */
function jobReceivedAmount(job) {
  if (!job) return 0;
  if (Array.isArray(job.payments) && job.payments.length > 0) {
    return job.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  }
  if (isPaidJob(job)) return Number(job.amount || 0);
  return 0;
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
