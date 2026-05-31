/**
 * nextBestAction.js — Pure ranking logic for the Today screen hero card.
 *
 * Extracted from TodayScreen.jsx so it can be unit-tested independently.
 * No React, no DOM, no side effects.
 *
 * Tier priority (highest wins):
 *   1  Overdue invoice (sent, past due, unpaid, not snoozed)
 *   2  Finished-but-not-invoiced (job complete >48h, no invoice sent)
 *   3  Stale sent quote (quoted stage, sent ≥3 days ago, not accepted)
 *   5  All-clear (nothing actionable)
 *
 * Tier 4 (accepted quote, not started) is deliberately skipped — the
 * accepted-quote banner on TodayScreen already surfaces this prominently.
 * Adding a duplicate hero prompt would be redundant.
 *
 * Tie-break within a tier: largest £ → oldest date → lowest ID.
 */

const MS_PER_DAY = 86400000;
const UNINVOICED_GRACE_MS = 48 * 60 * 60 * 1000; // 48 hours
const STALE_QUOTE_DAYS = 3;

// ── Snooze store interface ────────────────────────────────────────────────────
// The snooze store is injected so tests can override without touching localStorage.

const SNOOZE_KEY = 'jobprofit:snooze:v1';

export function readSnoozeStore() {
  try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '{}'); } catch { return {}; }
}

export function writeSnoozeStore(s) {
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(s)); } catch {}
}

export function isJobSnoozed(jobId, now = new Date(), snoozeStore = readSnoozeStore()) {
  const until = snoozeStore[jobId];
  return !!(until && new Date(until) > now);
}

export function snoozeJob(jobId) {
  const store = readSnoozeStore();
  store[jobId] = new Date(Date.now() + 24 * MS_PER_DAY).toISOString();
  writeSnoozeStore(store);
}

// ── Amount / date helpers (mirror TodayScreen) ────────────────────────────────

export function jobAmount(job) {
  return Number(job?.total ?? job?.amount ?? 0);
}

export function jobDateStr(job) {
  return job?.invoiceSentAt || job?.completedAt || job?.date || job?.createdAt || '';
}

/**
 * Tie-break comparator within the same tier.
 * Sort: largest amount first, then oldest date, then lowest ID (string sort).
 */
export function tierTieBreak(a, b) {
  const amtDiff = jobAmount(b) - jobAmount(a);
  if (amtDiff !== 0) return amtDiff;
  const dateA = jobDateStr(a) || '';
  const dateB = jobDateStr(b) || '';
  if (dateA < dateB) return -1;
  if (dateA > dateB) return 1;
  return String(a.id) < String(b.id) ? -1 : 1;
}

// ── Individual tier checks (pure, injectable snoozeStore) ─────────────────────

/**
 * Tier 1: invoice sent, past due, unpaid, not snoozed.
 * Requires isAwaitingPayment + daysPastDue from chaseLadder/jobStatus.
 *
 * @param {object} job
 * @param {Date}   now
 * @param {object} snoozeStore  – injectable (default: reads localStorage)
 * @param {function} isAwaitingFn
 * @param {function} daysPastDueFn
 * @returns {boolean}
 */
export function isOverdueChase(job, now, snoozeStore, isAwaitingFn, daysPastDueFn) {
  if (!isAwaitingFn(job)) return false;
  if (isJobSnoozed(job.id, now, snoozeStore)) return false;
  return daysPastDueFn(job, now) >= 0;
}

/**
 * Tier 2: job complete (or active stage), no invoice sent, completed >48h ago.
 *
 * "Active" status can reach Tier 2 because the old stage model used 'active'
 * to mean "work ongoing / ready to invoice" — the 48h grace prevents noise
 * for jobs that just flipped to active.
 *
 * @param {object} job
 * @param {Date}   now
 * @param {function} deriveStatusFn
 * @returns {boolean}
 */
export function isUnbilledComplete(job, now, deriveStatusFn) {
  const status = deriveStatusFn(job);
  if (status !== 'completed' && status !== 'active') return false;
  if (job.invoiceSentAt) return false;
  const completedAt = job.completedAt || job.date || job.createdAt;
  if (!completedAt) return false;
  return (now - new Date(completedAt)) > UNINVOICED_GRACE_MS;
}

/**
 * Tier 3: quote sent (status === 'quoted', quoteSentAt is set), not accepted,
 * and the quote is ≥3 days old — same staleness threshold WorkScreen uses
 * to show the 'warn' chip.
 *
 * @param {object} job
 * @param {Date}   now
 * @param {function} deriveStatusFn
 * @returns {boolean}
 */
export function isStaleSentQuote(job, now, deriveStatusFn) {
  const status = deriveStatusFn(job);
  if (status !== 'quoted') return false;
  if (!job.quoteSentAt) return false;
  // Already accepted — no need to chase
  if (job.quoteStatus === 'accepted' || job.acceptedAt) return false;
  const daysSinceSent = (now - new Date(job.quoteSentAt)) / MS_PER_DAY;
  return daysSinceSent >= STALE_QUOTE_DAYS;
}

