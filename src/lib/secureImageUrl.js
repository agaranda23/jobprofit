/**
 * secureImageUrl.js — upgrades a bare http:// image URL to https:// so it
 * never trips a browser "Not secure" / mixed-content warning when rendered
 * on an https page.
 *
 * Root cause this guards against: LogoModal's paste-URL path used to save
 * profile.logo_url verbatim with no scheme enforcement, so some traders'
 * profiles still hold an old http:// value. Rendering that with a bare
 * <img src="http://…"> on an https page (including the PUBLIC customer-
 * facing quote/invoice/receipt pages) is mixed content — this is the
 * "make old data safe on display" half of the fix; LogoModal itself now
 * also blocks new http:// saves (see LogoModal.jsx handleUrlSave).
 *
 * Deliberately conservative — only rewrites a bare http:// scheme. Every
 * other shape is returned completely unchanged:
 *   - https://…            already secure
 *   - //cdn.example.com/…  protocol-relative — inherits the page's own scheme
 *   - data:image/…         inline data URI — no network fetch at all
 *   - '' / null / undefined  falsy — callers already guard these with &&
 */

/**
 * @param {string|null|undefined} url
 * @returns {string|null|undefined} the same value, with a leading "http://" upgraded to "https://"
 */
export function secureImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (/^http:\/\//i.test(url)) {
    return `https://${url.slice('http://'.length)}`;
  }
  return url;
}
