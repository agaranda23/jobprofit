/**
 * PublicBooksView — the accountant "books link" at /books/<token>
 * (feat/accountant-books-link).
 *
 * Read-only, no-auth page a Pro trader hands to their accountant. Shows a
 * period-scoped summary of income, expenses, VAT, an estimated tax set-aside,
 * plus the underlying invoiced-jobs / receipts / customer lists, and an
 * "Export for Xero/QuickBooks" action that reuses the exact same CSV builders
 * as the in-app accountant export (src/lib/accountantExport.js) so the books
 * link and the shipped export can never silently disagree.
 *
 * Data comes from ONE call to fetch-books-summary (service-role, token-gated,
 * whitelist-shaped — see that function's docblock). This page never talks to
 * Supabase directly and never renders an edit/write affordance of any kind.
 *
 * What is deliberately NOT rendered (and structurally cannot be, because the
 * server function never returns it): bank details, Stripe IDs, any other
 * trader's data, the trader's internal auth id, raw job/receipt rows.
 *
 * Design: mobile-first, reuses .pqv-wrap/.pqv-card/.pqv-header/.pqv-section
 * (PublicQuoteView) rather than adding a new CSS namespace to index.css.
 */

import { useState, useEffect, useCallback } from 'react';
import { isValidBooksToken } from '../lib/publicBooksToken';
import ConsentBanner from '../components/ConsentBanner.jsx';

const FETCH_BOOKS_SUMMARY_URL = '/.netlify/functions/fetch-books-summary';

const DARK = '#141414';
const MID = '#505050';
const LIGHT = '#8a8a8a';
const GREEN = '#0e6b43';

function gbp(n) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n) || 0);
}

function fmtDate(raw) {
  if (!raw) return '';
  try {
    const d = raw.length === 10 ? new Date(raw + 'T00:00:00') : new Date(raw);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return raw;
  }
}

const PERIODS = [
  { id: 'this_tax_year', label: 'This tax year' },
  { id: 'last_tax_year', label: 'Last tax year' },
  { id: 'this_quarter', label: 'This quarter' },
  { id: 'custom', label: 'Custom' },
];

// ── Loading / error states — reuse .pqv-* class names, no new CSS needed ────

function LoadingState() {
  return (
    <div className="pqv-wrap" aria-busy="true" aria-label="Loading books">
      <div className="pqv-card">
        <div className="pqv-skeleton pqv-skeleton--title" />
        <div className="pqv-skeleton pqv-skeleton--line" />
        <div className="pqv-skeleton pqv-skeleton--line pqv-skeleton--short" />
        <div className="pqv-skeleton pqv-skeleton--line" />
        <div className="pqv-skeleton pqv-skeleton--line pqv-skeleton--short" />
      </div>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="pqv-wrap">
      <div className="pqv-card pqv-card--error">
        <div className="pqv-error-icon" aria-hidden="true">&#x26A0;</div>
        <h1 className="pqv-error-title">Not found</h1>
        <p className="pqv-error-body">
          {message || 'This link may be invalid or has been revoked. Ask the trader for a new link.'}
        </p>
      </div>
    </div>
  );
}

