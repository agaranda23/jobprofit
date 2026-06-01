/**
 * telemetry.js — thin wrapper around PostHog for production event capture.
 *
 * In DEV builds the events are console-logged (easy to confirm without
 * polluting a real PostHog project). In production the events go to PostHog
 * via the singleton initialised in main.jsx.
 *
 * Null-safe: if PostHog was not initialised (env var missing, adblocker,
 * or a public route that skips AppShell) both functions are silent no-ops.
 *
 * Exports:
 *   logTelemetry(event, data)         — capture a named event
 *   identifyUser(userId, traits)      — link events to a known user
 */
import posthog from 'posthog-js';

/**
 * Capture a named event with an optional flat payload.
 * snake_case event names; no PII in data beyond userId (set via identifyUser).
 *
 * @param {string} event
 * @param {Record<string, unknown>} [data]
 */
export function logTelemetry(event, data) {
  if (import.meta.env.DEV) {
    console.log(`[telemetry] ${event}`, data);
    return;
  }
  try {
    posthog.capture(event, data);
  } catch {
    // PostHog not initialised or blocked — silently no-op.
  }
}

/**
 * Identify the signed-in user so all subsequent events are linked.
 * Call once per session-load when session + profile become available.
 * PII-light by design: no email, just the Supabase UUID + plan metadata.
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
  try {
    posthog.identify(userId, traits);
  } catch {
    // PostHog not initialised or blocked — silently no-op.
  }
}
