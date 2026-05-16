import {
  computeAmountPaid,
  computeBalance,
  isFullyPaid,
  isOverpaid,
} from '../lib/payments';
import { isAwaitingPayment } from '../lib/jobStatus';
import { gbp } from '../lib/today';

function formatLongDate(isoDate) {
  if (!isoDate) return '';
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

/**
 * Three render variants per PRD §4.2:
 *   balance > 0  → Received / Balance + progress bar + [Record Payment] [Mark as Paid]
 *   balance = 0  → "✓ Paid in full" + last payment line + [Add another payment]
 *   balance < 0  → as above + "(£X overpaid)" inline
 *
 * Self-gates visibility per Phase B scope decision: renders only when
 * there's meaningful payment state to display. Hides for draft/completed
 * jobs with no payments yet, AND for legacy-paid jobs (paid via the
 * pre-Phase-B picker, which didn't create payments[] entries — those
 * are handled by the existing "✅ Paid" + Mark as unpaid block in
 * JobDetail's outer JSX). Phase B.5 will route the legacy picker through
 * addPayment, at which point this gate collapses to just
 * "payments.length > 0 || invoiceSentAt".
 */
export default function PaymentSummaryBlock({ job, onRecordPayment, onMarkAsPaid }) {
  const payments = job.payments || [];
  const balance = computeBalance(job);
  const amountPaid = computeAmountPaid(job);
  const fullyPaid = isFullyPaid(job);
  const overpaid = isOverpaid(job);

  // Renders when there's payment state worth showing: any payment history
  // OR job is in the awaiting-payment lifecycle. isAwaitingPayment covers
  // both the Phase B path (invoiceSentAt set) AND the legacy path
  // (invoiceStatus === 'invoiced' && paymentStatus !== 'paid') — Sarah
  // and other pre-Phase-B jobs fall into the latter. Legacy-paid jobs
  // (paid:true, no payments) naturally return false here because
  // deriveStatus returns 'paid' for them, and isAwaitingPayment only
  // returns true for invoice_sent / awaiting.
  const shouldRender = payments.length > 0 || isAwaitingPayment(job);
  if (!shouldRender) return null;

  // Variant 1 — balance > 0
  if (!fullyPaid) {
    const total = job.amount || 0;
    const pct = total > 0 ? Math.min(100, Math.round((amountPaid / total) * 100)) : 0;
    return (
      <div className="payment-summary">
        <div className="payment-summary-row">
          <div>
            <div className="payment-summary-label">Received</div>
            <div className="payment-summary-value">{gbp(amountPaid)}</div>
          </div>
          <div className="payment-summary-row-right">
            <div className="payment-summary-label">Balance</div>
            <div className="payment-summary-value">{gbp(balance)}</div>
          </div>
        </div>
        <div className="payment-summary-progress">
          <div className="payment-summary-progress-bar" style={{ width: pct + '%' }} />
          <span className="payment-summary-progress-pct">{pct}%</span>
        </div>
        <div className="payment-summary-actions">
          <button type="button" className="btn-primary" onClick={onRecordPayment}>
            Record Payment
          </button>
          <button type="button" className="btn-secondary" onClick={onMarkAsPaid}>
            Mark as Paid
          </button>
        </div>
      </div>
    );
  }

  // Variants 2 + 3 — fully paid (possibly overpaid)
  const overpaidAmount = -balance;
  const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;

  return (
    <div className="payment-summary payment-summary--paid">
      <div className="payment-summary-paid-headline">
        ✓ Paid in full: {gbp(amountPaid)}
        {overpaid && (
          <span className="payment-summary-overpaid"> (£{overpaidAmount.toFixed(2)} overpaid)</span>
        )}
      </div>
      {lastPayment && (
        <div className="payment-summary-last">
          Last payment {formatLongDate(lastPayment.date)} ({lastPayment.method})
        </div>
      )}
      <div className="payment-summary-actions">
        <button type="button" className="btn-secondary" onClick={onRecordPayment}>
          Add another payment
        </button>
      </div>
    </div>
  );
}
