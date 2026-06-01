/**
 * PublicInvoiceView — hosted invoice page at /i/<token>.
 *
 * Customer-facing, read-only invoice view. No authentication required.
 * Mirrors PublicQuoteView's structure exactly — same fetch mechanism (token
 * resolves via fetchPublicJob using meta->>publicAccessToken), same loading
 * and error states, same forced-light .pqv-card treatment for legibility.
 *
 * What renders:
 *   - Full branded invoice via InvoiceDocumentPreview (logo, business, Bill To,
 *     line items, VAT, CIS deduction, Total Payable)
 *   - "Pay £X by card" button when the trader is Stripe-connected
 *     (calls create-invoice-payment-link via POST, then redirects to Stripe)
 *   - Static stripe_payment_link as a fallback when present but not connected
 *   - Bank transfer details when no card payment option exists (graceful)
 *
 * What is NOT rendered:
 *   - Internal notes, receipts, photos, profit data
 *   - Any sensitive business data beyond what appears on a real invoice
 *   - The trader-side UI (no editing, no status changes)
 *
 * Pay-now reconciliation: when the customer pays, the existing
 * stripe-connect-webhook handler fires and reconciles the job — we do not
 * duplicate that logic here.
 *
 * Design: mobile-first, max-width 600px on desktop, no auth shell,
 * forced light theme (reuses .pqv-card from PublicQuoteView).
 */

import { useState, useEffect } from 'react';
import { fetchPublicJob } from '../lib/store';
import { isValidToken } from '../lib/publicInvoiceToken';
import InvoiceDocumentPreview from '../components/InvoiceDocumentPreview';

const FETCH_PROFILE_URL   = '/.netlify/functions/fetch-public-invoice';
const CREATE_PAY_LINK_URL = '/.netlify/functions/create-invoice-payment-link-public';

// ── Helpers ────────────────────────────────────────────────────────────────────

function gbp(n) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(Number(n) || 0);
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="pqv-wrap" aria-busy="true" aria-label="Loading invoice">
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
        <h1 className="pqv-error-title">Invoice not found</h1>
        <p className="pqv-error-body">
          {message || 'This link may be invalid or the invoice has been removed. Contact your trader for a new link.'}
        </p>
      </div>
    </div>
  );
}

/**
 * PayNowBlock — shown when the trader is Stripe-connected.
 * Creates a Checkout Session on demand and redirects to Stripe.
 * Falls back to a "link unavailable" inline error on failure; never shows
 * a broken or permanently disabled button.
 *
 * @param {{ token: string, grossTotal: number }} props
 */
function PayNowBlock({ token, grossTotal }) {
  const [state, setState] = useState('idle'); // 'idle' | 'loading' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  async function handlePay() {
    if (state === 'loading') return;
    setState('loading');
    setErrorMsg('');

    try {
      // create-invoice-payment-link-public accepts a publicInvoiceToken
      // (server resolves the job + verifies ownership using the service-role key).
      const res = await fetch(CREATE_PAY_LINK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicInvoiceToken: token }),
      });

      let data;
      try { data = await res.json(); } catch { data = {}; }

      if (!res.ok) {
        setErrorMsg(data?.error || "Couldn't create payment link — please try again or pay by bank transfer");
        setState('error');
        return;
      }

      if (data?.payUrl) {
        window.location.href = data.payUrl;
      } else {
        setErrorMsg('Could not generate a payment link — please try again or pay by bank transfer');
        setState('error');
      }
    } catch {
      setErrorMsg("Couldn't connect — check your internet and try again");
      setState('error');
    }
  }

  return (
    <div className="piv-paynow-block">
      {state === 'error' && (
        <p className="piv-paynow-error" role="alert">{errorMsg}</p>
      )}
      <button
        type="button"
        className="piv-btn-paynow"
        onClick={handlePay}
        disabled={state === 'loading'}
        aria-busy={state === 'loading'}
      >
        {state === 'loading' ? 'Preparing payment…' : `Pay ${gbp(grossTotal)} by card`}
      </button>
      <div className="piv-paynow-sub">Powered by Stripe — secure card payment</div>
    </div>
  );
}

/**
 * StaticPayLink — shown when the trader has a manually-entered static Stripe
 * Payment Link but is not using Stripe Connect. Renders as a plain link button.
 */
