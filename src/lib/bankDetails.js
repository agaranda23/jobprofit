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

/**
 * Formats raw sort-code input as NN-NN-NN. Strips non-digits and caps at 6.
 *
 * @param {string} raw
 * @returns {string}
 */
export function formatSortCode(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}
