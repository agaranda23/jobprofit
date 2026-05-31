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

const publicToken = parsePublicQuoteRoute();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {publicToken ? (
      // Public quote view — no auth gate, no AppShell, code-split
      <Suspense fallback={<div className="auth-loading"><div className="ocr-spinner" /></div>}>
        <PublicQuoteView token={publicToken} />
      </Suspense>
    ) : (
      <AppShell />
    )}
  </StrictMode>,
)
