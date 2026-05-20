/**
 * Public quote token helpers — Phase G-1.
 *
 * Each job that is shared with a customer gets a per-job UUID stored in
 * meta.publicAccessToken. The token is generated lazily — only when the
 * trader taps "Send link" for the first time. Tokens are valid indefinitely
 * in v1; rotation UI is deferred to a later phase.
 *
 * The public route /q/<token> is accessible without auth. Supabase RLS allows
 * anonymous SELECT on jobs rows that have a non-null publicAccessToken, and
 * the client query filters by the specific token value supplied in the URL.
 * The combination "must have a token" + "must match the URL token" gives
 * URL-as-capability security without any server-side crypto.
 */

/**
 * Generates a new public access token for a job.
 * Uses browser-native crypto.randomUUID — no external dep required.
 *
 * @returns {string} A UUID v4 string suitable for storing in job.publicAccessToken.
 */
export function generatePublicAccessToken() {
  return crypto.randomUUID();
}

/**
 * Builds the shareable public quote URL for a job.
 *
 * @param {string} token - The job's publicAccessToken (UUID).
 * @param {string} [origin] - Override the origin (defaults to window.location.origin). Used in tests.
 * @returns {string} The full URL the customer taps (e.g. https://app.jobprofit.co.uk/q/<token>).
 */
export function buildPublicQuoteUrl(token, origin) {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/q/${token}`;
}

/**
 * Builds a pre-filled WhatsApp share message containing the public quote URL.
 *
 * @param {string} url - The public quote URL.
 * @param {string} [customerName] - Customer's name (for personalisation). Falls back to generic greeting.
 * @param {string} [businessName] - Trader's business name. Appears in the sign-off.
 * @returns {string} Plain text message suitable for WhatsApp / clipboard.
 */
export function buildShareMessage(url, customerName, businessName) {
  const greeting = customerName ? `Hi ${customerName},` : 'Hi,';
  const signoff = businessName ? `\n\n${businessName}` : '';
  return `${greeting} here's your quote — tap to view:\n\n${url}${signoff}`;
}

/**
 * Checks whether a string looks like a valid UUID v4 (the shape returned by
 * crypto.randomUUID). Used in tests + the public route guard.
 *
 * @param {string} token
 * @returns {boolean}
 */
export function isValidToken(token) {
  if (typeof token !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);
}
