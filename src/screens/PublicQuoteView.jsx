/**
 * PublicQuoteView — Phase G-1.
 *
 * Customer-facing, read-only quote view at /q/<token>.
 * No authentication required. No state mutations.
 *
 * What renders:
 *   - Trader business name (from job meta / profile fields in meta)
 *   - Customer name + job description
 *   - Line items breakdown + total
 *   - "Accepted" badge if acceptedSignature is already set (Phase F trader-side)
 *
 * What is deliberately NOT rendered:
 *   - Payment history, receipts, photos, internal notes
 *   - Any customer PII beyond their own name
 *   - Any sensitive business data (bank details, VAT number)
 *
 * Design: mobile-first, max-width 600px on desktop, no auth shell.
 *
 * Phase G-2 will add: signature pad, POST handler, customer name entry.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchPublicJob } from '../lib/store';
import { isValidToken } from '../lib/publicQuoteToken';
import SignaturePad from '../components/SignaturePad';
import ConsentBanner from '../components/ConsentBanner.jsx';
import PoweredByJobProfit from '../components/PoweredByJobProfit.jsx';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Formats a number as GBP. Mirrors gbp() from lib/today but has no import dep. */
function gbp(n) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n) || 0);
}

/** Formats an ISO date string to en-GB display date. Returns '' for falsy. */
function fmtDate(raw) {
  if (!raw) return '';
  try {
    const d = raw.length === 10 ? new Date(raw + 'T00:00:00') : new Date(raw);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return raw;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCEPT_QUOTE_URL       = '/.netlify/functions/accept-quote';
const TRACK_OPEN_URL         = '/.netlify/functions/track-quote-open';
const CREATE_DEPOSIT_URL     = '/.netlify/functions/create-deposit-payment-link';
const FETCH_QUOTE_PROFILE_URL = '/.netlify/functions/fetch-public-quote-profile';

// ── Sub-components ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="pqv-wrap" aria-busy="true" aria-label="Loading quote">
      <div className="pqv-card">
        <div className="pqv-skeleton pqv-skeleton--title" />
        <div className="pqv-skeleton pqv-skeleton--line" />
        <div className="pqv-skeleton pqv-skeleton--line pqv-skeleton--short" />
        <div className="pqv-skeleton pqv-skeleton--line" />
        <div className="pqv-skeleton pqv-skeleton--line pqv-skeleton--short" />
      </div>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="pqv-wrap">
      <div className="pqv-card pqv-card--error">
        <div className="pqv-error-icon" aria-hidden="true">&#x26A0;</div>
        <h1 className="pqv-error-title">Quote not found</h1>
        <p className="pqv-error-body">
          {message || 'This link may be invalid or the quote has been removed. Contact your trader for a new link.'}
        </p>
      </div>
    </div>
  );
}

function AcceptedBadge({ acceptedAt }) {
  return (
    <div className="pqv-accepted-badge" role="status">
      <span className="pqv-accepted-badge-icon" aria-hidden="true">&#x2713;</span>
      <span>
        Quote accepted
        {acceptedAt ? ` on ${fmtDate(acceptedAt)}` : ''}
      </span>
    </div>
  );
}

