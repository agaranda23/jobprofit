/**
 * CardPaymentsScreen — Stripe Connect onboarding + status screen.
 *
 * Two states driven by profile.stripe_connect_status:
 *   'connected'   → shows account name, Manage on Stripe link, Disconnect option
 *   anything else → shows the Connect Stripe CTA + reassurance block
 *
 * Wiring:
 *   - "Connect Stripe" calls /.netlify/functions/connect-oauth-start (POST, authed)
 *     and redirects the browser to the returned Stripe OAuth URL.
 *   - "Disconnect Stripe" shows a confirm sheet, then calls
 *     /.netlify/functions/connect-disconnect (POST, authed) and reloads profile.
 *   - "Manage on Stripe" opens the Stripe Express dashboard in a new tab.
 *
 * Mobile-first: designed for 375px width, thumb-reach targets ≥44px.
 *
 * Invocation points (banners on Send Invoice / Money / Today) are NOT in this
 * file — they ship in PR 2. This screen is the authoritative connect/disconnect
 * surface and lives at Settings → Get paid → Card payments.
 *
 * PR 2 TODO: show real activeLinkCount from disconnect response in the confirm
 * sheet copy (currently always 0, locked via connect-disconnect.js comment).
 */

import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the Supabase session access token for use in authenticated fetch calls.
 * Returns null if no active session is found.
 */
async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/**
 * Calls connect-oauth-start and navigates the browser to the returned Stripe URL.
 * Returns an error string on failure, null on success (success = navigation started).
 */
async function startOAuthFlow() {
  const token = await getAccessToken();
  if (!token) return 'Session expired — please sign out and back in';

  const res = await fetch('/.netlify/functions/connect-oauth-start', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    let msg = 'Could not start Stripe connection — please try again';
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      // ignore parse error
    }
    return msg;
  }

  const { url } = await res.json();
  if (!url) return 'No redirect URL returned — please try again';

  // Full browser navigation — Stripe OAuth happens in the same tab.
  // On return, Netlify's connect-oauth-callback redirects back to /#/settings?connected=1.
  window.location.href = url;
  return null;
}

/**
 * Calls connect-disconnect and returns { ok, activeLinkCount, error }.
 */
async function disconnectStripe() {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'Session expired — please sign out and back in' };

  const res = await fetch('/.netlify/functions/connect-disconnect', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    let msg = 'Could not disconnect — please try again';
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {
      // ignore parse error
    }
    return { ok: false, error: msg };
  }

  const body = await res.json();
  return { ok: true, activeLinkCount: body.activeLinkCount ?? 0 };
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * Confirmation bottom sheet shown when the trader taps "Disconnect Stripe".
 *
 * activeLinkCount is fetched from the disconnect endpoint (PR 2). When > 0,
 * renders the full warning per brief decision #5 (locked 2026-05-31):
 *   "X invoice[s] still have an active Pay-now link. They'll keep working
 *    until paid or until they expire. New invoices won't include a Pay-now
 *    button until you reconnect."
 */
