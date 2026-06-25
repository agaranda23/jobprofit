/**
 * DocumentSearchOverlay — full-screen search overlay for jobs, quotes, and invoices.
 *
 * Opened from the "Look at your work" view-buttons row on TodayScreen and the
 * "Records" pill in WorkScreen. The overlay starts in the `initialMode` prop and
 * exposes a compact 3-segment switcher (All jobs / Quotes / Invoices) so users
 * can switch without closing and re-opening.
 *
 * Props:
 *   mode        'jobs' | 'quotes' | 'invoices'  — initial mode (internal state takes over)
 *   jobs        full jobs array passed from parent
 *   onClose     () => void
 *   onJobSelect (job) => void  — called when a row is tapped; wires to onJobTap
 *
 * Reused helpers (do NOT re-implement):
 *   jobMatchesQuery, sortJobsByStage  — src/lib/jobSort.js
 *   deriveDisplayStatus               — src/lib/jobStatus.js
 *   buildQuoteRecordMeta,
 *   buildInvoiceRecordMeta            — src/lib/documentRecord.js
 *   gbp                               — src/lib/today.js
 *
 * BINDING RULE: all React hooks must sit above any early return.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import Icon from './Icon';
import { jobMatchesQuery, sortJobsByStage } from '../lib/jobSort';
import { deriveDisplayStatus } from '../lib/jobStatus';
import { buildQuoteRecordMeta, buildInvoiceRecordMeta } from '../lib/documentRecord';
import { gbp } from '../lib/today';

// ── Per-mode config ────────────────────────────────────────────────────────────
// emptyIconName uses the Icon component name (Lucide) — no emoji.

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

// ── Quote-vocabulary pill (Quoted overlay only) ───────────────────────────────

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

// ── Invoice-vocabulary pill (Invoices overlay only) ───────────────────────────

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

// ── Jobs-mode pill (pipeline stage) ──────────────────────────────────────────

function stageChipClass(stage) {
  switch (stage) {
    case 'Paid':     return 'dso-chip dso-chip--green';
    case 'Overdue':  return 'dso-chip dso-chip--rose';
    case 'Invoiced': return 'dso-chip dso-chip--amber';
    case 'Quoted':   return 'dso-chip dso-chip--neutral';
    default:         return 'dso-chip dso-chip--muted';
  }
}

// ── Invoice-mode ordered list: Overdue → Invoiced → Paid ─────────────────────

function orderInvoices(jobs) {
  const overdue   = sortJobsByStage(jobs.filter(j => deriveDisplayStatus(j) === 'Overdue'),   'Overdue');
  const invoiced  = sortJobsByStage(jobs.filter(j => deriveDisplayStatus(j) === 'Invoiced'),  'Invoiced');
  const paid      = sortJobsByStage(jobs.filter(j => deriveDisplayStatus(j) === 'Paid'),      'Paid');
  // All others (edge cases) go after paid
  const other     = jobs.filter(j => !['Overdue', 'Invoiced', 'Paid'].includes(deriveDisplayStatus(j)));
  return [...overdue, ...invoiced, ...paid, ...other];
}

// ── Subtitle helpers ──────────────────────────────────────────────────────────

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
      .filter(j => {
        const s = deriveDisplayStatus(j);
        return s === 'Invoiced' || s === 'Overdue';
      })
      .reduce((s, j) => s + Number(j.total ?? j.amount ?? 0), 0);
    const kStr = owed >= 1000 ? `£${(owed / 1000).toFixed(1).replace(/\.0$/, '')}k` : gbp(owed);
    return `${n} sent · ${unpaid} unpaid · ${kStr} out`;
  }
  return '';
}

// ── Row component ─────────────────────────────────────────────────────────────

function DocRow({ job, mode, onSelect }) {
  const name    = job.customer || job.name || 'Job';
  const amount  = job.total ?? job.amount;
  const amtStr  = amount != null && Number(amount) > 0 ? gbp(amount) : '';

  let subLine = '';
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

// ── Main component ─────────────────────────────────────────────────────────────

// ── Mode switcher segments ────────────────────────────────────────────────────
const MODE_TABS = [
  { key: 'jobs',     label: 'All jobs' },
  { key: 'quotes',   label: 'Quotes'   },
  { key: 'invoices', label: 'Invoices' },
];

export default function DocumentSearchOverlay({
  mode: initialMode = 'jobs',
  jobs = [],
  onClose,
  onJobSelect,
  // Zero-item CTA callbacks — passed through from TodayScreen
  onCreateJob,
  onCreateQuote,
  onSendInvoice,
}) {
  // ALL hooks above any early return (binding project rule).
  // `activeMode` is internal so the switcher can change it without the parent re-rendering.
  const [activeMode, setActiveMode] = useState(initialMode);
  const [query, setQuery] = useState('');

  // Reset search when mode changes so stale results never show in the new view.
  const handleModeSwitch = useCallback((newMode) => {
    setActiveMode(newMode);
    setQuery('');
  }, []);

  // Close on Escape key
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const config = getModeConfig(activeMode);

  // Mode-filtered base set
  const baseJobs = useMemo(() => {
    if (activeMode === 'quotes')   return jobs.filter(j => !!j.quoteSentAt);
    if (activeMode === 'invoices') return jobs.filter(j => !!j.invoiceSentAt);
    return jobs;
  }, [jobs, activeMode]);

  // Sorted (when no search active)
  const sortedJobs = useMemo(() => {
    if (activeMode === 'invoices') return orderInvoices(baseJobs);
    if (activeMode === 'quotes')   return sortJobsByStage(baseJobs, 'Quoted');
    return sortJobsByStage(baseJobs, null);
  }, [baseJobs, activeMode]);

  // Live-filtered (when search active — run over base set, ignore sort order per spec)
  const displayJobs = useMemo(() => {
    if (!query) return sortedJobs;
    return baseJobs.filter(j => jobMatchesQuery(j, query));
  }, [query, sortedJobs, baseJobs]);

  const subtitle  = buildSubtitle(activeMode, displayJobs, query);
  const isEmpty   = baseJobs.length === 0; // zero-item first-use state
  const noResults = query && displayJobs.length === 0;

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

  return (
    <div
      className="dso-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={config.title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="dso-sheet">
        {/* Header — title/subtitle on the left, close on the right */}
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

        {/* Mode switcher — All jobs / Quotes / Invoices.
            Reuses the .work-segments / .work-segment idiom so it reads as a
            sibling of the Pipeline/Records controls in WorkScreen. */}
        <div className="dso-mode-switcher" role="tablist" aria-label="Record type">
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

        {/* Search bar — hidden when zero items */}
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

        {/* Content area */}
        <div className="dso-list">
          {isEmpty ? (
            /* Zero-item first-use state — Icon component, no emoji */
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
              <button
                type="button"
                className="dso-empty__cta"
                onClick={handleEmptyCta}
              >
                {config.emptyCta}
              </button>
            </div>
          ) : noResults ? (
            /* No-results state */
            <div className="dso-no-results">
              <p className="dso-no-results__title">Nothing for &ldquo;{query}&rdquo;</p>
              <p className="dso-no-results__hint">{config.noResultsHint}</p>
              <button
                type="button"
                className="dso-no-results__clear"
                onClick={() => setQuery('')}
              >
                Clear search
              </button>
            </div>
          ) : (
            /* Row list */
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
      </div>
    </div>
  );
}