function LineItemsTable({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const total = items.reduce((sum, i) => {
    const qty = Number(i.qty || i.quantity || 1);
    const unit = Number(i.cost || i.unitCost || i.price || 0);
    return sum + qty * unit;
  }, 0);

  return (
    <div className="pqv-section">
      <h2 className="pqv-section-title">Quote breakdown</h2>
      <div className="pqv-line-items">
        {items.map((item, idx) => {
          const qty = Number(item.qty || item.quantity || 1);
          const unit = Number(item.cost || item.unitCost || item.price || 0);
          const lineTotal = qty * unit;
          return (
            <div key={idx} className="pqv-line-item">
              <span className="pqv-line-item-desc">
                {item.desc || 'Item'}
                {qty > 1 && <span className="pqv-line-item-qty"> &times; {qty}</span>}
              </span>
              <span className="pqv-line-item-cost">{gbp(lineTotal)}</span>
            </div>
          );
        })}
        <div className="pqv-line-total">
          <span className="pqv-line-total-label">Total</span>
          <span className="pqv-line-total-value">{gbp(total)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * RemoteAcceptedBlock — shown after a successful G-2 submission.
 * Displays the signature thumbnail + confirmed timestamp.
 */
function RemoteAcceptedBlock({ signatureDataUrl, acceptedAt }) {
  return (
    <div className="pqv-sign-accepted" role="status">
      <div className="pqv-sign-accepted-title">Quote accepted</div>
      {acceptedAt && (
        <div className="pqv-sign-accepted-date">
          Accepted on {fmtDate(acceptedAt)}
        </div>
      )}
      <div className="pqv-sign-accepted-consent">
        Accepted quote &amp; terms (v1)
      </div>
      {signatureDataUrl && (
        <img
          src={signatureDataUrl}
          alt="Your signature"
          className="pqv-sign-accepted-img"
        />
      )}
    </div>
  );
}

/**
 * SignSection — signature pad + customer name entry for Phase G-2.
 *
 * Props:
 *   token        – the publicAccessToken from the URL
 *   onAccepted   – callback({ acceptedAt }) when the server confirms acceptance
 */
function SignSection({ token, onAccepted }) {
  const [customerName, setCustomerName] = useState('');
  const [submitState, setSubmitState] = useState('idle'); // 'idle' | 'submitting' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  // capturedSig holds the dataURL after the pad's onSave fires
  const [capturedSig, setCapturedSig] = useState(null);
  // consentChecked: customer must tick T&Cs + Privacy before Confirm is active
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentNudge, setConsentNudge] = useState(false);

  const handlePadSave = useCallback((dataUrl) => {
    setCapturedSig(dataUrl);
  }, []);

  const handlePadCancel = useCallback(() => {
    setCapturedSig(null);
  }, []);

  async function handleSubmit() {
    if (!capturedSig) return;
    if (!consentChecked) {
      setConsentNudge(true);
      return;
    }
    setSubmitState('submitting');
    setErrorMsg('');

    try {
      const res = await fetch(ACCEPT_QUOTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          signature: capturedSig,
          acceptedName: customerName.trim() || undefined,
          consentGiven: true,
        }),
      });

      if (!res.ok) {
        let msg = "Couldn't submit — please try again";
        try {
          const errData = await res.json();
          if (errData?.error) msg = errData.error;
        } catch { /* ignore parse failure */ }
        setErrorMsg(msg);
        setSubmitState('error');
        return;
      }

      const result = await res.json();
      setSubmitState('idle');
      onAccepted({ acceptedAt: result.acceptedAt, signatureDataUrl: capturedSig });
    } catch {
      setErrorMsg("Couldn't submit — please try again");
      setSubmitState('error');
    }
  }

  const isSubmitting = submitState === 'submitting';

  // If the pad has not yet delivered a signature, show the name input + pad
  if (!capturedSig) {
    return (
      <div className="pqv-section pqv-sign-section">
        <h2 className="pqv-section-title">Sign to accept this quote</h2>

        <div className="pqv-sign-name-row">
          <label className="pqv-sign-name-label" htmlFor="pqv-customer-name">
            Your name (optional)
          </label>
          <input
            id="pqv-customer-name"
            type="text"
            className="pqv-sign-name-input"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="e.g. Jane Smith"
            maxLength={200}
            autoComplete="name"
          />
        </div>

        <SignaturePad
          onSave={handlePadSave}
          onCancel={handlePadCancel}
          width={320}
          height={180}
        />
      </div>
    );
  }

  // Signature captured — show preview + consent checkbox + confirm/redo buttons
  return (
    <div className="pqv-section pqv-sign-section">
      <h2 className="pqv-section-title">Confirm your signature</h2>

      <img
        src={capturedSig}
        alt="Your signature preview"
        className="pqv-sign-preview-img"
      />

      {/* Consent checkbox — must be ticked before Confirm is active */}
      <label
        className="pqv-consent-row"
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 44, cursor: 'pointer', marginTop: 14, marginBottom: 4 }}
      >
        <input
          type="checkbox"
          checked={consentChecked}
          onChange={(e) => { setConsentChecked(e.target.checked); if (e.target.checked) setConsentNudge(false); }}
          style={{ marginTop: 3, flexShrink: 0, width: 20, height: 20, cursor: 'pointer' }}
          aria-label="Accept terms and privacy policy"
        />
        <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text, #1a1a1a)' }}>
          I accept this quote and the{' '}
          <a href="/terms" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline' }}>terms</a>.
          {' '}&middot;{' '}
          <a href="/privacy" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline', fontSize: 12, opacity: 0.75 }}>See how your details are used</a>
        </span>
      </label>
      {consentNudge && !consentChecked && (
        <p className="pqv-sign-error" role="alert" style={{ margin: '0 0 8px' }}>
          Tick the box to accept.
        </p>
      )}

      {submitState === 'error' && (
        <p className="pqv-sign-error" role="alert">{errorMsg}</p>
      )}

      <div className="pqv-sign-confirm-actions">
        <button
          type="button"
          className="btn-ghost pqv-sign-btn-redo"
          onClick={() => { setCapturedSig(null); setSubmitState('idle'); setErrorMsg(''); setConsentChecked(false); setConsentNudge(false); }}
          disabled={isSubmitting}
        >
          Redo
        </button>
        <button
          type="button"
          className="btn-convert pqv-sign-btn-submit"
          onClick={handleSubmit}
          disabled={isSubmitting || !consentChecked}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? 'Submitting...' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}

