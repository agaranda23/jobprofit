/**
 * OnboardingWizard — 5-step required-field wizard (NEW NAV only).
 *
 * Steps:
 *  1. Trading name  → profiles.business_name
 *  2. First name    → profiles.first_name
 *  3. Last name     → profiles.last_name
 *  4. Bank details  → profiles.sort_code + profiles.account_number
 *  5. Email         → display-only confirm (lives in auth.users.email — read-only)
 *
 * Gate behaviour:
 *  - Shown on first app-open (new nav) when first_name or last_name is NULL.
 *  - A session flag (jp.wizardActive) prevents re-showing mid-session while
 *    the user navigates between wizard steps.
 *  - After submitting, onComplete() is called with the saved profile so the
 *    parent can refresh state and route the user to their intended destination.
 *
 * IMPORTANT: This component must never be mounted for old-nav users.
 * The NEW_NAV guard lives in AppShell — don't add one here.
 */

import { useState } from 'react';
import { supabase } from '../lib/supabase';

const STEPS = [
  {
    id: 'trading_name',
    step: 1,
    label: 'Trading name',
    helper: 'What should appear at the top of your invoices?',
    placeholder: 'Smith Plumbing Ltd',
    inputMode: 'text',
    type: 'text',
  },
  {
    id: 'first_name',
    step: 2,
    label: 'First name',
    helper: "Your first name — used on invoice sign-offs and your account.",
    placeholder: 'Alan',
    inputMode: 'text',
    type: 'text',
  },
  {
    id: 'last_name',
    step: 3,
    label: 'Last name',
    helper: null,
    placeholder: 'Smith',
    inputMode: 'text',
    type: 'text',
  },
  {
    id: 'bank',
    step: 4,
    label: 'Bank details',
    helper: 'Printed on every invoice so customers can pay you.',
    placeholder: null, // bank step has two sub-inputs
    inputMode: null,
    type: 'bank',
  },
  {
    id: 'email',
    step: 5,
    label: 'Email',
    helper: "This is the email on your account. Edit it in your device settings if needed.",
    placeholder: null, // pre-filled from auth
    inputMode: 'email',
    type: 'email',
  },
];

function formatSortCode(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return digits.slice(0, 2) + '-' + digits.slice(2);
  return digits.slice(0, 2) + '-' + digits.slice(2, 4) + '-' + digits.slice(4);
}

function isSortCodeValid(v) {
  return /^\d{2}-\d{2}-\d{2}$/.test(v);
}

function isAccountNumberValid(v) {
  return /^\d{8}$/.test(v);
}

