import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { logTelemetry } from '../lib/telemetry';

/**
 * Reads OAuth error params from the URL hash or query string and strips them.
 *
 * Supabase may return the error in either location depending on the OAuth flow:
 *   - Hash fragment: /#error=access_denied&error_description=...
 *   - Query string:  /?error=access_denied&error_description=...
 *
 * Returns a human-friendly message string, or null when there is no error.
 * Cleans the URL so the error params don't persist on refresh.
 */
function consumeOAuthError() {
  // Try hash first (Supabase's default implicit flow), then query string.
  const rawHash = window.location.hash.replace(/^#\/?/, '');
  const hashParams = new URLSearchParams(rawHash);
  const queryParams = new URLSearchParams(window.location.search);

  const error = hashParams.get('error') || queryParams.get('error');
  if (!error) return null;

  const description =
    hashParams.get('error_description') ||
    queryParams.get('error_description') ||
    '';

  // Strip the error params from the URL without adding a history entry.
  // Keep any non-error hash fragment (e.g. #/today view).
  const cleanHash = window.location.hash.replace(
    /[#&]?error=[^&]*(&error_description=[^&]*)?/,
    ''
  ).replace(/^#&/, '#').replace(/^#$/, '');
  const cleanSearch = window.location.search.replace(
    /[?&]?error=[^&]*(&error_description=[^&]*)?/,
    ''
  ).replace(/^\?$/, '');
  window.history.replaceState(
    null,
    '',
    window.location.pathname + cleanSearch + cleanHash
  );

  // access_denied = user clicked "Cancel" on the Google consent screen.
  if (error === 'access_denied') {
    return "Google sign-in was cancelled or didn't complete — try again, or use email below.";
  }
  // Anything else: show the raw description if present, otherwise a generic message.
  return description
    ? `Sign-in error: ${decodeURIComponent(description.replace(/\+/g, ' '))}`
    : 'Google sign-in failed — try again, or use email below.';
}

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  // Funnel step 1: auth wall viewed.
  // Also check for a returning OAuth error (e.g. user cancelled Google sign-in).
  useEffect(() => {
    logTelemetry('auth_screen_viewed');
    const oauthError = consumeOAuthError();
    if (oauthError) {
      setError(oauthError);
      logTelemetry('signin_google_callback_error', { raw: oauthError });
    }
  }, []);

  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    logTelemetry('signin_google_clicked');
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) {
        setError(error.message);
      }
    } catch (e) {
      setError(e.message || 'Something went wrong');
    } finally {
      setGoogleLoading(false);
    }
  };

  const send = async (e) => {
    e?.preventDefault?.();
    if (!email.trim()) return;
    setSending(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) {
        setError(error.message);
      } else {
        // Funnel step 2: OTP link successfully requested.
        logTelemetry('signin_link_requested');
        setSent(true);
      }
    } catch (e) {
      setError(e.message || 'Something went wrong');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <img src="/jobprofit-logo.png" alt="" className="auth-logo" />
        <h1 className="auth-title">JobProfit</h1>
        <p className="auth-hero">Quote it, send it, get paid. From the van.</p>

        <div className="auth-loop" aria-label="Quote, Signed, Invoiced, Paid">
          <span className="auth-loop-chip auth-loop-chip--1">Quote</span>
          <span className="auth-loop-sep" aria-hidden="true">›</span>
          <span className="auth-loop-chip auth-loop-chip--2">Signed</span>
          <span className="auth-loop-sep" aria-hidden="true">›</span>
          <span className="auth-loop-chip auth-loop-chip--3">Invoiced</span>
          <span className="auth-loop-sep" aria-hidden="true">›</span>
          <span className="auth-loop-chip auth-loop-chip--4">Paid</span>
        </div>

        <ul className="auth-benefits">
          <li>Speak the job — quote in your customer's WhatsApp in 52 seconds.</li>
          <li>Get it signed, invoiced, and unpaid ones chased — without nagging anyone yourself.</li>
          <li>See the real profit on every job, not just what landed in the bank.</li>
        </ul>

        <p className="auth-trust">£12/mo flat. Tradify charges £34. Free trial, no card. No app store — it just opens.</p>
      </div>

      {!sent ? (
        <>
          <div className="auth-google">
            <button
              type="button"
              className="auth-google-btn"
              onClick={signInWithGoogle}
              disabled={googleLoading}
            >
              <svg className="auth-google-icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {googleLoading ? 'Redirecting…' : 'Continue with Google'}
            </button>
          </div>

          <div className="auth-divider" aria-hidden="true">
            <span>or</span>
          </div>

          <form className="auth-form auth-form--secondary" onSubmit={send}>
            <label className="auth-label">
              <span>Email address</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={sending}
              />
            </label>
            <button type="submit" className="auth-submit" disabled={sending || !email.trim()}>
              {sending ? 'Sending your link…' : 'Start free — email me a sign-in link'}
            </button>
            {error && <p className="auth-error">{error}</p>}
            <p className="auth-hint">No passwords. We email you a link, you tap it, you're in.</p>
          </form>
        </>
      ) : (
        <div className="auth-sent">
          <div className="auth-sent-icon">✉️</div>
          <h2>Check your email</h2>
          <p>We've sent your sign-in link to <strong>{email}</strong>.</p>
          <p className="auth-hint">Tap the link on this phone and you're in. No password to remember.</p>
          <button className="auth-link-btn" onClick={() => { setSent(false); setEmail(''); }}>
            Use a different email
          </button>
        </div>
      )}
    </div>
  );
}
