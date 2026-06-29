/**
 * callPayPrompt.js — logic for the "Did [customer] pay?" prompt.
 *
 * When the founder taps Call on an unpaid job and then returns to the app,
 * we show a one-tap "Mark paid / Not yet" prompt. This module owns all the
 * guard logic; the UI lives in WorkScreen.jsx.
 *
 * Storage: sessionStorage so the record is cleared on tab close — no
 * cross-session nagging. Falls back silently when storage is unavailable.
 *
 * Key: jp.callpay.pending
 * Value: JSON { jobId: string, calledAt: number }
 *
 * The prompt fires ONCE per call — consumeCallRecord() removes the record
 * so a subsequent focus/visibility event doesn't re-show it.
 */

const STORAGE_KEY = 'jp.callpay.pending';

// Maximum milliseconds away from the app before we assume the call was
// abandoned / the user did something else. 30 minutes is generous enough
// to cover a long job discussion while not nagging after an accidental tap.
export const MAX_AWAY_MS = 30 * 60 * 1000;

// Minimum milliseconds away. The visibilitychange fires for tab switches too;
// 800ms threshold avoids triggering on momentary swipes or notification shade.
export const MIN_AWAY_MS = 800;

/**
 * Record that the user just tapped Call on a job. Call before window.open().
 */
export function recordCall(jobId) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ jobId, calledAt: Date.now() }));
  } catch {
    // sessionStorage unavailable — ignore
  }
}

/**
 * Read + remove the pending call record in one step.
 * Returns { jobId, calledAt } or null.
 * Calling this marks the prompt as "consumed" so it only shows once.
 */
export function consumeCallRecord() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Discard the pending record without showing the prompt (e.g. the job was
 * already marked paid by another path while the user was on the call).
 */
export function clearCallRecord() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
}

/**
 * Decide whether the prompt should show after returning to the app.
 *
 * @param {object} params
 * @param {object|null} params.record      — output of consumeCallRecord()
 * @param {object|null} params.job         — live job object from the jobs array
 * @param {number}      params.returnedAt  — Date.now() at the moment of return
 * @returns {boolean}
 */
export function shouldShowCallPayPrompt({ record, job, returnedAt }) {
  if (!record || !job) return false;

  // Only for jobs whose stage can be marked paid
  if (!isMarkableUnpaid(job)) return false;

  // Only if the call was recent enough
  const awayMs = returnedAt - record.calledAt;
  if (awayMs < MIN_AWAY_MS) return false;
  if (awayMs > MAX_AWAY_MS) return false;

  // Job must still be unpaid — don't show if it was paid another way while away
  if (isAlreadyPaid(job)) return false;

  return true;
}

/**
 * Is this job in a stage where "Mark paid" makes sense?
 * Matches getStageCTA's markPaid:true conditions (Invoiced, Overdue)
 * plus On-stage jobs with an amount set.
 */
export function isMarkableUnpaid(job) {
  if (!job) return false;
  if (isAlreadyPaid(job)) return false;
  const status = job.status || '';
  const invoiceStatus = job.invoiceStatus || '';
  // Overdue / Invoiced — the two stages with markPaid:true on the tile CTA
  if (status === 'overdue' || invoiceStatus === 'sent') return true;
  // On-stage with a price (spec requirement)
  if (status === 'active') {
    const amount = Number(job.total ?? job.amount ?? 0);
    return amount > 0;
  }
  return false;
}

/**
 * Returns true when the job is already in a paid state.
 */
export function isAlreadyPaid(job) {
  if (!job) return true;
  return job.paid === true || job.status === 'paid' || job.paymentStatus === 'paid';
}
