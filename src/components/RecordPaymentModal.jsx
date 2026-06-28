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
import { getJobProfit } from '../lib/cashflow';
import { marginState } from '../lib/profitThresholds';
import { gbp } from '../lib/today';
import PostPaidCostRow from './PostPaidCostRow';

/**
 * Renders the profit reveal line shown on the paid-success screen.
 *
 * Honesty rules (spec 2026-06-08):
 *   - profit > 0, quote > 0 and healthy (≥25%): headline + healthy margin sub
 *   - profit > 0, quote > 0 and thin (5–24%): headline + thin margin sub
 *   - profit > 0, quote <= 0: headline only (no margin sub — quote unknown)
 *   - profit <= 0 (loss/break-even, costs logged): loss headline + advice sub
 *   - profit === 0 and no data (quote=0, materials=0): "Paid. Logged." — no fake £0 celebration
 *
 * Never paywalled — it's the free taste of the Insight Layer.
 */
function ProfitRevealBlock({ job, receipts }) {
  const { quote, materials, profit, margin } = getJobProfit(job, receipts);

  // No data at all — don't show a fake £0 result
  if (profit === 0 && materials === 0 && quote === 0) {
    return (
      <p className="rpm-profit-reveal rpm-profit-reveal--neutral">
        Paid. Logged.
      </p>
    );
  }

  if (profit <= 0) {
    const lossAbs = Math.round(Math.abs(profit)).toLocaleString('en-GB');
    return (
      <div className="rpm-profit-reveal rpm-profit-reveal--underwater">
        <p className="rpm-profit-reveal-headline">This one cost you £{lossAbs}.</p>
        <p className="rpm-profit-reveal-sub">Worth knowing before the next quote.</p>
      </div>
    );
  }

  const state = marginState(margin);
  const profitFormatted = gbp(profit).replace(/\.00$/, '').replace(/^£/, '');

  let subLine = null;
  if (quote > 0) {
    if (state === 'healthy') {
      subLine = `${margin}% margin on this one.`;
    } else if (state === 'thin') {
      subLine = `${margin}% margin — tighter than usual.`;
    }
    // underwater with profit > 0 is impossible (profit > 0 means margin >= 0,
    // and marginState(0) is underwater but profit === 0 is caught above).
    // Any positive profit with quote > 0 produces margin 0..100, handled above.
  }

  return (
    <div className={`rpm-profit-reveal rpm-profit-reveal--${state}`}>
      <p className="rpm-profit-reveal-headline">That&apos;s £{profitFormatted} in your pocket.</p>
      {subLine && <p className="rpm-profit-reveal-sub">{subLine}</p>}
    </div>
  );
}

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
  // profitRevealActive: true when the job cleared balance but the cost prompt
  // was suppressed — show the profit reveal on its own before closing.
  const [profitRevealActive, setProfitRevealActive] = useState(false);

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
      onAddPayment(job, {
        amount: parsedAmount,
        date,
        method,
        note: note.trim(),
        // Structural flag so invoice preview/PDF can key off type instead of free
        // text. Set only in deposit mode — undefined for normal payments so the
        // field doesn't appear on every payment object.
        ...(isDeposit && { type: 'deposit' }),
      });

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
          // Cost prompt suppressed — show the profit reveal, then let the user
          // close. Keeps the paid-success state consistent.
          setPaidSuccess(true);
          setProfitRevealActive(true);
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

  // ── Paid success state (profit reveal + cost capture) ───────────────────────
  if (paidSuccess && costPromptActive) {
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
          <ProfitRevealBlock job={job} receipts={receipts} />
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

  // ── Paid success state (profit reveal only — cost prompt was suppressed) ─────
  if (paidSuccess && profitRevealActive) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal modal--paid-success" onClick={e => e.stopPropagation()}>
          <div className="modal-paid-badge" aria-live="polite">
            <span className="modal-paid-check" aria-hidden="true">&#10003;</span>
            <span className="modal-paid-label">Paid</span>
          </div>
          <ProfitRevealBlock job={job} receipts={receipts} />
          <button type="button" className="btn-primary rpm-profit-reveal-done" onClick={onClose}>
            Done
          </button>
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
