/**
 * draftAutosave.js — single-slot persistence for the in-progress
 * quote/job-creation form, so a phone call, a lock-screen, or the OS killing
 * a backgrounded tab can't wipe out work the trader hasn't saved yet.
 *
 * Real user pain this fixes: "If someone calls me in the middle of a quote,
 * it doesn't save." AddJobModal (manual + voice) previously held all of its
 * form state in memory only — closing/reloading the page lost it completely.
 *
 * Storage: localStorage (same key/value pattern already used by chaseLadder.js,
 * nextBestAction.js's snooze store, etc.) rather than the IndexedDB offline-job
 * queue (src/lib/offlineQueue.js). Deliberate choice, not an oversight:
 *   - localStorage.setItem is SYNCHRONOUS. The one hard requirement here is
 *     "the last edit survives pagehide/visibilitychange" — an in-flight
 *     IndexedDB transaction can be torn down when the OS suspends/kills a
 *     backgrounded tab before the async write completes (a known WebKit
 *     gotcha); a synchronous localStorage write inside the pagehide handler
 *     cannot be interrupted that way.
 *   - The payload is small (a dozen form fields + a transcript string) —
 *     nothing like the IndexedDB queue's job-rows-plus-retry use case.
 *   - This is single-slot, ephemeral, local-only UI state that never gets
 *     synced to Supabase or queued for retry — a different shape of problem
 *     to the offline job queue, so reusing IndexedDB here would mean bolting
 *     an unrelated concern onto that store rather than reusing a pattern.
 *
 * Single slot: only one AddJobModal can be open at a time, so one in-progress
 * draft is all the app ever needs to remember.
 */

const DRAFT_KEY = 'jobprofit:draft:v1';

/**
 * Persists the given snapshot, stamping it with the current time.
 * Swallows storage errors (Safari private mode, quota exceeded) — losing the
 * autosave silently is preferable to crashing the form the trader is using.
 */
export function saveDraft(data) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    // Safari incognito / storage full — silently skip, matches chaseLadder.js
  }
}

/**
 * Returns the saved draft object, or null if none exists / it's corrupt.
 */
export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Removes the saved draft. Call once the quote/job is actually sent or saved. */
export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // no-op
  }
}
