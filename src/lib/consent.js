/**
 * consent.js — analytics consent helpers.
 *
 * Single source of truth for the 'jp.analytics_consent' localStorage key.
 * Coordinates with GA4 Consent Mode v2 so analytics_storage is never 'granted'
 * before the user has chosen.
 *
 * Exports:
 *   getConsent()       → 'granted' | 'denied' | null
 *   setConsent(value)  → writes localStorage, updates GA4 consent state, dispatches event
 *   isConsentGranted() → boolean shorthand
 */

const KEY = 'jp.analytics_consent';

/**
 * Returns the stored consent value or null if the user has not yet chosen.
 * @returns {'granted'|'denied'|null}
 */
export function getConsent() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'granted' || v === 'denied') return v;
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists consent, updates GA4 Consent Mode v2, and fires a window event
 * so any listening component (e.g. the banner) can hide itself.
 *
 * @param {'granted'|'denied'} value
 */
export function setConsent(value) {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    // Private browsing may block localStorage writes — not fatal.
  }

  try {
    // Update GA4 Consent Mode v2 — gtag queues this safely if not yet loaded.
    window.gtag('consent', 'update', {
      analytics_storage: value === 'granted' ? 'granted' : 'denied',
    });
  } catch {
    // gtag not bootstrapped (no VITE_GA4_ID, adblocker, public page) — safe no-op.
  }

  // Notify the banner (and any other listener) that consent has been decided.
  try {
    window.dispatchEvent(new CustomEvent('jp:consent', { detail: { value } }));
  } catch {
    // SSR or edge environments — safe no-op.
  }
}

/**
 * Shorthand: returns true only when consent is explicitly 'granted'.
 * @returns {boolean}
 */
export function isConsentGranted() {
  return getConsent() === 'granted';
}
