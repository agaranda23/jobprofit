/**
 * accountantExport.js — Xero-ready / QuickBooks-ready CSV builders.
 *
 * This is a SMARTER EXPORT ONLY. No OAuth, no API connection, no live sync,
 * no app certification with either platform. It builds correctly-shaped CSV
 * files that a trader hands to their accountant (or imports themselves) —
 * the accountant does one bulk import, not 40 manual entries.
 *
 * NEVER describe this feature as "syncing" to Xero/QuickBooks in any UI
 * copy — it produces files the user imports; nothing talks to either
 * platform's API.
 *
 * Pure functions only — no React, no DOM, no fetch. Fully unit-testable.
 * DOM/blob-touching code (the ZIP builder) is isolated in
 * buildAccountantExportZipBlob(), the only async, side-effect-adjacent export.
 *
 * ── Data model notes (verified against the live job/receipt shapes) ─────────
 *   Prices entered in the app are VAT-INCLUSIVE (gross) — see vatUtils.js.
 *   We derive net/VAT for export the same way the invoice PDF does:
 *   splitVatInclusive(gross, rate). rate = 0.2 when the trader is
 *   VAT-registered, 0 when not (so "net" naturally equals "gross" for a
 *   non-VAT-registered trader — there is no VAT to strip out).
 *
 *   job.lineItems[n] = { desc, cost, qty?, quantity?, rate? } — cost is GROSS
 *   per line (mirrors drawLineItems() in invoicePDF.js). Jobs with no
 *   lineItems fall back to a single line from job.summary / job.total.
 *
 *   job.invoiceNumber / job.invoiceSentAt / job.invoiceDueDate are the
 *   canonical invoice fields (see WorkScreen.jsx). A job only counts as an
 *   "invoice" for this export once invoiceNumber is set — leads/quotes are
 *   never included in the Sales Invoices / Invoices files.
 *
 *   receipt.amount is GROSS, receipt.vat is the trader's own recorded VAT
 *   figure (not assumed at 20% — some receipts carry partial/mixed VAT).
 *   receipt.invoiceNumber is the supplier's own reference when known.
 *
 * ── AccountCode ──────────────────────────────────────────────────────────
 *   Left blank on every row, deliberately. A trader's chart of accounts is
 *   theirs to define — guessing a code (e.g. defaulting to "200") risks
 *   silently misclassifying income/expense in the accountant's ledger, which
 *   is worse than an empty cell the accountant fills in during import.
 *
 * ── UnitAmount / Xero "amounts are" setting ─────────────────────────────────
 *   UnitAmount is the NET (ex-VAT) line amount; TaxType tells Xero to add
 *   VAT on top. This matches Xero's default "Tax Exclusive" org setting.
 *   If the accountant's Xero org is instead set to "Tax Inclusive", the
 *   imported invoice totals will be wrong by the VAT amount — this is the
 *   one thing that MUST be checked in a real Xero trial import before this
 *   export is trusted (see PR description).
 */

import { splitVatInclusive } from './vatUtils.js';
import { taxYearFor, taxYearStart, taxYearEnd, quarterBounds } from './taxYear.js';
import { isExcludedJob, isPaidJob } from './jobPredicates.js';

// ── CSV primitives (mirrors exportCsv.js / receiptsCsv.js — keep in sync) ───

