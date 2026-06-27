/**
 * receiptsCsv.js — "Send to accountant" receipt export.
 *
 * Pure function: no React, no DOM, no side effects.
 * Called from DocumentSearchOverlay when the Pro user taps "Send to accountant"
 * with a tax-period filter active.
 *
 * Columns: Date, Merchant, Amount £, VAT £, Job, Invoice number
 *
 * Image zip is deferred to v2 (see spec §5, image-zip note). The caller
 * (DocumentSearchOverlay) uses downloadOrShare() from exportCsv.js to trigger
 * the share sheet / anchor download.
 */

/**
 * Escape a cell value for CSV: wrap strings in quotes, emit numbers as-is.
 * Mirrors the cell() helper in exportCsv.js — keep in sync if the escaping
 * logic ever changes.
 */
function cell(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return isFinite(val) ? String(val) : '';
  const str = String(val);
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function csvRow(cols) {
  return cols.map(cell).join(',');
}

/**
 * Builds a UTF-8 CSV string from a filtered list of receipts.
 *
 * @param {object[]} receipts — already filtered to the desired tax period
 * @param {object[]} jobs     — full jobs array (used to resolve job customer name
 *                               and invoice number from jobId)
 * @param {string}   taxYear  — label to include in the header comment (e.g. "2025/26")
 * @returns {string}          — CSV string (UTF-8, LF line endings)
 */
export function buildReceiptsCsv(receipts, jobs = [], taxYear = '') {
  const safeReceipts = Array.isArray(receipts) ? receipts : [];
  const safeJobs     = Array.isArray(jobs)     ? jobs     : [];

  // Build a quick lookup: jobId → job for customer name + invoice number.
  // Receipts may carry a UUID jobId (cloud) or numeric (legacy) — stringify both.
  const jobById = {};
  for (const j of safeJobs) {
    if (j && j.id != null) jobById[String(j.id)] = j;
    if (j && j.cloudId != null) jobById[String(j.cloudId)] = j;
  }

  const headers = ['Date', 'Merchant', 'Amount £', 'VAT £', 'Job / Customer', 'Invoice number'];
  const lines   = [];

  // Optional header comment identifying the tax year
  if (taxYear) {
    lines.push(`# Receipts export — tax year ${taxYear}`);
  }
  lines.push(csvRow(headers));

  for (const r of safeReceipts) {
    if (!r) continue;

    const job          = r.jobId ? jobById[String(r.jobId)] : null;
    const jobCustomer  = job ? (job.customer || job.name || '') : (r.jobId ? '' : 'Not on a job');
    const invoiceNum   = job ? (job.invoiceNumber || job.meta?.invoiceNumber || '') : '';

    lines.push(csvRow([
      r.date     || '',
      r.label    || r.merchant || '',
      Number(r.amount || 0).toFixed(2),
      Number(r.vat    || 0).toFixed(2),
      jobCustomer,
      invoiceNum,
    ]));
  }

  return lines.join('\n');
}