// ── BankDepositBlock ──────────────────────────────────────────────────────────
//
// V1 bank-transfer path: shown ABOVE SignSection when deposit_percent > 0 and
// the trader is NOT on the Stripe online path. Informational only — the customer
// accepts the quote normally (signs on screen). The deposit is a request paid
// off-platform and is NOT a precondition of acceptance in V1.

/**
 * @param {{
 *   depositPercent:     number,
 *   depositAmountPence: number,
 *   accountName:        string,
 *   sortCode:           string,
 *   accountNumber:      string,
 * }} props
 */
function BankDepositBlock({ depositPercent, depositAmountPence, accountName, sortCode, accountNumber }) {
  const depositGbp = depositAmountPence > 0 ? gbp(depositAmountPence / 100) : '';
  if (!depositGbp || !sortCode || !accountNumber) return null;

  return (
    <div className="pqv-section">
      <div className="pqv-deposit-block pqv-deposit-block--bank">
        <div className="pqv-deposit-block-row">
          <span>Deposit ({depositPercent}%)</span>
          <span>{depositGbp}</span>
        </div>
        <div className="pqv-deposit-block-sub">
          Pay by bank transfer to secure your booking
        </div>
        <div className="pqv-bank-details" style={{ marginTop: 10, fontSize: 13, lineHeight: 1.7 }}>
          {accountName && <div><strong>Name:</strong> {accountName}</div>}
          <div><strong>Sort code:</strong> {sortCode}</div>
          <div><strong>Account:</strong> {accountNumber}</div>
          <div style={{ marginTop: 6, color: 'var(--text-mid, #505050)', fontSize: 12 }}>
            Use your name as the reference, then message your trader to confirm.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DepositBlock ─────────────────────────────────────────────────────────────

/**
 * DepositBlock — shown on the customer quote page when deposit_percent > 0.
 *
 * Renders:
 *   - A green deposit info row (amount + "locks in your slot")
 *   - Primary: "Pay £X deposit & accept" (calls create-deposit-payment-link then redirects)
 *   - Secondary: "Accept without deposit" (existing SignSection flow)
 *
 * Decision locked: "Accept without deposit" is always visible when deposit > 0.
 * Decision locked: deposit_percent === 0 → this block is not rendered at all.
 *
 * @param {{
 *   job: object,
 *   token: string,                     — the public quote token (UUID)
 *   depositPercent: number,
 *   depositAmountPence: number,        — pence; calculated from job total if not pre-stored
 *   onAcceptWithoutDeposit: function,  — show the SignSection
 *   depositSuccess: boolean,           — ?deposit_success=true on the URL
 *   depositCancelled: boolean,         — ?deposit_cancelled=true on the URL
 * }} props
 */
function DepositBlock({ token, depositPercent, depositAmountPence, onAcceptWithoutDeposit, depositSuccess, depositCancelled }) {
  const [depositState, setDepositState] = useState('idle'); // 'idle' | 'loading' | 'error'
  const [depositError, setDepositError] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentNudge, setConsentNudge] = useState(false);

  const depositGbp = depositAmountPence > 0 ? gbp(depositAmountPence / 100) : '';

  // If already returned from a successful Stripe Checkout, show confirmation.
  if (depositSuccess) {
    return (
      <div className="pqv-section">
        <div className="pqv-deposit-success">
          <div className="pqv-deposit-success-title">Deposit paid</div>
          <div className="pqv-deposit-success-body">
            Your deposit of {depositGbp} has been received. Your slot is locked in.
          </div>
        </div>
      </div>
    );
  }

  async function handlePayDeposit() {
    if (depositState === 'loading') return;
    if (!consentChecked) {
      setConsentNudge(true);
      return;
    }
    setDepositState('loading');
    setDepositError('');

    try {
      const res = await fetch(CREATE_DEPOSIT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicQuoteToken: token, // server validates this against job.meta.publicAccessToken
          consentGiven: true,
        }),
      });

      let data;
      try { data = await res.json(); } catch { data = {}; }

      if (!res.ok) {
        setDepositError(data?.error || "Couldn't create payment link — please try again");
        setDepositState('error');
        return;
      }

      if (data?.payUrl) {
        // Redirect to Stripe Checkout. On return, the URL will have ?deposit_success=true
        // or ?deposit_cancelled=true (set in create-deposit-payment-link.js).
        window.location.href = data.payUrl;
      } else {
        setDepositError('Could not generate a payment link — please try again');
        setDepositState('error');
      }
    } catch {
      setDepositError("Couldn't connect — check your internet and try again");
      setDepositState('error');
    }
  }

  return (
    <div className="pqv-section">
      {depositCancelled && (
        <div className="pqv-deposit-cancelled" role="alert">
          Payment cancelled. You can try again below or accept without a deposit.
        </div>
      )}

      <div className="pqv-deposit-block">
        <div className="pqv-deposit-block-row">
          <span>Deposit ({depositPercent}%)</span>
          <span>{depositGbp}</span>
        </div>
        <div className="pqv-deposit-block-sub">Pay now to lock in your slot</div>
      </div>

      {/* Consent checkbox — mirrors the sign flow; must be ticked before Pay is active */}
      <label
        className="pqv-consent-row"
        style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 44, cursor: 'pointer', marginTop: 14, marginBottom: 4 }}
      >
        <input
          type="checkbox"
          checked={consentChecked}
          onChange={(e) => { setConsentChecked(e.target.checked); if (e.target.checked) setConsentNudge(false); }}
          style={{ marginTop: 3, flexShrink: 0, width: 20, height: 20, cursor: 'pointer' }}
          aria-label="Accept terms and privacy policy"
        />
        <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text, #1a1a1a)' }}>
          I accept this quote and the{' '}
          <a href="/terms" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline' }}>terms</a>.
          {' '}&middot;{' '}
          <a href="/privacy" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline', fontSize: 12, opacity: 0.75 }}>See how your details are used</a>
        </span>
      </label>
      {consentNudge && !consentChecked && (
        <p className="pqv-sign-error" role="alert" style={{ margin: '0 0 8px' }}>
          Tick the box to accept.
        </p>
      )}

      {depositState === 'error' && (
        <p className="pqv-sign-error" role="alert">{depositError}</p>
      )}

      <button
        type="button"
        className="pqv-btn-deposit"
        onClick={handlePayDeposit}
        disabled={depositState === 'loading' || !consentChecked}
        aria-busy={depositState === 'loading'}
      >
        {depositState === 'loading' ? 'Preparing payment…' : `Pay ${depositGbp} deposit & accept`}
      </button>

      <button
        type="button"
        className="pqv-btn-no-deposit"
        onClick={onAcceptWithoutDeposit}
        disabled={depositState === 'loading'}
      >
        Accept without deposit
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * @param {{ token: string }} props
 */
