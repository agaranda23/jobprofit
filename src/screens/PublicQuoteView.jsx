/**
 * PublicQuoteView — Phase G-2 (accept/decline redesign).
 *
 * Customer-facing, read-only quote view at /q/<token>.
 * No authentication required. No state mutations.
 *
 * What renders:
 *   - Trader business name (from job meta / profile fields in meta)
 *   - Customer name + job description
 *   - Line items breakdown + total
 *   - Accept / Decline buttons when quote is pending
 *   - Read-only terminal state when already accepted or declined
 *
 * What is deliberately NOT rendered:
 *   - Payment history, receipts, photos, internal notes
 *   - Any customer PII beyond their own name
 *   - Any sensitive business data (bank details, VAT number)
 *
 * Design: mobile-first, max-width 600px on desktop, no auth shell.
 *
 * Signature pad removed (Phase G-2 redesign): data-minimisation under UK GDPR.
 * An audited timestamped tap with inline consent and optional name fully serves
 * the legal purpose. Signature was the largest PII with no added legal weight.
 * Backfill of historic signatures is a fast-follow (LGL sign-off advisable).
 */

import { useState, useEffect } from 'react';
import { isValidToken } from '../lib/publicQuoteToken';

// Fetch job data via the server-side function so the anon Supabase client is
// never used for job data. See fix/security-stop-the-line (H-1).
async function fetchPublicJobViaFunction(token) {
  try {
    const res = await fetch('/.netlify/functions/fetch-public-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
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

const ACCEPT_QUOTE_URL        = '/.netlify/functions/accept-quote';
const DECLINE_QUOTE_URL       = '/.netlify/functions/decline-quote';
const TRACK_OPEN_URL          = '/.netlify/functions/track-quote-open';
const CREATE_DEPOSIT_URL      = '/.netlify/functions/create-deposit-payment-link';
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
 * RemoteAcceptedBlock — shown after customer accepts in this session.
 * Also shown on revisit when quoteStatus is already 'accepted'.
 */
function RemoteAcceptedBlock({ acceptedAt, showBankDetails, depositPercent, depositAmountPence, accountName, sortCode, accountNumber }) {
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
      <p className="pqv-sign-accepted-note">
        Thanks — your trader has been told.
      </p>
      {/* Keep bank details visible after accept so the customer can pay the deposit */}
      {showBankDetails && (
        <div className="pqv-bank-details" style={{ marginTop: 12, fontSize: 'var(--fs-label)', lineHeight: 1.7, color: '#086B45' }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: '#086B45' }}>
            Deposit ({depositPercent}%) — {depositAmountPence > 0 ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(depositAmountPence / 100) : ''}
          </div>
          {accountName && <div><strong>Name:</strong> {accountName}</div>}
          <div><strong>Sort code:</strong> {sortCode}</div>
          <div><strong>Account:</strong> {accountNumber}</div>
          <div style={{ marginTop: 6, color: 'var(--text-mid, #505050)', fontSize: 'var(--fs-label)' }}>
            Use your name as the reference, then message your trader to confirm.
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * RemoteDeclinedBlock — shown after customer declines in this session.
 * Also shown on revisit when quoteStatus is 'declined'.
 */
function RemoteDeclinedBlock({ declinedAt }) {
  return (
    <div className="pqv-sign-declined" role="status">
      <div className="pqv-sign-declined-title">Quote declined</div>
      {declinedAt && (
        <div className="pqv-sign-declined-date">
          Declined on {fmtDate(declinedAt)}
        </div>
      )}
      <p className="pqv-sign-declined-note">
        No problem — message your trader directly to reopen it.
      </p>
    </div>
  );
}

/**
 * DecisionSection — Accept / Decline buttons for Phase G-2 redesign.
 *
 * No signature pad. Customer taps Accept or Decline. Decline opens an inline
 * confirm with an optional free-text reason field. Consent is via inline copy
 * on the Accept button rather than a checkbox.
 *
 * Props:
 *   token       – the publicAccessToken from the URL
 *   onAccepted  – callback({ acceptedAt }) when server confirms acceptance
 *   onDeclined  – callback({ declinedAt }) when server confirms decline
 */
function DecisionSection({ token, onAccepted, onDeclined }) {
  const [customerName, setCustomerName] = useState('');
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [submitState, setSubmitState] = useState('idle'); // 'idle' | 'submitting' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  async function handleAccept() {
    if (submitState === 'submitting') return;
    setSubmitState('submitting');
    setErrorMsg('');

    try {
      const res = await fetch(ACCEPT_QUOTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          acceptedName: customerName.trim() || undefined,
          consentGiven: true,
        }),
      });

      if (!res.ok) {
        let msg = 'Could not send that — try again';
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
      onAccepted({ acceptedAt: result.acceptedAt });
    } catch {
      setErrorMsg('Could not send that — try again');
      setSubmitState('error');
    }
  }

  async function handleDeclineConfirm() {
    if (submitState === 'submitting') return;
    setSubmitState('submitting');
    setErrorMsg('');

    try {
      const res = await fetch(DECLINE_QUOTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          declinedName: customerName.trim() || undefined,
          declineReason: declineReason.trim() || undefined,
        }),
      });

      if (!res.ok) {
        let msg = 'Could not send that — try again';
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
      onDeclined({ declinedAt: result.declinedAt });
    } catch {
      setErrorMsg('Could not send that — try again');
      setSubmitState('error');
    }
  }

  const isSubmitting = submitState === 'submitting';

  return (
    <div className="pqv-section pqv-sign-section">
      <h2 className="pqv-section-title">Your decision</h2>
      <p className="pqv-sign-section-helper">Take a look, then let your trader know.</p>

      {/* Optional name — used on both accept and decline */}
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

      {submitState === 'error' && (
        <p className="pqv-sign-error" role="alert">{errorMsg}</p>
      )}

      {!declineOpen ? (
        <div className="pqv-decision-actions">
          {/* Primary: Accept */}
          <button
            type="button"
            className="pqv-btn-accept"
            onClick={handleAccept}
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? 'Sending…' : 'Accept quote'}
          </button>
          {/* Inline consent copy — no checkbox required */}
          <p className="pqv-decision-consent">
            By accepting you agree to the quote and the{' '}
            <a href="/terms" target="_blank" rel="noopener">terms</a>.{' '}
            <a href="/privacy" target="_blank" rel="noopener">See how your details are used</a>.
          </p>

          {/* Secondary: Decline */}
          <button
            type="button"
            className="pqv-btn-decline"
            onClick={() => setDeclineOpen(true)}
            disabled={isSubmitting}
          >
            Decline quote
          </button>
        </div>
      ) : (
        /* Inline decline confirm — shows reason field then confirm button */
        <div className="pqv-decline-confirm">
          <h3 className="pqv-decline-confirm-title">Decline this quote</h3>

          <div className="pqv-sign-name-row" style={{ marginTop: 8 }}>
            <label className="pqv-sign-name-label" htmlFor="pqv-decline-reason">
              Reason (optional)
            </label>
            <textarea
              id="pqv-decline-reason"
              className="pqv-sign-name-input pqv-decline-reason-input"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="e.g. Gone with another quote"
              maxLength={500}
              rows={3}
            />
          </div>

          {submitState === 'error' && (
            <p className="pqv-sign-error" role="alert">{errorMsg}</p>
          )}

          <div className="pqv-decision-actions" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="pqv-btn-decline"
              onClick={handleDeclineConfirm}
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? 'Sending…' : 'Decline this quote'}
            </button>
            <button
              type="button"
              className="pqv-btn-back"
              onClick={() => { setDeclineOpen(false); setErrorMsg(''); setSubmitState('idle'); }}
              disabled={isSubmitting}
            >
              Back
            </button>
          </div>
        </div>
      )}
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
        {/* color:#086B45 is explicit here — the parent .pqv-deposit-block has no
            inherited color, so without this the values render invisible on the
            light-green (#D6F5E6) background. Contrast ratio ~6.7:1 passes AA. */}
        <div className="pqv-bank-details" style={{ marginTop: 10, fontSize: 'var(--fs-label)', lineHeight: 1.7, color: '#086B45' }}>
          {accountName && <div><strong>Name:</strong> {accountName}</div>}
          <div><strong>Sort code:</strong> {sortCode}</div>
          <div><strong>Account:</strong> {accountNumber}</div>
          <div style={{ marginTop: 6, opacity: 0.75, fontSize: 'var(--fs-label)' }}>
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
function DepositBlock({ _job, token, depositPercent, depositAmountPence, onAcceptWithoutDeposit, depositSuccess, depositCancelled }) {
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
        <span style={{ fontSize: 'var(--fs-label)', lineHeight: 1.5, color: 'var(--text, #1a1a1a)' }}>
          I accept this quote and the{' '}
          <a href="/terms" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline' }}>terms</a>.
          {' '}&middot;{' '}
          <a href="/privacy" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline', fontSize: 'var(--fs-label)', opacity: 0.75 }}>See how your details are used</a>
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
  // remoteAccepted: set when the customer accepts in this session.
  const [remoteAccepted, setRemoteAccepted] = useState(null); // null | { acceptedAt }
  // remoteDeclined: set when the customer declines in this session.
  const [remoteDeclined, setRemoteDeclined] = useState(null); // null | { declinedAt }
  // showDecisionSection: toggled to true when customer taps "Accept without deposit"
  const [showDecisionSection, setShowDecisionSection] = useState(false);

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
        fetchPublicJobViaFunction(token),
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

  // Accepted if: quoteStatus is accepted (canonical G-2 signal), deposit was paid
  // (auto-accepts), customer just accepted in this session, or legacy row carries
  // acceptedSignature with no quoteStatus yet (pre-G-2 fallback, checked last).
  const isAccepted = job.quoteStatus === 'accepted'
    || depositAlreadyPaid || !!remoteAccepted || !!job.acceptedSignature;
  const isDeclined = !isAccepted && (job.quoteStatus === 'declined' || !!remoteDeclined);
  const isTerminal = isAccepted || isDeclined;
  const acceptedAt = remoteAccepted?.acceptedAt || job.acceptedAt || null;
  const declinedAt = remoteDeclined?.declinedAt || job.declinedAt || null;
  const quoteDate = job.date || job.createdAt || null;

  // Determine which deposit path to render.
  // stripeOnline: true when bank details are absent (Stripe path).
  // If bank details are present → show BankDepositBlock (informational) above decision.
  // If no deposit → fall straight through to DecisionSection.
  const hasBankDetails = !!(traderSortCode && traderAccountNumber);
  const isOnlineStripeDeposit = hasDeposit && !hasBankDetails;
  // hadBankDepositBlock: true when the trader uses bank-transfer deposits.
  // Computed BEFORE the isTerminal gate so it remains true after the customer
  // accepts — the PRD requires bank details to stay visible post-accept so the
  // customer can pay the deposit. showBankDepositBlock gates on !isTerminal
  // (controls the pre-decision block above the buttons); hadBankDepositBlock
  // is used to pass showBankDetails into RemoteAcceptedBlock independently.
  const hadBankDepositBlock = hasDeposit && !isOnlineStripeDeposit && hasBankDetails;
  // Show paths:
  //   isTerminal                     → show terminal state only (no action buttons)
  //   hasDeposit + Stripe + !terminal → DepositBlock (Stripe path, leads to accept via redirect)
  //   hasDeposit + bank + !terminal   → BankDepositBlock (informational) + DecisionSection below
  //   !hasDeposit + !terminal         → DecisionSection directly
  const showDepositBlock = hasDeposit && isOnlineStripeDeposit && !isTerminal && !showDecisionSection;
  const showBankDepositBlock = hadBankDepositBlock && !isTerminal;
  const showDecisionFlow = !isTerminal && (!hasDeposit || showDecisionSection || showBankDepositBlock);

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

        {/* Accepted badge — shown on load when quote was already accepted before
            this session. Suppressed when remoteAccepted is set so that
            RemoteAcceptedBlock (rendered below) is the sole confirmation. */}
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
            onAcceptWithoutDeposit={() => setShowDecisionSection(true)}
            depositSuccess={depositSuccess}
            depositCancelled={depositCancelled}
          />
        )}

        {/* Bank-transfer deposit block — shown informational above decision for bank-path traders */}
        {showBankDepositBlock && (
          <BankDepositBlock
            depositPercent={depositPercent}
            depositAmountPence={depositAmountPence}
            accountName={traderAccountName}
            sortCode={traderSortCode}
            accountNumber={traderAccountNumber}
          />
        )}

        {/* Decision section — shown when no deposit, or bank-deposit path, or customer chose "Accept without deposit" */}
        {showDecisionFlow && (
          <DecisionSection
            token={token}
            onAccepted={(result) => setRemoteAccepted(result)}
            onDeclined={(result) => setRemoteDeclined(result)}
          />
        )}

        {/* Post-submit confirmation blocks — only one will render */}
        {remoteAccepted && (
          <RemoteAcceptedBlock
            acceptedAt={remoteAccepted.acceptedAt}
            showBankDetails={hadBankDepositBlock}
            depositPercent={depositPercent}
            depositAmountPence={depositAmountPence}
            accountName={traderAccountName}
            sortCode={traderSortCode}
            accountNumber={traderAccountNumber}
          />
        )}
        {remoteDeclined && (
          <RemoteDeclinedBlock
            declinedAt={remoteDeclined.declinedAt}
          />
        )}
        {/* Read-only terminal state on revisit after decline (no in-session state) */}
        {isDeclined && !remoteDeclined && (
          <RemoteDeclinedBlock
            declinedAt={declinedAt}
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
            Your details are held by <strong>{businessName || 'your trader'}</strong> to handle this quote, using OHNAR.{' '}
            <a href="/privacy" target="_blank" rel="noopener">How your data is used</a>
          </p>
          <PoweredByJobProfit source="quote" hidden={!!traderProfile.isPro} />
        </div>

      </div>
    </div>
    </>
  );
}