function cell(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return isFinite(val) ? String(val) : '';
  const str = String(val);
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function row(cols) {
  return cols.map(cell).join(',');
}

// ── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Formats an ISO date/datetime string as UK DD/MM/YYYY.
 * @param {string} dateStr
 * @returns {string} '' if dateStr is falsy or unparseable
 */
export function formatDateUK(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function inRange(dateStr, start, end) {
  if (!start || !end) return true; // no bound supplied — don't hide data
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d >= start && d <= end;
}

/**
 * Resolves the { start, end, label } window for a period preset.
 *
 * @param {'this_tax_year'|'last_tax_year'|'this_quarter'|'custom'} period
 * @param {object} [opts]
 * @param {string} [opts.customStart] - 'YYYY-MM-DD', only used when period === 'custom'
 * @param {string} [opts.customEnd]   - 'YYYY-MM-DD', only used when period === 'custom'
 * @param {Date}   [opts.now]         - injectable for testing
 * @returns {{ start: Date|null, end: Date|null, label: string }}
 */
export function resolveExportPeriod(period, { customStart, customEnd, now = new Date() } = {}) {
  if (period === 'this_tax_year') {
    return { start: taxYearStart(now), end: taxYearEnd(now), label: taxYearFor(now).replace('/', '-') };
  }
  if (period === 'last_tax_year') {
    const shifted = new Date(now);
    shifted.setFullYear(shifted.getFullYear() - 1);
    return { start: taxYearStart(shifted), end: taxYearEnd(shifted), label: taxYearFor(shifted).replace('/', '-') };
  }
  if (period === 'this_quarter') {
    const bounds = quarterBounds(now);
    const q = Math.floor(bounds.start.getMonth() / 3) + 1;
    return { start: bounds.start, end: bounds.end, label: `${bounds.start.getFullYear()}-Q${q}` };
  }
  // custom — both dates required to actually filter; a single supplied date
  // is treated as "no bound on that side" rather than guessing the other end.
  const start = customStart ? new Date(`${customStart}T00:00:00`) : null;
  const end = customEnd ? new Date(`${customEnd}T23:59:59`) : null;
  const label = customStart && customEnd ? `${customStart}_to_${customEnd}` : 'custom-range';
  return { start, end, label };
}

// ── Job → invoice-line derivation (shared by Xero + QuickBooks invoices) ────

/**
 * @param {object} job
 * @returns {{ desc: string, qty: number, grossAmount: number }[]}
 */
function deriveInvoiceLines(job) {
  const rawItems = Array.isArray(job?.lineItems) ? job.lineItems : [];
  if (rawItems.length > 0) {
    const lines = rawItems
      .filter(li => li && (li.desc || Number(li.cost) > 0))
      .map(li => ({
        desc: li.desc || job?.summary || 'Work completed',
        qty: Number(li.qty ?? li.quantity ?? 1) || 1,
        grossAmount: Number(li.cost) || 0,
      }));
    if (lines.length > 0) return lines;
  }
  return [{
    desc: job?.summary || 'Work completed',
    qty: 1,
    grossAmount: Number(job?.total ?? job?.amount ?? 0) || 0,
  }];
}

/**
 * Splits a gross line amount into net/VAT. rate is 0 for non-VAT-registered
 * traders, so net === gross in that case (nothing to strip out).
 */
function splitLine(grossAmount, isVatRegistered) {
  return splitVatInclusive(grossAmount, isVatRegistered ? 0.2 : 0);
}

function resolveInvoiceDateRaw(job) {
  return job?.invoiceSentAt || job?.date || '';
}

/**
 * Mirrors the due-date fallback in invoicePDF.js: caller-supplied invoiceDueDate
 * wins; otherwise invoice date + payment_terms_days (default 14) so the export
 * agrees with the due date the customer actually saw on their invoice PDF.
 */
function resolveDueDateRaw(job, profile) {
  if (job?.invoiceDueDate) return job.invoiceDueDate;
  const base = resolveInvoiceDateRaw(job);
  if (!base) return '';
  const d = new Date(base);
  if (isNaN(d.getTime())) return '';
  const termsDays = Number(profile?.payment_terms_days ?? 14);
  d.setDate(d.getDate() + termsDays);
  return d.toISOString().slice(0, 10);
}

// ── Xero builders ────────────────────────────────────────────────────────────

const XERO_SALES_HEADERS = [
  'ContactName', 'InvoiceNumber', 'InvoiceDate', 'DueDate', 'Description',
  'Quantity', 'UnitAmount', 'AccountCode', 'TaxType', 'Currency',
];

/**
 * Xero "Sales Invoices" import file. One row PER INVOICE LINE — a multi-line
 * invoice repeats the same InvoiceNumber across several rows (Xero's bulk
 * import format, not a nested structure).
 *
 * @param {object[]} jobs
 * @param {object} opts
 * @param {boolean} opts.isVatRegistered
 * @param {object} [opts.profile] - used only for the due-date fallback (payment_terms_days)
 * @param {Date|null} opts.start
 * @param {Date|null} opts.end
 * @returns {string} CSV string
 */
export function buildXeroSalesInvoicesCsv(jobs, { isVatRegistered = false, profile = null, start = null, end = null } = {}) {
  const lines = [row(XERO_SALES_HEADERS)];
  const taxType = isVatRegistered ? '20% (VAT on Income)' : 'No VAT';

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || isExcludedJob(job) || !job.invoiceNumber) continue;
    const invoiceDateRaw = resolveInvoiceDateRaw(job);
    if (!inRange(invoiceDateRaw, start, end)) continue;

    const contactName = job.customer || job.name || 'Customer';
    const invoiceDate = formatDateUK(invoiceDateRaw);
    const dueDate = formatDateUK(resolveDueDateRaw(job, profile));

    for (const line of deriveInvoiceLines(job)) {
      const { net } = splitLine(line.grossAmount, isVatRegistered);
      lines.push(row([
        contactName,
        job.invoiceNumber,
        invoiceDate,
        dueDate,
        line.desc,
        line.qty,
        net.toFixed(2),
        '', // AccountCode — see file header note
        taxType,
        'GBP',
      ]));
    }
  }
  return lines.join('\n');
}

