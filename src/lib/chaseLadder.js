/**
 * chaseLadder.js — Per-job chase state + tiered WhatsApp message templates.
 *
 * State lives in localStorage only. No Supabase. Degrades gracefully in
 * Safari private mode (try/catch on every I/O call).
 *
 * localStorage key: jobprofit:chases:v1
 * Value shape: { [jobId]: { count, lastChasedAt, firstChasedAt } }
 */

const STORAGE_KEY = 'jobprofit:chases:v1';

// ── localStorage helpers ──────────────────────────────────────────────────

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Safari incognito / storage full — silently skip
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Returns { count, lastChasedAt, firstChasedAt } for the job, or null if
 * it has never been chased.
 */
export function getChaseState(jobId) {
  if (!jobId) return null;
  const store = readStore();
  return store[jobId] ?? null;
}

/**
 * Records a chase tap for the given job.
 * Increments count, updates lastChasedAt, sets firstChasedAt on first tap.
 */
export function recordChase(jobId) {
  if (!jobId) return;
  const store = readStore();
  const now = new Date().toISOString();
  const existing = store[jobId];
  store[jobId] = {
    count: existing ? existing.count + 1 : 1,
    lastChasedAt: now,
    firstChasedAt: existing ? existing.firstChasedAt : now,
  };
  writeStore(store);
}

/**
 * Removes the chase record for the job. Called when Mark Paid fires.
 */
export function clearChase(jobId) {
  if (!jobId) return;
  const store = readStore();
  delete store[jobId];
  writeStore(store);
}

// ── Tier logic ────────────────────────────────────────────────────────────

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pure function. Returns the tier (1, 2, 3, or 4+) based on chase state
 * and current wall-clock time.
 *
 * Tier 1 — never chased, or chased but < 7 days since last chase.
 * Tier 2 — chased ≥ 1 time AND ≥ 7 days since most recent chase.
 * Tier 3 — chased ≥ 2 times AND ≥ 7 days since most recent chase
 *           (implying ≥ 14 days from first).
 * Tier 4 — chased ≥ 3 times AND ≥ 7 days since most recent chase.
 *           Uses tier-3 copy; surfaces the "Time for a call?" user hint.
 *
 * @param {object|null} state - result of getChaseState(), or null
 * @param {Date} [_now] - injectable for tests
 * @returns {number} tier (1–4)
 */
export function computeTier(state, _now = new Date()) {
  if (!state) return 1;

  const { count, lastChasedAt } = state;
  const daysSinceLastChase = (_now - new Date(lastChasedAt)) / SEVEN_DAYS_MS;

  if (daysSinceLastChase < 1) return 1;   // < 7 days — stay on tier 1
  if (count >= 3) return 4;
  if (count >= 2) return 3;
  if (count >= 1) return 2;
  return 1;
}

// ── Message builder ───────────────────────────────────────────────────────

/**
 * Builds the chase message string for the given tier.
 *
 * @param {{ name: string, amountOutstanding: string, daysSinceDue: number,
 *           tier: number, amountPaid: number }} params
 * @returns {string}
 */
export function buildChaseMessage({ name, amountOutstanding, daysSinceDue, tier, amountPaid = 0 }) {
  const safeName = name || 'there';
  const effectiveTier = tier >= 4 ? 3 : tier;

  let msg;
  switch (effectiveTier) {
    case 2: {
      const prefix = amountPaid > 0 ? `Thanks for the £${amountPaid} — ` : '';
      msg = `${prefix}Hi ${safeName}, just a nudge — the invoice for ${amountOutstanding} is still open, ${daysSinceDue} days on now. Could you let me know when it's due to land? Happy to resend bank details if it helps. Cheers.`;
      break;
    }
    case 3: {
      const prefix = amountPaid > 0 ? `Thanks for the part-payment — ` : '';
      msg = `${prefix}Hi ${safeName}, chasing this one more time — ${amountOutstanding} has been outstanding for ${daysSinceDue} days. Can you confirm a payment date this week? If there's a problem at your end give me a ring and we'll sort it.`;
      break;
    }
    default: {
      // Tier 1
      msg = `Hi ${safeName}, just a friendly reminder that ${amountOutstanding} is still outstanding on the job. Let me know if you have any questions — cheers!`;
      break;
    }
  }
  return msg;
}

// ── Link builder ──────────────────────────────────────────────────────────

/**
 * Builds the wa.me deep-link URL for the given phone + tier.
 * Returns null when no phone number is present.
 *
 * @param {{ phone: string, name: string, amountOutstanding: string,
 *           daysSinceDue: number, tier: number, amountPaid: number }} params
 * @returns {string|null}
 */
export function buildChaseLink({ phone, name, amountOutstanding, daysSinceDue, tier, amountPaid = 0 }) {
  const cleaned = (phone || '').replace(/\s/g, '').replace(/^0/, '44').replace(/^\+/, '');
  if (!cleaned) return null;

  const msg = buildChaseMessage({ name, amountOutstanding, daysSinceDue, tier, amountPaid });
  return `https://wa.me/${cleaned}?text=${encodeURIComponent(msg)}`;
}

// ── Display helpers ───────────────────────────────────────────────────────

/**
 * Returns a human-readable "last chased N days ago" string for the pill,
 * or null if no state exists.
 *
 * @param {object|null} state
 * @param {Date} [_now]
 * @returns {string|null}
 */
export function lastChasedLabel(state, _now = new Date()) {
  if (!state) return null;
  const diffMs = _now - new Date(state.lastChasedAt);
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'Last chased today';
  if (diffDays === 1) return 'Last chased yesterday';
  return `Last chased ${diffDays}d ago`;
}
