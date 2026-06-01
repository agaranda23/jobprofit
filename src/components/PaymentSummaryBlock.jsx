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
 * Four render variants:
 *
 * PRE-INVOICE (Quoted / Active / Lead with deposits):
 *   A. payments.length === 0 → lightweight prompt: "Add a deposit" + [Record Payment]
 *   B. payments.length > 0   → Received / Quote (no progress bar, no Mark as Paid)
 *      + nudge when deposit clears the full quote: "Money's in. Invoice when the work's done."
 *
 * POST-INVOICE (Invoiced / Overdue):
 *   C. balance > 0  → Received / Balance + progress bar + [Record Payment] [Mark as Paid]
 *   D. balance = 0  → "✓ Paid in full" + last payment line + [Add another payment]
 *      balance < 0  → as D + "(£X overpaid)" inline
 *
 * Visibility gate (relaxed from Phase B):
 *   Pre-invoice stages (Quoted/Active/Lead) show when:
 *     - payments.length > 0 (deposit already recorded), OR
 *     - stage is explicitly Quoted or Active (show the prompt)
 *   Post-invoice: any payment history OR job is awaiting payment.
 *
 * onSendInvoice — optional; passed by JobDetailDrawer when the job is pre-invoice.
 *   Renders a "Send invoice" CTA in variant B to push the user back into the loop.
 */
export default function PaymentSummaryBlock({
  job,
  onRecordPayment,
  onMarkAsPaid,
  onSendInvoice,
}) {
  const payments = job.payments || [];
  const balance = computeBalance(job);
  const amountPaid = computeAmountPaid(job);
  const fullyPaid = isFullyPaid(job);
  const overpaid = isOverpaid(job);

  // Determine whether this is a pre-invoice stage.
  // Pre-invoice: no invoiceSentAt AND status is lead / quoted / active (or
  // legacy equivalents). Post-invoice: invoice_sent / awaiting / paid.
  const hasInvoice = !!(
    job.invoiceSentAt ||
    job.status === 'invoice_sent' ||
    job.status === 'awaiting' ||
    job.status === 'paid' ||
    job.invoiceStatus === 'invoiced'
  );
  const isPreInvoice = !hasInvoice;

  // Which canonical stage for the visibility decision
  const canonicalStatus = job.status;
  const isQuotedOrActive =
    canonicalStatus === 'quoted' ||
    canonicalStatus === 'active' ||
    canonicalStatus === 'lead';

  // Gate: show when there's meaningful payment state or the job is at a stage
  // where the payment entry point should be surfaced.
  const shouldRender =
    payments.length > 0 ||
    isAwaitingPayment(job) ||
    (isPreInvoice && isQuotedOrActive);

  if (!shouldRender) return null;

  // ── Variant A: pre-invoice, no payments yet ─────────────────────────────
  if (isPreInvoice && payments.length === 0) {
    return (
      <div className="payment-summary payment-summary--pre-invoice-empty">
        <div className="payment-summary-actions">
          <button type="button" className="btn-primary" onClick={onRecordPayment}>
            Record Payment
          </button>
        </div>
      </div>
    );
  }

  // ── Variant B: pre-invoice, deposit(s) recorded ──────────────────────────
  if (isPreInvoice && payments.length > 0) {
    const quoteTotal = job.total ?? job.amount ?? 0;
    // _depositFullyClearsQuote is set by applyAutoFlip when the deposit
    // equals/exceeds the quote on a pre-invoice job (instead of flipping to paid).
    const showNudge = !!job._depositFullyClearsQuote;
    return (
      <div className="payment-summary payment-summary--pre-invoice">
        {showNudge && (
          <div className="payment-summary-nudge">
            Money&apos;s in. Invoice when the work&apos;s done.
          </div>
        )}
        <div className="payment-summary-row">
          <div>
            <div className="payment-summary-label">Received</div>
            <div className="payment-summary-value">{gbp(amountPaid)}</div>
          </div>
          <div className="payment-summary-row-right">
            <div className="payment-summary-label">Quote</div>
            <div className="payment-summary-value">{gbp(quoteTotal)}</div>
          </div>
        </div>
        <div className="payment-summary-actions">
          <button type="button" className="btn-secondary" onClick={onRecordPayment}>
            Record Payment
          </button>
          {onSendInvoice && (
            <button type="button" className="btn-primary" onClick={onSendInvoice}>
              Send invoice
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Variant C: post-invoice, balance > 0 ────────────────────────────────
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

  // ── Variants D: post-invoice, fully paid (possibly overpaid) ────────────
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
