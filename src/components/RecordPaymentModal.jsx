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

export default function RecordPaymentModal({ job, onAddPayment, onClose, flash }) {
  const balance = computeBalance(job);
  // Prefill with current balance unless job is fully paid / overpaid
  // (then user must type — "Add another payment" UX).
  const [amount, setAmount] = useState(balance > 0 ? balance.toFixed(2) : '');
  const [date, setDate] = useState(todayLocalIsoDate());
  const [method, setMethod] = useState('cash');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const parsedAmount = parseFloat(amount);
  const isOverpaymentWarning =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount > balance;

  const handleSave = () => {
    setError('');
    try {
      validateAmount(parsedAmount);
      validateDate(date);
      validateMethod(method);
      // Determine pre-call whether this payment will trigger auto-flip,
      // so we can show the right toast. (Handler doesn't return the new job.)
      const willClearBalance = parsedAmount >= balance;
      onAddPayment(job, { amount: parsedAmount, date, method, note: note.trim() });
      flash?.(willClearBalance ? '💷 Job marked paid' : '✅ Payment recorded');
      onClose();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Record Payment</h3>
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
                This is more than the balance of £{balance.toFixed(2)}
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