export default function PublicQuoteView({ token }) {
  // ── All hooks must sit above any early return (PR #125 binding rule) ──────────
  const [fetchState, setFetchState] = useState({ status: 'loading', job: null, errorMsg: '' });
  const [profileState, setProfileState] = useState({ status: 'loading', profile: null });
  // remoteAccepted: set when the customer completes the sign flow in this session.
  const [remoteAccepted, setRemoteAccepted] = useState(null); // null | { acceptedAt, signatureDataUrl }
  // showSignSection: toggled to true when customer taps "Accept without deposit"
  const [showSignSection, setShowSignSection] = useState(false);

  // Read ?deposit_success and ?deposit_cancelled from the URL (set by Stripe redirect).
  // Computed once at mount — URL params don't change during the page lifetime.
  const [depositSuccess] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('deposit_success') === 'true';
    } catch { return false; }
  });
  const [depositCancelled] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('deposit_cancelled') === 'true';
    } catch { return false; }
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isValidToken(token)) {
        setFetchState({ status: 'error', job: null, errorMsg: 'This link is not valid. Ask your trader for an updated link.' });
        setProfileState({ status: 'ok', profile: null });
        return;
      }

      // Fetch job + profile in parallel
      const [jobResult, profileResult] = await Promise.allSettled([
        fetchPublicJob(token),
        fetch(FETCH_QUOTE_PROFILE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      if (cancelled) return;

      const result = jobResult.status === 'fulfilled' ? jobResult.value : null;
      if (!result) {
        setFetchState({ status: 'error', job: null, errorMsg: 'Quote not found. The link may have expired or been removed.' });
        setProfileState({ status: 'ok', profile: null });
        return;
      }

      setFetchState({ status: 'ok', job: result, errorMsg: '' });
      setProfileState({ status: 'ok', profile: profileResult.status === 'fulfilled' ? profileResult.value : null });

      fetch(TRACK_OPEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      }).catch(() => { /* non-blocking */ });
    }

    load();
    return () => { cancelled = true; };
  }, [token]);

  // ── Early returns — hooks are all above here ──────────────────────────────────
  const { status, job, errorMsg } = fetchState;

  if (status === 'loading' || (status === 'ok' && profileState.status === 'loading')) {
    return <LoadingState />;
  }
  if (status === 'error') return <ErrorState message={errorMsg} />;

  // ── Derived values ────────────────────────────────────────────────────────────
  // Profile from the server (may be null if the fetch failed — degrade gracefully)
  const traderProfile = profileState.profile || {};

  // Business identity: prefer server profile (full details); fall back to job meta
  const businessName    = traderProfile.businessName || job.businessName || job.business_name || '';
  const businessAddress = traderProfile.address   || '';
  const businessPhone   = traderProfile.phone     || '';
  const businessEmail   = traderProfile.email     || '';
  const businessWebsite = traderProfile.website   || '';
  const businessLogoUrl = traderProfile.logoUrl   || '';
  const vatRegistered   = traderProfile.vatRegistered ?? false;
  const vatNumber       = traderProfile.vatNumber || '';
  const termsText       = traderProfile.termsText || traderProfile.terms_text || '';
  // Bank details — provided by fetch-public-quote-profile (V1 bank-transfer-deposits).
  const traderAccountName   = traderProfile.accountName   || '';
  const traderSortCode      = traderProfile.sortCode      || '';
  const traderAccountNumber = traderProfile.accountNumber || '';

  // Quote number and valid-until date from the server profile / job
  const quoteValidityDays = traderProfile.quoteValidityDays ?? 30;
  const quoteNumber = job.quoteNumber || (job.id ? `Q-${String(job.id).slice(-4).toUpperCase()}` : '');
  const issueDate = job.date
    ? (job.date.length === 10 ? new Date(job.date + 'T00:00:00') : new Date(job.date))
    : new Date();
  const validUntil = new Date(issueDate);
  validUntil.setDate(validUntil.getDate() + quoteValidityDays);
  const validUntilStr = validUntil.toLocaleDateString('en-GB');
  const customerName = job.customer || job.customer_name || job.name || '';
  const description = job.summary || '';
  const lineItems = Array.isArray(job.lineItems) && job.lineItems.length > 0
    ? job.lineItems.filter(i => i.desc || i.cost)
    : [];
  const total = job.total ?? job.amount ?? 0;

  // Deposit: use stored percent/amount from DB; calculate if absent.
  const depositPercent = Number(job.deposit_percent ?? 0);
  const hasDeposit = depositPercent > 0;
  const depositAmountPence = job.deposit_amount_pence
    ? job.deposit_amount_pence
    : Math.round(total * (depositPercent / 100) * 100);

  // Deposit already paid (either from DB or from ?deposit_success param this session)
  const depositAlreadyPaid = !!job.deposit_paid_at || depositSuccess;

  // Accepted if: server already has a signature, quoteStatus is accepted,
  // deposit was paid (which auto-accepts), or customer just signed in this session.
  const isAccepted = !!job.acceptedSignature || job.quoteStatus === 'accepted'
    || depositAlreadyPaid || !!remoteAccepted;
  const acceptedAt = remoteAccepted?.acceptedAt || job.acceptedAt || null;
  const quoteDate = job.date || job.createdAt || null;

  // Determine which deposit path to render.
  // stripeOnline: true when the trader profile indicates an online Stripe deposit link
  // was embedded — in V1 we infer this from whether the public profile has an account_name
  // that is empty BUT depositAmountPence is set (Stripe path sets deposit_amount_pence too).
  // Simpler heuristic: if bank details are present on the profile, show bank path;
  // if the job has a Stripe-paid deposit, show the existing DepositBlock.
  // V1 decision: if deposit_paid_at exists → already online-paid → not bank path.
  // For V1 we check: is there a Stripe deposit already (deposit_paid_at)?
  // If yes → existing DepositBlock handles success state.
  // If no deposit_paid_at and bank details are present → show BankDepositBlock (informational).
  // If no deposit_paid_at and no bank details → fall through to existing DepositBlock (Stripe).
  const hasBankDetails = !!(traderSortCode && traderAccountNumber);
  const isOnlineStripeDeposit = hasDeposit && !hasBankDetails;
  // When should we show the deposit flow vs the sign flow vs nothing?
  // - isAccepted: show accepted badge only (no action needed)
  // - hasDeposit && isOnlineStripeDeposit && !isAccepted && !showSignSection: show DepositBlock (Stripe)
  // - hasDeposit && !isOnlineStripeDeposit && !isAccepted: show BankDepositBlock (informational) ABOVE sign
  // - !hasDeposit || showSignSection: show SignSection (existing flow)
  const showDepositBlock = hasDeposit && isOnlineStripeDeposit && !isAccepted && !showSignSection;
  const showBankDepositBlock = hasDeposit && !isOnlineStripeDeposit && !isAccepted;
  const showSignFlow = !isAccepted && (!hasDeposit || showSignSection || showBankDepositBlock);

  return (
    <>
    <ConsentBanner />
    <div className="pqv-wrap">
      <div className="pqv-card">

        {/* Header — full trader business identity, matching the quote PDF */}
        <div className="pqv-header">
          {businessLogoUrl && (
            <img
              src={businessLogoUrl}
              alt="Business logo"
              className="pqv-business-logo"
              style={{ maxHeight: 56, maxWidth: 120, objectFit: 'contain', marginBottom: 6 }}
            />
          )}
          {businessName && (
            <div className="pqv-business-name">{businessName}</div>
          )}
          {businessAddress && (
            <div className="pqv-business-meta">{businessAddress}</div>
          )}
          {(businessPhone || businessEmail || businessWebsite) && (
            <div className="pqv-business-meta">
              {[businessPhone, businessEmail, businessWebsite].filter(Boolean).join('  •  ')}
            </div>
          )}
          {vatRegistered && vatNumber && (
            <div className="pqv-business-meta pqv-business-meta--light">
              VAT Reg: {vatNumber}
            </div>
          )}
          <div className="pqv-quote-label" style={{ marginTop: 8 }}>
            Quote
            {quoteDate && <span className="pqv-quote-date"> &middot; {fmtDate(quoteDate)}</span>}
          </div>
          {quoteNumber && (
            <div className="pqv-quote-ref">Ref: {quoteNumber}</div>
          )}
          <div className="pqv-quote-valid-until">Valid until {validUntilStr}</div>
        </div>

        {/* Accepted badge — suppressed when remoteAccepted is set so that
            RemoteAcceptedBlock (rendered below) is the sole confirmation
            after a fresh in-session sign. The badge still shows for the
            already-accepted-on-load case (remoteAccepted is null). */}
        {isAccepted && !remoteAccepted && <AcceptedBadge acceptedAt={acceptedAt} />}

        {/* Customer + description */}
        <div className="pqv-section">
          {customerName && (
            <div className="pqv-customer-name">{customerName}</div>
          )}
          {description && (
            <p className="pqv-description">{description}</p>
          )}
        </div>

        {/* Line items breakdown */}
        {lineItems.length > 0 ? (
          <LineItemsTable items={lineItems} />
        ) : (
          total > 0 && (
            <div className="pqv-section">
              <div className="pqv-flat-total">
                <span className="pqv-flat-total-label">Total</span>
                <span className="pqv-flat-total-value">{gbp(total)}</span>
              </div>
            </div>
          )
        )}

        {/* Stripe deposit flow — Pro+Stripe traders: card-on-acceptance */}
        {showDepositBlock && (
          <DepositBlock
            job={job}
            token={token}
            depositPercent={depositPercent}
            depositAmountPence={depositAmountPence}
            onAcceptWithoutDeposit={() => setShowSignSection(true)}
            depositSuccess={depositSuccess}
            depositCancelled={depositCancelled}
          />
        )}

        {/* Bank-transfer deposit block — shown informational above sign for bank-path traders */}
        {showBankDepositBlock && (
          <BankDepositBlock
            depositPercent={depositPercent}
            depositAmountPence={depositAmountPence}
            accountName={traderAccountName}
            sortCode={traderSortCode}
            accountNumber={traderAccountNumber}
          />
        )}

        {/* Sign section — shown when no deposit, or bank-deposit path (always signable), or customer chose "Accept without deposit" */}
        {showSignFlow && (
          <SignSection
            token={token}
            onAccepted={(result) => setRemoteAccepted(result)}
          />
        )}

        {/* Post-submit confirmation block */}
        {remoteAccepted && (
          <RemoteAcceptedBlock
            signatureDataUrl={remoteAccepted.signatureDataUrl}
            acceptedAt={remoteAccepted.acceptedAt}
          />
        )}

        {/* Terms & conditions footer — shown when set by the trader */}
        {termsText && (
          <div className="pqv-terms-block">
            <div className="pqv-terms-label">Terms &amp; conditions</div>
            <p className="pqv-terms-text">{termsText}</p>
          </div>
        )}

        <div className="pqv-footer">
          <p className="pqv-footer-note">
            Your details are held by <strong>{businessName || 'your trader'}</strong> to handle this quote, using JobProfit.{' '}
            <a href="/privacy" target="_blank" rel="noopener">How your data is used</a>
          </p>
          <PoweredByJobProfit source="quote" hidden={!!traderProfile.isPro} />
        </div>

      </div>
    </div>
    </>
  );
}
