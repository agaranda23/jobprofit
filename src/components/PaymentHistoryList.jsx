import { useState } from 'react';
import { gbp } from '../lib/today';

function formatLongDate(isoDate) {
  if (!isoDate) return '';
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * View-only payment history list per PRD §4.3.
 * Phase B scope: list display only. Edit + delete affordances deferred
 * to Phase B.5 — payments.js helpers already support editPayment /
 * deletePayment; the UI surface is what's missing.
 *
 * Self-gating: returns null when no payments.
 * Collapse rule per PRD §4.3:
 *   - Exactly 1 entry → expanded by default
 *   - More than 1 entry → collapsed by default (user taps to expand)
 *
 * Payments are displayed newest-first (most recent at top) — matches the
 * "Last payment" line in PaymentSummaryBlock which uses payments[length-1].
 * The underlying payments[] is append-order (oldest first); we reverse for
 * display only; storage order is untouched.
 */
export default function PaymentHistoryList({ job }) {
  const payments = job?.payments || [];
  const [expanded, setExpanded] = useState(payments.length === 1);

  if (payments.length === 0) return null;

  const displayPayments = [...payments].reverse();

  return (
    <div className="payment-history">
      <button
        type="button"
        className="payment-history-toggle"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span>Payments ({payments.length})</span>
        <span className="payment-history-chev" aria-hidden="true">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <ul className="payment-history-list">
          {displayPayments.map(p => (
            <li key={p.id} className="payment-history-entry">
              <div className="payment-history-row">
                <span className="payment-history-date">{formatLongDate(p.date)}</span>
                <span className="payment-history-sep" aria-hidden="true">·</span>
                <span className="payment-history-amount">{gbp(p.amount)}</span>
                <span className="payment-history-sep" aria-hidden="true">·</span>
                <span className="payment-history-method">{p.method}</span>
              </div>
              {p.note && <div className="payment-history-note">"{p.note}"</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
