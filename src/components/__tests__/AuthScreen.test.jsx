// @vitest-environment jsdom
/**
 * AuthScreen — clarity-led sign-in screen (Option A hero)
 *
 * Covers: pitch copy (hero, loop chips, feature strip, profit/independence
 * strip, CTA lines, trust line), existing submit handler behaviour, telemetry
 * events, and Google OAuth callback error handling (FIX 1 — stress-test-batch-1).
 * Auth logic (supabase.auth.signInWithOtp) and telemetry calls are mocked —
 * we verify the wires are connected without making real network calls.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../lib/telemetry', () => ({
  logTelemetry: vi.fn(),
}));

const mockSignInWithOtp = vi.fn();
const mockSignInWithOAuth = vi.fn();
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args) => mockSignInWithOtp(...args),
      signInWithOAuth: (...args) => mockSignInWithOAuth(...args),
    },
  },
}));

import { logTelemetry } from '../../lib/telemetry';
import AuthScreen from '../AuthScreen';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderAuth() {
  return render(<AuthScreen />);
}

// Clean up the DOM after every test so multiple renders don't accumulate.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Pitch copy ────────────────────────────────────────────────────────────────

describe('AuthScreen — pitch copy', () => {
  it('renders the eyebrow line', () => {
    renderAuth();
    expect(screen.getByText('Not another app to figure out.')).toBeTruthy();
  });

  it('renders the hero line', () => {
    renderAuth();
    expect(screen.getByText('Run your trade business from your phone.')).toBeTruthy();
  });

  it('renders the subhead line', () => {
    const { container } = renderAuth();
    const subhead = container.querySelector('.auth-subhead');
    expect(subhead).toBeTruthy();
    expect(subhead?.textContent).toBe('Get paid faster, without leaving the van.');
  });

  it('renders all four loop chips via class selectors', () => {
    const { container } = renderAuth();
    expect(container.querySelector('.auth-loop-chip--1')?.textContent).toBe('Quote');
    expect(container.querySelector('.auth-loop-chip--2')?.textContent).toBe('Signed');
    expect(container.querySelector('.auth-loop-chip--3')?.textContent).toBe('Invoiced');
    expect(container.querySelector('.auth-loop-chip--4')?.textContent).toBe('Paid');
  });

  it('loop strip has accessible aria-label containing all four stage names', () => {
    const { container } = renderAuth();
    const loop = container.querySelector('.auth-loop');
    expect(loop?.getAttribute('aria-label')).toContain('Quote');
    expect(loop?.getAttribute('aria-label')).toContain('Paid');
  });

  it('chevron separators are aria-hidden', () => {
    const { container } = renderAuth();
    const seps = container.querySelectorAll('.auth-loop-sep');
    expect(seps.length).toBe(3);
    seps.forEach((sep) => expect(sep.getAttribute('aria-hidden')).toBe('true'));
  });

  it('renders the merged free/price CTA line', () => {
    const { container } = renderAuth();
    const ctaLine = container.querySelector('.auth-cta-line');
    expect(ctaLine).toBeTruthy();
    expect(ctaLine?.textContent).toBe('Start free, no card — unlimited quotes and invoices.');
  });

  it('renders the differentiator line (no lead fees / no commission)', () => {
    const { container } = renderAuth();
    const diff = container.querySelector('.auth-diff');
    expect(diff).toBeTruthy();
    expect(diff?.textContent).toBe('No lead fees, no commission — nobody clipping your ticket.');
  });

  it('renders the profit strip as a pure profit-visibility claim', () => {
    const { container } = renderAuth();
    const strip = container.querySelector('.auth-profit-strip');
    expect(strip).toBeTruthy();
    expect(strip?.textContent).toContain('see what you actually made');
    expect(strip?.textContent).toContain('after materials, fuel and tax');
  });

  it('renders the primary CTA line with "no card" as a distinct risk-remover', () => {
    const { container } = renderAuth();
    const ctaLine = container.querySelector('.auth-cta-line');
    expect(ctaLine).toBeTruthy();
    expect(ctaLine?.textContent).toContain('Start free');
    expect(ctaLine?.textContent).toContain('no card');

    // "no card" gets its own visually-prominent element — that's the
    // click driver, not the framing text around it.
    const highlight = container.querySelector('.auth-cta-highlight');
    expect(highlight).toBeTruthy();
    expect(highlight?.textContent).toBe('no card');
  });

  it('renders the CTA sub-line as a secondary, non-forced Pro pricing cue', () => {
    const { container } = renderAuth();
    const subline = container.querySelector('.auth-cta-subline');
    expect(subline).toBeTruthy();
    expect(subline?.textContent).toContain('£12/mo flat for Pro when you\'re ready');
    expect(subline?.textContent).toContain('Cancel anytime');
    // Must not read as a forced-conversion trial — free tier is genuinely free, not time-limited.
    expect(subline?.textContent).not.toMatch(/after your free trial|trial ends/i);
    // Comparative competitor pricing claim is deferred pending legal sign-off.
    expect(subline?.textContent).not.toMatch(/Tradify|£34/i);
  });

  it('renders the trust line naming plumbers first, without naming any competitor', () => {
    const { container } = renderAuth();
    const trust = container.querySelector('.auth-trust');
    expect(trust).toBeTruthy();
    expect(trust?.textContent).toContain('Built with feedback from UK plumbers, builders');
    expect(trust?.textContent).not.toMatch(/Tradify|ServiceM8|Powered Now/i);
  });

  it('does not name a competitor anywhere in the hero pitch', () => {
    const { container } = renderAuth();
    const brand = container.querySelector('.auth-brand');
    expect(brand?.textContent).not.toMatch(/Tradify|ServiceM8|Powered Now/i);
  });
});

// ── Screenshot strip ("show, don't tell") ────────────────────────────────────
// Real product screenshots. Post conversion-optimisation reorder, the strip
// sits BELOW the sign-up block (Zone 2) — the tappable sign-up action now
// lands on the first phone screen, with proof-of-product right after it.

describe('AuthScreen — screenshot strip', () => {
  it('renders exactly 4 screenshots', () => {
    const { container } = renderAuth();
    const shots = container.querySelectorAll('.auth-screenshot');
    expect(shots.length).toBe(4);
  });

  it('renders the 4 screenshots in Today → Quote → Invoice → Pipeline order, each in a tappable button with a meaningful accessible name', () => {
    const { container } = renderAuth();
    const shots = Array.from(container.querySelectorAll('.auth-screenshot'));
    expect(shots.map((img) => img.getAttribute('src'))).toEqual([
      '/screens/ohnar-screen-today.png',
      '/screens/ohnar-screen-quote.png',
      '/screens/ohnar-screen-invoice.png',
      '/screens/ohnar-screen-pipeline.png',
    ]);
    // Each screenshot is now wrapped in a <button> that opens the enlarge
    // gallery. The meaningful description lives on the button's aria-label
    // (the inner <img> is alt="" so a screen reader announces the control's
    // name once, not twice). Assert the accessible name — in order — on the
    // buttons, which is where it now lives.
    const buttons = Array.from(container.querySelectorAll('.auth-screenshot-btn'));
    expect(buttons.length).toBe(4);
    buttons.forEach((btn) => {
      const label = btn.getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(10);
    });
    expect(buttons[0].getAttribute('aria-label')).toMatch(/today/i);
    expect(buttons[1].getAttribute('aria-label')).toMatch(/quote/i);
    expect(buttons[2].getAttribute('aria-label')).toMatch(/invoice/i);
    expect(buttons[3].getAttribute('aria-label')).toMatch(/pipeline|jobs/i);
  });

  it('lazy-loads every screenshot (it sits below the immediate fold)', () => {
    const { container } = renderAuth();
    const shots = container.querySelectorAll('.auth-screenshot');
    shots.forEach((img) => expect(img.getAttribute('loading')).toBe('lazy'));
  });

  it('places the strip after the sign-up block (Zone 2), not before it', () => {
    const { container } = renderAuth();
    const brand = container.querySelector('.auth-brand');
    const googleBtn = container.querySelector('.auth-google-btn');
    const strip = container.querySelector('.auth-screenshots');
    expect(brand && googleBtn && strip).toBeTruthy();
    expect(brand.compareDocumentPosition(googleBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(googleBtn.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the "here\'s the actual app" eyebrow above the track', () => {
    const { container } = renderAuth();
    const eyebrow = container.querySelector('.auth-screenshots-eyebrow');
    expect(eyebrow).toBeTruthy();
    expect(eyebrow?.textContent).toBe("Here's the actual app.");
  });

  it('does not remove or hide the Google sign-in and email sign-in — both still render', () => {
    renderAuth();
    expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeTruthy();
    expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Email me a sign-in link/i })
    ).toBeTruthy();
  });
});

// ── CTA and form ──────────────────────────────────────────────────────────────

describe('AuthScreen — CTA and form', () => {
  it('submit button reads "Email me a sign-in link" when idle', () => {
    renderAuth();
    expect(
      screen.getByRole('button', { name: /Email me a sign-in link/i })
    ).toBeTruthy();
  });

  it('submit button is disabled when email is empty', () => {
    renderAuth();
    const btn = screen.getByRole('button', { name: /Email me a sign-in link/i });
    expect(btn.disabled).toBe(true);
  });

  it('submit button is enabled after typing a valid email', () => {
    renderAuth();
    const input = screen.getByPlaceholderText('you@example.com');
    fireEvent.change(input, { target: { value: 'alan@example.com' } });
    const btn = screen.getByRole('button', { name: /Email me a sign-in link/i });
    expect(btn.disabled).toBe(false);
  });

  it('renders the no-password hint', () => {
    renderAuth();
    expect(
      screen.getByText(/No password — we email a link, tap it, you're in\./)
    ).toBeTruthy();
  });

  it('shows "Sending your link…" while the OTP request is in flight', async () => {
    mockSignInWithOtp.mockReturnValue(new Promise(() => {}));
    renderAuth();
    const input = screen.getByPlaceholderText('you@example.com');
    fireEvent.change(input, { target: { value: 'alan@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Sending your link…/i })).toBeTruthy()
    );
  });

  it('calls supabase.auth.signInWithOtp with the entered email on submit', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    renderAuth();
    const input = screen.getByPlaceholderText('you@example.com');
    fireEvent.change(input, { target: { value: 'trade@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }));
    await waitFor(() => expect(mockSignInWithOtp).toHaveBeenCalledOnce());
    expect(mockSignInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'trade@example.com' })
    );
  });
});

// ── Sent state ────────────────────────────────────────────────────────────────

describe('AuthScreen — sent state', () => {
  async function submitAndWaitForSent() {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    renderAuth();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'trade@van.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }));
    await waitFor(() => screen.getByText('Check your email'));
  }

  it('shows "Check your email" heading after successful send', async () => {
    await submitAndWaitForSent();
    expect(screen.getByText('Check your email')).toBeTruthy();
  });

  it('shows the submitted email address in the sent body', async () => {
    await submitAndWaitForSent();
    expect(screen.getByText(/trade@van\.com/)).toBeTruthy();
  });

  it('shows the no-password hint in the sent state', async () => {
    await submitAndWaitForSent();
    expect(
      screen.getByText(/Tap the link on this phone and you're in\. No password to remember\./)
    ).toBeTruthy();
  });

  it('renders "Use a different email" button in the sent state', async () => {
    await submitAndWaitForSent();
    expect(screen.getByRole('button', { name: /Use a different email/i })).toBeTruthy();
  });

  it('"Use a different email" resets back to the form', async () => {
    await submitAndWaitForSent();
    fireEvent.click(screen.getByRole('button', { name: /Use a different email/i }));
    expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy();
  });
});

// ── Telemetry ─────────────────────────────────────────────────────────────────

describe('AuthScreen — telemetry', () => {
  it('fires auth_screen_viewed on mount', () => {
    renderAuth();
    expect(logTelemetry).toHaveBeenCalledWith('auth_screen_viewed');
  });

  it('fires signin_link_requested after a successful OTP send', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    renderAuth();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'trade@van.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }));
    await waitFor(() =>
      expect(logTelemetry).toHaveBeenCalledWith('signin_link_requested')
    );
  });

  it('does NOT fire signin_link_requested when supabase returns an error', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: { message: 'rate limited' } });
    renderAuth();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'trade@van.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }));
    await waitFor(() =>
      expect(screen.getByText(/rate limited/i)).toBeTruthy()
    );
    expect(logTelemetry).not.toHaveBeenCalledWith('signin_link_requested');
  });
});

// ── Referral invite banner (JP-LU7 Phase 2, part D) ──────────────────────────
// main.jsx captures ?ref=CODE into sessionStorage('jp.referralCode') before any
// auth redirect can strip it. AuthScreen shows a friendly invite banner while
// that key is still present (i.e. before the visitor has signed in).

describe('AuthScreen — referral invite banner', () => {
  afterEach(() => {
    try { sessionStorage.clear(); } catch { /* jsdom */ }
    cleanup();
    vi.clearAllMocks();
  });

  it('does not render the banner when no referral code is in sessionStorage', () => {
    try { sessionStorage.removeItem('jp.referralCode'); } catch { /* jsdom */ }
    const { container } = renderAuth();
    expect(container.querySelector('.auth-referral-banner')).toBeNull();
  });

  it('renders the invite banner when jp.referralCode is present', () => {
    sessionStorage.setItem('jp.referralCode', 'ABC123');
    const { container } = renderAuth();
    const banner = container.querySelector('.auth-referral-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("You've been invited to OHNAR");
    expect(banner.textContent).toContain('both get a free month of Pro');
  });

  it('does not look up or display a referrer name (V1 — no pre-signup PII endpoint)', () => {
    sessionStorage.setItem('jp.referralCode', 'ABC123');
    const { container } = renderAuth();
    const banner = container.querySelector('.auth-referral-banner');
    // The raw code itself must never leak into the visible copy.
    expect(banner.textContent).not.toContain('ABC123');
  });

  it('renders the banner before .auth-brand in the DOM', () => {
    sessionStorage.setItem('jp.referralCode', 'ABC123');
    const { container } = renderAuth();
    const banner = container.querySelector('.auth-referral-banner');
    const brand = container.querySelector('.auth-brand');
    expect(banner && brand).toBeTruthy();
    expect(banner.compareDocumentPosition(brand) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('fires referral_invite_banner_shown telemetry when the banner is shown', () => {
    sessionStorage.setItem('jp.referralCode', 'ABC123');
    renderAuth();
    expect(logTelemetry).toHaveBeenCalledWith('referral_invite_banner_shown');
  });

  it('does NOT fire referral_invite_banner_shown when there is no referral code', () => {
    try { sessionStorage.removeItem('jp.referralCode'); } catch { /* jsdom */ }
    renderAuth();
    expect(logTelemetry).not.toHaveBeenCalledWith('referral_invite_banner_shown');
  });
});

// ── Google sign-in ────────────────────────────────────────────────────────────

describe('AuthScreen — Google sign-in', () => {
  it('renders the "Continue with Google" button', () => {
    renderAuth();
    expect(
      screen.getByRole('button', { name: /Continue with Google/i })
    ).toBeTruthy();
  });

  it('"Continue with Google" button is enabled on initial render', () => {
    renderAuth();
    const btn = screen.getByRole('button', { name: /Continue with Google/i });
    expect(btn.disabled).toBe(false);
  });

  it('calls supabase.auth.signInWithOAuth with provider "google" when clicked', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null });
    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledOnce());
    expect(mockSignInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google' })
    );
  });

  it('fires signin_google_clicked telemetry when the button is pressed', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null });
    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));
    await waitFor(() =>
      expect(logTelemetry).toHaveBeenCalledWith('signin_google_clicked')
    );
  });

  it('shows an error message when signInWithOAuth returns an error', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: { message: 'OAuth provider not enabled' } });
    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));
    await waitFor(() =>
      expect(screen.getByText(/OAuth provider not enabled/i)).toBeTruthy()
    );
  });

  it('Google button is above the email input in the DOM', () => {
    const { container } = renderAuth();
    const googleBtn = container.querySelector('.auth-google-btn');
    const emailInput = container.querySelector('input[type="email"]');
    expect(googleBtn).toBeTruthy();
    expect(emailInput).toBeTruthy();
    // compareDocumentPosition: 4 means emailInput follows googleBtn
    expect(googleBtn.compareDocumentPosition(emailInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

// ── Google OAuth callback error handling (FIX 1 — stress-test-batch-1) ───────
// When Google returns an error (e.g. user cancels the consent screen) Supabase
// appends ?error=access_denied&error_description=... to the redirect URL.
// AuthScreen must detect this on mount, surface a friendly message, and clean
// the URL so a refresh doesn't re-show the error.

describe('AuthScreen — OAuth callback error handling', () => {
  // Save and restore window.location for each test
  let originalLocation;
  beforeEach(() => {
    originalLocation = window.location.href;
  });
  afterEach(() => {
    // Reset URL to clean state so tests don't bleed into each other
    window.history.replaceState(null, '', originalLocation);
    cleanup();
    vi.clearAllMocks();
  });

  it('shows a friendly message when hash contains error=access_denied', () => {
    window.history.replaceState(null, '', '/#error=access_denied&error_description=User+cancelled');
    renderAuth();
    expect(
      screen.getByText(/Google sign-in was cancelled or didn't complete/i)
    ).toBeTruthy();
  });

  it('shows a friendly message when query string contains error=access_denied', () => {
    window.history.replaceState(null, '', '/?error=access_denied&error_description=User+cancelled');
    renderAuth();
    expect(
      screen.getByText(/Google sign-in was cancelled or didn't complete/i)
    ).toBeTruthy();
  });

  it('shows the error_description for non-access_denied errors', () => {
    window.history.replaceState(null, '', '/?error=server_error&error_description=Internal+Server+Error');
    renderAuth();
    expect(screen.getByText(/Sign-in error: Internal Server Error/i)).toBeTruthy();
  });

  it('shows a generic fallback when error is set but description is absent', () => {
    window.history.replaceState(null, '', '/?error=unknown_error');
    renderAuth();
    expect(
      screen.getByText(/Google sign-in failed — try again, or use email below/i)
    ).toBeTruthy();
  });

  it('cleans the error params from the URL after rendering', () => {
    window.history.replaceState(null, '', '/?error=access_denied&error_description=User+cancelled');
    renderAuth();
    expect(window.location.search).not.toContain('error=');
  });

  it('does NOT show an error message when the URL has no error params', () => {
    window.history.replaceState(null, '', '/');
    renderAuth();
    // The auth-error element should not be present
    const errorEl = document.querySelector('.auth-error');
    expect(errorEl).toBeNull();
  });

  it('fires signin_google_callback_error telemetry when an OAuth error is detected', () => {
    window.history.replaceState(null, '', '/?error=access_denied');
    renderAuth();
    expect(logTelemetry).toHaveBeenCalledWith(
      'signin_google_callback_error',
      expect.objectContaining({ raw: expect.any(String) })
    );
  });

  it('a normal sign-in flow is unaffected when URL has no error params', async () => {
    window.history.replaceState(null, '', '/');
    mockSignInWithOtp.mockResolvedValue({ error: null });
    renderAuth();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'trade@van.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }));
    await waitFor(() => screen.getByText('Check your email'));
    expect(screen.getByText('Check your email')).toBeTruthy();
  });
});

// ── ToS clickwrap acceptance travels on the magic-link URL ───────────────────
// The consent-capture trail must survive the link being opened on a DIFFERENT
// device/browser than the one that requested it (Mail app in-app browser vs
// an installed home-screen PWA, most commonly). stashTosAcceptance() alone
// can't do that — it only writes to localStorage on the requesting device —
// so send() must also embed tos_v/tos_at on emailRedirectTo. See
// captureTosAcceptanceFromUrl() in lib/legal.js for the landing-side half.

describe('AuthScreen — ToS acceptance on the magic-link redirect URL', () => {
  afterEach(() => {
    localStorage.removeItem('jp.tosAcceptance');
    cleanup();
    vi.clearAllMocks();
  });

  it('embeds tos_v and tos_at query params on emailRedirectTo', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    renderAuth();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'trade@van.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }));
    await waitFor(() => expect(mockSignInWithOtp).toHaveBeenCalledOnce());

    const [{ options }] = mockSignInWithOtp.mock.calls[0];
    const redirectUrl = new URL(options.emailRedirectTo);
    expect(redirectUrl.searchParams.get('tos_v')).toBeTruthy();
    expect(redirectUrl.searchParams.get('tos_at')).toBeTruthy();
    // acceptedAt must be a real, parseable timestamp
    expect(Number.isNaN(Date.parse(redirectUrl.searchParams.get('tos_at')))).toBe(false);
  });

  it('also stashes the same acceptance to localStorage for the same-device fast path', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    renderAuth();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'trade@van.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }));
    await waitFor(() => expect(mockSignInWithOtp).toHaveBeenCalledOnce());

    const stashed = JSON.parse(localStorage.getItem('jp.tosAcceptance'));
    const [{ options }] = mockSignInWithOtp.mock.calls[0];
    const redirectUrl = new URL(options.emailRedirectTo);
    expect(stashed.version).toBe(redirectUrl.searchParams.get('tos_v'));
    expect(stashed.acceptedAt).toBe(redirectUrl.searchParams.get('tos_at'));
  });
});

// ── Referral code survives the auth redirect (fix/referral-attribution-oauth) ─
// Bug: a referred Google signup left profiles.referred_by null and created no
// referrals row — the code was silently lost somewhere in the app -> Google ->
// Supabase -> app round trip. Relying on sessionStorage alone to survive that
// bounce is fragile (see withReferralCode in lib/referral.js), so both
// signInWithGoogle and the magic-link send() now put the code back INTO the
// returning URL via redirectTo/emailRedirectTo. main.jsx's captureReferralCode
// re-reads `?ref=` on the way back in, regardless of which origin/tab the
// flow lands on.

describe('AuthScreen — referral code carried through the auth redirect', () => {
  afterEach(() => {
    try { sessionStorage.clear(); } catch { /* jsdom */ }
    cleanup();
    vi.clearAllMocks();
  });

  it('includes ?ref=<code> in redirectTo when signing in with Google and a referral code is pending', async () => {
    sessionStorage.setItem('jp.referralCode', 'ruvWbv');
    mockSignInWithOAuth.mockResolvedValue({ error: null });
    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledOnce());
    const { redirectTo } = mockSignInWithOAuth.mock.calls[0][0].options;
    expect(redirectTo).toContain('ref=ruvWbv');
  });

  it('redirectTo has no ref param for Google sign-in when there is no pending referral code', async () => {
    mockSignInWithOAuth.mockResolvedValue({ error: null });
    renderAuth();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));
    await waitFor(() => expect(mockSignInWithOAuth).toHaveBeenCalledOnce());
    const { redirectTo } = mockSignInWithOAuth.mock.calls[0][0].options;
    expect(redirectTo).not.toContain('ref=');
  });

  it('includes ?ref=<code> in emailRedirectTo when requesting a magic link and a referral code is pending', async () => {
    sessionStorage.setItem('jp.referralCode', 'ruvWbv');
    mockSignInWithOtp.mockResolvedValue({ error: null });
    renderAuth();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'trade@van.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }));
    await waitFor(() => expect(mockSignInWithOtp).toHaveBeenCalledOnce());
    const { emailRedirectTo } = mockSignInWithOtp.mock.calls[0][0].options;
    expect(emailRedirectTo).toContain('ref=ruvWbv');
  });

  it('emailRedirectTo has no ref param for the magic link when there is no pending referral code', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    renderAuth();
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'trade@van.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Email me a sign-in link/i }));
    await waitFor(() => expect(mockSignInWithOtp).toHaveBeenCalledOnce());
    const { emailRedirectTo } = mockSignInWithOtp.mock.calls[0][0].options;
    expect(emailRedirectTo).not.toContain('ref=');
  });
});

