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
    expect(subhead?.textContent).toContain('Quote jobs, send invoices, track payments');
    expect(subhead?.textContent).toContain('know your real profit');
    expect(subhead?.textContent).toContain('in minutes, not hours');
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

  it('renders the plain feature strip', () => {
    const { container } = renderAuth();
    const features = container.querySelector('.auth-features');
    expect(features).toBeTruthy();
    expect(features?.textContent).toBe(
      'Quote in seconds · Get paid faster · Know your real profit'
    );
  });

  it('renders the profit/independence strip under the feature strip', () => {
    const { container } = renderAuth();
    const strip = container.querySelector('.auth-profit-strip');
    expect(strip).toBeTruthy();
    expect(strip?.textContent).toContain('after materials, fuel and tax');
    expect(strip?.textContent).toContain('No lead fees, no commission, nobody clipping your ticket');
  });

  it('renders the primary CTA line with "no card needed" as a distinct risk-remover', () => {
    const { container } = renderAuth();
    const ctaLine = container.querySelector('.auth-cta-line');
    expect(ctaLine).toBeTruthy();
    expect(ctaLine?.textContent).toContain('Start free');
    expect(ctaLine?.textContent).toContain('no card needed');

    // "no card needed" gets its own visually-prominent element — that's the
    // click driver, not the framing text around it.
    const highlight = container.querySelector('.auth-cta-highlight');
    expect(highlight).toBeTruthy();
    expect(highlight?.textContent).toBe('no card needed');
  });

  it('renders the "what\'s free" line directly under the CTA', () => {
    const { container } = renderAuth();
    const freeLine = container.querySelector('.auth-cta-free-line');
    expect(freeLine).toBeTruthy();
    expect(freeLine?.textContent).toBe('Unlimited quotes · Unlimited invoices · Free to try');
  });

  it('renders the CTA sub-line as a secondary, non-forced Pro pricing cue', () => {
    const { container } = renderAuth();
    const subline = container.querySelector('.auth-cta-subline');
    expect(subline).toBeTruthy();
    expect(subline?.textContent).toContain('£12/month for Pro when you\'re ready');
    expect(subline?.textContent).toContain('Cancel anytime');
    // Must not read as a forced-conversion trial — free tier is genuinely free, not time-limited.
    expect(subline?.textContent).not.toMatch(/after your free trial|trial ends/i);
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

// ── CTA and form ──────────────────────────────────────────────────────────────

describe('AuthScreen — CTA and form', () => {
  it('CTA button reads "Start free — email me a sign-in link" when idle', () => {
    renderAuth();
    expect(
      screen.getByRole('button', { name: /Start free — email me a sign-in link/i })
    ).toBeTruthy();
  });

  it('CTA button is disabled when email is empty', () => {
    renderAuth();
    const btn = screen.getByRole('button', { name: /Start free/i });
    expect(btn.disabled).toBe(true);
  });

  it('CTA button is enabled after typing a valid email', () => {
    renderAuth();
    const input = screen.getByPlaceholderText('you@example.com');
    fireEvent.change(input, { target: { value: 'alan@example.com' } });
    const btn = screen.getByRole('button', { name: /Start free/i });
    expect(btn.disabled).toBe(false);
  });

  it('renders the no-passwords hint', () => {
    renderAuth();
    expect(
      screen.getByText(/No passwords\. We email you a link, you tap it, you're in\./)
    ).toBeTruthy();
  });

  it('shows "Sending your link…" while the OTP request is in flight', async () => {
    mockSignInWithOtp.mockReturnValue(new Promise(() => {}));
    renderAuth();
    const input = screen.getByPlaceholderText('you@example.com');
    fireEvent.change(input, { target: { value: 'alan@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Start free/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Sending your link…/i })).toBeTruthy()
    );
  });

  it('calls supabase.auth.signInWithOtp with the entered email on submit', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null });
    renderAuth();
    const input = screen.getByPlaceholderText('you@example.com');
    fireEvent.change(input, { target: { value: 'trade@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Start free/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /Start free/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /Start free/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /Start free/i }));
    await waitFor(() =>
      expect(screen.getByText(/rate limited/i)).toBeTruthy()
    );
    expect(logTelemetry).not.toHaveBeenCalledWith('signin_link_requested');
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
    fireEvent.click(screen.getByRole('button', { name: /Start free/i }));
    await waitFor(() => screen.getByText('Check your email'));
    expect(screen.getByText('Check your email')).toBeTruthy();
  });
});
