/**
 * Public receipt token helpers — hosted receipt page.
 *
 * Mirrors publicInvoiceToken.js. Receipts reuse the same per-job
 * publicAccessToken UUID that quotes and invoices use — one token per job,
 * one set of shared links. The public route is /r/<token>.
 *
 * Security model: URL-as-capability — knowing the token is sufficient.
 * The Netlify function fetch-public-receipt accepts the token and returns only
 * the safe public subset for a receipt (business details, amount paid, paid date).
 * No internal notes, receipts (expense receipts), photos, or profit data.
 */

export { generatePublicAccessToken, isValidToken } from './publicQuoteToken';

/**
 * Builds the shareable hosted receipt URL for a job.
 *
 * @param {string} token - The job's publicAccessToken (UUID).
 * @param {string} [origin] - Override the origin (defaults to window.location.origin). Used in tests.
 * @returns {string} Full URL, e.g. https://app.jobprofit.co.uk/r/<token>.
 */
export function buildPublicReceiptUrl(token, origin) {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/r/${token}`;
}
