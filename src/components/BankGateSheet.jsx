/**
 * BankGateSheet — collects sort code + account number just-in-time, when a
 * trader requests a deposit but has no bank details on file yet.
 *
 * Extracted from ReviewSheet.jsx's inline "bank-gate" view so the voice-quote
 * confirm card (AddJobModal) can show the exact same gate without duplicating
 * the form/validation/save logic.
 *
 * Props:
 *   onClose()               – dismiss without saving
 *   onSaved(patch)           – called after a successful save with
 *                              { sort_code, account_number } so the caller can
 *                              update its own local profile copy
 *   onProfileUpdate(patch)   – optional; if provided, used to persist the patch
 *                              (e.g. the app's central profile-update pipeline).
 *                              Falls back to a direct Supabase write when omitted
 *                              — mirrors the pattern already used by ReviewSheet
 *                              for callers that don't thread onProfileUpdate.
 *   onSkip()                 – "Send without a deposit" — caller zeroes the
 *                              deposit percent and proceeds
 */
import { useState } from 'react';
import Icon from './Icon';
import { formatSortCode } from '../lib/bankDetails.js';
import { supabase } from '../lib/supabase';

export default function BankGateSheet({ onClose, onSaved, onProfileUpdate, onSkip }) {
  const [bankSortCode, setBankSortCode] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankSaving, setBankSaving] = useState(false);
  const [bankError, setBankError] = useState(null);

  const bankSortCodeValid = /^\d{6}$/.test(bankSortCode.replace(/\D/g, ''));
  const bankAccountNumberValid = /^\d{6,8}$/.test(bankAccountNumber);
  const bankCanSave = bankSortCodeValid && bankAccountNumberValid && !bankSaving;

  const handleBankGateSave = async () => {
    if (!bankCanSave) return;
    setBankSaving(true);
    setBankError(null);
    try {
      const patch = {
        sort_code:      bankSortCode.trim(),
        account_number: bankAccountNumber.trim(),
      };
      if (onProfileUpdate) {
        await onProfileUpdate(patch);
      } else {
        // Fallback: write directly when onProfileUpdate is not threaded.
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user?.id) throw new Error('Not signed in');
        const { error: dbErr } = await supabase
          .from('profiles')
          .update(patch)
          .eq('id', session.user.id);
        if (dbErr) throw dbErr;
      }
      onSaved?.(patch);
    } catch (e) {
      setBankError(e?.message || 'Could not save — check your connection and try again');
    } finally {
      setBankSaving(false);
    }
  };

  return (
    <div className="modal-backdrop modal-backdrop--top" onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal-sheet rs-sheet" role="dialog" aria-modal="true" aria-label="Add your bank details">
        <div className="modal-sheet-header">
          <h3 className="modal-sheet-title">Add your bank details</h3>
          <button className="modal-sheet-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="modal-sheet-body">
          <p className="modal-sheet-text">
            Your bank details are included in the quote message so your customer knows where to send the deposit.
          </p>
        </div>
        <div className="invoice-fields-row" style={{ flexDirection: 'column', gap: 12 }}>
          <div className="invoice-field-group">
            <label className="invoice-field-label" htmlFor="bg-sort-code">Sort code</label>
            <input
              id="bg-sort-code"
              className="invoice-field-input"
              type="text"
              inputMode="numeric"
              value={bankSortCode}
              placeholder="12-34-56"
              onChange={e => setBankSortCode(formatSortCode(e.target.value))}
              autoFocus
              autoComplete="off"
              aria-label="Sort code"
            />
          </div>
          <div className="invoice-field-group">
            <label className="invoice-field-label" htmlFor="bg-account-number">Account number</label>
            <input
              id="bg-account-number"
              className="invoice-field-input"
              type="text"
              inputMode="numeric"
              value={bankAccountNumber}
              placeholder="12345678"
              onChange={e => setBankAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 8))}
              autoComplete="off"
              aria-label="Account number"
            />
          </div>
        </div>
        {bankError && (
          <p className="modal-sheet-error" role="alert">{bankError}</p>
        )}
        <button
          type="button"
          className="btn-primary modal-sheet-btn"
          onClick={handleBankGateSave}
          disabled={!bankCanSave}
        >
          {bankSaving ? 'Saving…' : 'Save and continue'}
        </button>
        <button
          type="button"
          className="btn-ghost modal-sheet-btn"
          style={{ marginTop: 8 }}
          onClick={onSkip}
        >
          Send without a deposit
        </button>
      </div>
    </div>
  );
}