// ── Trust signals: company footer + reassurance strip ────────────────────────
// The logged-out front door had no trust anchors despite the back office being
// a genuine UK-registered company. These cover the persistent footer (company
// number, ICO registration, legal links, contact) and the quiet reassurance
// line near the primary sign-up CTA.

describe('AuthScreen — company footer', () => {
  it('renders the company number and ICO registration in the footer', () => {
    const { container } = renderAuth();
    const entity = container.querySelector('.auth-legal-footer-entity');
    expect(entity).toBeTruthy();
    expect(entity.textContent).toContain('Company No. 17249792');
    expect(entity.textContent).toContain('ICO reg ZC163042');
  });

  it('renders Privacy, Terms and Cookies links pointing at the static legal pages', () => {
    const { container } = renderAuth();
    const links = container.querySelector('.auth-legal-footer-links');
    expect(links).toBeTruthy();
    expect(links.querySelector('a[href="/privacy"]')).toBeTruthy();
    expect(links.querySelector('a[href="/terms"]')).toBeTruthy();
    expect(links.querySelector('a[href="/cookies"]')).toBeTruthy();
  });

  it('renders a Contact link mailing the current getohnar@gmail.com inbox (not the retired getjobprofit address)', () => {
    const { container } = renderAuth();
    const links = container.querySelector('.auth-legal-footer-links');
    const contact = links.querySelector('a[href^="mailto:"]');
    expect(contact).toBeTruthy();
    expect(contact.getAttribute('href')).toBe('mailto:getohnar@gmail.com');
    expect(contact.textContent).toBe('Contact');
  });

  it('places the footer at the end of the page, after the screenshot strip', () => {
    const { container } = renderAuth();
    const strip = container.querySelector('.auth-screenshots');
    const footer = container.querySelector('.auth-legal-footer');
    expect(strip && footer).toBeTruthy();
    expect(strip.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('AuthScreen — trust strip', () => {
  it('renders the Stripe / encryption / UK-registration reassurance line', () => {
    const { container } = renderAuth();
    const strip = container.querySelector('.auth-trust-strip');
    expect(strip).toBeTruthy();
    expect(strip.textContent).toContain('Card payments secured by Stripe');
    expect(strip.textContent).toContain('Your data encrypted');
    expect(strip.textContent).toContain('UK-registered company');
  });

  it('does not overclaim with unverifiable trust badges', () => {
    const { container } = renderAuth();
    const strip = container.querySelector('.auth-trust-strip');
    expect(strip.textContent).not.toMatch(/bank-level|certified|ISO ?27001/i);
  });

  it('sits directly under the primary CTA line, above the sign-in buttons', () => {
    const { container } = renderAuth();
    const ctaLine = container.querySelector('.auth-cta-line');
    const strip = container.querySelector('.auth-trust-strip');
    const googleBtn = container.querySelector('.auth-google-btn');
    expect(ctaLine && strip && googleBtn).toBeTruthy();
    expect(ctaLine.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(googleBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