// ── Small stat card ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, tone = 'default' }) {
  const valueColor = tone === 'positive' ? GREEN : tone === 'negative' ? '#b3261e' : DARK;
  return (
    <div style={{ background: '#f8f8f8', borderRadius: 8, padding: '12px 14px', flex: '1 1 140px', minWidth: 140 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: LIGHT, letterSpacing: '0.06em', marginBottom: 4 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 18, fontWeight: 800, color: valueColor }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: MID, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Period picker ─────────────────────────────────────────────────────────────

function PeriodPicker({ period, customStart, customEnd, onPick, onCustomChange, onCustomApply, loading }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            disabled={loading}
            style={{
              padding: '7px 12px',
              borderRadius: 999,
              border: period === p.id ? `1.5px solid ${GREEN}` : '1px solid #ddd',
              background: period === p.id ? '#e8f6ef' : '#fff',
              color: period === p.id ? GREEN : MID,
              fontSize: 12,
              fontWeight: 700,
              cursor: loading ? 'default' : 'pointer',
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 11, color: MID }}>
            From
            <input
              type="date"
              value={customStart}
              onChange={(e) => onCustomChange('start', e.target.value)}
              style={{ display: 'block', marginTop: 2, padding: '6px 8px', borderRadius: 6, border: '1px solid #ddd' }}
            />
          </label>
          <label style={{ fontSize: 11, color: MID }}>
            To
            <input
              type="date"
              value={customEnd}
              onChange={(e) => onCustomChange('end', e.target.value)}
              style={{ display: 'block', marginTop: 2, padding: '6px 8px', borderRadius: 6, border: '1px solid #ddd' }}
            />
          </label>
          <button
            type="button"
            onClick={onCustomApply}
            disabled={loading || !customStart || !customEnd}
            style={{
              padding: '7px 14px',
              borderRadius: 6,
              border: 'none',
              background: GREEN,
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              cursor: (!customStart || !customEnd) ? 'not-allowed' : 'pointer',
              opacity: (!customStart || !customEnd) ? 0.6 : 1,
            }}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}

// ── Simple two-column table ───────────────────────────────────────────────────

function DataTable({ title, columns, rows, emptyLabel }) {
  return (
    <div className="pqv-section">
      <h2 className="pqv-section-title">{title}</h2>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: LIGHT, margin: 0 }}>{emptyLabel}</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    style={{
                      textAlign: c.align || 'left',
                      padding: '6px 8px',
                      color: LIGHT,
                      fontWeight: 700,
                      fontSize: 10,
                      letterSpacing: '0.04em',
                      borderBottom: '1.5px solid #eee',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {c.label.toUpperCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        padding: '6px 8px',
                        color: DARK,
                        borderBottom: '1px solid #f2f2f2',
                        textAlign: c.align || 'left',
                        whiteSpace: c.nowrap ? 'nowrap' : 'normal',
                      }}
                    >
                      {c.render ? c.render(row) : row[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Export — reuses src/lib/accountantExport.js so the books link and the
//    in-app Xero/QuickBooks export can never silently disagree. ─────────────

function mapInvoicedJobsForExport(invoicedJobs) {
  return (invoicedJobs || []).map((j) => ({
    customer: j.customer,
    summary: j.summary,
    invoiceNumber: j.invoiceNumber,
    date: j.date,
    paymentDate: j.date,
    total: j.amount,
    amount: j.amount,
    paid: j.paid,
  }));
}

function mapReceiptsForExport(receipts) {
  return (receipts || []).map((r, idx) => ({
    id: idx + 1,
    merchant: r.label,
    label: r.label,
    amount: r.amount,
    vat: r.vat,
    date: r.date,
  }));
}

function ExportRow({ summary, period, customStart, customEnd }) {
  const [exporting, setExporting] = useState(null); // null | 'xero' | 'quickbooks'
  const [error, setError] = useState('');

  const handleExport = useCallback(async (platform) => {
    if (exporting) return;
    setExporting(platform);
    setError('');
    try {
      const { buildAccountantExportFiles, buildAccountantExportZipBlob } = await import('../lib/accountantExport.js');
      const { files, zipFilename } = buildAccountantExportFiles({
        platform,
        jobs: mapInvoicedJobsForExport(summary.invoicedJobs),
        receipts: mapReceiptsForExport(summary.receipts),
        profile: { payment_terms_days: summary.business?.paymentTermsDays },
        isVatRegistered: !!summary.business?.vatRegistered,
        period,
        customStart,
        customEnd,
      });
      const blob = await buildAccountantExportZipBlob(files);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = zipFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      setError("Couldn't build the export — please try again.");
    } finally {
      setExporting(null);
    }
  }, [exporting, summary, period, customStart, customEnd]);

  return (
    <div className="pqv-section">
      <h2 className="pqv-section-title">Export</h2>
      <p style={{ fontSize: 12, color: MID, marginTop: 0, marginBottom: 10 }}>
        Downloads a ZIP of correctly formatted CSV files for the period selected above — import in one go instead of re-typing each invoice and receipt.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => handleExport('xero')}
          disabled={!!exporting}
          style={{ padding: '9px 16px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', color: DARK, fontSize: 13, fontWeight: 700, cursor: exporting ? 'default' : 'pointer' }}
        >
          {exporting === 'xero' ? 'Preparing…' : 'Export for Xero'}
        </button>
        <button
          type="button"
          onClick={() => handleExport('quickbooks')}
          disabled={!!exporting}
          style={{ padding: '9px 16px', borderRadius: 6, border: '1px solid #ddd', background: '#fff', color: DARK, fontSize: 13, fontWeight: 700, cursor: exporting ? 'default' : 'pointer' }}
        >
          {exporting === 'quickbooks' ? 'Preparing…' : 'Export for QuickBooks'}
        </button>
      </div>
      {error && <p style={{ fontSize: 12, color: '#b3261e', marginTop: 8 }}>{error}</p>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {{ token: string }} props
 */
export default function PublicBooksView({ token }) {
  const [fetchState, setFetchState] = useState({ status: 'loading', summary: null, errorMsg: '' });
  const [period, setPeriod] = useState('this_tax_year');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  // appliedCustom: the {start,end} pair actually sent to the server — only
  // updates when the user taps "Apply", so typing a date doesn't refetch
  // on every keystroke.
  const [appliedCustom, setAppliedCustom] = useState({ start: '', end: '' });

  const load = useCallback(async (p, cs, ce) => {
    if (!isValidBooksToken(token)) {
      setFetchState({ status: 'error', summary: null, errorMsg: 'This link is not valid. Ask the trader for an updated link.' });
      return;
    }
    setFetchState((prev) => ({ status: 'loading', summary: prev.summary, errorMsg: '' }));
    try {
      const res = await fetch(FETCH_BOOKS_SUMMARY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, period: p, customStart: cs || undefined, customEnd: ce || undefined }),
      });
      if (!res.ok) {
        setFetchState({ status: 'error', summary: null, errorMsg: 'Not found. This link may be invalid or has been revoked.' });
        return;
      }
      const summary = await res.json();
      setFetchState({ status: 'ok', summary, errorMsg: '' });
    } catch {
      setFetchState({ status: 'error', summary: null, errorMsg: "Couldn't load — please try again." });
    }
  }, [token]);

  useEffect(() => {
    if (period === 'custom') return; // wait for explicit Apply
    load(period, null, null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  useEffect(() => {
    if (period !== 'custom') return;
    if (!appliedCustom.start || !appliedCustom.end) return;
    load('custom', appliedCustom.start, appliedCustom.end);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedCustom]);

  const handleCustomChange = (which, value) => {
    if (which === 'start') setCustomStart(value);
    else setCustomEnd(value);
  };

  const handleCustomApply = () => {
    setAppliedCustom({ start: customStart, end: customEnd });
  };

  const { status, summary, errorMsg } = fetchState;

  if (status === 'error') return <ErrorState message={errorMsg} />;
  if (status === 'loading' && !summary) return <LoadingState />;
  if (!summary) return <LoadingState />;

  const businessName = summary.business?.name || 'This business';
  const profit = Number(summary.profit || 0);

  return (
    <>
      <div className="pqv-wrap">
        <div className="pqv-card">

          {/* Read-only lock header */}
          <div className="pqv-header">
            <div
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 11, fontWeight: 700, color: MID,
                background: '#f2f2f2', borderRadius: 999, padding: '4px 10px', marginBottom: 8,
              }}
            >
              <span aria-hidden="true">&#128274;</span>
              <span>Read-only — {businessName}&rsquo;s books</span>
            </div>
            {summary.business?.address && (
              <div className="pqv-business-meta">{summary.business.address}</div>
            )}
            {summary.business?.vatRegistered && summary.business?.vatNumber && (
              <div className="pqv-business-meta pqv-business-meta--light">VAT Reg: {summary.business.vatNumber}</div>
            )}
          </div>

          <div className="pqv-section" style={{ paddingTop: 0 }}>
            <PeriodPicker
              period={period}
              customStart={customStart}
              customEnd={customEnd}
              onPick={setPeriod}
              onCustomChange={handleCustomChange}
              onCustomApply={handleCustomApply}
              loading={status === 'loading'}
            />
            {summary.period?.label && (
              <p style={{ fontSize: 11, color: LIGHT, margin: '-8px 0 12px' }}>
                Showing {summary.period.label}
                {summary.period.start && summary.period.end ? ` (${fmtDate(summary.period.start)} – ${fmtDate(summary.period.end)})` : ''}
              </p>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <StatCard label="Income (paid)" value={gbp(summary.income?.paidTotal)} />
              <StatCard label="Expenses" value={gbp(summary.expenses?.total)} />
              <StatCard
                label="Profit"
                value={gbp(profit)}
                tone={profit >= 0 ? 'positive' : 'negative'}
              />
              <StatCard label="Est. tax set-aside" value={gbp(summary.taxEstimate)} sub="Estimate, not a filed figure" />
            </div>
          </div>

          {summary.business?.vatRegistered && (
            <div className="pqv-section">
              <h2 className="pqv-section-title">VAT summary</h2>
              <p style={{ fontSize: 11, color: LIGHT, marginTop: -4, marginBottom: 8 }}>
                Cash-accounting basis — VAT on money received, not invoices issued.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <StatCard label="Net sales" value={gbp(summary.vat?.netSales)} />
                <StatCard label="Output VAT" value={gbp(summary.vat?.outputVat)} />
                <StatCard label="Input VAT" value={gbp(summary.vat?.inputVat)} />
                <StatCard label="Net VAT" value={gbp(summary.vat?.netVat)} sub={summary.vat?.netVat >= 0 ? 'Owed to HMRC' : 'Reclaimable'} />
              </div>
            </div>
          )}

          <DataTable
            title="Invoiced jobs"
            emptyLabel="No invoiced jobs in this period."
            rows={summary.invoicedJobs || []}
            columns={[
              { key: 'customer', label: 'Customer' },
              { key: 'invoiceNumber', label: 'Invoice #', nowrap: true },
              { key: 'date', label: 'Date', nowrap: true, render: (r) => fmtDate(r.date) },
              { key: 'paid', label: 'Paid', render: (r) => (r.paid ? 'Yes' : 'No') },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => gbp(r.amount) },
            ]}
          />

          <DataTable
            title="Receipts"
            emptyLabel="No receipts in this period."
            rows={summary.receipts || []}
            columns={[
              { key: 'label', label: 'Supplier' },
              { key: 'date', label: 'Date', nowrap: true, render: (r) => fmtDate(r.date) },
              { key: 'vat', label: 'VAT', align: 'right', render: (r) => gbp(r.vat) },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => gbp(r.amount) },
            ]}
          />

          <DataTable
            title="Customers"
            emptyLabel="No customer activity in this period."
            rows={summary.customers || []}
            columns={[
              { key: 'name', label: 'Customer' },
              { key: 'jobCount', label: 'Jobs', align: 'right' },
              { key: 'paidTotal', label: 'Paid total', align: 'right', render: (r) => gbp(r.paidTotal) },
            ]}
          />

          <ExportRow
            summary={summary}
            period={period}
            customStart={period === 'custom' ? appliedCustom.start : undefined}
            customEnd={period === 'custom' ? appliedCustom.end : undefined}
          />

          <div className="pqv-footer">
            <p className="pqv-footer-note">
              This is a read-only summary shared by {businessName}. Figures are as recorded in OHNAR and are estimates where marked — always reconcile against source documents.
            </p>
          </div>
        </div>
      </div>
      <ConsentBanner />
    </>
  );
}
