/**
 * telemetry.js — thin wrapper around PostHog + Google Analytics 4 for production event capture.
 *
 * DUAL-RUN: both PostHog and GA4 are fired from every call site behind the same
 * consent gate. Each provider is independently env-gated — a missing key silently
 * no-ops that provider; the other continues normally.
 *
 * In DEV builds the events are console-logged (easy to confirm without
 * polluting either analytics project). In production the events go to both
 * PostHog (via the singleton initialised in main.jsx) and GA4 (via window.gtag
 * bootstrapped in main.jsx).
 *
 * Consent guard: logTelemetry and identifyUser both check isConsentGranted()
 * before calling either provider. PostHog is also initialised opted-out by default
 * (main.jsx) and GA4 uses Consent Mode v2 (analytics_storage: 'denied' default),
 * so this guard is a belt-and-braces layer for readability and future-proofing.
 *
 * Null-safe: if either provider was not initialised (env var missing, adblocker,
 * or a public route that skips AppShell) calls to that provider are silent no-ops.
 * One provider throwing never blocks the other.
 *
 * GA4 custom dimensions note:
 *   The upgrade_trigger parameter (and any other custom event params) must be
 *   registered as Custom Dimensions in the GA4 admin UI before they appear in
 *   reports or funnel explorations. See PR description for the full list.
 *
 * Exports:
 *   UPGRADE_TRIGGERS                        — canonical enum for the attribution chain
 *   logTelemetry(event, data)               — capture a named event
 *   identifyUser(userId, traits)            — link events to a known user
 *   getLastUpgradeTrigger()                 — read the persisted trigger from sessionStorage
 *   setLastUpgradeTrigger(trigger)          — write the trigger into sessionStorage
 *
 * Attribution chain:
 *   Every entry point that opens ProUpgradeSheet must call setLastUpgradeTrigger()
 *   with the appropriate UPGRADE_TRIGGERS value. ProUpgradeSheet reads it on open
 *   (upgrade_sheet_viewed) and on CTA tap (checkout_started). AppShell reads it
 *   after Stripe redirect (upgrade_succeeded / subscription_active).
 *   sessionStorage is used so the trigger survives the Stripe redirect round-trip
 *   within the same tab but does not persist across sessions (each conversion
 *   event is attributed to the most-recent trigger in that session).
 */
import posthog from 'posthog-js';
import { isConsentGranted } from './consent.js';

/**
 * Canonical trigger values for the upgrade attribution chain.
 * Every callsite that opens ProUpgradeSheet must pass one of these.
 * Define once here so grep finds every reference.
 *
 * @readonly
 */
export const UPGRADE_TRIGGERS = /** @type {const} */ ({
  INSIGHT_LOCKED:     'insight_locked',
  WHITELABEL_FOOTER:  'whitelabel_footer',
  AUTO_CHASE_LOCKED:  'auto_chase_locked',
  SETTINGS:           'settings',
  TRIAL_BANNER:       'trial_banner',
  TODAY_PILL:         'today_pill',
  UPGRADE_BANNER:     'upgrade_banner',
  // Trial-end conversion events (Moment 1 + Moment 2)
  TRIAL_END:          'trial_end',       // Moment-1 sheet (Day 14)
  DROP_TO_FREE:       'drop_to_free',    // Moment-2 full-screen
  ACCOUNTANT_EXPORT:  'accountant_export', // Xero/QuickBooks export locked tile (Money tab)
  // "You've got Pro" reveal — one-time comprehension fix, not a checkout trigger
  // (see ProUpgradeSheet variant="pro_reveal" — fires pro_reveal_viewed/dismissed
  // instead of the usual upgrade_sheet_viewed/checkout_started pair).
  PRO_REVEAL:         'pro_reveal',
});

const TRIGGER_SESSION_KEY = 'jp.lastUpgradeTrigger';

/**
 * Persist the upgrade trigger into sessionStorage so it survives the
 * Stripe Checkout redirect round-trip within the same tab.
 *
 * @param {string} trigger — one of UPGRADE_TRIGGERS values
 */
export function setLastUpgradeTrigger(trigger) {
  try {
    sessionStorage.setItem(TRIGGER_SESSION_KEY, trigger);
  } catch {
    // sessionStorage unavailable (private browsing) — no-op; attribution degrades gracefully.
  }
}

/**
 * Read the most-recently set upgrade trigger.
 * Returns null if nothing was set in this session.
 *
 * @returns {string|null}
 */
export function getLastUpgradeTrigger() {
  try {
    return sessionStorage.getItem(TRIGGER_SESSION_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Capture a named event with an optional flat payload.
 * snake_case event names; no PII in data beyond userId (set via identifyUser).
 * Fires BOTH PostHog and GA4 — one failing never blocks the other.
 *
 * @param {string} event
 * @param {Record<string, unknown>} [data]
 */
export function logTelemetry(event, data) {
  if (import.meta.env.DEV) {
    console.log(`[telemetry] ${event}`, data);
    return;
  }
  if (!isConsentGranted()) return;
  try {
    posthog.capture(event, data);
  } catch {
    // PostHog not initialised or blocked — silently no-op.
  }
  try {
    window.gtag('event', event, data);
  } catch {
    // gtag not initialised or blocked — silently no-op.
  }
}

/**
 * Identify the signed-in user so all subsequent events are linked.
 * Call once per session-load when session + profile become available.
 * PII-light by design: no email, just the Supabase UUID + plan metadata.
 * Identifies in BOTH PostHog and GA4 — one failing never blocks the other.
 *
 * @param {string} userId               — Supabase auth user id (UUID)
 * @param {{ plan?: string, trial_ends_at?: string|null }} [traits]
 */
export function identifyUser(userId, traits = {}) {
  if (!userId) return;
  if (import.meta.env.DEV) {
    console.log('[telemetry] identify', userId, traits);
    return;
  }
  if (!isConsentGranted()) return;
  try {
    posthog.identify(userId, traits);
  } catch {
    // PostHog not initialised or blocked — silently no-op.
  }
  try {
    // Set user_id on the GA4 config so all subsequent hits are scoped to this user.
    window.gtag('config', import.meta.env.VITE_GA4_ID, { user_id: userId });
    // Set user-scoped properties (plan, trial_ends_at).
    // PII-light: Supabase UUID + plan metadata only — no email or name.
    window.gtag('set', 'user_properties', traits);
  } catch {
    // gtag not initialised or blocked — silently no-op.
  }
}
