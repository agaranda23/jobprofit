/**
 * Public invoice token helpers — hosted invoice page.
 *
 * Mirrors publicQuoteToken.js. Each job that has an invoice sent gets the
 * same per-job publicAccessToken that the quote page uses. We reuse a single
 * token per job so a trader who already shared a quote link does not need to
 * generate a second token. The public route is /i/<token>.
 *
 * Security model: URL-as-capability — knowing the token is sufficient. The
 * Netlify function fetch-public-invoice accepts the token and returns only the
 * data a customer legitimately receives (job details + trader business info for
 * payment — no internal notes, receipts, photos, or other job PII).
 */

// Re-export from publicQuoteToken — same UUID format, same validator.
export { generatePublicAccessToken, isValidToken } from './publicQuoteToken';

/**
 * Builds the shareable hosted invoice URL for a job.
 *
 * @param {string} token - The job's publicAccessToken (UUID).
 * @param {string} [origin] - Override the origin (defaults to window.location.origin). Used in tests.
 * @returns {string} Full URL the customer taps, e.g. https://app.jobprofit.co.uk/i/<token>.
 */
export function buildPublicInvoiceUrl(token, origin) {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/i/${token}`;
}
