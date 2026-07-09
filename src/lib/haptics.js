/**
 * haptics.js — tasteful vibration patterns for key user moments.
 *
 * Uses navigator.vibrate (Web Vibration API). iOS PWA does not support this
 * API, so all calls are no-ops there — intentional, not a bug.
 *
 * Pattern guide:
 *   light   —  8ms    single tap (page settle, minor confirm)
 *   medium  — 18ms    single tap (send invoice, secondary action)
 *   success — [12,40,18]  double-tap (mark paid, celebration)
 *   warning — [10,30,10]  double-tap (error, overdue alert)
 *
 * Call sites (keep sparse — only meaningful moments):
 *   success → mark-paid celebration, quote-accepted realtime notification
 *   medium  → send invoice/quote confirmed
 *   light   → swipe pager page-settle, chase/reminder sent, job/quote saved
 *   warning → (reserved — not wired at launch)
 *
 * iOS Safari/PWA feedback: since vibrate() is a no-op there, every call site
 * above that isn't ALSO backed by an on-screen visual (a toast, or the
 * PaidCelebration/InvoiceSentMoment overlays) has a synthesized-audio partner
 * — see src/lib/paymentSound.js (mark-paid) and src/lib/momentEarcons.js
 * (send/chase/quote-accepted) — so the moment is never silent on iPhone.
 */

const PATTERNS = {
  light:   8,
  medium:  18,
  success: [12, 40, 18],
  warning: [10, 30, 10],
};

const supported =
  typeof navigator !== 'undefined' &&
  typeof navigator.vibrate === 'function';

/**
 * Fire a haptic pattern.
 * @param {'light'|'medium'|'success'|'warning'} kind
 */
export function haptic(kind) {
  if (!supported) return;
  const pattern = PATTERNS[kind];
  if (pattern == null) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Silently ignore — browser may block vibrate in certain contexts.
  }
}
