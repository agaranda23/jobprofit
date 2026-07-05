/**
 * firstQuoteCelebration.js — one-time gating for the "your first quote's
 * ready" celebratory moment on Today (see TodayScreen.jsx: handleJobSave's
 * isDraftQuote branch, handleSaveAndSend, handleVoiceQuoteSave).
 *
 * Mirrors proReveal.js: a per-user, per-device localStorage flag rather than
 * a Supabase column. Harmless to show again on a second device, so it isn't
 * worth a migration — see project memory: migrations are hand-applied in
 * prod and silently drift.
 *
 * "First-ever" is checked against the trader's REAL job history (no prior
 * job has ever carried a quoteStatus) as well as the device flag, so a
 * returning user who already has quotes doesn't get the moment just because
 * it's a new device — the device flag alone only protects against re-firing
 * within the same device/session (e.g. a fast double-save).
 */
const KEY_PREFIX = 'jp.firstQuoteCelebrationSeen.';

/**
 * @param {string|null|undefined} userId
 * @returns {boolean}
 */
export function hasSeenFirstQuoteCelebration(userId) {
  if (!userId) return true;
  try {
    return !!localStorage.getItem(KEY_PREFIX + userId);
  } catch {
    return true;
  }
}

/**
 * @param {string|null|undefined} userId
 */
export function markFirstQuoteCelebrationSeen(userId) {
  if (!userId) return;
  try {
    localStorage.setItem(KEY_PREFIX + userId, '1');
  } catch {
    /* private browsing or storage denied — best effort only */
  }
}

/**
 * True when `existingJobs` (the trader's jobs BEFORE the save in progress)
 * contains no prior quote AND the celebration hasn't already been shown on
 * this device for this user.
 *
 * @param {Array} existingJobs — jobs array as loaded before this save lands
 * @param {string|null|undefined} userId
 * @returns {boolean}
 */
export function shouldCelebrateFirstQuote(existingJobs, userId) {
  const hasAnyPriorQuote = Array.isArray(existingJobs) && existingJobs.some(j => !!j?.quoteStatus);
  return !hasAnyPriorQuote && !hasSeenFirstQuoteCelebration(userId);
}
