import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import posthog from 'posthog-js';
import AppShell from './AppShell.jsx';
import { activateThemeController } from './lib/theme.js';

// Initialise PostHog only when the project API key is present.
// Dev/PR previews without VITE_POSTHOG_KEY set will skip this block
// entirely — no errors, no noise in the PostHog project.
if (import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false,
    persistence: 'localStorage+cookie',
    loaded: (ph) => { if (import.meta.env.DEV) ph.debug(); },
  });
}

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

// Hosted receipt page — /r/<token>
// Lazy-loaded: customers open this after payment is confirmed.
const PublicReceiptView = lazy(() => import('./screens/PublicReceiptView.jsx'));

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

/**
 * Checks whether the current URL path is a public receipt route.
 * Pattern: /r/<token> where token is any non-empty segment.
 * Returns the token string if matched, null otherwise.
 */
function parsePublicReceiptRoute() {
  const path = window.location.pathname;
  const match = /^\/r\/([^/]+)$/.exec(path);
  return match ? match[1] : null;
}

const publicQuoteToken   = parsePublicQuoteRoute();
const publicInvoiceToken = parsePublicInvoiceRoute();
const publicReceiptToken = parsePublicReceiptRoute();

const SUSPENSE_FALLBACK = <div className="auth-loading"><div className="ocr-spinner" /></div>;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {publicInvoiceToken ? (
      // Hosted invoice page — no auth gate, no AppShell, code-split
      <Suspense fallback={SUSPENSE_FALLBACK}>
        <PublicInvoiceView token={publicInvoiceToken} />
      </Suspense>
    ) : publicReceiptToken ? (
      // Hosted receipt page — no auth gate, no AppShell, code-split
      <Suspense fallback={SUSPENSE_FALLBACK}>
        <PublicReceiptView token={publicReceiptToken} />
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
