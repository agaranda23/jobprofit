import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import posthog from 'posthog-js';
import AppShell from './AppShell.jsx';
import Splash from './components/Splash.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { activateThemeController } from './lib/theme.js';
import { getConsent } from './lib/consent.js';

// ── Referral attribution — capture ?ref= BEFORE any auth redirect strips it ──
// This runs synchronously at the very top of main so we never lose the code.
// The code is persisted to sessionStorage; AppShell reads it on SIGNED_IN.
(function captureReferralCode() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref && /^[A-Za-z0-9]{1,20}$/.test(ref)) {
      sessionStorage.setItem('jp.referralCode', ref.trim());
      // Clean the param from the URL bar without adding a history entry
      params.delete('ref');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
      history.replaceState(null, '', newUrl);
    }
  } catch {
    // sessionStorage unavailable (private mode edge case) — silently skip
  }
})();

// Bootstrap Google Analytics 4 only when VITE_GA4_ID is present.
// Dev/PR previews without VITE_GA4_ID set will skip this block entirely.
//
// GDPR/PECR compliance (Consent Mode v2):
//   1. window.dataLayer + gtag() stub are created BEFORE the script loads so
//      that any consent calls issued synchronously below are queued and
//      replayed by gtag.js once it loads.
//   2. analytics_storage defaults to 'denied' — no measurement cookies or
//      hits are sent until the user accepts via the ConsentBanner.
//   3. If consent was previously granted (localStorage) we update to 'granted'
//      immediately so returning users resume measurement without re-prompting.
//   4. GA4 sends a page_view automatically on config — no explicit
//      capture_pageview call is needed.
if (import.meta.env.VITE_GA4_ID) {
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());

  // Consent Mode v2 — must be declared BEFORE config to take effect.
  window.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    wait_for_update: 500,
  });

  // Restore previous consent for returning users.
  if (getConsent() === 'granted') {
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
  }

  window.gtag('config', import.meta.env.VITE_GA4_ID, {
    send_page_view: true,
  });

  // Inject the gtag.js script tag dynamically (env-gated, keeps it out of
  // the bundle entirely when the key is absent).
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${import.meta.env.VITE_GA4_ID}`;
  document.head.appendChild(script);
}

// Bootstrap PostHog only when VITE_POSTHOG_KEY is present.
// EU-hosted (eu.i.posthog.com) — override via VITE_POSTHOG_HOST if needed.
//
// GDPR/PECR compliance:
//   opt_out_capturing_by_default prevents any event or cookie writes until the
//   user accepts via the ConsentBanner. If consent was previously granted
//   (localStorage) we opt back in immediately so returning users resume tracking
//   without re-prompting.
//
// persistence: 'localStorage' avoids writing the PostHog cookie before consent.
if (import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false,
    persistence: 'localStorage',
    opt_out_capturing_by_default: true,
    loaded: (ph) => {
      if (import.meta.env.DEV) ph.debug();
      // Restore previous consent — runs synchronously before first render.
      if (getConsent() === 'granted') {
        ph.opt_in_capturing();
      }
    },
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

const SUSPENSE_FALLBACK = <Splash />;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
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
    </ErrorBoundary>
  </StrictMode>,
)