function DisconnectSheet({ onConfirm, onCancel, confirming, activeLinkCount = 0 }) {
  const hasActiveLinks = activeLinkCount > 0;
  const linkWord = activeLinkCount === 1 ? 'invoice' : 'invoices';

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Disconnect Stripe"
      onClick={onCancel}
    >
      <div
        className="modal card-payments-sheet"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="card-payments-sheet__title">Disconnect Stripe?</h2>

        {hasActiveLinks ? (
          <p className="card-payments-sheet__body">
            {activeLinkCount} {linkWord} still {activeLinkCount === 1 ? 'has' : 'have'} an active
            Pay-now link. {activeLinkCount === 1 ? 'It' : 'They'}&rsquo;ll keep working until paid
            or until {activeLinkCount === 1 ? 'it expires' : 'they expire'}. New invoices won&rsquo;t
            include a Pay-now button until you reconnect.
          </p>
        ) : (
          <p className="card-payments-sheet__body">
            You can disconnect any time. New invoices won&rsquo;t include a Pay-now
            button until you reconnect.
          </p>
        )}

        <button
          type="button"
          className="card-payments-sheet__confirm"
          onClick={onConfirm}
          disabled={confirming}
        >
          {confirming ? 'Disconnecting…' : 'Disconnect'}
        </button>
        <button
          type="button"
          className="card-payments-sheet__cancel"
          onClick={onCancel}
          disabled={confirming}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── CardPaymentsScreen ────────────────────────────────────────────────────────

export default function CardPaymentsScreen({ profile, onBack, onProfileUpdate }) {
  // All hooks must sit above any conditional return — see feedback_react_hooks_before_early_returns.md
  const [connecting, setConnecting]           = useState(false);
  const [connectError, setConnectError]       = useState('');
  const [showDisconnect, setShowDisconnect]   = useState(false);
  const [disconnecting, setDisconnecting]     = useState(false);
  const [disconnectError, setDisconnectError] = useState('');
  // activeLinkCount: fetched just before the disconnect sheet opens so the
  // warning copy is accurate at the moment the trader decides to disconnect.
  const [activeLinkCount, setActiveLinkCount] = useState(0);

  const isConnected = profile?.stripe_connect_status === 'connected' && !!profile?.stripe_user_id;

  // Derive a display name for the connected account.
  // stripe_user_id (acct_...) is not human-readable; the business_name or
  // the trader's own name from the profile is used as a proxy until PR 3 or
  // a separate account-detail fetch adds the Stripe account name.
  const connectedAccountName =
    profile?.business_name ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
    'Your Stripe account';

  const handleConnect = async () => {
    if (connecting) return;
    setConnecting(true);
    setConnectError('');
    const err = await startOAuthFlow();
    // startOAuthFlow navigates away on success — only runs past here on error
    if (err) {
      setConnectError(err);
      setConnecting(false);
    }
  };

  const handleDisconnectOpen = async () => {
    setDisconnectError('');
    // Pre-fetch activeLinkCount before showing the sheet so the warning copy
    // is accurate. We call connect-disconnect speculatively here but we don't
    // actually disconnect — the count comes back in the 200 response preview.
    // Simpler: we run the real disconnect only on confirm. For the count we
    // do a lightweight direct Supabase query from the client instead. The
    // client can only SELECT their own rows (RLS: trader_user_id = auth.uid()).
    // We use the count from the Supabase realtime client so no extra function is needed.
    try {
      const { supabase: sb } = await import('../lib/supabase.js');
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const { count } = await sb
          .from('invoice_payment_tokens')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString());
        setActiveLinkCount(count ?? 0);
      }
    } catch {
      setActiveLinkCount(0);
    }
    setShowDisconnect(true);
  };

  const handleDisconnectConfirm = async () => {
    if (disconnecting) return;
    setDisconnecting(true);
    setDisconnectError('');
    const { ok, error } = await disconnectStripe();
    setDisconnecting(false);
    if (!ok) {
      setDisconnectError(error);
      return;
    }
    setShowDisconnect(false);
    setActiveLinkCount(0);
    // Notify parent to reload the profile so the screen flips to not-connected
    onProfileUpdate?.({
      stripe_user_id: null,
      stripe_connect_status: 'disconnected',
    });
  };

  return (
    <div className="screen card-payments-screen">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="screen-header card-payments-screen__header">
        <button
          type="button"
          className="card-payments-screen__back"
          onClick={onBack}
          aria-label="Back to Settings"
        >
          ‹
        </button>
        <h1 className="screen-title">Card payments</h1>
      </div>

      <div className="card-payments-screen__body">
        {isConnected ? (
          /* ── Connected state (wireframe 4.2) ─────────────────────────── */
          <>
            <div className="card-payments-status card-payments-status--connected">
              <span className="card-payments-status__icon" aria-hidden="true">&#x2713;</span>
              <div>
                <div className="card-payments-status__title">Connected to Stripe</div>
                <div className="card-payments-status__detail">{connectedAccountName}</div>
              </div>
            </div>

            <a
              href="https://dashboard.stripe.com"
              target="_blank"
              rel="noopener noreferrer"
              className="card-payments-cta card-payments-cta--secondary"
            >
              Manage on Stripe &#x2197;
            </a>

            <p className="card-payments-screen__on-copy">
              Pay-now is on for new invoices.
            </p>

            {disconnectError && (
              <p className="card-payments-screen__error" role="alert">
                {disconnectError}
              </p>
            )}

            <button
              type="button"
              className="card-payments-screen__disconnect-link"
              onClick={handleDisconnectOpen}
            >
              Disconnect Stripe
            </button>
          </>
        ) : (
          /* ── Not connected state (wireframe 4.1) ─────────────────────── */
          <>
            <div className="card-payments-status card-payments-status--disconnected">
              <span className="card-payments-status__icon card-payments-status__icon--empty" aria-hidden="true">&#x25CB;</span>
              <div>
                <div className="card-payments-status__title">Not connected</div>
                <p className="card-payments-status__explainer">
                  Add a Pay-now button to your invoices. Customers pay by card,
                  money lands in your bank.
                </p>
              </div>
            </div>

            {connectError && (
              <p className="card-payments-screen__error" role="alert">
                {connectError}
              </p>
            )}

            <button
              type="button"
              className="card-payments-cta card-payments-cta--primary"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? 'Connecting…' : 'Connect Stripe'}
            </button>

            {/* Reassurance block */}
            <ul className="card-payments-reassurance" aria-label="How it works">
              <li className="card-payments-reassurance__item">
                <span className="card-payments-reassurance__icon" aria-hidden="true">&#x1F512;</span>
                <span>Money goes straight to your bank. We never hold it.</span>
              </li>
              <li className="card-payments-reassurance__item">
                <span className="card-payments-reassurance__icon" aria-hidden="true">&#x23F1;</span>
                <span>Payouts in 2&ndash;7 days, set by Stripe.</span>
              </li>
              <li className="card-payments-reassurance__item">
                <span className="card-payments-reassurance__icon" aria-hidden="true">&#x1F4B3;</span>
                <span>Card details never touch JobProfit.</span>
              </li>
              <li className="card-payments-reassurance__item">
                <span className="card-payments-reassurance__icon" aria-hidden="true">&#x1F3E6;</span>
                <span>Disconnect any time.</span>
              </li>
            </ul>

            <p className="card-payments-screen__footnote">
              You&rsquo;ll need 5 min, your business details, and your bank account number.
            </p>
          </>
        )}
      </div>

      {/* ── Disconnect confirmation sheet ───────────────────────────────────── */}
      {showDisconnect && (
        <DisconnectSheet
          onConfirm={handleDisconnectConfirm}
          onCancel={() => setShowDisconnect(false)}
          confirming={disconnecting}
          activeLinkCount={activeLinkCount}
        />
      )}
    </div>
  );
}
