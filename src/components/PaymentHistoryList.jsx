import { useState } from 'react';
import { gbp } from '../lib/today';

function formatLongDate(isoDate) {
  if (!isoDate) return '';
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * Payment history list per PRD §4.3.
 * Edit + delete affordances wired in Phase B.5.
 * payments.js helpers (editPayment / deletePayment) are pure — callers handle
 * persistence via onEditPayment / onDeletePayment callbacks.
 *
 * Self-gating: returns null when no payments.
 * Collapse rule per PRD §4.3:
 *   - Exactly 1 entry → expanded by default
 *   - More than 1 entry → collapsed by default (user taps to expand)
 *
 * Payments are displayed newest-first (most recent at top).
 * The underlying payments[] is append-order (oldest first); we reverse for
 * display only; storage order is untouched.
 */
export default function PaymentHistoryList({ job, onEditPayment, onDeletePayment }) {
  const payments = job?.payments || [];
  const [expanded, setExpanded] = useState(payments.length === 1);
  // id of the payment whose overflow menu is open, or null
  const [openMenuId, setOpenMenuId] = useState(null);

  if (payments.length === 0) return null;

  const displayPayments = [...payments].reverse();

  const closeMenu = () => setOpenMenuId(null);

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
                {(onEditPayment || onDeletePayment) && (
                  <div className="payment-history-menu-wrap">
                    <button
                      type="button"
                      className="payment-history-menu-btn"
                      aria-label="Payment options"
                      onClick={() => setOpenMenuId(prev => prev === p.id ? null : p.id)}
                    >
                      ···
                    </button>
                    {openMenuId === p.id && (
                      <div className="payment-history-menu">
                        {onEditPayment && (
                          <button
                            type="button"
                            className="payment-history-menu-item"
                            onClick={() => { closeMenu(); onEditPayment(p); }}
                          >
                            Edit
                          </button>
                        )}
                        {onDeletePayment && (
                          <button
                            type="button"
                            className="payment-history-menu-item payment-history-menu-item--danger"
                            onClick={() => { closeMenu(); onDeletePayment(p); }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {p.note && <div className="payment-history-note">"{p.note}"</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