/**
 * Returns which tier (1–3) a job qualifies for, or 0 if none.
 *
 * @param {object}   job
 * @param {Date}     now
 * @param {object}   snoozeStore   – injectable
 * @param {function} isAwaitingFn
 * @param {function} daysPastDueFn
 * @param {function} deriveStatusFn
 * @returns {number}  0 | 1 | 2 | 3
 */
export function qualifyingTier(job, now, snoozeStore, isAwaitingFn, daysPastDueFn, deriveStatusFn) {
  if (isOverdueChase(job, now, snoozeStore, isAwaitingFn, daysPastDueFn)) return 1;
  if (isUnbilledComplete(job, now, deriveStatusFn)) return 2;
  if (isStaleSentQuote(job, now, deriveStatusFn)) return 3;
  return 0;
}

/**
 * Runs the full ranking over an array of jobs.
 * Returns { tier, job, poolSize } — tier 5 + null job = all-clear.
 *
 * @param {object[]} jobs
 * @param {Date}     now
 * @param {object}   snoozeStore   – injectable (default: reads localStorage)
 * @param {function} isAwaitingFn
 * @param {function} daysPastDueFn
 * @param {function} deriveStatusFn
 * @returns {{ tier: number, job: object|null, poolSize: number }}
 */
export function rankNextBestAction(jobs, now = new Date(), snoozeStore, isAwaitingFn, daysPastDueFn, deriveStatusFn) {
  const byTier = { 1: [], 2: [], 3: [] };

  for (const job of jobs) {
    if (!job?.id) continue;
    const t = qualifyingTier(job, now, snoozeStore, isAwaitingFn, daysPastDueFn, deriveStatusFn);
    if (t >= 1 && t <= 3) byTier[t].push(job);
  }

  for (let t = 1; t <= 3; t++) {
    const pool = byTier[t];
    if (pool.length === 0) continue;
    const winner = pool.slice().sort(tierTieBreak)[0];
    return { tier: t, job: winner, poolSize: pool.length };
  }

  return { tier: 5, job: null, poolSize: 0 };
}

// ── Copy builders (pure) ──────────────────────────────────────────────────────

export function nbaLabel(tier) {
  if (tier === 1) return 'CHASE';
  if (tier === 2) return 'INVOICE';
  if (tier === 3) return 'FOLLOW UP';
  return '';
}

export function nbaHeadline(tier, job) {
  const rawName = (job?.customer || job?.customerName || job?.name || '').trim();
  const firstName = rawName ? rawName.split(' ')[0] : null;
  const display = firstName || 'them';
  if (tier === 1) return firstName ? `Chase ${display}.` : 'Chase for payment.';
  if (tier === 2) return firstName ? `Invoice ${display}.` : 'Send the invoice.';
  if (tier === 3) return firstName ? `Follow up: ${display}'s quote.` : 'Follow up on your quote.';
  return '';
}

export function nbaMeta(tier, job, now) {
  const amount = jobAmount(job);
  if (tier === 1) {
    // daysPastDue is injected by TodayScreen; for pure copy we accept it as a param
    return { amount, suffix: null, negative: true };
  }
  if (tier === 2) {
    const completedAt = job?.completedAt || job?.date || job?.createdAt;
    const hoursAgo = completedAt ? Math.floor((now - new Date(completedAt)) / 3600000) : null;
    const suffix = hoursAgo != null
      ? (hoursAgo < 48 ? 'completed recently' : `done ${Math.floor(hoursAgo / 24)}d ago`)
      : 'job complete';
    return { amount, suffix, negative: false };
  }
  if (tier === 3) {
    const quoteSentAt = job?.quoteSentAt;
    const daysSinceSent = quoteSentAt
      ? Math.floor((now - new Date(quoteSentAt)) / MS_PER_DAY)
      : null;
    const suffix = daysSinceSent != null ? `sent ${daysSinceSent} day${daysSinceSent === 1 ? '' : 's'} ago` : 'awaiting reply';
    return { amount: amount || null, suffix, negative: false };
  }
  return { amount: null, suffix: '', negative: false };
}

export function nbaCta(tier, job, profile) {
  if (tier === 1) {
    const phone = job?.customerPhone || job?.phone || '';
    const email = job?.customerEmail || job?.email || '';
    if (phone) return { label: 'Chase on WhatsApp', action: 'whatsapp' };
    if (email) return { label: 'Chase by email', action: 'email' };
    return { label: 'Open job', action: 'open' };
  }
  if (tier === 2) return { label: 'Send invoice', action: 'send_invoice' };
  if (tier === 3) return { label: 'Open quote', action: 'open' };
  return { label: '', action: 'noop' };
}
