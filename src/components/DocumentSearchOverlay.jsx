/**
 * DocumentSearchOverlay — full-screen search overlay for jobs, quotes, invoices,
 * and receipts (feat/documents-findability-v1).
 *
 * Opened from the "Documents" pill in WorkScreen. The overlay starts in the
 * `initialMode` prop and exposes a mode switcher so users can change type without
 * closing and re-opening.
 *
 * Props:
 *   mode        'jobs' | 'quotes' | 'invoices' | 'receipts' — initial mode
 *   jobs        full jobs array passed from parent
 *   receipts    full receipts array passed from parent (for Receipts mode)
 *   profile     Supabase profiles row (for Pro-gate on export)
 *   onClose     () => void
 *   onJobSelect (job) => void — called when a job row is tapped
 *   onOpenUpgradeSheet (trigger) => void — called when a free user taps export
 *
 * v1 additions (feat/documents-findability-v1):
 *   - Receipts mode: searchable by merchant / amount / date; status pill; sort date-desc.
 *   - Filter row: tax-period chips + status chips (receipts + invoices).
 *   - Tax subtitle in Receipts mode: "N receipts · £X · £Y VAT · YYYY/YY"
 *   - "Send to accountant" export: CSV of filtered receipts, Pro-gated.
 *
 * Reused helpers (do NOT re-implement):
 *   jobMatchesQuery, sortJobsByStage  — src/lib/jobSort.js
 *   deriveDisplayStatus               — src/lib/jobStatus.js
 *   buildQuoteRecordMeta,
 *   buildInvoiceRecordMeta            — src/lib/documentRecord.js
 *   gbp                               — src/lib/today.js
 *   taxYearFor, receiptInPeriod       — src/lib/taxYear.js
 *   buildReceiptsCsv                  — src/lib/receiptsCsv.js
 *   downloadOrShare                   — src/lib/exportCsv.js
 *   isPro                             — src/lib/plan.js
 *   receiptStatus, buildReceiptSubtitle — src/lib/documentSearchStatus.js
 *     (split out of this file so it stays a component-only export —
 *     react-refresh/only-export-components)
 *
 * BINDING RULE: all React hooks must sit above any early return.
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Icon from './Icon';
import { jobMatchesQuery, sortJobsByStage } from '../lib/jobSort';
import { deriveDisplayStatus } from '../lib/jobStatus';
import { buildQuoteRecordMeta, buildInvoiceRecordMeta } from '../lib/documentRecord';
import { gbp } from '../lib/today';
import { taxYearFor, receiptInPeriod } from '../lib/taxYear';
import { buildReceiptsCsv } from '../lib/receiptsCsv';
import { downloadOrShare } from '../lib/exportCsv';
import { isPro } from '../lib/plan';
import { receiptStatus, buildReceiptSubtitle } from '../lib/documentSearchStatus';

// Mode config

function getModeConfig(mode) {
  switch (mode) {
    case 'quotes':
      return {
        title: 'Quotes',
        searchPlaceholder: 'Search a name, job or amount',
        emptyIconName: 'file',
        emptyTitle: 'No quotes sent yet',
        emptyBody: 'Price a job up and send it — every quote you fire off shows up here to search later.',
        emptyCta: 'Quote a job',
        noResultsHint: 'No quote matches that. Check the spelling or try the job name.',
      };
    case 'invoices':
      return {
        title: 'Invoices',
        searchPlaceholder: 'Search a name, job or amount',
        emptyIconName: 'invoice',
        emptyTitle: 'No invoices yet',
        emptyBody: 'Once you send your first invoice, every one lives here — search any customer to find it.',
        emptyCta: 'Send your first invoice',
        noResultsHint: 'Check the spelling, or try a job name instead of a customer.',
      };
    case 'receipts':
      return {
        title: 'Receipts',
        searchPlaceholder: 'Search merchant, amount or date',
        emptyIconName: 'receipt',
        emptyTitle: 'No receipts yet',
        emptyBody: "Snap one when you pay for materials — it'll show up here and on the job.",
        emptyCta: 'Add a receipt',
        noResultsHint: 'Nothing matches. Try the merchant name or a rough amount.',
      };
    default: // 'jobs'
      return {
        title: 'All jobs',
        searchPlaceholder: 'Search a name, job or street',
        emptyIconName: 'job',
        emptyTitle: 'No jobs yet',
        emptyBody: 'Log your first job and OHNAR does the maths.',
        emptyCta: 'Log a job',
        noResultsHint: 'Check the spelling, or try a job name instead of a customer.',
      };
  }
}

// Quote pill

function quoteChipLabel(job) {
  if (job.acceptedAt || job.quoteStatus === 'accepted') return 'Accepted';
  if (job.quoteStatus === 'declined') return 'Declined';
  return 'Awaiting';
}

function quoteChipClass(job) {
  if (job.acceptedAt || job.quoteStatus === 'accepted') return 'dso-chip dso-chip--green';
  if (job.quoteStatus === 'declined') return 'dso-chip dso-chip--rose';
  return 'dso-chip dso-chip--neutral';
}

// Invoice pill

function invoiceChipLabel(job) {
  const stage = deriveDisplayStatus(job);
  if (stage === 'Paid') return 'Paid';
  if (stage === 'Overdue') return 'Overdue';
  return 'Unpaid';
}

function invoiceChipClass(job) {
  const stage = deriveDisplayStatus(job);
  if (stage === 'Paid') return 'dso-chip dso-chip--green';
  if (stage === 'Overdue') return 'dso-chip dso-chip--rose';
  return 'dso-chip dso-chip--neutral';
}

// Receipt status pill — receiptStatus() lives in src/lib/documentSearchStatus.js

function receiptChipClass(status) {
  return status === 'Paid' ? 'dso-chip dso-chip--green' : 'dso-chip dso-chip--neutral';
}

// Jobs mode pill

function stageChipClass(stage) {
  switch (stage) {
    case 'Paid':     return 'dso-chip dso-chip--green';
    case 'Overdue':  return 'dso-chip dso-chip--rose';
    case 'Invoiced': return 'dso-chip dso-chip--amber';
    case 'Quoted':   return 'dso-chip dso-chip--neutral';
    default:         return 'dso-chip dso-chip--muted';
  }
}

// Invoice ordering: Overdue then Invoiced then Paid

function orderInvoices(jobs) {
  const overdue  = sortJobsByStage(jobs.filter(j => deriveDisplayStatus(j) === 'Overdue'),  'Overdue');
  const invoiced = sortJobsByStage(jobs.filter(j => deriveDisplayStatus(j) === 'Invoiced'), 'Invoiced');
  const paid     = sortJobsByStage(jobs.filter(j => deriveDisplayStatus(j) === 'Paid'),     'Paid');
  const other    = jobs.filter(j => !['Overdue', 'Invoiced', 'Paid'].includes(deriveDisplayStatus(j)));
  return [...overdue, ...invoiced, ...paid, ...other];
}

// Receipt search matcher

function receiptMatchesQuery(receipt, query) {
  if (!query) return true;
  const q = query.toLowerCase().trim();
  if (!q) return true;
  const merchant    = (receipt.label || receipt.merchant || '').toLowerCase();
  const amount      = String(Number(receipt.amount || 0).toFixed(2));
  const amountRound = String(Math.round(Number(receipt.amount || 0)));
  const date        = (receipt.date || '').toLowerCase();
  return (
    merchant.includes(q) ||
    amount.includes(q)   ||
    amountRound.includes(q) ||
    date.includes(q)
  );
}

// Subtitle helpers

function buildSubtitle(mode, filteredJobs, query) {
  if (query) {
    const n = filteredJobs.length;
    if (n === 0) return 'no matches';
    return n === 1 ? '1 match' : `${n} matches`;
  }
  const n = filteredJobs.length;
  if (mode === 'jobs') {
    return n === 1 ? '1 job' : `${n} jobs`;
  }
  if (mode === 'quotes') {
    const awaiting = filteredJobs.filter(j => !j.acceptedAt && j.quoteStatus !== 'accepted' && j.quoteStatus !== 'declined').length;
    const totalGbp = filteredJobs.reduce((s, j) => s + Number(j.total ?? j.amount ?? 0), 0);
    const kStr = totalGbp >= 1000 ? `£${(totalGbp / 1000).toFixed(1).replace(/\.0$/, '')}k` : gbp(totalGbp);
    return `${n} sent · ${awaiting} awaiting · ${kStr} out`;
  }
  if (mode === 'invoices') {
    const unpaid = filteredJobs.filter(j => {
      const s = deriveDisplayStatus(j);
      return s === 'Invoiced' || s === 'Overdue';
    }).length;
    const owed = filteredJobs
      .filter(j => { const s = deriveDisplayStatus(j); return s === 'Invoiced' || s === 'Overdue'; })
      .reduce((s, j) => s + Number(j.total ?? j.amount ?? 0), 0);
    const kStr = owed >= 1000 ? `£${(owed / 1000).toFixed(1).replace(/\.0$/, '')}k` : gbp(owed);
    return `${n} sent · ${unpaid} unpaid · ${kStr} out`;
  }
  return '';
}

// buildReceiptSubtitle() lives in src/lib/documentSearchStatus.js

// Filter row

const TAX_PERIOD_OPTIONS = [
  { key: 'all',     label: 'All'          },
  { key: 'month',   label: 'This month'   },
  { key: 'quarter', label: 'This quarter' },
  { key: 'taxyear', label: 'Tax year'     },
];

const STATUS_OPTIONS = [
  { key: 'unpaid', label: 'Unpaid' },
  { key: 'paid',   label: 'Paid'   },
];

function FilterRow({ mode, taxPeriod, onTaxPeriod, statusFilter, onStatusFilter }) {
  const showFilters = mode === 'receipts' || mode === 'invoices';
  if (!showFilters) return null;

  return (
    <div className="dso-filter-row" role="group" aria-label="Filter documents">
      {TAX_PERIOD_OPTIONS.map(opt => {
        const active = taxPeriod === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            className={`dso-filter-chip${active ? ' dso-filter-chip--active' : ''}`}
            aria-pressed={active}
            onClick={() => onTaxPeriod(active ? 'all' : opt.key)}
          >
            {opt.label}
          </button>
        );
      })}
      {STATUS_OPTIONS.map(opt => {
        const active = statusFilter === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            className={`dso-filter-chip${active ? ' dso-filter-chip--active' : ''}`}
            aria-pressed={active}
            onClick={() => onStatusFilter(active ? null : opt.key)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// Receipt row

function ReceiptRow({ receipt, parentJob }) {
  const merchant = receipt.label || receipt.merchant || 'Receipt';
  const amtStr   = Number(receipt.amount || 0) > 0 ? gbp(Number(receipt.amount)) : '';
  const status   = receiptStatus(receipt, parentJob);
  const chipCls  = receiptChipClass(status);

  const jobLabel  = parentJob ? (parentJob.customer || parentJob.name || '') : 'Not on a job';
  const dateLabel = receipt.date
    ? new Date(receipt.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  const subLine   = [jobLabel, dateLabel].filter(Boolean).join(' · ');

  return (
    <div className="dso-row dso-row--receipt" aria-label={`${merchant}${amtStr ? ` · ${amtStr}` : ''} · ${status}`}>
      <div className="dso-row__body">
        <span className="dso-row__name">{merchant}</span>
        {subLine && <span className="dso-row__sub">{subLine}</span>}
      </div>
      <div className="dso-row__right">
        {amtStr && <span className="dso-row__amount">{amtStr}</span>}
        <span className={chipCls}>{status}</span>
      </div>
    </div>
  );
}

// Job row

function DocRow({ job, mode, onSelect }) {
  const name   = job.customer || job.name || 'Job';
  const amount = job.total ?? job.amount;
  const amtStr = amount != null && Number(amount) > 0 ? gbp(amount) : '';

  let subLine   = '';
  let chipLabel = '';
  let chipCls   = '';

  if (mode === 'quotes') {
    const meta = buildQuoteRecordMeta(job);
    subLine   = meta.metaString !== 'None yet' ? meta.metaString : '';
    chipLabel = quoteChipLabel(job);
    chipCls   = quoteChipClass(job);
  } else if (mode === 'invoices') {
    const meta = buildInvoiceRecordMeta(job);
    subLine   = meta.metaString !== 'None yet' ? meta.metaString : '';
    chipLabel = invoiceChipLabel(job);
    chipCls   = invoiceChipClass(job);
  } else {
    const stage = deriveDisplayStatus(job);
    subLine   = job.summary || '';
    chipLabel = stage;
    chipCls   = stageChipClass(stage);
  }

  return (
    <button
      type="button"
      className="dso-row"
      onClick={() => onSelect(job)}
      aria-label={`${name}${amtStr ? ` · ${amtStr}` : ''} · ${chipLabel}`}
    >
      <div className="dso-row__body">
        <span className="dso-row__name">{name}</span>
        {subLine && <span className="dso-row__sub">{subLine}</span>}
      </div>
      <div className="dso-row__right">
        {amtStr && <span className="dso-row__amount">{amtStr}</span>}
        {chipLabel && <span className={chipCls}>{chipLabel}</span>}
        <Icon name="chevron-right" size={14} className="dso-row__chevron" />
      </div>
    </button>
  );
}

// Mode switcher tabs

const MODE_TABS = [
  { key: 'jobs',     label: 'All jobs'  },
  { key: 'quotes',   label: 'Quotes'    },
  { key: 'invoices', label: 'Invoices'  },
  { key: 'receipts', label: 'Receipts'  },
];

// Main component

export default function DocumentSearchOverlay({
  mode: initialMode = 'jobs',
  jobs = [],
  receipts = [],
  profile = null,
  onClose,
  onJobSelect,
  onCreateJob,
  onCreateQuote,
  onSendInvoice,
  onOpenUpgradeSheet,
}) {
  // All hooks above any early return (project rule).
  const [activeMode, setActiveMode]     = useState(initialMode);
  const [query, setQuery]               = useState('');
  const [taxPeriod, setTaxPeriod]       = useState('all');
  const [statusFilter, setStatusFilter] = useState(null);
  const [exporting, setExporting]       = useState(false);
  const exportingRef                    = useRef(false);

  const handleModeSwitch = useCallback((newMode) => {
    setActiveMode(newMode);
    setQuery('');
    setTaxPeriod('all');
    setStatusFilter(null);
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Hide the bottom nav and lock body scroll while this overlay is open.
  // Mirrors JobDetailDrawer/AddJobModal — the existing CSS rule
  // `body.overlay-open .bottom-nav { display:none }` removes the nav from the
  // render tree, which sidesteps the ancestor stacking-context trap that was
  // causing the sheet's lower content to paint behind the nav.
  // Component is conditionally mounted, so unmount fires cleanup on every close
  // path (X button, backdrop tap, Escape).
  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('overlay-open');
    return () => {
      document.body.style.overflow = '';
      document.body.classList.remove('overlay-open');
      window.scrollTo(0, scrollY);
    };
  }, []);

  const config = getModeConfig(activeMode);

  // Job-based modes

  const baseJobs = useMemo(() => {
    if (activeMode === 'quotes')   return jobs.filter(j => !!j.quoteSentAt);
    if (activeMode === 'invoices') return jobs.filter(j => !!j.invoiceSentAt);
    if (activeMode === 'jobs')     return jobs;
    return [];
  }, [jobs, activeMode]);

  const sortedJobs = useMemo(() => {
    if (activeMode === 'invoices') return orderInvoices(baseJobs);
    if (activeMode === 'quotes')   return sortJobsByStage(baseJobs, 'Quoted');
    return sortJobsByStage(baseJobs, null);
  }, [baseJobs, activeMode]);

  const statusFilteredJobs = useMemo(() => {
    if (activeMode !== 'invoices' || !statusFilter) return sortedJobs;
    return sortedJobs.filter(j => {
      const stage = deriveDisplayStatus(j);
      if (statusFilter === 'paid')   return stage === 'Paid';
      if (statusFilter === 'unpaid') return stage === 'Invoiced' || stage === 'Overdue';
      return true;
    });
  }, [sortedJobs, activeMode, statusFilter]);

  const periodFilteredJobs = useMemo(() => {
    if (activeMode !== 'invoices' || taxPeriod === 'all') return statusFilteredJobs;
    return statusFilteredJobs.filter(j => {
      const dateStr = j.invoiceSentAt || j.date || '';
      return receiptInPeriod(dateStr, taxPeriod);
    });
  }, [statusFilteredJobs, activeMode, taxPeriod]);

  const displayJobs = useMemo(() => {
    if (!query) return periodFilteredJobs;
    return baseJobs.filter(j => jobMatchesQuery(j, query));
  }, [query, periodFilteredJobs, baseJobs]);

  // Receipts mode

  const jobByIdMap = useMemo(() => {
    const m = {};
    for (const j of jobs) {
      if (j && j.id      != null) m[String(j.id)]      = j;
      if (j && j.cloudId != null) m[String(j.cloudId)] = j;
    }
    return m;
  }, [jobs]);

  const periodFilteredReceipts = useMemo(() => {
    return receipts.filter(r => receiptInPeriod(r.date, taxPeriod));
  }, [receipts, taxPeriod]);

  const statusFilteredReceipts = useMemo(() => {
    if (!statusFilter) return periodFilteredReceipts;
    return periodFilteredReceipts.filter(r => {
      const job = r.jobId ? (jobByIdMap[String(r.jobId)] ?? null) : null;
      const st  = receiptStatus(r, job);
      if (statusFilter === 'paid')   return st === 'Paid';
      if (statusFilter === 'unpaid') return st === 'Unpaid';
      return true;
    });
  }, [periodFilteredReceipts, statusFilter, jobByIdMap]);

  const displayReceipts = useMemo(() => {
    if (!query) return statusFilteredReceipts;
    return statusFilteredReceipts.filter(r => receiptMatchesQuery(r, query));
  }, [query, statusFilteredReceipts]);

  // Subtitle + empty state

  const subtitle = useMemo(() => {
    if (activeMode === 'receipts') {
      return buildReceiptSubtitle(displayReceipts, taxPeriod, query);
    }
    return buildSubtitle(activeMode, displayJobs, query);
  }, [activeMode, displayJobs, displayReceipts, taxPeriod, query]);

  const isEmpty = activeMode === 'receipts'
    ? receipts.length === 0
    : baseJobs.length === 0;

  const noResults = useMemo(() => {
    if (activeMode === 'receipts') return displayReceipts.length === 0 && receipts.length > 0;
    return !!(query && displayJobs.length === 0);
  }, [activeMode, displayReceipts, receipts, displayJobs, query]);

  // Callbacks

  const handleSelect = useCallback((job) => {
    onJobSelect?.(job);
    onClose?.();
  }, [onJobSelect, onClose]);

  const handleEmptyCta = useCallback(() => {
    onClose?.();
    if (activeMode === 'invoices') onSendInvoice?.();
    else if (activeMode === 'quotes') onCreateQuote?.();
    else onCreateJob?.();
  }, [activeMode, onClose, onSendInvoice, onCreateQuote, onCreateJob]);

  const handleExport = useCallback(async () => {
    if (exportingRef.current) return;
    if (!isPro(profile)) {
      onOpenUpgradeSheet?.('accountant_export');
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    try {
      const year   = taxYearFor(new Date());
      const csvStr = buildReceiptsCsv(displayReceipts, jobs, year);
      const blob   = new Blob(['﻿' + csvStr], { type: 'text/csv;charset=utf-8;' });
      const safe   = year.replace('/', '-');
      await downloadOrShare(blob, `receipts-${safe}.csv`, 'text/csv');
    } catch (err) {
      console.warn('Receipt export failed', err);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }, [profile, displayReceipts, jobs]);

  const showExportCta = activeMode === 'receipts' && taxPeriod !== 'all' && receipts.length > 0;

  // Render

  return (
    <div
      className="dso-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={config.title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="dso-sheet">
        <div className="dso-header">
          <div className="dso-header__titles">
            <h2 className="dso-header__title">{config.title}</h2>
            {!isEmpty && <span className="dso-header__subtitle">{subtitle}</span>}
          </div>
          <button
            type="button"
            className="dso-close-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="dso-mode-switcher" role="tablist" aria-label="Document type">
          {MODE_TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeMode === tab.key}
              className={`dso-mode-tab${activeMode === tab.key ? ' dso-mode-tab--active' : ''}`}
              onClick={() => handleModeSwitch(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {!isEmpty && (
          <FilterRow
            mode={activeMode}
            taxPeriod={taxPeriod}
            onTaxPeriod={setTaxPeriod}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
          />
        )}

        {!isEmpty && (
          <div className="dso-search-wrap">
            <Icon name="search" size={16} className="dso-search-icon" />
            <input
              type="search"
              className="dso-search-input"
              placeholder={config.searchPlaceholder}
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                className="dso-search-clear"
                aria-label="Clear search"
                onClick={() => setQuery('')}
              >
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        )}

        <div className="dso-list">
          {isEmpty ? (
            <div className="dso-empty">
              {config.emptyIconName && (
                <Icon
                  name={config.emptyIconName}
                  size={32}
                  variant="muted"
                  className="dso-empty__icon"
                  aria-hidden="true"
                />
              )}
              <p className="dso-empty__title">{config.emptyTitle}</p>
              <p className="dso-empty__body">{config.emptyBody}</p>
              {activeMode !== 'receipts' && (
                <button
                  type="button"
                  className="dso-empty__cta"
                  onClick={handleEmptyCta}
                >
                  {config.emptyCta}
                </button>
              )}
            </div>
          ) : noResults ? (
            <div className="dso-no-results">
              {taxPeriod !== 'all' && !query ? (
                <>
                  <p className="dso-no-results__title">Nothing logged for this tax year yet.</p>
                  <button
                    type="button"
                    className="dso-no-results__clear"
                    onClick={() => setTaxPeriod('all')}
                  >
                    Show all
                  </button>
                </>
              ) : (
                <>
                  <p className="dso-no-results__title">Nothing for &ldquo;{query}&rdquo;</p>
                  <p className="dso-no-results__hint">{config.noResultsHint}</p>
                  <button
                    type="button"
                    className="dso-no-results__clear"
                    onClick={() => setQuery('')}
                  >
                    Clear search
                  </button>
                </>
              )}
            </div>
          ) : activeMode === 'receipts' ? (
            displayReceipts.map(r => (
              <ReceiptRow
                key={r.id}
                receipt={r}
                parentJob={r.jobId ? (jobByIdMap[String(r.jobId)] ?? null) : null}
              />
            ))
          ) : (
            displayJobs.map(job => (
              <DocRow
                key={job.id}
                job={job}
                mode={activeMode}
                onSelect={handleSelect}
              />
            ))
          )}
        </div>

        {showExportCta && (
          <div className="dso-export-bar">
            <button
              type="button"
              className="dso-export-btn"
              onClick={handleExport}
              disabled={exporting}
              aria-label="Send receipts to accountant as CSV"
            >
              <Icon name="download" size={15} aria-hidden="true" />
              {exporting ? 'Preparing…' : 'Send to accountant'}
            </button>
            <p className="dso-export-sub">
              Every receipt for {taxYearFor(new Date())}, ready to hand over.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
