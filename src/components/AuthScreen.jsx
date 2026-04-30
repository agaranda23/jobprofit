import { useState } from 'react';
import { supabase } from '../lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

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
        <img src="/icon-192.png" alt="" className="auth-logo" />
        <h1 className="auth-title">JobProfit</h1>
        <p className="auth-tagline">Track what you actually make each day</p>
        <ul className="auth-benefits">
          <li>Log jobs in seconds — by voice or photo</li>
          <li>Auto-generate invoices and chase unpaid ones</li>
          <li>See your real profit, not just revenue</li>
        </ul>
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
            {sending ? 'Sending…' : 'Send sign-in link'}
          </button>
          {error && <p className="auth-error">{error}</p>}
          <p className="auth-hint">No passwords. We'll email you a link to sign in.</p>
        </form>
      ) : (
        <div className="auth-sent">
          <div className="auth-sent-icon">✉️</div>
          <h2>Check your email</h2>
          <p>We've sent a sign-in link to <strong>{email}</strong></p>
          <p className="auth-hint">Tap the link on this device to sign in.</p>
          <button className="auth-link-btn" onClick={() => { setSent(false); setEmail(''); }}>
            Use a different email
          </button>
        </div>
      )}
    </div>
  );
}