function StaticPayLink({ stripePaymentLink, grossTotal }) {
  return (
    <div className="piv-paynow-block">
      <a
        href={stripePaymentLink}
        className="piv-btn-paynow"
        target="_blank"
        rel="noopener noreferrer"
      >
        Pay {gbp(grossTotal)} by card
      </a>
      <div className="piv-paynow-sub">Secure card payment</div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

/**
 * @param {{ token: string }} props
 */
export default function PublicInvoiceView({ token }) {
  // All hooks above any early return (PR #125 rule).
  const [jobState,     setJobState]     = useState({ status: 'loading', job: null, errorMsg: '' });
  const [profileState, setProfileState] = useState({ status: 'loading', profile: null });

  // Load both the job and profile in parallel.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isValidToken(token)) {
        setJobState({ status: 'error', job: null, errorMsg: 'This link is not valid. Ask your trader for an updated link.' });
        setProfileState({ status: 'ok', profile: null });
        return;
      }

      // Fetch job (anon Supabase client) + profile (service-role function) in parallel.
      const [jobResult, profileResult] = await Promise.allSettled([
        fetchPublicJob(token),
        fetch(FETCH_PROFILE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      if (cancelled) return;

      // Handle job result.
      const job = jobResult.status === 'fulfilled' ? jobResult.value : null;
      if (!job) {
        setJobState({ status: 'error', job: null, errorMsg: 'Invoice not found. The link may have expired or been removed.' });
        setProfileState({ status: 'ok', profile: null });
        return;
      }

      setJobState({ status: 'ok', job, errorMsg: '' });
      setProfileState({ status: 'ok', profile: profileResult.status === 'fulfilled' ? profileResult.value : null });
    }

    load();
    return () => { cancelled = true; };
  }, [token]);

  // ── Early returns — hooks all above ───────────────────────────────────────────
  const { status, job, errorMsg } = jobState;

  if (status === 'loading' || (status === 'ok' && profileState.status === 'loading')) {
    return <LoadingState />;
  }

  if (status === 'error') {
    return <ErrorState message={errorMsg} />;
  }

  // ── Derived values ────────────────────────────────────────────────────────────
  const profile = profileState.profile || {};

  // Build the biz object that InvoiceDocumentPreview expects.
  // Profile fields from fetch-public-invoice are camelCase in the response.
  const biz = {
    name:           profile.businessName  || '',
    address:        profile.address       || '',
    phone:          profile.phone         || '',
    email:          profile.email         || '',
    logoUrl:        profile.logoUrl       || '',
    logo_url:       profile.logoUrl       || '',
    vatRegistered:  profile.vatRegistered ?? false,
    vatNumber:      profile.vatNumber     || '',
    accountName:    profile.accountName   || '',
    sortCode:       profile.sortCode      || '',
    accountNumber:  profile.accountNumber || '',
    bankDetails:    profile.bankDetails   || '',
    stripePaymentLink: profile.stripePaymentLink || '',
    utr:            profile.utrNumber     || '',
  };

  // Build a profile-shape object for InvoiceDocumentPreview's CIS logic.
  const cisProfile = {
    is_cis_subcontractor: profile.isCisSubcontractor ?? false,
    cis_default_rate:     profile.cisDefaultRate ?? 20,
  };

  // Invoice meta from the job.
  const invoiceNumber = job.invoiceNumber || '';
  const dueDate       = job.invoiceDueDate || '';
  const total         = job.total ?? job.amount ?? 0;

  // Gross total (after VAT).
  const showVat    = !!biz.vatRegistered;
  const vat        = showVat ? Math.round(total * 0.2 * 100) / 100 : 0;
  const grossTotal = total + vat;

  // Payment options — priority: Connect > static link > bank only.
  const isConnected      = !!profile.isConnected;
  const hasStaticLink    = !!biz.stripePaymentLink;
  const hasBankDetails   = !!(biz.accountName || biz.sortCode || biz.accountNumber || biz.bankDetails);
  const showPayNowButton = isConnected;
  const showStaticLink   = !isConnected && hasStaticLink;

  return (
    <div className="pqv-wrap">
      <div className="pqv-card">

        {/* Document header label */}
        <div className="pqv-header">
          {biz.name && <div className="pqv-business-name">{biz.name}</div>}
          <div className="pqv-quote-label">Invoice</div>
        </div>

        {/* Full branded invoice rendered by InvoiceDocumentPreview */}
        <InvoiceDocumentPreview
          job={job}
          biz={biz}
          profile={cisProfile}
          invoiceNumber={invoiceNumber}
          dueDate={dueDate}
          payNowUrl=""
          receipts={[]}
        />

        {/* Pay-now section — below the document, not inside it */}
        {showPayNowButton && (
          <PayNowBlock token={token} grossTotal={grossTotal} />
        )}

        {showStaticLink && (
          <StaticPayLink stripePaymentLink={biz.stripePaymentLink} grossTotal={grossTotal} />
        )}

        {/* Bank-only nudge when no card option exists but bank details are present */}
        {!showPayNowButton && !showStaticLink && hasBankDetails && (
          <div className="piv-bank-only-note">
            Please pay by bank transfer using the details above.
          </div>
        )}

        <div className="pqv-footer">
          <p className="pqv-footer-note">
            Questions about this invoice? Contact your trader directly.
          </p>
        </div>

      </div>
    </div>
  );
}
