import { useState } from 'react';
import {
  validateAmount,
  validateDate,
  validateMethod,
  computeBalance,
} from '../lib/payments';

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
export default function RecordPaymentModal({ job, onAddPayment, onClose, flash, mode = 'payment' }) {
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
        flash?.('✅ Deposit recorded');
      } else {
        const willClearBalance = parsedAmount >= balance;
        flash?.(willClearBalance ? '💷 Job marked paid' : '✅ Payment recorded');
      }
      onClose();
    } catch (e) {
      setError(e.message);
    }
  };

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
