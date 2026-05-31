/**
 * theme.js — Light / Dark / System theme controller
 *
 * Preference is stored as 'light' | 'dark' | 'system' in localStorage key
 * jp.theme. The resolved theme (what the document actually shows) is either
 * 'light' or 'dark'.
 *
 * In 'system' mode the controller subscribes to the OS prefers-color-scheme
 * media query and updates the document when the OS preference changes.
 *
 * Default is 'dark' — existing users' experience is unchanged on upgrade.
 * Light and System are opt-in from Settings.
 *
 * The resolved theme is applied by setting data-theme on <html>:
 *   data-theme="dark"  → :root tokens stay (dark default, no override needed)
 *   data-theme="light" → [data-theme="light"] block in index.css overrides tokens
 *
 * No-flash approach: a tiny inline script in index.html runs before React
 * mounts and sets data-theme synchronously from localStorage.
 */

export const STORAGE_KEY = 'jp.theme';
export const VALID_PREFS = ['light', 'dark', 'system'];

/** Read the stored preference; fall back to 'dark'. */
export function getStoredPref() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (VALID_PREFS.includes(stored)) return stored;
  } catch {
    // localStorage may be unavailable (private browsing, SSR)
  }
  return 'dark';
}

/** Persist a preference. */
export function setStoredPref(pref) {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // ignore write failure
  }
}

/** Resolve a preference to the actual rendered theme ('light' | 'dark'). */
export function resolveTheme(pref) {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  // 'system': follow OS
  try {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    // matchMedia not available
  }
  return 'dark';
}

/** Apply a resolved theme to the document root element. */
export function applyTheme(resolvedTheme) {
  document.documentElement.dataset.theme = resolvedTheme;
}

// ── Live controller ──────────────────────────────────────────────────────────

let _mediaListener = null;

/**
 * Activate the theme controller.
 * - Reads pref from localStorage and applies the resolved theme immediately.
 * - In 'system' mode, subscribes to OS changes.
 * Returns a cleanup function that removes the OS listener.
 */
export function activateThemeController() {
  const pref = getStoredPref();
  applyTheme(resolveTheme(pref));
  subscribeToSystem(pref);
  return () => unsubscribeFromSystem();
}

/**
 * Change the preference, persist it, apply the resolved theme, and
 * manage the OS media listener accordingly.
 */
export function setPref(pref) {
  setStoredPref(pref);
  applyTheme(resolveTheme(pref));
  subscribeToSystem(pref);
}

function subscribeToSystem(pref) {
  unsubscribeFromSystem();
  if (pref !== 'system') return;
  try {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    _mediaListener = () => applyTheme(resolveTheme('system'));
    mq.addEventListener('change', _mediaListener);
  } catch {
    // matchMedia not available
  }
}

function unsubscribeFromSystem() {
  if (!_mediaListener) return;
  try {
    window.matchMedia('(prefers-color-scheme: light)').removeEventListener('change', _mediaListener);
  } catch {
    // ignore
  }
  _mediaListener = null;
}
