// @vitest-environment jsdom
/**
 * GetProPill — 3-state "use it" machine tests (Today-alive, item 5)
 *
 * Covers:
 *   1. Copy/state variants render for the correct profile conditions
 *   2. Dismiss is blocked in urgency (X button absent)
 *   3. Dismiss is available in settled and free states
 *   4. Settled deep-links to Money (onNavigateToMoney), rotating the
 *      suggested perk across mounts via lib/proPillRotation.js
 *   5. Urgency opens the upgrade sheet (onOpen) — NOT a direct checkout call
 *   6. Singular/plural day wording
 *   7. Pill hidden entirely for paid Pro users
 *   8. Pill renders during an ACTIVE trial (the bug this PR fixes lived in
 *      TodayScreen's render gate, not here, but this file pins the component
 *      itself never hides a trial profile)
 *
 * 2026-07-05: rewritten for the "use it" repoint — urgency no longer calls
 * startCheckoutImmediate() directly (see GetProPill.jsx doc comment); it
 * reopens ProUpgradeSheet instead. billing.js is no longer imported by the
 * component, so it is no longer mocked here.
 *
 * Mocking strategy:
 *   - sessionStorage/localStorage reset between tests (rotation lives in
 *     localStorage — must be cleared or state leaks across tests)
 *   - plan helpers are real (tested in plan.test.js), injected via profile shape
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GetProPill from '../GetProPill';

// ── Module mocks ─────────────────────────────────────────────────────────────

// Icon renders nothing meaningful in unit tests — stub it to keep snapshots clean.
vi.mock('../Icon', () => ({
  default: ({ name }) => <span data-testid={`icon-${name}`} />,
}));

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

// Last-day profile: trial ends in <24 hours but still active. Folds into the
// "urgency" state under the new 3-state machine (trialDaysLeft ceils to 1).
function lastDayProfile() {
  return {
    plan: 'trial',
    trial_ends_at: msFromNow(0.5 * 86400000), // 12 hours left
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

// ── Tests: copy states ────────────────────────────────────────────────────────

describe('GetProPill — copy per state', () => {
  it('settled state (>=4 days left): shows trial settled copy, first rotation slot (true profit)', () => {
    render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} onNavigateToMoney={vi.fn()} />);
    expect(screen.getByText(/Pro trial · 8 days left — see your true profit/i)).toBeTruthy();
  });

  it('settled state (exactly 4 days): shows settled copy not urgency', () => {
    render(<GetProPill profile={trialProfile(4)} onOpen={vi.fn()} onNavigateToMoney={vi.fn()} />);
    expect(screen.getByText(/Pro trial · 4 days left/i)).toBeTruthy();
  });

  it('settled state: rotates to "remove your footer" on the 2nd mount, "tax pot" on the 3rd', () => {
    const { unmount } = render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} onNavigateToMoney={vi.fn()} />);
    expect(screen.getByText(/see your true profit/i)).toBeTruthy();
    unmount();

    const second = render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} onNavigateToMoney={vi.fn()} />);
    expect(screen.getByText(/remove your footer/i)).toBeTruthy();
    second.unmount();

    const third = render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} onNavigateToMoney={vi.fn()} />);
    expect(screen.getByText(/see your tax pot/i)).toBeTruthy();
    third.unmount();

    // Cycles back round to true profit on the 4th mount.
    render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} onNavigateToMoney={vi.fn()} />);
    expect(screen.getByText(/see your true profit/i)).toBeTruthy();
  });

  it('urgency state (3 days left): shows the "use it" urgency copy', () => {
    render(<GetProPill profile={trialProfile(3)} onOpen={vi.fn()} />);
    expect(screen.getByText(/3 days of Pro left — after that, chasing's back on you/i)).toBeTruthy();
  });

  it('urgency state (2 days left): shows urgency copy', () => {
    render(<GetProPill profile={trialProfile(2)} onOpen={vi.fn()} />);
    expect(screen.getByText(/2 days of Pro left — after that, chasing's back on you/i)).toBeTruthy();
  });

  it('last-day profile (folded into urgency): singular "day" wording', () => {
    render(<GetProPill profile={lastDayProfile()} onOpen={vi.fn()} />);
    expect(screen.getByText(/1 day of Pro left — after that, chasing's back on you/i)).toBeTruthy();
  });

  it('free state: shows free copy (unchanged)', () => {
    render(<GetProPill profile={freeProfile()} onOpen={vi.fn()} />);
    expect(screen.getByText(/Get Pro — auto-chase late payers, remove OHNAR branding/i)).toBeTruthy();
  });

  it('plural days: "8 days" not "8 day"', () => {
    render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} onNavigateToMoney={vi.fn()} />);
    expect(screen.getByText(/8 days/)).toBeTruthy();
  });
});

// ── Tests: renders during an active trial (the TodayScreen gate this PR fixes) ─

describe('GetProPill — never self-hides for an active trial', () => {
  it('renders (does not return null) for a settled-trial profile', () => {
    const { container } = render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} onNavigateToMoney={vi.fn()} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders (does not return null) for an urgency-trial profile', () => {
    const { container } = render(<GetProPill profile={trialProfile(2)} onOpen={vi.fn()} />);
    expect(container.firstChild).not.toBeNull();
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
    render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} onNavigateToMoney={vi.fn()} />);
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

  it('last-day profile (urgency): NO dismiss button', () => {
    render(<GetProPill profile={lastDayProfile()} onOpen={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
  });

  it('settled: dismissed pill hides after X tap', () => {
    const { container } = render(<GetProPill profile={trialProfile(8)} onOpen={vi.fn()} onNavigateToMoney={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(container.firstChild).toBeNull();
  });

  it('urgency: pill is still visible even when session dismiss flag is set', () => {
    // Simulate a prior dismiss from settled state
    sessionStorage.setItem('jp.getproPillDismissed', '1');
    const { container } = render(<GetProPill profile={trialProfile(2)} onOpen={vi.fn()} />);
    // Urgency state ignores the dismiss flag
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText(/2 days of Pro left/i)).toBeTruthy();
  });

  it('last-day profile (urgency): pill is still visible even when session dismiss flag is set', () => {
    sessionStorage.setItem('jp.getproPillDismissed', '1');
    const { container } = render(<GetProPill profile={lastDayProfile()} onOpen={vi.fn()} />);
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByText(/1 day of Pro left/i)).toBeTruthy();
  });
});

// ── Tests: CTA routing ────────────────────────────────────────────────────────

describe('GetProPill — CTA routing', () => {
  it('settled: tapping body calls onNavigateToMoney, NOT onOpen', () => {
    const onOpen = vi.fn();
    const onNavigateToMoney = vi.fn();
    render(<GetProPill profile={trialProfile(8)} onOpen={onOpen} onNavigateToMoney={onNavigateToMoney} />);
    fireEvent.click(screen.getByRole('button', { name: /Pro trial/i }));
    expect(onNavigateToMoney).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('settled: falls back to onOpen when onNavigateToMoney is not wired (never dead-ends)', () => {
    const onOpen = vi.fn();
    render(<GetProPill profile={trialProfile(8)} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Pro trial/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('free: tapping body calls onOpen', () => {
    const onOpen = vi.fn();
    render(<GetProPill profile={freeProfile()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Get Pro/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('urgency: tapping body calls onOpen (opens ProUpgradeSheet), not onNavigateToMoney', () => {
    const onOpen = vi.fn();
    const onNavigateToMoney = vi.fn();
    render(<GetProPill profile={trialProfile(2)} onOpen={onOpen} onNavigateToMoney={onNavigateToMoney} />);
    fireEvent.click(screen.getByRole('button', { name: /2 days of Pro left/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onNavigateToMoney).not.toHaveBeenCalled();
  });

  it('last-day profile (urgency): tapping body calls onOpen', () => {
    const onOpen = vi.fn();
    render(<GetProPill profile={lastDayProfile()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /1 day of Pro left/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
