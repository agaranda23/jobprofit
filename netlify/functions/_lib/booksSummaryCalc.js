/**
 * booksSummaryCalc — pure computation + response-shape allow-lists for the
 * accountant "books link" (feat/accountant-books-link).
 *
 * Deliberately self-contained: duplicates small pieces of taxYear.js /
 * vatUtils.js / jobPredicates.js / accountantExport.js's resolveExportPeriod /
 * plan.js's isPro, rather than importing them from src/lib. This mirrors the
 * existing weeklyDigestCalc.js convention — Netlify function calc logic stays
 * dependency-free of the browser bundle (accountantExport.js in particular
 * carries a dynamic `import('jszip')` we never want anywhere near a Lambda
 * bundle). Keep the duplicated math in sync with those files if either
 * changes; each duplicated block below says which file it mirrors.
 *
 * SECURITY — this module is the single source of truth for "what shape can
 * leave this function." Every response (top level, and every nested job /
 * receipt / customer item) is built with pickAllowed() against a hardcoded
 * allow-list exported below. This is a WHITELIST, not a denylist — a denylist
 * ("strip these secret keys") silently leaks the next secret column someone
 * adds to `profiles`; a whitelist cannot, by construction. Tests assert the
 * response key-set is a subset of these lists.
 *
 * No Supabase, no browser APIs — pure functions, fully unit-testable.
 */

const VAT_RATE = 0.2;

// ── Response allow-lists (whitelist-shape, not denylist) ────────────────────
// NEVER add sort_code / account_number / account_name / any stripe_* field /
// user_id / raw meta to any of these lists. See PR description + migration
// header for why (an accountant reviewing income/expenses/VAT has no need for
// the trader's own bank or Stripe IDs — unlike fetch-public-quote-profile.js,
// where bank fields are justified because the CUSTOMER needs them to pay a
// deposit; that justification does not transfer here).
export const TOP_LEVEL_ALLOWED_KEYS = [
  'business', 'period', 'income', 'expenses', 'profit', 'vat', 'taxEstimate',
  'invoicedJobs', 'receipts', 'customers',
];
export const BUSINESS_ALLOWED_KEYS = ['name', 'address', 'vatNumber', 'vatRegistered', 'logoUrl', 'paymentTermsDays'];
export const PERIOD_ALLOWED_KEYS = ['id', 'label', 'start', 'end'];
export const INCOME_ALLOWED_KEYS = ['paidTotal', 'invoicedTotal'];
export const EXPENSES_ALLOWED_KEYS = ['total', 'vatTotal'];
export const VAT_ALLOWED_KEYS = ['grossSales', 'netSales', 'outputVat', 'inputVat', 'netVat'];
export const JOB_ALLOWED_KEYS = ['customer', 'summary', 'amount', 'date', 'invoiceNumber', 'paid', 'vatAmount'];
export const RECEIPT_ALLOWED_KEYS = ['label', 'amount', 'vat', 'date'];
export const CUSTOMER_ALLOWED_KEYS = ['name', 'paidTotal', 'jobCount'];

