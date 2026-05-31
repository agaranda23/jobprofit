/**
 * exportCsv.js — pure CSV builder for the "Export everything" Settings item.
 *
 * One row per job. Accountant-friendly columns drawn from the real job model:
 *   Date, Customer, Summary, Invoice/Total £, Costs £, Profit £, Status, Paid date
 *
 * "Costs £" = sum of receipts whose jobId matches job.id or job.cloudId.
 * The column is 0.00 when no receipts are linked (correct — no invented data).
 *
 * Pure function — no React, no DOM, no side effects. Unit-testable.
 *
 * Column rationale:
 *   - Date:        job.date (YYYY-MM-DD from cloud mapper; localDateStr for legacy)
 *   - Customer:    job.customer || job.name
 *   - Summary:     job.summary
 *   - Invoiced £:  job.total ?? job.amount (matches the figure on the invoice PDF)
 *   - Costs £:     sum of receipts linked to this job
 *   - Profit £:    Invoiced − Costs
 *   - Status:      derived display stage (Lead/Quoted/On/Invoiced/Overdue/Paid)
 *   - Paid date:   job.paymentDate || job.date when status === Paid, else blank
 *
 * Status derivation is intentionally a simpler variant of deriveDisplayStatus
 * in WorkScreen — it does NOT need to match WorkScreen pixel-for-pixel; the
 * accountant just needs a readable bucket. If the canonical version changes,
 * update here too but it is not load-bearing for accounting correctness.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function isPaidJob(job) {
  if (!job) return false;
  if (job.paid === true) return true;
  if (job.paymentStatus === 'paid') return true;
  if (job.status === 'paid') return true;
  return false;
}

/**
 * Lightweight status label for the CSV. Doesn't need to be pixel-perfect
 * with the UI's deriveDisplayStatus — just needs to be unambiguous for an
 * accountant reading the spreadsheet.
 */
function deriveStatusLabel(job) {
  if (!job) return '';
  if (isPaidJob(job)) return 'Paid';
  const s = (job.status || job.jobStatus || '').toLowerCase();
  const ps = (job.paymentStatus || '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled' || ps === 'cancelled') return 'Cancelled';
  if (s === 'draft') return 'Draft';
  if (s === 'lead') return 'Lead';
  if (s === 'quoted') return 'Quoted';
  if (s === 'invoice_sent') return 'Invoiced';
  if (s === 'active' || s === 'complete') return 'On';
  // Legacy fallback
  if (ps === 'awaiting') return 'Invoiced';
  return 'Lead';
}

/**
 * Escape a cell value for CSV: wrap in quotes, escape internal quotes.
 * Handles numbers (emitted as-is), strings (quoted), and null/undefined (empty).
 */
function cell(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return isFinite(val) ? String(val) : '';
  const str = String(val);
  // Quote any value that contains a comma, newline, or double-quote.
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function row(cols) {
  return cols.map(cell).join(',');
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds a UTF-8 CSV string from the user's jobs and linked receipts.
 *
 * @param {object[]} jobs     — normalised job objects (cloud or legacy shape)
 * @param {object[]} receipts — all receipts; matched to jobs via jobId / cloudId
 * @returns {string}          — CSV string (UTF-8, LF line endings)
 */
export function buildJobsCsv(jobs, receipts) {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];

  const headers = ['Date', 'Customer', 'Summary', 'Invoiced £', 'Costs £', 'Profit £', 'Status', 'Paid date'];
  const lines = [row(headers)];

  for (const job of safeJobs) {
    if (!job) continue;

    const invoiced = Number(job.total ?? job.amount ?? 0) || 0;

    // Match receipts linked to this job by jobId → job.id or job.cloudId
    const costs = safeReceipts
      .filter(r => {
        if (!r || r.jobId == null) return false;
        const jId = String(r.jobId);
        if (String(job.id) === jId) return true;
        if (job.cloudId != null && String(job.cloudId) === jId) return true;
        return false;
      })
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    const profit = invoiced - costs;
    const status = deriveStatusLabel(job);
    const paidDate = isPaidJob(job) ? (job.paymentDate || job.date || '') : '';

    lines.push(row([
      job.date || '',
      job.customer || job.name || '',
      job.summary || '',
      invoiced.toFixed(2),
      costs.toFixed(2),
      profit.toFixed(2),
      status,
      paidDate,
    ]));
  }

  return lines.join('\n');
}

/**
 * Triggers a download of the CSV. Uses the Web Share API on mobile when
 * available (share sheet → AirDrop, WhatsApp, email, Files etc.).
 * Falls back to an anchor-download on desktop.
 *
 * @param {string} csvString — output of buildJobsCsv()
 * @param {string} [filename]
 */
export async function downloadOrShareCsv(csvString, filename = 'jobprofit-export.csv') {
  const blob = new Blob(['﻿' + csvString], { type: 'text/csv;charset=utf-8;' });

  // Web Share API — works on iOS Safari 15+ and Android Chrome. The
  // `navigator.canShare` guard prevents a crash on browsers that have
  // navigator.share but don't accept files (e.g. older Chrome on desktop).
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    const file = new File([blob], filename, { type: 'text/csv' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'JobProfit export',
          text: 'Your jobs export from JobProfit',
        });
        return;
      } catch (err) {
        // User cancelled the share sheet — fall through to anchor download.
        if (err.name === 'AbortError') return;
        // Any other error: fall through silently to anchor download.
      }
    }
  }

  // Anchor download fallback (desktop or unsupported browsers)
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Small delay so the browser completes the download before revoke.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 150);
}
