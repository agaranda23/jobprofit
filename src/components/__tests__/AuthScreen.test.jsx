// @vitest-environment jsdom
/**
 * AuthScreen — value-first sign-in screen
 *
 * Covers: pitch copy (hero, loop chips, proof beats, trust line), reworded CTA,
 * existing submit handler behaviour, and telemetry events.
 * Auth logic (supabase.auth.signInWithOtp) and telemetry calls are mocked —
 * we verify the wires are connected without making real network calls.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
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
  it('renders the hero line', () => {
    renderAuth();
    expect(screen.getByText('Quote it, send it, get paid. From the van.')).toBeTruthy();
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

  it('renders the first proof beat', () => {
    renderAuth();
    const items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toContain('Speak the job');
    expect(items[0].textContent).toContain('52 seconds');
  });

  it('renders the second proof beat', () => {
    renderAuth();
    const items = screen.getAllByRole('listitem');
    expect(items[1].textContent).toContain('Get it signed, invoiced, and unpaid ones chased');
  });

  it('renders the third proof beat', () => {
    renderAuth();
    const items = screen.getAllByRole('listitem');
    expect(items[2].textContent).toContain('See the real profit on every job');
  });

  it('renders exactly three proof-beat list items', () => {
    renderAuth();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });

  it('renders the price/trust line', () => {
    const { container } = renderAuth();
    const trust = container.querySelector('.auth-trust');
    expect(trust).toBeTruthy();
    expect(trust?.textContent).toContain('£12/mo flat');
    expect(trust?.textContent).toContain('Tradify charges £34');
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