const XERO_BILLS_HEADERS = [
  'ContactName', 'InvoiceNumber', 'InvoiceDate', 'Description',
  'Quantity', 'UnitAmount', 'AccountCode', 'TaxType',
];

/**
 * Xero "Bills" import file, built from receipts/expenses. One row per receipt
 * (receipts aren't itemised the way invoices are, so there's no per-line
 * repeat here).
 *
 * @param {object[]} receipts
 * @param {object} opts
 * @param {boolean} opts.isVatRegistered
 * @param {Date|null} opts.start
 * @param {Date|null} opts.end
 * @returns {string} CSV string
 */
export function buildXeroBillsCsv(receipts, { isVatRegistered = false, start = null, end = null } = {}) {
  const lines = [row(XERO_BILLS_HEADERS)];
  const taxType = isVatRegistered ? '20% (VAT on Expenses)' : 'No VAT';

  for (const r of Array.isArray(receipts) ? receipts : []) {
    if (!r || !inRange(r.date, start, end)) continue;
    const gross = Number(r.amount) || 0;
    // Non-VAT-registered traders can't reclaim input VAT — the whole gross
    // amount is just the cost. VAT-registered traders reclaim using the
    // receipt's OWN recorded VAT figure (not an assumed 20% split).
    const net = isVatRegistered ? gross - (Number(r.vat) || 0) : gross;
    const contactName = r.label || r.merchant || 'Supplier';
    const invoiceNumber = r.invoiceNumber || `RCPT-${r.id}`;

    lines.push(row([
      contactName,
      invoiceNumber,
      formatDateUK(r.date),
      contactName,
      1,
      net.toFixed(2),
      '', // AccountCode — see file header note
      taxType,
    ]));
  }
  return lines.join('\n');
}

// ── QuickBooks builders ──────────────────────────────────────────────────────

const QB_INVOICES_HEADERS = ['InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Description', 'Qty', 'Amount', 'TaxAmount'];

/**
 * QuickBooks "Invoices" import file. Amount is NET, TaxAmount is the VAT
 * portion — Amount + TaxAmount reconciles exactly to the gross the customer
 * was actually charged. One row per invoice line (same source as Xero).
 */
export function buildQuickBooksInvoicesCsv(jobs, { isVatRegistered = false, profile = null, start = null, end = null } = {}) {
  const lines = [row(QB_INVOICES_HEADERS)];

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || isExcludedJob(job) || !job.invoiceNumber) continue;
    const invoiceDateRaw = resolveInvoiceDateRaw(job);
    if (!inRange(invoiceDateRaw, start, end)) continue;

    const customer = job.customer || job.name || 'Customer';
    const invoiceDate = formatDateUK(invoiceDateRaw);
    const dueDate = formatDateUK(resolveDueDateRaw(job, profile));

    for (const line of deriveInvoiceLines(job)) {
      const { net, vat } = splitLine(line.grossAmount, isVatRegistered);
      lines.push(row([
        job.invoiceNumber,
        customer,
        invoiceDate,
        dueDate,
        line.desc,
        line.qty,
        net.toFixed(2),
        vat.toFixed(2),
      ]));
    }
  }
  return lines.join('\n');
}

const QB_EXPENSES_HEADERS = ['Date', 'Description', 'Amount'];

/**
 * QuickBooks "Expenses/Bank" (money out) file. Amount is the full GROSS
 * amount — this mirrors an actual bank-statement line (what really left the
 * account), not an accounting-adjusted net figure.
 */
export function buildQuickBooksExpensesCsv(receipts, { start = null, end = null } = {}) {
  const lines = [row(QB_EXPENSES_HEADERS)];

  for (const r of Array.isArray(receipts) ? receipts : []) {
    if (!r || !inRange(r.date, start, end)) continue;
    const gross = Number(r.amount) || 0;
    lines.push(row([
      formatDateUK(r.date),
      r.label || r.merchant || 'Expense',
      gross.toFixed(2),
    ]));
  }
  return lines.join('\n');
}