/** Explicit-pick helper — the only way response objects are built in this module. */
export function pickAllowed(obj, keys) {
  const out = {};
  if (!obj) return out;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

const VALID_PERIODS = new Set(['this_tax_year', 'last_tax_year', 'this_quarter', 'custom']);

export function isValidBooksPeriod(period) {
  return VALID_PERIODS.has(period);
}

// ── Pro re-check (mirrors isPro()/planAllowsPro()/isTrialActive() in
//    src/lib/plan.js — keep in sync). Deliberately does NOT mirror
//    UNLOCK_PRO_FOR_ALL (the temporary "unlock everyone" dev override): that
//    flag exists to unblock UI/feature review during development, not to
//    govern whether financial data can leave a token-gated server function.
//    If it's ever flipped true again, this check stays strict — failing
//    toward "deny" is the correct default for a security-sensitive gate. ────
export function isProNow(profile, now = new Date()) {
  if (!profile) return false;
  if (profile.plan === 'pro') return true;
  if (profile.plan === 'trial' && profile.trial_ends_at) {
    return new Date(profile.trial_ends_at) > now;
  }
  return false;
}

// ── Predicates (mirrors src/lib/jobPredicates.js) ────────────────────────────
function isPaidJob(job) {
  if (!job) return false;
  if (job.paid === true) return true;
  if (job.paymentStatus === 'paid') return true;
  if (job.status === 'paid') return true;
  return false;
}

function isExcludedJob(job) {
  if (!job) return true;
  const s = (job.status || job.jobStatus || '').toLowerCase();
  const ps = (job.paymentStatus || '').toLowerCase();
  if (s === 'cancelled' || s === 'canceled' || s === 'draft') return true;
  if (ps === 'cancelled' || ps === 'canceled') return true;
  return false;
}

// ── VAT split (mirrors src/lib/vatUtils.js splitVatInclusive) ───────────────
function splitVatInclusive(gross, rate = VAT_RATE) {
  const g = Number(gross) || 0;
  if (g === 0) return { gross: 0, net: 0, vat: 0 };
  const net = g / (1 + rate);
  const vat = g - net;
  return { gross: g, net, vat };
}

// ── UK tax-year + quarter bounds (mirrors src/lib/taxYear.js) ───────────────
function taxYearStart(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const startYear = (month > 4 || (month === 4 && day >= 6)) ? year : year - 1;
  return new Date(startYear, 3, 6);
}

function taxYearEnd(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const startYear = (month > 4 || (month === 4 && day >= 6)) ? year : year - 1;
  const endYear = startYear + 1;
  return new Date(endYear, 3, 5, 23, 59, 59);
}

function taxYearLabel(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const startYear = (month > 4 || (month === 4 && day >= 6)) ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

function quarterBounds(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  const month = d.getMonth();
  const qStart = Math.floor(month / 3) * 3;
  const start = new Date(d.getFullYear(), qStart, 1);
  const end = new Date(d.getFullYear(), qStart + 3, 0, 23, 59, 59);
  return { start, end };
}

/**
 * Resolves the { start, end, label } window for a period preset.
 * Mirrors resolveExportPeriod() in src/lib/accountantExport.js exactly (same
 * inputs/outputs) so "the books" and the shipped Xero/QuickBooks export can
 * never silently disagree on what "this tax year" means.
 *
 * @param {'this_tax_year'|'last_tax_year'|'this_quarter'|'custom'} period
 * @param {object} [opts]
 * @param {string} [opts.customStart] - 'YYYY-MM-DD', only used when period === 'custom'
 * @param {string} [opts.customEnd]   - 'YYYY-MM-DD', only used when period === 'custom'
 * @param {Date}   [opts.now]         - injectable for testing
 * @returns {{ start: Date|null, end: Date|null, label: string }}
 */
export function resolveBooksPeriod(period, { customStart, customEnd, now = new Date() } = {}) {
  if (period === 'this_tax_year') {
    return { start: taxYearStart(now), end: taxYearEnd(now), label: taxYearLabel(now) };
  }
  if (period === 'last_tax_year') {
    const shifted = new Date(now);
    shifted.setFullYear(shifted.getFullYear() - 1);
    return { start: taxYearStart(shifted), end: taxYearEnd(shifted), label: taxYearLabel(shifted) };
  }
  if (period === 'this_quarter') {
    const bounds = quarterBounds(now);
    const q = Math.floor(bounds.start.getMonth() / 3) + 1;
    return { start: bounds.start, end: bounds.end, label: `${bounds.start.getFullYear()}-Q${q}` };
  }
  const start = customStart ? new Date(`${customStart}T00:00:00`) : null;
  const end = customEnd ? new Date(`${customEnd}T23:59:59`) : null;
  const label = customStart && customEnd ? `${customStart}_to_${customEnd}` : 'custom-range';
  return { start, end, label };
}

function inRange(dateStr, start, end) {
  if (!start || !end) return true; // no bound supplied — don't hide data
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  return d >= start && d <= end;
}

function toIsoDateOrNull(d) {
  return d instanceof Date && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

/**
 * Computes the full books summary for one trader + one period from RAW
 * Supabase rows (snake_case columns, jobs.meta as JSONB). Only reads from
 * `job.meta` the handful of camelCase keys it needs (invoiceNumber) — it never
 * returns raw meta, and the caller (fetch-books-summary.js) never selects
 * meta fields beyond what this function reads.
 *
 * @param {object}   args
 * @param {object}   args.profile  - whitelisted profile row (business_name, vat_number, tax_set_aside_pct, payment_terms_days)
 * @param {object[]} args.jobs     - raw jobs rows for this trader (id, customer_name, summary, amount, paid, date, payment_date, meta)
 * @param {object[]} args.receipts - raw receipts rows for this trader (amount, vat, date, merchant)
 * @param {string}   [args.period]
 * @param {string}   [args.customStart]
 * @param {string}   [args.customEnd]
 * @param {Date}     [args.now]
 * @returns {object} whitelist-shaped summary — see TOP_LEVEL_ALLOWED_KEYS
 */
export function computeBooksSummary({
  profile = {},
  jobs = [],
  receipts = [],
  period = 'this_tax_year',
  customStart,
  customEnd,
  now = new Date(),
}) {
  const { start, end, label } = resolveBooksPeriod(period, { customStart, customEnd, now });
  const vatRegistered = !!profile?.vat_number;
  const taxSetAsidePct = Number(profile?.tax_set_aside_pct ?? 20);

  let paidTotal = 0;
  let invoicedTotal = 0;
  const invoicedJobs = [];
  const customerTotals = new Map();

  for (const job of Array.isArray(jobs) ? jobs : []) {
    if (!job || isExcludedJob(job)) continue;
    const meta = (job.meta && typeof job.meta === 'object') ? job.meta : {};
    const invoiceNumber = meta.invoiceNumber || null;
    const amount = Number(meta.total ?? job.amount ?? 0);
    const customer = job.customer_name || 'Customer';
    const paid = isPaidJob(job);
    // "date" is the invoice/earned date: prefer the invoice-sent date (mirrors
    // resolveInvoiceDateRaw in accountantExport.js), falling back to payment
    // date, then the job's booked date.
    const dateStr = meta.invoiceSentAt || job.payment_date || job.date || null;

    if (paid && inRange(job.payment_date || job.date, start, end)) {
      paidTotal += amount;
      const prev = customerTotals.get(customer) || { name: customer, paidTotal: 0, jobCount: 0 };
      prev.paidTotal += amount;
      prev.jobCount += 1;
      customerTotals.set(customer, prev);
    }

    if (invoiceNumber && inRange(dateStr, start, end)) {
      invoicedTotal += amount;
      const { vat: vatAmount } = splitVatInclusive(amount, vatRegistered ? VAT_RATE : 0);
      invoicedJobs.push(pickAllowed({
        customer,
        summary: job.summary || '',
        amount,
        date: dateStr,
        invoiceNumber,
        paid,
        vatAmount,
      }, JOB_ALLOWED_KEYS));
    }
  }

  let expensesTotal = 0;
  let expensesVatTotal = 0;
  const receiptsOut = [];
  for (const r of Array.isArray(receipts) ? receipts : []) {
    if (!r) continue;
    const dateStr = r.date || (r.created_at ? String(r.created_at).slice(0, 10) : null);
    if (!inRange(dateStr, start, end)) continue;
    const amount = Number(r.amount || 0);
    const vat = Number(r.vat || 0);
    expensesTotal += amount;
    expensesVatTotal += vat;
    receiptsOut.push(pickAllowed({
      label: r.merchant || 'Receipt',
      amount,
      vat,
      date: dateStr,
    }, RECEIPT_ALLOWED_KEYS));
  }

  const profit = paidTotal - expensesTotal;

  // VAT summary — mirrors getVatSummary() in src/lib/cashflow.js: cash-
  // accounting basis (VAT accounted on money actually received, not invoices
  // issued), generalised from a fixed calendar quarter to the selected period.
  const { net: netSales, vat: outputVat } = splitVatInclusive(paidTotal, vatRegistered ? VAT_RATE : 0);
  const inputVat = expensesVatTotal;
  const netVat = outputVat - inputVat;

  // Estimated tax set-aside — mirrors the Money tab's "Tax Pot" definition
  // (max(0, profit) * tax_set_aside_pct%), scaled to whatever period was
  // selected rather than fixed to YTD. Clearly an estimate, not a filed figure.
  const taxEstimate = Math.max(0, profit) * (taxSetAsidePct / 100);

  invoicedJobs.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  receiptsOut.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const customers = Array.from(customerTotals.values())
    .map((c) => pickAllowed(c, CUSTOMER_ALLOWED_KEYS))
    .sort((a, b) => b.paidTotal - a.paidTotal);

  return pickAllowed({
    business: pickAllowed({
      name: profile?.business_name || '',
      address: profile?.address || '',
      vatNumber: profile?.vat_number || '',
      vatRegistered,
      logoUrl: profile?.logo_url || '',
      paymentTermsDays: profile?.payment_terms_days ?? 14,
    }, BUSINESS_ALLOWED_KEYS),
    period: pickAllowed({
      id: period,
      label,
      start: toIsoDateOrNull(start),
      end: toIsoDateOrNull(end),
    }, PERIOD_ALLOWED_KEYS),
    income: pickAllowed({ paidTotal, invoicedTotal }, INCOME_ALLOWED_KEYS),
    expenses: pickAllowed({ total: expensesTotal, vatTotal: expensesVatTotal }, EXPENSES_ALLOWED_KEYS),
    profit,
    vat: pickAllowed({ grossSales: paidTotal, netSales, outputVat, inputVat, netVat }, VAT_ALLOWED_KEYS),
    taxEstimate,
    invoicedJobs,
    receipts: receiptsOut,
    customers,
  }, TOP_LEVEL_ALLOWED_KEYS);
}
