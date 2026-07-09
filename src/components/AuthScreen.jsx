import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { logTelemetry } from '../lib/telemetry';
import { stashTosAcceptance, buildTosRedirectUrl } from '../lib/legal';
import { REFERRAL_CODE_STORAGE_KEY, withReferralCode } from '../lib/referral';
import Icon from './Icon';
import OhnarWordmark from './OhnarWordmark';

// "Here's the actual app." screenshot strip — also drives the tap-to-expand
// gallery below. `screen` is the stable telemetry/caption key (matches the
// Get Paid loop: Today -> Quote -> Invoice -> Paid pipeline). `alt` doubles
// as the enlarged image's alt text and the dialog's aria-label caption.
const AUTH_SCREENSHOTS = [
  {
    screen: 'today',
    src: '/screens/ohnar-screen-today.png',
    alt: 'OHNAR Today dashboard showing money waiting to collect',
    width: 680,
    height: 1061,
  },
  {
    screen: 'quote',
    src: '/screens/ohnar-screen-quote.png',
    alt: 'A quote in OHNAR, ready to send to a customer',
    width: 680,
    height: 1085,
  },
  {
    screen: 'invoice',
    src: '/screens/ohnar-screen-invoice.png',
    alt: 'An invoice in OHNAR with a pay-now link for the customer',
    width: 680,
    height: 1085,
  },
  {
    screen: 'pipeline',
    src: '/screens/ohnar-screen-pipeline.png',
    alt: 'OHNAR jobs pipeline showing every job from quoted to paid',
    width: 680,
    height: 1168,
  },
];

/**
 * ScreenshotLightbox — full-screen, swipeable "see the whole loop" gallery
 * for the landing-page screenshot strip. Purely presentational: AuthScreen
 * owns all state/effects (open index, Esc/arrow keydown, focus trap, body
 * scroll lock, telemetry) and passes handlers down as props, same split as
 * JobDetailDrawer's PhotoLightbox/parent pattern.
 *
 * Reuses .photo-lightbox-backdrop / .photo-lightbox-img as-is (see index.css
 * "Photo lightbox" block) and adds landing-specific chrome — visible close
 * button, prev/next, counter — via the screenshot-lightbox-* classes, since
 * the in-app receipt lightbox this is modelled on has no visible close and
 * is single-image (not appropriate for a first-time public visitor).
 */
