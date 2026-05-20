/**
 * PublicQuoteView — Phase G-1.
 *
 * Customer-facing, read-only quote view at /q/<token>.
 * No authentication required. No state mutations.
 *
 * What renders:
 *   - Trader business name (from job meta / profile fields in meta)
 *   - Customer name + job description
 *   - Line items breakdown + total
 *   - "Accepted" badge if acceptedSignature is already set (Phase F trader-side)
 *
 * What is deliberately NOT rendered:
 *   - Payment history, receipts, photos, internal notes
 *   - Any customer PII beyond their own name
 *   - Any sensitive business data (bank details, VAT number)
 *
 * Design: mobile-first, max-width 600px on desktop, no auth shell.
 *
 * Phase G-2 will add: signature pad, POST handler, customer name entry.
 */

import { useState, useEffect } from 'react';
import { fetchPublicJob } from '../lib/store';
import { isValidToken } from '../lib/publicQuoteToken';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Formats a number as GBP. Mirrors gbp() from lib/today but has no import dep. */
function gbp(n) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n) || 0);
}

/** Formats an ISO date string to en-GB display date. Returns '' for falsy. */
function fmtDate(raw) {
  if (!raw) return '';
  try {
    const d = raw.length === 10 ? new Date(raw + 'T00:00:00') : new Date(raw);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return raw;
  }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="pqv-wrap" aria-busy="true" aria-label="Loading quote">
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
        <h1 className="pqv-error-title">Quote not found</h1>
        <p className="pqv-error-body">
          {message || 'This link may be invalid or the quote has been removed. Contact your trader for a new link.'}
        </p>
      </div>
    </div>
  );
}

function AcceptedBadge({ acceptedAt }) {
  return (
    <div className="pqv-accepted-badge" role="status">
      <span className="pqv-accepted-badge-icon" aria-hidden="true">&#x2713;</span>
      <span>
        Quote accepted
        {acceptedAt ? ` on ${fmtDate(acceptedAt)}` : ''}
      </span>
    </div>
  );
}

function LineItemsTable({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const total = items.reduce((sum, i) => {
    const qty = Number(i.qty || i.quantity || 1);
    const unit = Number(i.cost || i.unitCost || i.price || 0);
    return sum + qty * unit;
  }, 0);

  return (
    <div className="pqv-section">
      <h2 className="pqv-section-title">Quote breakdown</h2>
      <div className="pqv-line-items">
        {items.map((item, idx) => {
          const qty = Number(item.qty || item.quantity || 1);
          const unit = Number(item.cost || item.unitCost || item.price || 0);
          const lineTotal = qty * unit;
          return (
            <div key={idx} className="pqv-line-item">
              <span className="pqv-line-item-desc">
                {item.desc || 'Item'}
                {qty > 1 && <span className="pqv-line-item-qty"> &times; {qty}</span>}
              </span>
              <span className="pqv-line-item-cost">{gbp(lineTotal)}</span>
            </div>
          );
        })}
        <div className="pqv-line-total">
          <span className="pqv-line-total-label">Total</span>
          <span className="pqv-line-total-value">{gbp(total)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {{ token: string }} props
 */
export default function PublicQuoteView({ token }) {
  // Consolidated fetch state — single setState per effect branch avoids
  // cascading-render lint warnings (react-hooks/exhaustive-deps).
  const [fetchState, setFetchState] = useState({ status: 'loading', job: null, errorMsg: '' });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isValidToken(token)) {
        setFetchState({ status: 'error', job: null, errorMsg: 'This link is not valid. Ask your trader for an updated link.' });
        return;
      }

      try {
        const result = await fetchPublicJob(token);
        if (cancelled) return;
        if (!result) {
          setFetchState({ status: 'error', job: null, errorMsg: 'Quote not found. The link may have expired or been removed.' });
        } else {
          setFetchState({ status: 'ok', job: result, errorMsg: '' });
        }
      } catch {
        if (!cancelled) {
          setFetchState({ status: 'error', job: null, errorMsg: 'Could not load the quote. Check your connection and try again.' });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [token]);

  const { status, job, errorMsg } = fetchState;

  if (status === 'loading') return <LoadingState />;
  if (status === 'error') return <ErrorState message={errorMsg} />;

  const businessName = job.businessName || job.business_name || '';
  const customerName = job.customer || job.customer_name || job.name || '';
  const description = job.summary || '';
  const lineItems = Array.isArray(job.lineItems) && job.lineItems.length > 0
    ? job.lineItems.filter(i => i.desc || i.cost)
    : [];
  const total = job.total ?? job.amount ?? 0;
  const isAccepted = !!job.acceptedSignature || job.quoteStatus === 'accepted';
  const acceptedAt = job.acceptedAt || null;
  const quoteDate = job.date || job.createdAt || null;

  return (
    <div className="pqv-wrap">
      <div className="pqv-card">

        {/* Header — trader business info */}
        <div className="pqv-header">
          {businessName && (
            <div className="pqv-business-name">{businessName}</div>
          )}
          <div className="pqv-quote-label">
            Quote
            {quoteDate && <span className="pqv-quote-date"> &middot; {fmtDate(quoteDate)}</span>}
          </div>
        </div>

        {/* Accepted badge — shown if the quote is already accepted */}
        {isAccepted && <AcceptedBadge acceptedAt={acceptedAt} />}

        {/* Customer + description */}
        <div className="pqv-section">
          {customerName && (
            <div className="pqv-customer-name">{customerName}</div>
          )}
          {description && (
            <p className="pqv-description">{description}</p>
          )}
        </div>

        {/* Line items breakdown */}
        {lineItems.length > 0 ? (
          <LineItemsTable items={lineItems} />
        ) : (
          /* Fallback: show flat total when no breakdown is available */
          total > 0 && (
            <div className="pqv-section">
              <div className="pqv-flat-total">
                <span className="pqv-flat-total-label">Total</span>
                <span className="pqv-flat-total-value">{gbp(total)}</span>
              </div>
            </div>
          )
        )}

        {/* Footer note — no actions in G-1 */}
        <div className="pqv-footer">
          <p className="pqv-footer-note">
            This is a read-only quote. Contact your trader with any questions.
          </p>
        </div>

      </div>
    </div>
  );
}
