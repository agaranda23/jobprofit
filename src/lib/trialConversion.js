/**
 * trialConversion.js — pure helpers for the trial-end conversion flow.
 *
 * Extracted from component files so the component files only export components
 * (satisfies react-refresh/only-export-components lint rule).
 *
 * Exports:
 *   deriveProofLine(jobs)              — Moment-1 proof-line tier + stats
 *   formatChargeDate(trialEndsAt)      — "DD Mmm" charge date string
 *   shouldShowPreChargeReminder(profile, now) — Day-~43 banner gate
 *   PRE_CHARGE_REMINDER_DISMISSED_KEY  — localStorage key
 */

// ── Moment-1 proof-line helper ────────────────────────────────────────────────

/**
 * Derive proof-line stats from the jobs array for the trial_end variant.
 * Returns { tier, quoteCount, invoiceCount, paidTotal } where tier is one of
 * 'strong', 'medium', 'light'.
 *
 * Strong  — at least 1 paid job (show paid total)
 * Medium  — at least 1 invoice sent but none paid
 * Light   — fallback (no stats worth surfacing)
 *
 * NEVER renders £0 or "0 quotes" — falls through to 'light' copy instead.
 *
 * @param {Array} jobs
 * @returns {{ tier: 'strong'|'medium'|'light', quoteCount: number, invoiceCount: number, paidTotal: string|null }}
 */
export function deriveProofLine(jobs = []) {
  const paid = jobs.filter(j =>
    j.status === 'paid' || j.paid === true || j.paymentStatus === 'paid'
  );
  const sent = jobs.filter(j =>
    j.status === 'invoice_sent' || j.invoiceSentAt
  );

  const quoteCount = jobs.filter(j => j.total > 0 || j.amount > 0).length;
  const invoiceCount = sent.length;

  const rawPaidTotal = paid.reduce((sum, j) => sum + Number(j.total ?? j.amount ?? 0), 0);
  const paidTotal = rawPaidTotal > 0
    ? `£${rawPaidTotal.toLocaleString('en-GB', { minimumFractionDigits: 0 })}`
    : null;

  if (paid.length >= 1 && paidTotal) {
    return { tier: 'strong', quoteCount, invoiceCount, paidTotal };
  }
  if (sent.length >= 1 && quoteCount >= 1) {
    return { tier: 'medium', quoteCount, invoiceCount, paidTotal };
  }
  return { tier: 'light', quoteCount, invoiceCount, paidTotal: null };
}

/**
 * Format the charge date (trial_ends_at + 30 days) as "D Mmm" e.g. "7 Aug".
 *
 * @param {string|null|undefined} trialEndsAt — ISO date string
 * @returns {string}
 */
export function formatChargeDate(trialEndsAt) {
  if (!trialEndsAt) return '30 days from now';
  const d = new Date(trialEndsAt);
  d.setDate(d.getDate() + 30);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── Pre-charge reminder gate ───────────────────────────────────────────────────

/**
 * localStorage key for the Day-~43 pre-charge reminder banner dismissal.
 * Stores today's date string (YYYY-MM-DD) so the banner is suppressed for
 * the rest of that calendar day.
 */
export const PRE_CHARGE_REMINDER_DISMISSED_KEY = 'jp.preChargeReminderDismissed';

/**
 * Returns true when the in-app pre-charge reminder banner should be shown.
 * Rule: plan='trial' (Moment-1 accepted), charge date within 5 days, not
 * dismissed today.
 *
 * @param {object|null|undefined} profile
 * @param {Date} [now]
 * @returns {boolean}
 */
export function shouldShowPreChargeReminder(profile, now = new Date()) {
  if (profile?.plan !== 'trial') return false;
  if (!profile?.trial_ends_at) return false;

  // Charge date = trial_ends_at + 30 days
  const chargeMs = new Date(profile.trial_ends_at).getTime() + 30 * 86400000;
  const msUntilCharge = chargeMs - now.getTime();

  // Show within 5 days of charge, but not after it
  if (msUntilCharge < 0 || msUntilCharge > 5 * 86400000) return false;

  // Per-day dismissal gate
  try {
    const stored = localStorage.getItem(PRE_CHARGE_REMINDER_DISMISSED_KEY);
    if (stored === now.toISOString().slice(0, 10)) return false;
  } catch {
    // localStorage unavailable — show anyway
  }

  return true;
}
