import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AppShell from './AppShell.jsx';
import { activateThemeController } from './lib/theme.js';

// Activate theme controller — reads stored pref, applies resolved data-theme
// to <html>, and subscribes to OS changes in 'system' mode.
// Called here (before render) as a secondary safety net — the inline script
// in index.html is the primary no-flash guard.
activateThemeController();

// Phase G-1: public quote route — /q/<token>
// Loaded lazily so it never inflates the main bundle for authenticated users.
const PublicQuoteView = lazy(() => import('./screens/PublicQuoteView.jsx'));

// Hosted invoice page — /i/<token>
// Also lazy-loaded: customers open this in a browser, not the app shell.
const PublicInvoiceView = lazy(() => import('./screens/PublicInvoiceView.jsx'));

/**
 * Checks whether the current URL path is a public quote route.
 * Pattern: /q/<token> where token is any non-empty segment.
 * Returns the token string if matched, null otherwise.
 */
function parsePublicQuoteRoute() {
  const path = window.location.pathname;
  const match = /^\/q\/([^/]+)$/.exec(path);
  return match ? match[1] : null;
}

/**
 * Checks whether the current URL path is a public invoice route.
 * Pattern: /i/<token> where token is any non-empty segment.
 * Returns the token string if matched, null otherwise.
 */
function parsePublicInvoiceRoute() {
  const path = window.location.pathname;
  const match = /^\/i\/([^/]+)$/.exec(path);
  return match ? match[1] : null;
}

const publicQuoteToken   = parsePublicQuoteRoute();
const publicInvoiceToken = parsePublicInvoiceRoute();

const SUSPENSE_FALLBACK = <div className="auth-loading"><div className="ocr-spinner" /></div>;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {publicInvoiceToken ? (
      // Hosted invoice page — no auth gate, no AppShell, code-split
      <Suspense fallback={SUSPENSE_FALLBACK}>
        <PublicInvoiceView token={publicInvoiceToken} />
      </Suspense>
    ) : publicQuoteToken ? (
      // Public quote view — no auth gate, no AppShell, code-split
      <Suspense fallback={SUSPENSE_FALLBACK}>
        <PublicQuoteView token={publicQuoteToken} />
      </Suspense>
    ) : (
      <AppShell />
    )}
  </StrictMode>,
)
