/**
 * proPillRotation.js — rotates the settled-trial GetProPill's suggested Pro
 * perk across app loads, so a trader who dismisses/ignores the pill still
 * gets exposed to more than one headline perk over the trial, not just
 * whichever one happened to render first.
 *
 * Per-device localStorage counter (not a Supabase column) — same reasoning
 * as proReveal.js: harmless to reset on a new device, not worth a migration.
 */
const ROTATION_KEY = 'jp.getProPillRotation';

/** Perk order — rotates true profit → remove your footer → tax pot → repeat. */
export const PILL_PERKS = ['true-profit', 'remove-footer', 'tax-pot'];

/**
 * Reads the last-shown perk index, advances it, persists the new index, and
 * returns the next perk name.
 *
 * Call this ONCE per component mount (e.g. inside a `useState(() => ...)`
 * lazy initializer) — never on every render, or the perk would change
 * mid-session instead of "across loads".
 *
 * @returns {string} one of PILL_PERKS
 */
export function nextPillPerk() {
  let idx = 0;
  try {
    const raw = localStorage.getItem(ROTATION_KEY);
    idx = raw != null ? (parseInt(raw, 10) + 1) % PILL_PERKS.length : 0;
    if (Number.isNaN(idx)) idx = 0;
    localStorage.setItem(ROTATION_KEY, String(idx));
  } catch {
    /* private browsing or storage denied — always show the first perk */
    idx = 0;
  }
  return PILL_PERKS[idx];
}
