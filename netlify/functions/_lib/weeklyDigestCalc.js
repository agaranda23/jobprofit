/**
 * weeklyDigestCalc — pure computation helpers for the weekly profit digest.
 *
 * Deliberately isolated from Supabase and sendPushToUser so the functions
 * can be unit-tested without any mocks beyond simple JS objects.
 *
 * Server-side only (Netlify function context). No browser APIs.
 *
 * Design decisions:
 *   - "Prior week" is Mon 00:00 → Sun 23:59 in UTC (the server has no user TZ).
 *     This is a deliberate simplification for v1; it's correct for UK-based
 *     users within a day's margin. If multi-TZ matters, pass tz per user.
 *   - "Paid in" = sum of job.amount for jobs where paid=true AND payment_date
 *     falls in the prior-week window. We query payment_date directly from the
 *     DB rather than relying on the client mapper (which collapses dates).
 *   - "True profit" = paid_in - receipt_cost - (weekly_overhead_share).
 *     weekly_overhead_share = monthly_overhead_total / 4.333.
 *   - Skip users with no paid activity (don't send £0 digests).
 */

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the start and end of the prior calendar week (Mon–Sun) in UTC.
 *
 * @param {Date} [now]
 * @returns {{ start: Date, end: Date }}
 */
export function priorWeekRange(now = new Date()) {
  // Day-of-week in UTC (0=Sun … 6=Sat). Shift so Monday=0.
  const dow = (now.getUTCDay() + 6) % 7; // Mon=0, Tue=1, … Sun=6
  // Start of THIS week (Monday 00:00 UTC)
  const thisWeekStart = new Date(now);
  thisWeekStart.setUTCHours(0, 0, 0, 0);
  thisWeekStart.setUTCDate(thisWeekStart.getUTCDate() - dow);

  // Prior week: 7 days before this week's Monday, ending Sunday 23:59:59.999 UTC
  const start = new Date(thisWeekStart);
  start.setUTCDate(start.getUTCDate() - 7);

  const end = new Date(thisWeekStart);
  end.setUTCMilliseconds(-1); // 1ms before Monday = Sunday 23:59:59.999

  return { start, end };
}

// ─── Summary computation ──────────────────────────────────────────────────────

/**
 * Computes the prior-week summary from raw Supabase rows.
 *
 * @param {object[]} jobs     - rows from `jobs` table with at least:
 *                               { amount, paid, payment_date, date }
 * @param {object[]} receipts - rows from `receipts` table with at least:
 *                               { amount, date, created_at? }
 * @param {object[]} overheads - JSONB array from profiles.overheads, each
 *                               { amount: number, is_active?: boolean }
 * @param {{ start: Date, end: Date }} range
 * @returns {{
 *   paidIn:        number,  — total £ received for jobs paid this week
 *   jobCount:      number,  — number of paid jobs in the week
 *   receiptCost:   number,  — receipt costs dated in the week
 *   weeklyOverhead: number, — monthly_total / 4.333 (weekly share)
 *   trueProfit:    number,  — paidIn - receiptCost - weeklyOverhead
 *   hasOverheads:  boolean, — whether user has any active overheads set
 * }}
 */
export function computeWeekSummary(jobs, receipts, overheads, { start, end }) {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];
  const safeOverheads = Array.isArray(overheads) ? overheads : [];

  let paidIn = 0;
  let jobCount = 0;

  for (const job of safeJobs) {
    if (!job) continue;
    // Server-side rows use snake_case. payment_date is set when job is paid.
    const isPaid = job.paid === true;
    if (!isPaid) continue;

    // payment_date may be 'YYYY-MM-DD' string or full ISO. Fall back to date.
    const rawDate = job.payment_date || job.date;
    if (!rawDate) continue;

    const d = parseUTCDate(rawDate);
    if (!d) continue;
    if (d < start || d > end) continue;

    paidIn += Number(job.amount || 0);
    jobCount++;
  }

  let receiptCost = 0;
  for (const receipt of safeReceipts) {
    if (!receipt) continue;
    const rawDate = receipt.date || (receipt.created_at ? receipt.created_at.slice(0, 10) : null);
    if (!rawDate) continue;
    const d = parseUTCDate(rawDate);
    if (!d) continue;
    if (d < start || d > end) continue;
    receiptCost += Number(receipt.amount || 0);
  }

  // Monthly overhead total — only active items
  let monthlyOverheadTotal = 0;
  let hasOverheads = false;
  for (const item of safeOverheads) {
    if (!item || item.is_active === false) continue;
    const n = Number(item.amount);
    if (!isNaN(n) && n > 0) {
      monthlyOverheadTotal += n;
      hasOverheads = true;
    }
  }

  // Weekly share: 1 week = 1/4.333 of a month (365.25 / 12 / 7)
  const weeklyOverhead = monthlyOverheadTotal / (365.25 / 12 / 7);

  const trueProfit = paidIn - receiptCost - weeklyOverhead;

  return { paidIn, jobCount, receiptCost, weeklyOverhead, trueProfit, hasOverheads };
}

// ─── Message builder ──────────────────────────────────────────────────────────

/**
 * Builds the push notification title and body from a week summary.
 *
 * Rules:
 *   - Never called when jobCount === 0 (callers must skip those users).
 *   - Title is always the £ paid-in headline.
 *   - Body adds a true-profit line only when overheads are set (hasOverheads=true)
 *     AND trueProfit differs from paidIn by more than £1 (i.e. there are real costs
 *     to show). If trueProfit is negative we still show it — that's a real signal.
 *
 * @param {{ paidIn: number, jobCount: number, trueProfit: number, hasOverheads: boolean }} summary
 * @returns {{ title: string, body: string }}
 */
export function buildDigestMessage(summary) {
  const { paidIn, jobCount, trueProfit, hasOverheads } = summary;

  const jobWord = jobCount === 1 ? 'job' : 'jobs';
  const title = `You made £${formatGBP(paidIn)} across ${jobCount} ${jobWord} last week`;

  let body = 'Tap to see your Money tab.';

  if (hasOverheads && Math.abs(paidIn - trueProfit) > 1) {
    const profitStr = trueProfit >= 0
      ? `£${formatGBP(trueProfit)} true profit`
      : `-£${formatGBP(Math.abs(trueProfit))} after costs`;
    body = `${profitStr} after costs. Tap to see your breakdown.`;
  }

  return { title, body };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parses a YYYY-MM-DD string (or ISO datetime) to a UTC midnight Date.
 * Returns null on failure.
 *
 * We use UTC midnight intentionally — the server has no local timezone.
 * "YYYY-MM-DD" should be treated as calendar-date-only comparisons.
 */
function parseUTCDate(str) {
  if (!str || typeof str !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (!m) return null;
  const d = new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10)));
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formats a number as a GBP string with 2 decimal places, no trailing .00.
 * £840 → "840", £840.50 → "840.50".
 */
function formatGBP(n) {
  const fixed = Number(n).toFixed(2);
  // Drop trailing .00 for cleaner display
  return fixed.endsWith('.00') ? fixed.slice(0, -3) : fixed;
}
