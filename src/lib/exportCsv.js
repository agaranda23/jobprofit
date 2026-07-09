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
 *
 * Shared derivation: deriveJobRows() is the single source of truth for
 * per-job aggregation consumed by both the CSV and PDF exporters — they cannot
 * drift from each other because they both call this function.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

import { isPaidJob } from './jobPredicates.js';

/**
 * Lightweight status label for the CSV/PDF. Doesn't need to be pixel-perfect
 * with the UI's deriveDisplayStatus — just needs to be unambiguous for an
 * accountant reading the spreadsheet or PDF.
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

// ── Shared aggregation (consumed by CSV and PDF) ──────────────────────────────

/**
 * Derives per-job row data used by both the CSV and PDF exporters.
 * Keeping this as the single aggregation function prevents the two exporters
 * from drifting on costs/profit math.
 *
 * @param {object[]} jobs
 * @param {object[]} receipts
 * @returns {{ date, customer, summary, invoiced, costs, profit, status, paidDate }[]}
 */
export function deriveJobRows(jobs, receipts) {
  const safeJobs = Array.isArray(jobs) ? jobs : [];
  const safeReceipts = Array.isArray(receipts) ? receipts : [];
  const result = [];

  for (const job of safeJobs) {
    if (!job) continue;

    const invoiced = Number(job.total ?? job.amount ?? 0) || 0;

    const costs = safeReceipts
      .filter(r => {
        if (!r || r.jobId == null) return false;
        const jId = String(r.jobId);
        if (String(job.id) === jId) return true;
        if (job.cloudId != null && String(job.cloudId) === jId) return true;
        return false;
      })
      .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

    result.push({
      date: job.date || '',
      customer: job.customer || job.name || '',
      summary: job.summary || '',
      invoiced,
      costs,
      profit: invoiced - costs,
      status: deriveStatusLabel(job),
      paidDate: isPaidJob(job) ? (job.paymentDate || job.date || '') : '',
    });
  }

  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Builds a UTF-8 CSV string from the user's jobs and linked receipts.
 * Used by "Export records" (Accountant section) — jobs ledger only.
 *
 * @param {object[]} jobs     — normalised job objects (cloud or legacy shape)
 * @param {object[]} receipts — all receipts; matched to jobs via jobId / cloudId
 * @returns {string}          — CSV string (UTF-8, LF line endings)
 */
export function buildJobsCsv(jobs, receipts) {
  const headers = ['Date', 'Customer', 'Summary', 'Invoiced £', 'Costs £', 'Profit £', 'Status', 'Paid date'];
  const lines = [row(headers)];

  for (const r of deriveJobRows(jobs, receipts)) {
    lines.push(row([
      r.date,
      r.customer,
      r.summary,
      r.invoiced.toFixed(2),
      r.costs.toFixed(2),
      r.profit.toFixed(2),
      r.status,
      r.paidDate,
    ]));
  }

  return lines.join('\n');
}

/**
 * Derives the account/profile fields included in "Export everything" (Art. 15 DSAR).
 * Returns an array of [key, value] pairs for fields we hold on the account owner.
 *
 * Included: identity (name, business name), contact (email, phone, address, website),
 * tax/company references (VAT, UTR), and account metadata (plan, signup date).
 *
 * Excluded deliberately:
 *   - sort_code / account_number   — banking secrets; not appropriate in a portable export
 *   - stripe_customer_id etc.      — third-party processor internals; covered by their DPA
 *   - preference columns           — not personal data (overheads, hourly_rate, toggles)
 *
 * @param {object} profile     — the user's profiles row (may be null/undefined)
 * @param {object} [session]   — Supabase session (used to surface auth email if profile
 *                               email field is blank and as the canonical account email)
 * @returns {[string, string][]}
 */
export function deriveAccountFields(profile, session) {
  const p = profile || {};
  // Auth email is the canonical login identifier; profile.email may be separate business email
  const authEmail = session?.user?.email || '';
  const createdAt = p.created_at
    ? new Date(p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';

  return [
    ['First name',      p.first_name     || ''],
    ['Last name',       p.last_name      || ''],
    ['Business name',   p.business_name  || p.account_name || ''],
    ['Login email',     authEmail],
    ['Business email',  p.email          || ''],
    ['Phone',           p.phone          || ''],
    ['Address',         p.address        || ''],
    ['Website',         p.website        || ''],
    ['VAT number',      p.vat_number     || ''],
    ['UTR number',      p.utr_number     || ''],
    ['Plan',            p.plan           || 'free'],
    ['Account created', createdAt],
  ];
}

/**
 * Is there any real, user-entered profile data worth exporting on its own
 * (i.e. with zero jobs and zero receipts)?
 *
 * Used to gate the "everything"/delete-account export: a brand-new or
 * jobs-free account can still hold a filled-in profile (name, VAT/UTR, etc.)
 * that the user is entitled to take with them (Art. 15 DSAR), so the
 * "nothing to export" guard must not key off jobs.length alone.
 *
 * Deliberately ignores fields that are always present regardless of what the
 * user has actually entered — `plan` (defaults to 'free') and the auth
 * `Login email` derived from the session — since their presence doesn't mean
 * there's anything meaningful to hand back.
 *
 * @param {object} profile — the user's profiles row (may be null/undefined)
 * @returns {boolean}
 */
export function hasExportableProfileData(profile) {
  const p = profile || {};
  const fields = [
    p.first_name,
    p.last_name,
    p.business_name,
    p.account_name,
    p.email,
    p.phone,
    p.address,
    p.website,
    p.vat_number,
    p.utr_number,
  ];
  return fields.some(v => typeof v === 'string' && v.trim().length > 0);
}

/**
 * Builds the "Export everything" CSV: an Account section (key/value rows)
 * followed by the full jobs ledger.
 *
 * Format choice: a clearly delimited two-section layout is the cleanest approach
 * for a single-file export. The Account section uses key,value rows (no extra
 * columns). A blank line and a "--- Jobs ---" header line separate the two
 * sections so the file is unambiguous to any reader or parser.
 *
 * @param {object[]} jobs
 * @param {object[]} receipts
 * @param {object}   profile   — profiles row
 * @param {object}   [session] — Supabase session
 * @returns {string}           — CSV string (UTF-8, LF line endings)
 */
export function buildEverythingCsv(jobs, receipts, profile, session) {
  const lines = [];

  // ── Account section ──────────────────────────────────────────────────────
  lines.push(row(['Account information', '']));
  for (const [key, value] of deriveAccountFields(profile, session)) {
    lines.push(row([key, value]));
  }

  // ── Separator ────────────────────────────────────────────────────────────
  lines.push('');
  lines.push(row(['--- Jobs ledger ---', '']));

  // ── Jobs section (same columns as buildJobsCsv) ───────────────────────
  const jobHeaders = ['Date', 'Customer', 'Summary', 'Invoiced £', 'Costs £', 'Profit £', 'Status', 'Paid date'];
  lines.push(row(jobHeaders));

  for (const r of deriveJobRows(jobs, receipts)) {
    lines.push(row([
      r.date,
      r.customer,
      r.summary,
      r.invoiced.toFixed(2),
      r.costs.toFixed(2),
      r.profit.toFixed(2),
      r.status,
      r.paidDate,
    ]));
  }

  return lines.join('\n');
}

/**
 * Generic download/share helper for any blob. Uses the Web Share API on mobile
 * when available (share sheet → AirDrop, WhatsApp, email, Files etc.).
 * Falls back to an anchor-download on desktop.
 *
 * @param {Blob}   blob
 * @param {string} filename
 * @param {string} mime  — passed to the File constructor for share-sheet type hint
 */
export async function downloadOrShare(blob, filename, mime) {
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function'
  ) {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'OHNAR export',
          text: 'Your export from OHNAR',
        });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        // Any other error: fall through silently to anchor download.
      }
    }
  }

  // Anchor download fallback
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 150);
}

/**
 * Triggers a download of the CSV. Kept for backwards-compatibility with any
 * callers that import this name directly.
 *
 * @param {string} csvString — output of buildJobsCsv()
 * @param {string} [filename]
 */
export async function downloadOrShareCsv(csvString, filename = 'ohnar-export.csv') {
  const blob = new Blob(['﻿' + csvString], { type: 'text/csv;charset=utf-8;' });
  await downloadOrShare(blob, filename, 'text/csv');
}
