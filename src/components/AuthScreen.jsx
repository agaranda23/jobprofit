import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { logTelemetry } from '../lib/telemetry';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  // Funnel step 1: auth wall viewed.
  useEffect(() => {
    logTelemetry('auth_screen_viewed');
  }, []);

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
        <form className="auth-form" onSubmit={send}>
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