const QB_PAYMENTS_HEADERS = ['Date', 'Description', 'Amount'];

/**
 * "Payments/Bank" (money in) file — one row per paid job, using the amount
 * actually received. Shared shape works for both platforms; nice-to-have
 * per the spec (Sales Invoices / Bills correctness is the priority).
 */
export function buildPaymentsCsv(jobs, { start = null, end = null } = {}) {
  const lines = [row(QB_PAYMENTS_HEADERS)];

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || !isPaidJob(job)) continue;
    const paidDateRaw = job.paymentDate || job.date;
    if (!inRange(paidDateRaw, start, end)) continue;
    const gross = Number(job.total ?? job.amount ?? 0) || 0;
    const customer = job.customer || job.name || 'Customer';
    const ref = job.invoiceNumber ? ` (${job.invoiceNumber})` : '';
    lines.push(row([
      formatDateUK(paidDateRaw),
      `Payment received - ${customer}${ref}`,
      gross.toFixed(2),
    ]));
  }
  return lines.join('\n');
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Builds the full set of accountant-export files for one platform + period.
 * Pure — returns file contents only, no download/DOM/blob work.
 *
 * @param {object} args
 * @param {'xero'|'quickbooks'} args.platform
 * @param {object[]} [args.jobs]
 * @param {object[]} [args.receipts]
 * @param {object|null} [args.profile] - used for due-date fallback only
 * @param {boolean} [args.isVatRegistered]
 * @param {'this_tax_year'|'last_tax_year'|'this_quarter'|'custom'} [args.period]
 * @param {string} [args.customStart] - 'YYYY-MM-DD', period === 'custom' only
 * @param {string} [args.customEnd]   - 'YYYY-MM-DD', period === 'custom' only
 * @param {Date} [args.now] - injectable for testing
 * @returns {{ files: { filename: string, content: string }[], zipFilename: string }}
 */
export function buildAccountantExportFiles({
  platform,
  jobs = [],
  receipts = [],
  profile = null,
  isVatRegistered = false,
  period = 'this_tax_year',
  customStart,
  customEnd,
  now = new Date(),
}) {
  const { start, end, label } = resolveExportPeriod(period, { customStart, customEnd, now });
  const brand = 'OHNAR';

  if (platform === 'xero') {
    return {
      files: [
        { filename: `${brand}-Xero-Sales-Invoices-${label}.csv`, content: buildXeroSalesInvoicesCsv(jobs, { isVatRegistered, profile, start, end }) },
        { filename: `${brand}-Xero-Bills-${label}.csv`, content: buildXeroBillsCsv(receipts, { isVatRegistered, start, end }) },
        { filename: `${brand}-Xero-Payments-${label}.csv`, content: buildPaymentsCsv(jobs, { start, end }) },
      ],
      zipFilename: `${brand}-Xero-Export-${label}.zip`,
    };
  }

  if (platform === 'quickbooks') {
    return {
      files: [
        { filename: `${brand}-QuickBooks-Invoices-${label}.csv`, content: buildQuickBooksInvoicesCsv(jobs, { isVatRegistered, profile, start, end }) },
        { filename: `${brand}-QuickBooks-Expenses-${label}.csv`, content: buildQuickBooksExpensesCsv(receipts, { start, end }) },
        { filename: `${brand}-QuickBooks-Payments-${label}.csv`, content: buildPaymentsCsv(jobs, { start, end }) },
      ],
      zipFilename: `${brand}-QuickBooks-Export-${label}.zip`,
    };
  }

  return { files: [], zipFilename: `${brand}-Export-${label}.zip` };
}

/**
 * Zips a set of { filename, content } CSV files into a single downloadable
 * Blob. JSZip is dynamically imported so it never bloats the main bundle —
 * it only loads the moment a Pro user actually generates an accountant pack
 * (mirrors the lazy-import pattern already used for jsPDF/write-excel-file
 * in exportPdf.js / exportXlsx.js).
 *
 * @param {{ filename: string, content: string }[]} files
 * @returns {Promise<Blob>}
 */
export async function buildAccountantExportZipBlob(files) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const f of files) {
    zip.file(f.filename, f.content);
  }
  return zip.generateAsync({ type: 'blob' });
}
