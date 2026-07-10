/**
 * pipelineStages — canonical stage order + the "seen" flag for StageStrip's
 * one-time coachmark.
 *
 * Split out of src/components/StageStrip.jsx (which must stay a
 * component-only export for React Fast Refresh —
 * react-refresh/only-export-components) but kept in the same shape so the
 * strip and its tests both import from here.
 */

/** localStorage key — set once, never cleared, so the coachmark only ever shows once. */
export const COACHMARK_KEY = 'jp.jobs_pipeline_coachmark_seen';

export const STAGES = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

/**
 * readCoachmarkSeen — pure function so tests can call it directly.
 * Returns true when the localStorage flag is present.
 */
export function readCoachmarkSeen() {
  try {
    return !!localStorage.getItem(COACHMARK_KEY);
  } catch {
    return false; // localStorage unavailable (private browsing / SSR)
  }
}

/**
 * writeCoachmarkSeen — persists the flag; idempotent.
 */
export function writeCoachmarkSeen() {
  try {
    localStorage.setItem(COACHMARK_KEY, '1');
  } catch {
    // private mode / storage full — silently swallow; the coachmark will reappear
    // on the next visit but that's an acceptable edge case.
  }
}
