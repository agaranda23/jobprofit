/**
 * webShare.js — thin helpers for Web Share API Level 2 (file sharing).
 *
 * Extracted from SendInvoiceModal / ReceiptModal so ReviewSheet can use
 * the same capability check without duplicating it.
 */

/**
 * Returns true when the browser can share the given File via the OS share
 * sheet. Silently returns false on any exception (permission denied, etc.).
 *
 * Deliberately checks navigator.share / navigator.canShare at call time
 * (not at module load) so test mocks installed after import take effect.
 *
 * @param {File} file
 * @returns {boolean}
 */
export function canShareFile(file) {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.share !== 'function' ||
    typeof navigator.canShare !== 'function'
  ) {
    return false;
  }
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}
