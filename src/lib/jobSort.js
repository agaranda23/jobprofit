/**
 * jobSort.js — pure helpers for the Jobs-tab Phase 1 list behaviour.
 *
 * These are extracted from WorkScreen.jsx so they can be unit-tested in a
 * node environment without loading React or any DOM-dependent imports.
 *
 * Covered:
 *   jobMatchesQuery  — 1B client-side search filter
 *   sortJobsByStage  — 1C urgent-first sort per stage
 *   firstLineOfAddress — 1E address display helper
 */

/**
 * Filter a job against a free-text search query.
 *
 * Case-insensitive match on customer name, job summary, address, and phone.
 * Pure function — no backend, works fully offline.
 *
 * @param {object} job
 * @param {string|null|undefined} q
 * @returns {boolean}
 */
export function jobMatchesQuery(job, q) {
  if (!q) return true;
  const lower = q.toLowerCase();
  return (
    (job.customer || job.name || '').toLowerCase().includes(lower) ||
    (job.summary || '').toLowerCase().includes(lower) ||
    (job.address || '').toLowerCase().includes(lower) ||
    (job.phone || job.customerPhone || job.mobile || '').toLowerCase().includes(lower)
  );
}

/**
 * Sort jobs within a stage by urgency — opinionated default, no sort UI.
 *
 * Overdue  → oldest due-date first (most urgent to chase)
 * Invoiced → soonest-due first (pay attention before they flip Overdue)
 * On       → most recently touched first (updatedAt or createdAt)
 * Lead     → newest first (freshest enquiry at the top)
 * Quoted   → newest first (most recent quote at the top)
 * Paid     → most recently paid first (most recent win at the top)
 *
 * Returns a new array — does not mutate the input.
 *
 * @param {object[]} jobs
 * @param {string|null} stage
 * @returns {object[]}
 */
export function sortJobsByStage(jobs, stage) {
  const sorted = [...jobs];
  switch (stage) {
    case 'Overdue':
      sorted.sort((a, b) => {
        const aDate = a.invoiceDueDate ? new Date(a.invoiceDueDate) : new Date(a.invoiceSentAt ?? 0);
        const bDate = b.invoiceDueDate ? new Date(b.invoiceDueDate) : new Date(b.invoiceSentAt ?? 0);
        return aDate - bDate; // oldest (most overdue) first
      });
      break;
    case 'Invoiced':
      sorted.sort((a, b) => {
        const aDate = a.invoiceDueDate ? new Date(a.invoiceDueDate) : new Date(a.invoiceSentAt ?? 0);
        const bDate = b.invoiceDueDate ? new Date(b.invoiceDueDate) : new Date(b.invoiceSentAt ?? 0);
        return aDate - bDate; // soonest due first
      });
      break;
    case 'On':
      sorted.sort((a, b) => {
        const aDate = new Date(a.updatedAt || a.createdAt || 0);
        const bDate = new Date(b.updatedAt || b.createdAt || 0);
        return bDate - aDate; // most recently touched first
      });
      break;
    case 'Lead':
    case 'Quoted':
      sorted.sort((a, b) => {
        const aDate = new Date(a.createdAt || 0);
        const bDate = new Date(b.createdAt || 0);
        return bDate - aDate; // newest first
      });
      break;
    case 'Paid':
      sorted.sort((a, b) => {
        const aDate = new Date(a.paidAt || a.updatedAt || a.createdAt || 0);
        const bDate = new Date(b.paidAt || b.updatedAt || b.createdAt || 0);
        return bDate - aDate; // most recently paid first
      });
      break;
    default:
      break;
  }
  return sorted;
}

/**
 * First line of an address string (everything before the first comma or newline).
 * Returns '' when the address is empty or undefined.
 *
 * @param {string|null|undefined} address
 * @returns {string}
 */
export function firstLineOfAddress(address) {
  if (!address) return '';
  return address.split(/[,\n]/)[0].trim();
}
