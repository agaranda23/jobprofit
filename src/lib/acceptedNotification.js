/**
 * acceptedNotification.js — Phase G-3
 *
 * Pure helpers for the accepted-quote in-app notification system.
 * No React, no DOM, no Supabase. All logic is testable in Vitest.
 *
 * A job is "newly accepted" when:
 *   - meta.quoteStatus === 'accepted' (written by accept-quote Netlify function)
 *   - meta.acceptedAt is set (the acceptance timestamp)
 *   - meta.acceptedSeenAt is NOT set (trader hasn't acknowledged it yet)
 *
 * "Seen" is stored in acceptedSeenAt (ISO timestamp written to the jobMeta
 * side-channel by writeJobMeta). It lives in localStorage only — it does not
 * need to round-trip to Supabase because it is purely a per-device UI state.
 * (If the trader uses two devices, they see the banner on each device until
 * they dismiss it on that device. Acceptable at v1 scale.)
 */

/**
 * Returns jobs that have been accepted by the customer but not yet seen
 * (acknowledged) by the tradesperson on this device.
 *
 * @param {Array} jobs  - the current jobs array (with meta fields overlaid by applyJobMetaToJobs)
 * @returns {Array}     - subset of jobs that are newly accepted (unseen)
 */
export function getNewlyAcceptedJobs(jobs) {
  if (!Array.isArray(jobs)) return [];
  return jobs.filter(isNewlyAccepted);
}

/**
 * Returns true when a single job is accepted but unseen.
 *
 * @param {object} job
 * @returns {boolean}
 */
export function isNewlyAccepted(job) {
  if (!job) return false;
  const isAccepted = job.quoteStatus === 'accepted' && !!job.acceptedAt;
  const isSeen = !!job.acceptedSeenAt;
  return isAccepted && !isSeen;
}

/**
 * Builds the display label for an accepted job banner row.
 * Returns a string like "Gemma accepted · £500" or "Customer accepted" when
 * name / amount are not available.
 *
 * @param {object} job
 * @returns {string}
 */
export function buildAcceptedLabel(job) {
  if (!job) return 'Quote accepted';
  const name = (job.acceptedName || job.customer_name || job.customer || '').trim();
  const amount = Number(job.total ?? job.amount ?? 0) || 0;
  const namePart = name || 'Customer';
  const amountPart = amount > 0
    ? ` · £${amount.toLocaleString('en-GB', { minimumFractionDigits: 0 })}`
    : '';
  return `${namePart} accepted${amountPart}`;
}

/**
 * Formats acceptedAt for display: "Today", "Yesterday", or "DD MMM".
 *
 * @param {string|null} isoString
 * @returns {string}
 */
export function formatAcceptedDate(isoString) {
  if (!isoString) return '';
  const accepted = new Date(isoString);
  const now = new Date();
  const todayStr = now.toDateString();
  const acceptedStr = accepted.toDateString();
  if (acceptedStr === todayStr) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (acceptedStr === yesterday.toDateString()) return 'Yesterday';
  return accepted.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
