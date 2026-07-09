/**
 * draftAutosave.js — single-slot persistence for an in-progress form, so a
 * phone call, a lock-screen, or the OS killing a backgrounded tab can't wipe
 * out work the trader hasn't saved yet.
 *
 * Real user pain this fixes: "If someone calls me in the middle of a quote,
 * it doesn't save." AddJobModal (manual + voice) previously held all of its
 * form state in memory only — closing/reloading the page lost it completely.
 * The same helper now also backs OnboardingWizard (2026-07) — a signup
 * interrupted mid-wizard is the first impression, and losing it is worse.
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
 * Single slot per store: only one AddJobModal (or one OnboardingWizard) can
 * be open at a time, so one in-progress draft per key is all the app ever
 * needs to remember. Each form gets its OWN key (via createDraftStore) so
 * an in-progress quote and an in-progress onboarding session never collide
 * or overwrite one another.
 */

const DRAFT_KEY = 'jobprofit:draft:v1';
const ONBOARDING_DRAFT_KEY = 'jobprofit:draft:onboarding:v1';

/**
 * Builds a save/load/clear trio bound to one localStorage key. Every store
 * shares the same swallow-errors-silently behaviour (Safari private mode,
 * quota exceeded) — losing the autosave is preferable to crashing the form.
 */
export function createDraftStore(key) {
  return {
    /** Persists the given snapshot, stamping it with the current time. */
    save(data) {
      try {
        localStorage.setItem(key, JSON.stringify({ ...data, savedAt: Date.now() }));
      } catch {
        // Safari incognito / storage full — silently skip, matches chaseLadder.js
      }
    },
    /** Returns the saved draft object, or null if none exists / it's corrupt. */
    load() {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    /** Removes the saved draft. Call once the form is actually saved/sent/completed. */
    clear() {
      try {
        localStorage.removeItem(key);
      } catch {
        // no-op
      }
    },
  };
}

// ── Quote/job-creation draft (AddJobModal + TodayScreen's "Resume your quote?") ──
const quoteDraftStore = createDraftStore(DRAFT_KEY);
export const saveDraft = quoteDraftStore.save;
export const loadDraft = quoteDraftStore.load;
export const clearDraft = quoteDraftStore.clear;

// ── Onboarding-wizard draft (OnboardingWizard) — distinct key, same mechanism ──
const onboardingDraftStore = createDraftStore(ONBOARDING_DRAFT_KEY);
export const saveOnboardingDraft = onboardingDraftStore.save;
export const loadOnboardingDraft = onboardingDraftStore.load;
export const clearOnboardingDraft = onboardingDraftStore.clear;
