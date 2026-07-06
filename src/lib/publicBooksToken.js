/**
 * Public books-link token helpers — the accountant "books link"
 * (feat/accountant-books-link).
 *
 * Mirrors publicQuoteToken.js / publicInvoiceToken.js. A Pro trader mints a
 * single revocable UUID stored in profiles.books_share_token (NOT per-job —
 * this is one link for the whole business's books, unlike the per-job quote/
 * invoice tokens). The public route is /books/<token>.
 *
 * Security model: SERVICE-ROLE-ONLY server lookup — see fetch-books-summary.js.
 * There is deliberately NO anon RLS policy on profiles; knowing the token is
 * necessary but the actual gate is the Netlify function's exact-match lookup
 * plus a live isPro() re-check, not a client-side Supabase query.
 */

// Re-export the UUID generator/validator — same format, same validator, as
// every other public-link token in this app.
export { generatePublicAccessToken as generateBooksShareToken, isValidToken as isValidBooksToken } from './publicQuoteToken';

/**
 * Builds the shareable public books-link URL.
 *
 * @param {string} token - The trader's books_share_token (UUID).
 * @param {string} [origin] - Override the origin (defaults to window.location.origin). Used in tests.
 * @returns {string} Full URL to hand to an accountant, e.g. https://app.ohnar.co.uk/books/<token>.
 */
export function buildPublicBooksUrl(token, origin) {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/books/${token}`;
}
