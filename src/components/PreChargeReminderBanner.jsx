/**
 * PreChargeReminderBanner — Day-~43 in-app reminder shown a few days before the
 * first charge fires after the Moment-1 "free month" extension.
 *
 * STUB: email/push delivery of this reminder is DEFERRED (no infra yet).
 * This component covers the IN-APP surface. The scheduling data hook below
 * exposes shouldShowPreChargeReminder() for AppShell to call on every load.
 *
 * BLOCKED ON (founder action):
 *   1. Push/email infrastructure — weekly-digest.js pattern can be extended.
 *   2. Stripe webhook fires `invoice.upcoming` ~7 days before charge —
 *      stripe-webhook.js should send the reminder push/email from there.
 * See PR description for the full spec.
 *
 * The in-app banner fires when:
 *   - User is on plan='trial' (Moment-1 accepted, still in extension period)
 *   - trial_ends_at + 30 days is within the next 5 calendar days
 *   - Banner has not been dismissed today (localStorage gate)
 *
 * Props:
 *   chargeDate   — formatted string e.g. "7 Aug" (from formatChargeDate)
 *   onKeep       — user taps "Keep Pro" — navigate to billing portal
 *   onCancel     — user taps "Cancel" — navigate to billing portal (same action;
 *                  Stripe portal handles the actual cancellation)
 *   onDismiss    — user taps ✕ — hides for today
 */

import { logTelemetry } from '../lib/telemetry.js';
import { PRE_CHARGE_REMINDER_DISMISSED_KEY } from '../lib/trialConversion.js';

export default function PreChargeReminderBanner({ chargeDate, onKeep, onCancel, onDismiss }) {
  const handleDismiss = () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem(PRE_CHARGE_REMINDER_DISMISSED_KEY, today);
    } catch {
      // Private browsing — no-op
    }
    logTelemetry('pre_charge_reminder_dismissed', { chargeDate });
    onDismiss?.();
  };

  const handleKeep = () => {
    logTelemetry('pre_charge_reminder_keep_pro', { chargeDate });
    onKeep?.();
  };

  const handleCancel = () => {
    logTelemetry('pre_charge_reminder_cancel_clicked', { chargeDate });
    onCancel?.();
  };

  return (
    <div className="pre-charge-banner" role="status" aria-live="polite">
      <button
        type="button"
        className="pre-charge-banner__close"
        onClick={handleDismiss}
        aria-label="Dismiss"
      >
        &times;
      </button>
      <p className="pre-charge-banner__headline">
        Your free month of Pro ends on {chargeDate}
      </p>
      <p className="pre-charge-banner__body">
        After {chargeDate}, JobProfit Pro is &pound;12/month. Want to keep it? Do nothing. Don&rsquo;t want it? Cancel in two taps and you won&rsquo;t be charged.
      </p>
      <div className="pre-charge-banner__actions">
        <button
          type="button"
          className="pre-charge-banner__btn pre-charge-banner__btn--keep"
          onClick={handleKeep}
        >
          Keep Pro
        </button>
        <button
          type="button"
          className="pre-charge-banner__btn pre-charge-banner__btn--cancel"
          onClick={handleCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
