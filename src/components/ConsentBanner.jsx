/**
 * ConsentBanner — fixed bottom bar shown when analytics consent is null.
 *
 * Two equal-weight buttons ("Accept all" / "Essentials only") with no dark
 * patterns. Hides itself immediately on choice. Links to /privacy and /cookies.
 *
 * Mount in AppShell and each public screen (PublicQuoteView, PublicInvoiceView,
 * PublicReceiptView) because PostHog fires on all of them.
 */

import { useState, useEffect } from 'react';
import { getConsent, setConsent } from '../lib/consent.js';

export default function ConsentBanner() {
  const [visible, setVisible] = useState(() => getConsent() === null);

  // Listen for consent being set from another tab or from Settings.
  useEffect(() => {
    function onConsent() { setVisible(false); }
    window.addEventListener('jp:consent', onConsent);
    return () => window.removeEventListener('jp:consent', onConsent);
  }, []);

  if (!visible) return null;

  function handleAccept() {
    setConsent('granted');
    setVisible(false);
  }

  function handleEssentials() {
    setConsent('denied');
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      aria-modal="false"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: 'var(--color-surface, #fff)',
        borderTop: '1px solid var(--color-border, #e5e5e5)',
        padding: '16px 20px',
        boxShadow: '0 -2px 16px rgba(0,0,0,0.08)',
      }}
    >
      <p style={{ margin: '0 0 14px', fontSize: 14, lineHeight: 1.55, color: 'var(--color-text, #1a1a1a)' }}>
        We use essential cookies to keep you logged in and take payments. We'd also like analytics to
        see what's working and fix what isn't. Your call.{' '}
        <a href="/privacy" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy</a>
        {' '}&amp;{' '}
        <a href="/cookies" target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'underline' }}>Cookies</a>.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleAccept}
          style={{
            flex: '1 1 140px',
            minHeight: 44,
            background: 'var(--color-accent, #2bc48a)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Accept all
        </button>
        <button
          type="button"
          onClick={handleEssentials}
          style={{
            flex: '1 1 140px',
            minHeight: 44,
            background: 'transparent',
            color: 'var(--color-text, #1a1a1a)',
            border: '1.5px solid var(--color-border, #d1d1d1)',
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          Essentials only
        </button>
      </div>
    </div>
  );
}
