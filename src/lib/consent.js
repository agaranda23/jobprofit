/**
 * consent.js — analytics consent helpers.
 *
 * Single source of truth for the 'jp.analytics_consent' localStorage key.
 * Coordinates with PostHog opt-in/out so the analytics lib is never capturing
 * before the user has chosen.
 *
 * Exports:
 *   getConsent()       → 'granted' | 'denied' | null
 *   setConsent(value)  → writes localStorage, calls posthog opt-in/out, dispatches event
 *   isConsentGranted() → boolean shorthand
 */

import posthog from 'posthog-js';

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
 * Persists consent, tells PostHog to opt in or out, and fires a window event
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
    if (value === 'granted') {
      posthog.opt_in_capturing();
    } else {
      posthog.opt_out_capturing();
    }
  } catch {
    // PostHog not initialised (no API key, adblocker, public page) — safe no-op.
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
