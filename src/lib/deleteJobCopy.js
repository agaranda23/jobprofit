/**
 * Shared confirmation copy for the job-delete dialog.
 *
 * Used by WorkScreen (tile ⋯ modal) and JobDetailDrawer (profile kebab)
 * so both surfaces are always byte-identical.
 *
 * `buildDeleteJobCopy(customerName)` returns the four strings with the
 * customer name interpolated into the body. When no customer name is
 * available, the body falls back to generic phrasing.
 */

export const DELETE_JOB_TITLE = 'Delete this job?';
export const DELETE_JOB_CONFIRM_LABEL = 'Delete job';
export const DELETE_JOB_CANCEL_LABEL = 'Cancel';

/**
 * Builds the body string with the customer name interpolated.
 * Falls back gracefully when the name is absent.
 *
 * @param {string} [customerName] – e.g. "Bob Smith"
 * @returns {string}
 */
export function buildDeleteJobBody(customerName) {
  if (customerName && customerName.trim()) {
    return `This permanently deletes ${customerName.trim()}'s job and everything attached to it — photos, receipts, payments and notes. You can't get it back.`;
  }
  return "This permanently deletes this job and everything attached to it — photos, receipts, payments and notes. You can't get it back.";
}

/**
 * Convenience helper: returns all four strings as an object.
 *
 * @param {string} [customerName]
 * @returns {{ title: string, body: string, confirmLabel: string, cancelLabel: string }}
 */
export function buildDeleteJobCopy(customerName) {
  return {
    title: DELETE_JOB_TITLE,
    body: buildDeleteJobBody(customerName),
    confirmLabel: DELETE_JOB_CONFIRM_LABEL,
    cancelLabel: DELETE_JOB_CANCEL_LABEL,
  };
}
