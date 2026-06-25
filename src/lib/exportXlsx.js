/**
 * exportXlsx.js — client-side Excel (.xlsx) builder for the "Export" format sheet.
 *
 * Uses write-excel-file (write-only, no parse surface, no known CVEs).
 * Lazy-imported so the ~70 KB gzipped chunk is only fetched when the user
 * actually picks Excel — mirrors the pattern in exportPdf.js (jsPDF).
 *
 * Data source: deriveJobRows() from exportCsv.js — the single aggregation
 * function shared by CSV and PDF. The xlsx columns are identical to the
 * CSV columns so accountants can switch formats without re-learning layout.
 *
 * Columns (in order, matching exportCsv.js):
 *   Date · Customer · Summary · Invoiced £ · Costs £ · Profit £ · Status · Paid date
 *
 * Formatting choices:
 *   - Header row: bold, green background (#00A86B), white text, frozen (sticky)
 *   - £ columns: Number type with "£#,##0.00" Excel format — real numbers,
 *     not text strings, so SUM/pivot tables work immediately
 *   - Column widths: set to sensible character counts (no auto-fit needed)
 *   - Sheet name: "Jobs"
 *
 * @module exportXlsx
 */

import { deriveJobRows } from './exportCsv.js';
import { downloadOrShare } from './exportCsv.js';

const GBP_FORMAT = '£#,##0.00';
const HEADER_BG  = '#2563EB'; // brand blue
const HEADER_FG  = '#FFFFFF';

/**
 * Builds an .xlsx Blob from already-derived job rows.
 * Split from buildJobsXlsx so it can be tested in isolation.
 *
 * @param {object[]} rows — output of deriveJobRows(jobs, receipts)
 * @returns {Promise<Blob>} application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 */
export async function buildXlsxFromRows(rows) {
  // Lazy-load write-excel-file so it doesn't bloat the initial bundle.
  // The browser sub-path is the correct entry for Vite (returns a Blob).
  const { default: writeExcelFile } = await import('write-excel-file/browser');

  // Header row — bold, brand-green background, white text
  const header = [
    { value: 'Date',        fontWeight: 'bold', backgroundColor: HEADER_BG, color: HEADER_FG },
    { value: 'Customer',    fontWeight: 'bold', backgroundColor: HEADER_BG, color: HEADER_FG },
    { value: 'Summary',     fontWeight: 'bold', backgroundColor: HEADER_BG, color: HEADER_FG },
    { value: 'Invoiced £',  fontWeight: 'bold', backgroundColor: HEADER_BG, color: HEADER_FG },
    { value: 'Costs £',     fontWeight: 'bold', backgroundColor: HEADER_BG, color: HEADER_FG },
    { value: 'Profit £',    fontWeight: 'bold', backgroundColor: HEADER_BG, color: HEADER_FG },
    { value: 'Status',      fontWeight: 'bold', backgroundColor: HEADER_BG, color: HEADER_FG },
    { value: 'Paid date',   fontWeight: 'bold', backgroundColor: HEADER_BG, color: HEADER_FG },
  ];

  // One data row per job
  const dataRows = rows.map(r => [
    { value: r.date        || '',    type: String  },
    { value: r.customer    || '',    type: String  },
    { value: r.summary     || '',    type: String  },
    { value: Number(r.invoiced) || 0, type: Number, format: GBP_FORMAT },
    { value: Number(r.costs)    || 0, type: Number, format: GBP_FORMAT },
    { value: Number(r.profit)   || 0, type: Number, format: GBP_FORMAT },
    { value: r.status      || '',    type: String  },
    { value: r.paidDate    || '',    type: String  },
  ]);

  const sheetData = [header, ...dataRows];

  // Column widths (in "characters" — approximate, consistent with the CSV column order)
  const columns = [
    { width: 14 }, // Date
    { width: 24 }, // Customer
    { width: 36 }, // Summary
    { width: 14 }, // Invoiced £
    { width: 12 }, // Costs £
    { width: 12 }, // Profit £
    { width: 12 }, // Status
    { width: 14 }, // Paid date
  ];

  // stickyRowsCount: 1 freezes the header row (Excel "Freeze Top Row")
  return writeExcelFile(sheetData, { columns, sheet: 'Jobs', stickyRowsCount: 1 }).toBlob();
}

/**
 * Full entry point: aggregates jobs + receipts, builds the .xlsx, triggers
 * download or share sheet (mirrors buildJobsPdf / buildJobsCsv entry points).
 *
 * @param {object[]} jobs
 * @param {object[]} receipts
 * @param {string}   [filename]
 * @returns {Promise<void>}
 */
export async function buildJobsXlsx(jobs, receipts, filename = 'jobprofit-export.xlsx') {
  const rows = deriveJobRows(jobs, receipts);
  const blob = await buildXlsxFromRows(rows);
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  await downloadOrShare(blob, filename, XLSX_MIME);
}
