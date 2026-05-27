/**
 * logTelemetry — gates console output to DEV builds only.
 *
 * Drop-in replacement for the inline `console.log('[telemetry] …')` calls
 * across WorkScreen, WorkCalendar, SendInvoiceModal, and BottomNav.
 *
 * TODO: swap the DEV branch body for a real analytics call (PostHog / Mixpanel)
 * when the analytics provider is chosen. The call sites don't need to change —
 * just update this function.
 */
export function logTelemetry(event, data) {
  if (import.meta.env.DEV) {
    console.log(`[telemetry] ${event}`, data);
  }
}
