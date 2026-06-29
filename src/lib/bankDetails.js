/**
 * bankDetails.js — shared helpers for trader bank-detail checks.
 *
 * Extracted from SendInvoiceModal / ReviewSheet (and their tests), which each
 * carried an identical copy. Single source of truth for the just-in-time bank
 * gate so the invoice-send and quote-send paths can't drift.
 */

/**
 * Returns true when the profile has both a sort code and an account number.
 * The JIT bank gate fires whenever either field is absent (not just when both
 * are null/empty).
 *
 * @param {{sort_code?: string, account_number?: string}|null|undefined} profile
 * @returns {boolean}
 */
export function profileHasBank(profile) {
  return !!(profile?.sort_code && profile?.account_number);
}
