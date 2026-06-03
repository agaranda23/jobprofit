/**
 * PostPaidCostRow — shared inline cost-capture row shown after a job is marked paid.
 *
 * Two surfaces:
 *   variant='zero'     — job paid with £0 costs; leads with "No materials on this one?"
 *   variant='add_more' — job already has costs; lighter "Anything else?" prompt
 *
 * After a successful save the row switches to a confirmation state:
 *   "Added £40 Materials." [Undo] [+ Add another]
 * Undo reverts ~5 s after save; the timer clears if the user taps Add another.
 *
 * This component is intentionally stateful (amount, category, save state) and
 * does NOT close the parent modal/drawer — the parent remains visible so the
 * Paid state stays on-screen. Closing is always a caller-driven action.
 *
 * Props
 * ─────
 * job            {object}   — the job that was just paid (used for amount display + jobId)
 * jobCostTotal   {number}   — sum of costs already logged against the job (£)
 * variant        {'zero'|'add_more'} — copy variant
 * onSave         {function} — async (payload) => void — caller persists the cost record
 * onSkip         {function} — () => void — called on "Nothing to add" / "All done"
 * onAutoMute     {function} — () => void — called when 3 consecutive dismissals are hit
 */

import { useEffect, useRef, useState } from 'react';
import { recordCostSaved, recordDismissal } from '../lib/postPaidCost';

const CATEGORIES = ['Materials', 'Fuel', 'Subbie', 'Other'];
const DEFAULT_CAT = 'Materials';
const UNDO_DURATION_MS = 5000;

function gbpDisplay(n) {
  return `£${Number(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function PostPaidCostRow({ job, jobCostTotal = 0, variant = 'zero', onSave, onSkip, onAutoMute }) {
  const [amount, setAmount]   = useState('');
  const [category, setCategory] = useState(DEFAULT_CAT);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(null); // { amount, category } after first save
  const [error, setError]     = useState('');
  const inputRef = useRef(null);
  const undoTimerRef = useRef(null);
  const savedPayloadRef = useRef(null);

  // Auto-focus the amount input on mount (numeric keyboard on mobile).
  useEffect(() => {
    if (!saved) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [saved]);

  // Clear the undo timer on unmount to avoid setState on unmounted component.
  useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }, []);

  const parsedAmount = parseFloat(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;

  const handleSave = async () => {
    if (!amountValid) { setError('Enter an amount'); return; }
    setError('');
    setSaving(true);
    const payload = {
      jobId: job.id,
      label: category,
      amount: parsedAmount,
      date: (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })(),
    };
    savedPayloadRef.current = payload;
    try {
      await onSave(payload);
      recordCostSaved();
      setSaved({ amount: parsedAmount, category });
      // Auto-close after UNDO_DURATION_MS if user does nothing
      undoTimerRef.current = setTimeout(() => {
        onSkip?.();
      }, UNDO_DURATION_MS);
    } catch (e) {
      setError('Could not save — try again');
      console.error('PostPaidCostRow save failed', e);
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    // No server-side undo in V1 — the refreshFromCloud call in handleAddReceipt
    // already completed. The parent deletes via normal receipt delete path.
    // For now: just reset local state and close (the receipt remains but the
    // user can delete it from the job). V2 can add a real API undo.
    setSaved(null);
    setAmount('');
    setCategory(DEFAULT_CAT);
    onSkip?.();
  };

  const handleAddAnother = () => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setSaved(null);
    setAmount('');
    setCategory(DEFAULT_CAT);
    // Re-focus
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  const handleSkip = () => {
    const { count, shouldAutoMute } = recordDismissal();
    if (shouldAutoMute) {
      onAutoMute?.();
    }
    onSkip?.();
  };

  // ── Saved / confirmation state ──────────────────────────────────────────────
  if (saved) {
    return (
      <div className="ppc-row ppc-row--saved" role="status" aria-live="polite">
        <span className="ppc-saved-msg">Added {gbpDisplay(saved.amount)} {saved.category}.</span>
        <div className="ppc-saved-actions">
          <button type="button" className="ppc-btn-ghost ppc-btn-undo" onClick={handleUndo}>
            Undo
          </button>
          <button type="button" className="ppc-btn-ghost ppc-btn-add-another" onClick={handleAddAnother}>
            + Add another
          </button>
        </div>
      </div>
    );
  }

  // ── Entry state ─────────────────────────────────────────────────────────────
  const isAddMore = variant === 'add_more';
  const heading   = isAddMore ? 'Anything else this job cost you?' : 'No materials on this one?';
  const subline   = isAddMore ? null : 'Add what the job cost you — keeps the profit honest.';

  return (
    <div className="ppc-row" role="region" aria-label="Add job cost">
      <div className="ppc-heading">{heading}</div>
      {subline && <div className="ppc-subline">{subline}</div>}

      {/* Amount + category chips */}
      <div className="ppc-fields">
        <div className="ppc-amount-wrap">
          <span className="ppc-amount-prefix" aria-hidden="true">£</span>
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            className="ppc-amount-input"
            placeholder="0.00"
            value={amount}
            aria-label="Cost amount in pounds"
            onChange={e => { setAmount(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
        </div>

        <div className="ppc-chips" role="group" aria-label="Cost category">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              type="button"
              className={`ppc-chip${category === cat ? ' ppc-chip--active' : ''}`}
              aria-pressed={category === cat}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="ppc-error">{error}</p>}

      {/* Primary actions */}
      <div className="ppc-actions">
        <button
          type="button"
          className="ppc-btn-primary"
          onClick={handleSave}
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? 'Saving…' : isAddMore ? '+ Add more' : 'Add cost'}
        </button>
        <button
          type="button"
          className="ppc-btn-skip"
          onClick={handleSkip}
          disabled={saving}
        >
          {isAddMore ? 'All done' : 'Nothing to add'}
        </button>
      </div>

      {/* Labour-only escape link — only shown on the zero variant (not add_more) */}
      {!isAddMore && (
        <button
          type="button"
          className="ppc-labour-only-link"
          onClick={handleSkip}
        >
          This one&rsquo;s labour-only
        </button>
      )}
    </div>
  );
}