export default function OnboardingWizard({ session, profile, onComplete }) {
  const [stepIndex, setStepIndex] = useState(() => firstMissingStep(profile, session));
  const [values, setValues] = useState({
    trading_name: profile?.business_name || '',
    first_name: profile?.first_name || '',
    last_name: profile?.last_name || '',
    sort_code: profile?.sort_code || '',
    account_number: profile?.account_number || '',
    email: session?.user?.email || '',
  });
  const [bankTouched, setBankTouched] = useState({ sort_code: false, account_number: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const step = STEPS[stepIndex];
  const totalSteps = STEPS.length;

  function getValue() {
    if (step.type === 'bank') return null; // bank step has two fields
    return values[step.id] ?? '';
  }

  function canAdvance() {
    if (step.type === 'bank') {
      return isSortCodeValid(values.sort_code) && isAccountNumberValid(values.account_number);
    }
    if (step.type === 'email') {
      return !!values.email.trim();
    }
    return (values[step.id] || '').trim().length > 0;
  }

  async function handleNext() {
    if (!canAdvance()) return;

    const isLastStep = stepIndex === STEPS.length - 1;

    if (isLastStep) {
      await saveAll();
    } else {
      setStepIndex(i => i + 1);
    }
  }

  function handleBack() {
    if (stepIndex > 0) setStepIndex(i => i - 1);
  }

  async function saveAll() {
    setSaving(true);
    setError(null);
    try {
      const userId = session?.user?.id;
      if (!userId) throw new Error('No user session');

      const patch = {
        id: userId,
        business_name: values.trading_name.trim() || null,
        first_name: values.first_name.trim() || null,
        last_name: values.last_name.trim() || null,
        sort_code: values.sort_code.trim() || null,
        account_number: values.account_number.trim() || null,
      };

      const { data, error: dbErr } = await supabase
        .from('profiles')
        .upsert(patch, { onConflict: 'id' })
        .select()
        .single();

      if (dbErr) throw dbErr;

      // Clear the session flag now that wizard is done
      sessionStorage.removeItem('jp.wizardActive');

      onComplete(data || patch);
    } catch (e) {
      console.error('Wizard save failed', e);
      setError('Could not save — check your connection and try again.');
      setSaving(false);
    }
  }

  return (
    <div className="wizard-screen">
      {/* Progress bar */}
      <div className="wizard-progress" role="progressbar" aria-valuenow={stepIndex + 1} aria-valuemin={1} aria-valuemax={totalSteps}>
        <div
          className="wizard-progress-fill"
          style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
        />
      </div>

      <div className="wizard-body">
        <div className="wizard-step-label">Step {step.step} of {totalSteps}</div>

        <h1 className="wizard-title">{step.label}</h1>

        {step.helper && (
          <p className="wizard-helper">{step.helper}</p>
        )}

        {step.type === 'bank' ? (
          <BankStep
            values={values}
            touched={bankTouched}
            onChange={(field, val) => setValues(v => ({ ...v, [field]: val }))}
            onBlur={(field) => setBankTouched(t => ({ ...t, [field]: true }))}
          />
        ) : step.type === 'email' ? (
          <EmailStep value={values.email} />
        ) : (
          <input
            className="wizard-input"
            type={step.type}
            inputMode={step.inputMode}
            value={getValue()}
            onChange={e => setValues(v => ({ ...v, [step.id]: e.target.value }))}
            onKeyDown={e => { if (e.key === 'Enter') handleNext(); }}
            placeholder={step.placeholder}
            autoFocus
            autoComplete="off"
            aria-label={step.label}
          />
        )}

        {error && <p className="wizard-error">{error}</p>}
      </div>

      <div className="wizard-footer">
        {stepIndex > 0 && (
          <button className="wizard-back-btn" onClick={handleBack} disabled={saving}>
            Back
          </button>
        )}
        <button
          className="wizard-next-btn"
          onClick={handleNext}
          disabled={!canAdvance() || saving}
        >
          {saving ? 'Saving…' : stepIndex === STEPS.length - 1 ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  );
}

function BankStep({ values, touched, onChange, onBlur }) {
  return (
    <div className="wizard-bank">
      <label className="wizard-bank-label" htmlFor="wiz-sort-code">Sort code</label>
      <input
        id="wiz-sort-code"
        className="wizard-input"
        type="text"
        inputMode="numeric"
        value={values.sort_code}
        placeholder="12-34-56"
        onChange={e => onChange('sort_code', formatSortCode(e.target.value))}
        onBlur={() => onBlur('sort_code')}
        autoFocus
        autoComplete="off"
        aria-label="Sort code"
      />
      {touched.sort_code && values.sort_code && !isSortCodeValid(values.sort_code) && (
        <p className="wizard-field-error">Sort code must be 6 digits, e.g. 12-34-56</p>
      )}

      <label className="wizard-bank-label" htmlFor="wiz-account-number" style={{ marginTop: 20 }}>Account number</label>
      <input
        id="wiz-account-number"
        className="wizard-input"
        type="text"
        inputMode="numeric"
        value={values.account_number}
        placeholder="12345678"
        onChange={e => onChange('account_number', e.target.value.replace(/\D/g, '').slice(0, 8))}
        onBlur={() => onBlur('account_number')}
        autoComplete="off"
        aria-label="Account number"
      />
      {touched.account_number && values.account_number && !isAccountNumberValid(values.account_number) && (
        <p className="wizard-field-error">Account number must be 8 digits</p>
      )}
    </div>
  );
}

function EmailStep({ value }) {
  return (
    <input
      className="wizard-input wizard-input--prefilled"
      type="email"
      value={value}
      readOnly
      aria-label="Email — read only, set on account"
    />
  );
}

/**
 * Returns the index of the first wizard step that is still missing data.
 * Falls back to 0 so the user always starts at step 1 if nothing is filled.
 */
function firstMissingStep(profile, session) {
  if (!profile?.business_name) return 0;
  if (!profile?.first_name) return 1;
  if (!profile?.last_name) return 2;
  if (!profile?.sort_code || !profile?.account_number) return 3;
  // Email always exists from auth — treat step 5 as confirmation, start there if
  // all prior steps are done so the user can just hit Finish.
  if (!session?.user?.email) return 4;
  return 4; // land on email confirmation step so user sees Finish button
}