function ScreenshotLightbox({
  screenshots,
  index,
  onClose,
  onPrev,
  onNext,
  onBackdropClick,
  onStageTouchStart,
  onStageTouchEnd,
  closeBtnRef,
  dialogRef,
}) {
  const shot = screenshots[index];
  if (!shot) return null;
  return (
    <div
      className="photo-lightbox-backdrop screenshot-lightbox-backdrop"
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={`${shot.alt} — enlarged`}
      ref={dialogRef}
    >
      <button
        type="button"
        className="screenshot-lightbox-close"
        onClick={onClose}
        aria-label="Close preview"
        ref={closeBtnRef}
      >
        <Icon name="close" size={20} />
      </button>

      <button
        type="button"
        className="screenshot-lightbox-nav screenshot-lightbox-nav--prev"
        onClick={onPrev}
        aria-label="Previous screen"
      >
        <Icon name="chevron-left" size={24} />
      </button>

      <div
        className="screenshot-lightbox-stage"
        onTouchStart={onStageTouchStart}
        onTouchEnd={onStageTouchEnd}
      >
        <img
          key={shot.screen}
          src={shot.src}
          alt={shot.alt}
          className="photo-lightbox-img screenshot-lightbox-img"
        />
      </div>

      <button
        type="button"
        className="screenshot-lightbox-nav screenshot-lightbox-nav--next"
        onClick={onNext}
        aria-label="Next screen"
      >
        <Icon name="chevron-right" size={24} />
      </button>

      <p className="screenshot-lightbox-counter">
        {index + 1} of {screenshots.length}
      </p>
    </div>
  );
}

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
  const [hasReferralInvite, setHasReferralInvite] = useState(false);

  // Screenshot gallery — null = closed, else the open index into AUTH_SCREENSHOTS.
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const closeBtnRef = useRef(null);
  const dialogRef = useRef(null);
  const thumbRefs = useRef([]);
  // Tracks which thumbnail opened the gallery, so closing returns focus there
  // even after the visitor has flicked to a different screen.
  const openerIndexRef = useRef(null);
  const openedOnRef = useRef(null);
  const screensViewedRef = useRef(new Set());
  const touchStartRef = useRef(null);

  // Funnel step 1: auth wall viewed.
  // Also check for a returning OAuth error (e.g. user cancelled Google sign-in).
  useEffect(() => {
    logTelemetry('auth_screen_viewed');
    const oauthError = consumeOAuthError();
    if (oauthError) {
      setError(oauthError);
      logTelemetry('signin_google_callback_error', { raw: oauthError });
    }

    // Referral invite banner (JP-LU7 Phase 2, part D):
    // main.jsx captures ?ref=CODE into sessionStorage before any auth redirect
    // can strip the query param. It's only cleared by AppShell on a genuine
    // new sign-in, so it's still present here for anyone arriving via a
    // referral link who hasn't signed in yet. V1 deliberately does NOT look up
    // the referrer's name — no pre-signup PII endpoint, keep it simple.
    try {
      if (sessionStorage.getItem(REFERRAL_CODE_STORAGE_KEY)) {
        setHasReferralInvite(true);
        logTelemetry('referral_invite_banner_shown');
      }
    } catch {
      // sessionStorage unavailable (private browsing) — banner just doesn't show
    }
  }, []);

  // Open on the tapped thumbnail. Fires the funnel-entry telemetry event —
  // depth (screensViewed) is captured once, on close, not on every step.
  const openLightbox = useCallback((index) => {
    const shot = AUTH_SCREENSHOTS[index];
    openerIndexRef.current = index;
    openedOnRef.current = shot.screen;
    screensViewedRef.current = new Set([shot.screen]);
    logTelemetry('auth_screenshot_expanded', { screen: shot.screen, index: index + 1, source: 'landing' });
    setLightboxIndex(index);
  }, []);

  // delta: -1 (prev) or 1 (next), wraps across all 4 screens.
  const goToScreenshot = useCallback((delta) => {
    setLightboxIndex((current) => {
      if (current === null) return current;
      const wrapped = (current + delta + AUTH_SCREENSHOTS.length) % AUTH_SCREENSHOTS.length;
      screensViewedRef.current.add(AUTH_SCREENSHOTS[wrapped].screen);
      return wrapped;
    });
  }, []);

  const closeLightbox = useCallback(() => {
    logTelemetry('auth_screenshot_gallery_closed', {
      screensViewed: screensViewedRef.current.size,
      openedOn: openedOnRef.current,
    });
    setLightboxIndex(null);
    const openerIndex = openerIndexRef.current;
    if (openerIndex != null) {
      requestAnimationFrame(() => thumbRefs.current[openerIndex]?.focus());
    }
  }, []);

  // Only the true empty backdrop closes the gallery — tapping the image,
  // arrows, or close button must not (matches the LogoModal convention).
  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) closeLightbox();
  };

  // Horizontal swipe inside the overlay navigates prev/next. A short vertical
  // delta or a small drag is ignored so it doesn't fight a deliberate tap.
  const handleStageTouchStart = (e) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
  };
  const handleStageTouchEnd = (e) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    goToScreenshot(dx < 0 ? 1 : -1);
  };

  // Esc/arrow-key navigation, Tab focus trap, and body scroll lock — only
  // while a screen is open. Fully torn down on close/unmount so no listener
  // or overflow lock survives past the gallery being closed.
  //
  // Keyed on `isLightboxOpen` (a boolean), NOT the raw `lightboxIndex`:
  // Prev/Next navigation changes the index but not the open state, so the
  // keydown listener, the scroll lock, and the open-focus rAF must fire once
  // on open and once on close — never on every navigation step (re-running
  // the rAF each step stole focus back to the × button after each Prev/Next).
  // goToScreenshot reads the latest index via a functional setState, so this
  // effect never needs the index value itself.
  const isLightboxOpen = lightboxIndex !== null;
  useEffect(() => {
    if (!isLightboxOpen) return undefined;

    const frame = requestAnimationFrame(() => closeBtnRef.current?.focus());
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeLightbox();
        return;
      }
      if (e.key === 'ArrowLeft') {
        goToScreenshot(-1);
        return;
      }
      if (e.key === 'ArrowRight') {
        goToScreenshot(1);
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll('button');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) { e.preventDefault(); last.focus(); }
        } else if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isLightboxOpen, closeLightbox, goToScreenshot]);

  const signInWithGoogle = async () => {
    setGoogleLoading(true);
    setError('');
    logTelemetry('signin_google_clicked');
    // Clickwrap acceptance — see the "By continuing..." line rendered below
    // the sign-in controls. Stashed now, before the OAuth redirect fires
    // (not after the network call resolves — if this attempt fails and a
    // later click succeeds, the flushed timestamp reflects this click, not
    // the successful one; negligible, the visitor did view/click it here).
    stashTosAcceptance();
    try {
      // Carry any in-flight referral code THROUGH the OAuth round trip by
      // putting it back in the returning URL, rather than relying solely on
      // sessionStorage surviving the app -> Google -> Supabase -> app bounce
      // (see withReferralCode for why sessionStorage alone is fragile here).
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: withReferralCode(window.location.origin) },
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
    // Clickwrap acceptance — same line governs this path too (see Google click above).
    // Stashed locally AND embedded in the redirect URL (tos_v/tos_at query
    // params): the emailed link is often opened on a different device/browser
    // than the one that requested it, which would otherwise never see this
    // localStorage write. captureTosAcceptanceFromUrl() in main.jsx recovers
    // the URL copy on landing — see src/lib/legal.js for the full picture.
    const tosAcceptance = stashTosAcceptance();
    try {
      // Same referral-carrying treatment as Google — see signInWithGoogle.
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: buildTosRedirectUrl(tosAcceptance, withReferralCode(window.location.origin)),
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
    <div className="auth-page">
    <div className="auth-screen">
      {hasReferralInvite && (
        <div className="auth-referral-banner" role="status">
          <Icon name="gift" size={20} variant="brand" label="" />
          <p className="auth-referral-banner-text">
            You've been invited to OHNAR — sign up and you <strong>both get a free month of Pro</strong>.
          </p>
        </div>
      )}
      <div className="auth-brand">
        <h1 className="auth-title">
          <OhnarWordmark size="clamp(2rem, 10vw, 2.75rem)" />
        </h1>
        <p className="auth-eyebrow">Not another app to figure out.</p>
        <p className="auth-hero">Run your trade business from your phone.</p>
        <p className="auth-subhead">Get paid faster, without leaving the van.</p>

        <div className="auth-loop" aria-label="Quote, Signed, Invoiced, Paid">
          <span className="auth-loop-chip auth-loop-chip--1">Quote</span>
          <span className="auth-loop-sep" aria-hidden="true">›</span>
          <span className="auth-loop-chip auth-loop-chip--2">Signed</span>
          <span className="auth-loop-sep" aria-hidden="true">›</span>
          <span className="auth-loop-chip auth-loop-chip--3">Invoiced</span>
          <span className="auth-loop-sep" aria-hidden="true">›</span>
          <span className="auth-loop-chip auth-loop-chip--4">Paid</span>
        </div>

        <p className="auth-cta-line">
          Start free, <strong className="auth-cta-highlight">no card</strong> — unlimited quotes and invoices.
        </p>
        {/* Quiet reassurance line, not a badge farm — all three claims are true
            today (Stripe processes cards, Supabase encrypts at rest + in
            transit, OHNAR LTD is UK-registered — see the footer below for the
            company number). Deliberately no "bank-level"/certification claims. */}
        <p className="auth-trust-strip">
          <Icon name="lock" size={13} variant="muted" />
          Card payments secured by Stripe · Your data encrypted · UK-registered company
        </p>
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
              {sending ? 'Sending your link…' : 'Email me a sign-in link'}
            </button>
            {error && <p className="auth-error">{error}</p>}
            <p className="auth-hint">No password — we email a link, tap it, you're in.</p>
          </form>

          {/* Sits below both the Google button and the email form, so it
              governs whichever sign-in path the visitor takes. */}
          <p className="auth-clickwrap">
            By continuing, you agree to our{' '}
            <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and
            acknowledge our{' '}
            <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>.
          </p>
        </>
      ) : (
        <div className="auth-sent">
          <div className="auth-sent-icon"><Icon name="email" size={32} variant="brand" label="Email sent" /></div>
          <h2>Check your email</h2>
          <p>We've sent your sign-in link to <strong>{email}</strong>.</p>
          <p className="auth-hint">Tap the link on this phone and you're in. No password to remember.</p>
          <button className="auth-link-btn" onClick={() => { setSent(false); setEmail(''); }}>
            Use a different email
          </button>
        </div>
      )}

      <p className="auth-diff">No lead fees, no commission — nobody clipping your ticket.</p>

      <div className="auth-screenshots">
        <p className="auth-screenshots-eyebrow">Here's the actual app.</p>
        <p className="auth-screenshots-hint">Tap any screen for a proper look.</p>
        <div className="auth-screenshots-track">
          {AUTH_SCREENSHOTS.map((shot, i) => (
            <button
              type="button"
              key={shot.screen}
              className="auth-screenshot-btn"
              ref={(el) => { thumbRefs.current[i] = el; }}
              onClick={() => openLightbox(i)}
              aria-label={`Take a closer look — ${shot.alt}`}
            >
              <img
                className="auth-screenshot"
                src={shot.src}
                alt=""
                loading="lazy"
                width={shot.width}
                height={shot.height}
              />
              <span className="auth-screenshot-badge" aria-hidden="true">
                <Icon name="expand" size={14} />
              </span>
            </button>
          ))}
        </div>
      </div>

      {lightboxIndex !== null && (
        <ScreenshotLightbox
          screenshots={AUTH_SCREENSHOTS}
          index={lightboxIndex}
          onClose={closeLightbox}
          onPrev={() => goToScreenshot(-1)}
          onNext={() => goToScreenshot(1)}
          onBackdropClick={handleBackdropClick}
          onStageTouchStart={handleStageTouchStart}
          onStageTouchEnd={handleStageTouchEnd}
          closeBtnRef={closeBtnRef}
          dialogRef={dialogRef}
        />
      )}

      <p className="auth-cta-subline">
        £12/mo flat for Pro when you're ready. Cancel anytime.
        {/* TODO(LGL): append the competitor price-comparison clause once the figure is source-verified + dated — comparative ad claim, do not ship unverified */}
      </p>
      <p className="auth-profit-strip">
        And when the job's done, see what you actually made — after materials, fuel and tax.
      </p>

      <p className="auth-trust">Built with feedback from UK plumbers, builders, electricians, gardeners, cleaners &amp; sole traders.</p>

      {/* Company registration details — required for a UK limited company
          trading online (Companies Act 2006 s.82 / E-Commerce Regs 2002).
          Contact mailbox is getohnar@gmail.com for now — swap to
          hello@ohnar.co.uk once that mailbox is stood up. */}
      <footer className="auth-legal-footer">
        <p className="auth-legal-footer-entity">
          OHNAR LTD · Company No. 17249792 (England &amp; Wales) · 128 City Road, London EC1V 2NX · ICO reg ZC163042
        </p>
        <p className="auth-legal-footer-links">
          <a href="/privacy" target="_blank" rel="noopener">Privacy</a>
          {' · '}
          <a href="/terms" target="_blank" rel="noopener">Terms</a>
          {' · '}
          <a href="/cookies" target="_blank" rel="noopener">Cookies</a>
          {' · '}
          <a href="mailto:getohnar@gmail.com">Contact</a>
        </p>
      </footer>
    </div>
    </div>
  );
}
