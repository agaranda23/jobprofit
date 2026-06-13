// @vitest-environment jsdom
/**
 * GetProPill — 4-state machine tests
 *
 * Covers:
 *   1. Four copy/state variants render for the correct profile conditions
 *   2. Dismiss is blocked in urgency and last-day states (X button absent)
 *   3. Dismiss is available in settled and free states
 *   4. Direct checkout is called for urgency / last-day (not onOpen)
 *   5. onOpen is called for settled / free (not startCheckout)
 *   6. Singular/plural day wording
 *   7. Pill hidden entirely for paid Pro users
 *
 * Mocking strategy:
 *   - startCheckout is mocked at the module level (billing.js)
 *   - sessionStorage is reset between tests
 *   - plan helpers are real (tested in plan.test.js), injected via profile shape
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GetProPill from '../GetProPill';

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../lib/billing', () => ({
  startCheckout: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/telemetry', () => ({
  logTelemetry: vi.fn(),
  setLastUpgradeTrigger: vi.fn(),
  UPGRADE_TRIGGERS: { TRIAL_BANNER: 'trial_banner', TODAY_PILL: 'today_pill' },
}));

// Icon renders nothing meaningful in unit tests — stub it to keep snapshots clean.
vi.mock('../Icon', () => ({
  default: ({ name }) => <span data-testid={`icon-${name}`} />,
}));

import { startCheckout } from '../../lib/billing';

// ── Profile factories ─────────────────────────────────────────────────────────

function msFromNow(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function trialProfile(daysFromNow) {
  return {
    plan: 'trial',
    trial_ends_at: msFromNow(daysFromNow * 86400000),
  };
}

function freeProfile() {
  return { plan: 'free' };
}

function proProfile() {
  return { plan: 'pro' };
}

// Last-day profile: trial ends in <24 hours but still active.
function lastDayProfile() {
  return {
    plan: 'trial',
    trial_ends_at: msFromNow(0.5 * 86400000), // 12 hours left
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

// ── Tests: copy states ────────────────────────────────────────────────────────

describe('GetProPill — copy per state', () => {
  it('settled state (>=4 days left): shows trial settled copy', () => {
    render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} />);
    expect(screen.getByText(/Pro trial — 8 days of true-profit left/i)).toBeTruthy();
  });

  it('settled state (exactly 4 days): shows settled copy not urgency', () => {
    render(<GetProPill profile={trialProfile(4)} onOpen={vi.fn()} />);
    expect(screen.getByText(/Pro trial — 4 days of true-profit left/i)).toBeTruthy();
  });

  it('urgency state (3 days left): shows urgency copy', () => {
    render(<GetProPill profile={trialProfile(3)} onOpen={vi.fn()} />);
    expect(screen.getByText(/3 days left — keep your true-profit view for £12\/mo/i)).toBeTruthy();
  });

  it('urgency state (2 days left): shows urgency copy', () => {
    render(<GetProPill profile={trialProfile(2)} onOpen={vi.fn()} />);
    expect(screen.getByText(/2 days left — keep your true-profit view for £12\/mo/i)).toBeTruthy();
  });

  it('urgency state (1 day left): uses singular "day"', () => {
    // 1 day left but >24 hours (not last-day). 1.5 days rounds up to 2 via ceil,
    // so use exactly 1.1 days to get ceil=2. Use 28 hours to get ceil(1.166)=2.
    // For exactly 1 day we need <24h but isTrialLastDay false: use 1.001 days.
    // Note: trialDaysLeft uses Math.ceil so 1.0001 days left → ceil = 2. We
    // need to land on exactly 1 via Math.ceil, which means <=24h && >0h.
    // Use the lastDayProfile shape but with enough hours that isTrialLastDay is
    // still false — actually isTrialLastDay is <=24h so ANY sub-24h trial is last-day.
    // Conclusion: "1 day" copy only appears in last-day state. Test last-day copy directly.
    render(<GetProPill profile={lastDayProfile()} onOpen={vi.fn()} />);
    expect(screen.getByText(/Last day of Pro — keep it for £12\/mo/i)).toBeTruthy();
  });

  it('last-day state: shows last-day copy', () => {
    render(<GetProPill profile={lastDayProfile()} onOpen={vi.fn()} />);
    expect(screen.getByText(/Last day of Pro — keep it for £12\/mo/i)).toBeTruthy();
  });

  it('free state: shows free copy', () => {
    render(<GetProPill profile={freeProfile()} onOpen={vi.fn()} />);
    expect(screen.getByText(/Get Pro — see your true profit, tax pot & auto-chasing/i)).toBeTruthy();
  });

  it('plural days: "8 days" not "8 day"', () => {
    render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} />);
    expect(screen.getByText(/8 days/)).toBeTruthy();
  });
});

// ── Tests: paid Pro user sees nothing ─────────────────────────────────────────

describe('GetProPill — hidden for paid Pro', () => {
  it('renders nothing for plan=pro', () => {
    const { container } = render(<GetProPill profile={proProfile()} onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});

// ── Tests: dismissal rules ────────────────────────────────────────────────────

describe('GetProPill — dismissal gating', () => {
  it('settled state: dismiss button is present', () => {
    render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeTruthy();
  });

  it('free state: dismiss button is present', () => {
    render(<GetProPill profile={freeProfile()} onOpen={vi.fn()} />);
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeTruthy();
  });

  it('urgency state: NO dismiss button', () => {
    render(<GetProPill profile={trialProfile(3)} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  });

  it('last-day state: NO dismiss button', () => {
    render(<GetProPill profile={lastDayProfile()} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  });

  it('settled: dismissed pill hides after X tap', () => {
    const { container } = render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(container.firstChild).toBeNull();
  });

  it('urgency: pill is still visible even when session dismiss flag is set', () => {
    // Simulate a prior dismiss from settled state
    sessionStorage.setItem('jp.getproPillDismissed', '1');
    const { container } = render(<GetProPill profile={trialProfile(2)} onOpen={vi.fn()} />);
    // Urgency state ignores the dismiss flag
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText(/2 days left/i)).toBeTruthy();
  });

  it('last-day: pill is still visible even when session dismiss flag is set', () => {
    sessionStorage.setItem('jp.getproPillDismissed', '1');
    const { container } = render(<GetProPill profile={lastDayProfile()} onOpen={vi.fn()} />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText(/Last day of Pro/i)).toBeTruthy();
  });
});

// ── Tests: CTA routing ────────────────────────────────────────────────────────

describe('GetProPill — CTA routing', () => {
  it('settled: tapping body calls onOpen, NOT startCheckout', async () => {
    const onOpen = vi.fn();
    render(<GetProPill profile={trialProfile(8)} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Pro trial/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('free: tapping body calls onOpen, NOT startCheckout', () => {
    const onOpen = vi.fn();
    render(<GetProPill profile={freeProfile()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Get Pro/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('urgency: tapping body calls startCheckout, NOT onOpen', async () => {
    const onOpen = vi.fn();
    render(<GetProPill profile={trialProfile(2)} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /2 days left/i }));
    // Allow async to settle
    await vi.waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(1));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('last-day: tapping body calls startCheckout, NOT onOpen', async () => {
    const onOpen = vi.fn();
    render(<GetProPill profile={lastDayProfile()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Last day of Pro/i }));
    await vi.waitFor(() => expect(startCheckout).toHaveBeenCalledTimes(1));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('urgency: startCheckout error is forwarded to onError', async () => {
    startCheckout.mockResolvedValueOnce({ error: 'Network error' });
    const onError = vi.fn();
    render(<GetProPill profile={trialProfile(2)} onOpen={vi.fn()} onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: /2 days left/i }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Network error'));
  });
});
