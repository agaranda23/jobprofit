import { useState } from 'react';
import {
  validateAmount,
  validateDate,
  validateMethod,
  computeBalance,
} from '../lib/payments';
import {
  shouldShowCostPrompt,
  costPromptVariant,
  recordPromptShown,
} from '../lib/postPaidCost';
import PostPaidCostRow from './PostPaidCostRow';

// UI segmented control: 4 user-facing methods. 'unknown' is a system-only
// value used by the migration and the Mark-as-Paid shortcut — never shown
// to the user as a choice.
const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

function todayLocalIsoDate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// mode='payment' (default) — post-invoice: prefill with balance, normal copy.
// mode='deposit'           — pre-invoice: empty prefill, deposit-aware copy.
//
// costCapture props (all optional — safe to omit for deposit mode or V1 exclusions):
//   receipts      {array}   — all receipts from AppShell (filtered by jobId to get job costs)
//   onAddReceipt  {function} — async handler that persists the cost record (handleAddReceipt)
//   profile       {object}  — user profile (reads remind_job_costs preference)
//   onAutoMute    {function} — () => void — caller writes remind_job_costs: false after 3 dismissals
export default function RecordPaymentModal({
  job,
  onAddPayment,
  onClose,
  flash,
  mode = 'payment',
  receipts,
  onAddReceipt,
  profile,
  onAutoMute,
}) {
  const isDeposit = mode === 'deposit';
  const balance = computeBalance(job);
  // Post-invoice: prefill with outstanding balance.
  // Pre-invoice (deposit): leave empty — the deposit amount is whatever the
  // tradesperson received, not a percentage of the quote.
  const [amount, setAmount] = useState(
    isDeposit ? '' : (balance > 0 ? balance.toFixed(2) : '')
  );
  const [date, setDate] = useState(todayLocalIsoDate());
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  // paidSuccess: true once payment is recorded and will-clear-balance.
  // The cost-capture row is shown in this state only.
  const [paidSuccess, setPaidSuccess] = useState(false);
  const [costPromptActive, setCostPromptActive] = useState(false);

  const quoteTotal = job?.total ?? job?.amount ?? 0;
  const parsedAmount = parseFloat(amount);
  // Pre-invoice: warn when deposit exceeds quote total (not balance).
  // Post-invoice: warn when payment exceeds outstanding balance.
  const overpaymentThreshold = isDeposit ? quoteTotal : balance;
  const isOverpaymentWarning =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount > overpaymentThreshold;

  const handleSave = () => {
    setError('');
    try {
      validateAmount(parsedAmount);
      validateDate(date);
      validateMethod(method);
      onAddPayment(job, { amount: parsedAmount, date, method, note: note.trim() });

      if (isDeposit) {
        // Deposit — no cost capture prompt; close immediately with flash
        flash?.('Deposit recorded');
        onClose();
        return;
      }

      const willClearBalance = parsedAmount >= balance;

      if (willClearBalance) {
        // THE LOAD-BEARING RULE: payment recorded first (flash fires immediately).
        // Cost capture appears after, never before.
        flash?.('Job marked paid');

        // Determine whether to show cost prompt
        const jobIncome = job?.total ?? job?.amount ?? 0;
        const jobCostTotal = Array.isArray(receipts)
          ? receipts.filter(r => r.jobId === job?.id || r.job_id === job?.id)
              .reduce((s, r) => s + Number(r.amount || 0), 0)
          : 0;
        const remindJobCosts = profile?.remind_job_costs !== false;

        const show = onAddReceipt && shouldShowCostPrompt({
          jobId: job?.id,
          jobIncome,
          jobCostTotal,
          remindJobCosts,
          isPartialPayment: false,
          isBulkPaid: false,
        });

        if (show) {
          recordPromptShown(job?.id);
          setPaidSuccess(true);
          setCostPromptActive(true);
        } else {
          onClose();
        }
      } else {
        // Partial payment — just flash and close
        flash?.('Payment recorded');
        onClose();
      }
    } catch (e) {
      setError(e.message);
    }
  };

  // ── Paid success state (cost capture) ────────────────────────────────────────
  if (paidSuccess && costPromptActive) {
    const jobIncome = job?.total ?? job?.amount ?? 0;
    const jobCostTotal = Array.isArray(receipts)
      ? receipts.filter(r => r.jobId === job?.id || r.job_id === job?.id)
          .reduce((s, r) => s + Number(r.amount || 0), 0)
      : 0;
    const variant = costPromptVariant(jobCostTotal);

    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal modal--paid-success" onClick={e => e.stopPropagation()}>
          <div className="modal-paid-badge" aria-live="polite">
            <span className="modal-paid-check" aria-hidden="true">&#10003;</span>
            <span className="modal-paid-label">Paid</span>
          </div>
          <PostPaidCostRow
            job={job}
            jobCostTotal={jobCostTotal}
            variant={variant}
            onSave={onAddReceipt}
            onSkip={onClose}
            onAutoMute={onAutoMute}
          />
        </div>
      </div>
    );
  }

  // ── Normal entry state ────────────────────────────────────────────────────────
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Record Payment</h3>
        {isDeposit && (
          <p className="modal-sub">Deposits and stage payments count</p>
        )}
        <div className="modal-fields">
          <label>
            <span>Amount (£)</span>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              autoFocus
            />
            {/* Live % readout — shows what this payment represents of the job total.
                Hidden when: total is 0 (divide-by-zero guard) or amount is empty/invalid.
                Shown even when amount > total (e.g. "120% of total") — doesn't break. */}
            {Number.isFinite(parsedAmount) && parsedAmount > 0 && quoteTotal > 0 && (
              <span className="payment-pct-hint">
                {(() => {
                  const pct = (parsedAmount / quoteTotal) * 100;
                  const pctStr = Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1);
                  return `£${parsedAmount.toFixed(2)} · ${pctStr}% of £${quoteTotal.toFixed(2)}`;
                })()}
              </span>
            )}
            {isOverpaymentWarning && (
              <span className="payment-warn">
                {isDeposit
                  ? `This is more than the quote of £${quoteTotal.toFixed(2)}`
                  : `This is more than the balance of £${balance.toFixed(2)}`
                }
              </span>
            )}
          </label>
          <label>
            <span>Date</span>
            <input
              type="date"
              value={date}
              max={todayLocalIsoDate()}
              onChange={e => setDate(e.target.value)}
            />
          </label>
          <label>
            <span>Method</span>
            <div className="payment-method-segmented" role="radiogroup" aria-label="Payment method">
              {METHODS.map(m => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={method === m.value}
                  className={`payment-method-btn ${method === m.value ? 'payment-method-btn--active' : ''}`}
                  onClick={() => setMethod(m.value)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </label>
          <label>
            <span>Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. 50% deposit"
            />
          </label>
        </div>
        {error && <p className="modal-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave}>Save Payment</button>
        </div>
      </div>
    </div>
  );
}
