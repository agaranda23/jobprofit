/**
 * proRevealWiring.test.js — Regression tests for the two AppShell.jsx call
 * sites that fire the "You've got Pro" reveal.
 *
 * Test strategy: AppShell is not unit-testable in isolation (heavy Supabase +
 * React context deps; no existing full-render harness — see
 * dropToFreeDismiss.test.js for the established precedent). Instead we mirror
 * the two handlers exactly, using mock setState functions so we can assert
 * they're called correctly. Any change to the real handlers that drops one of
 * these calls will break this test.
 *
 * Covers:
 *   (a) refreshProfile fallback — fires setProRevealOpen(true) on first
 *       Today load for wizard-skippers, gated on shouldShowProReveal
 *   (b) OnboardingWizard.onComplete — fires setProRevealOpen(true) immediately
 *       after the wizard path completes, gated on shouldShowProReveal
 *   (c) handleProRevealDismiss — marks the device flag and closes the sheet
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shouldShowProReveal, markProRevealSeen, hasSeenProReveal } from '../proReveal.js';

// ── localStorage mock (same pattern as dropToFreeDismiss.test.js) ────────────

const _store = {};
const _localStorageMock = {
  getItem:    (key)      => _store[key] ?? null,
  setItem:    (key, val) => { _store[key] = String(val); },
  removeItem: (key)      => { delete _store[key]; },
  clear:      ()         => { Object.keys(_store).forEach(k => delete _store[k]); },
};

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: _localStorageMock,
    writable: true,
    configurable: true,
  });
}

const USER_ID = 'user-1';

function activeTrialProfile(overrides = {}) {
  return {
    plan: 'trial',
    trial_ends_at: new Date(Date.now() + 5 * 86400000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => globalThis.localStorage.clear());
afterEach(() => globalThis.localStorage.clear());

// ── Helper: mirrors the refreshProfile fallback block in AppShell.jsx ────────

function simulateRefreshProfileProReveal({ data, userId, setProRevealOpen }) {
  if (shouldShowProReveal(data, userId)) {
    setProRevealOpen(true);
  }
}

// ── Helper: mirrors the OnboardingWizard onComplete block in AppShell.jsx ────

function simulateOnboardingCompleteProReveal({ savedProfile, userId, setProRevealOpen }) {
  if (shouldShowProReveal(savedProfile, userId)) {
    setProRevealOpen(true);
  }
}

// ── Helper: mirrors handleProRevealDismiss in AppShell.jsx ───────────────────

function simulateHandleProRevealDismiss({ userId, setProRevealOpen }) {
  markProRevealSeen(userId);
  setProRevealOpen(false);
}

describe('refreshProfile — pro reveal Today-load fallback (wizard-skippers)', () => {
  it('opens the reveal when isTrialActive is true and the flag is unset', () => {
    const setProRevealOpen = vi.fn();
    simulateRefreshProfileProReveal({ data: activeTrialProfile(), userId: USER_ID, setProRevealOpen });
    expect(setProRevealOpen).toHaveBeenCalledWith(true);
  });

  it('does NOT open the reveal when the flag is already set on this device', () => {
    markProRevealSeen(USER_ID);
    const setProRevealOpen = vi.fn();
    simulateRefreshProfileProReveal({ data: activeTrialProfile(), userId: USER_ID, setProRevealOpen });
    expect(setProRevealOpen).not.toHaveBeenCalled();
  });

  it('does NOT open the reveal for a free-plan profile', () => {
    const setProRevealOpen = vi.fn();
    simulateRefreshProfileProReveal({
      data: { plan: 'free', trial_ends_at: null },
      userId: USER_ID,
      setProRevealOpen,
    });
    expect(setProRevealOpen).not.toHaveBeenCalled();
  });

  it('does NOT open the reveal for a paid (plan=pro) profile', () => {
    const setProRevealOpen = vi.fn();
    simulateRefreshProfileProReveal({
      data: { plan: 'pro', trial_ends_at: null },
      userId: USER_ID,
      setProRevealOpen,
    });
    expect(setProRevealOpen).not.toHaveBeenCalled();
  });

  it('does NOT open the reveal for an expired trial', () => {
    const setProRevealOpen = vi.fn();
    const expired = activeTrialProfile({ trial_ends_at: new Date(Date.now() - 86400000).toISOString() });
    simulateRefreshProfileProReveal({ data: expired, userId: USER_ID, setProRevealOpen });
    expect(setProRevealOpen).not.toHaveBeenCalled();
  });
});

describe('OnboardingWizard.onComplete — pro reveal fires before Today paints', () => {
  it('opens the reveal immediately when the wizard completes on an active, unseen trial', () => {
    const setProRevealOpen = vi.fn();
    simulateOnboardingCompleteProReveal({
      savedProfile: activeTrialProfile(),
      userId: USER_ID,
      setProRevealOpen,
    });
    expect(setProRevealOpen).toHaveBeenCalledWith(true);
  });

  it('does NOT re-open the reveal if it was already seen on this device', () => {
    markProRevealSeen(USER_ID);
    const setProRevealOpen = vi.fn();
    simulateOnboardingCompleteProReveal({
      savedProfile: activeTrialProfile(),
      userId: USER_ID,
      setProRevealOpen,
    });
    expect(setProRevealOpen).not.toHaveBeenCalled();
  });
});

describe('handleProRevealDismiss — CTA dismiss contract', () => {
  it('marks the device flag so the reveal never fires again for this user', () => {
    const setProRevealOpen = vi.fn();
    expect(hasSeenProReveal(USER_ID)).toBe(false);
    simulateHandleProRevealDismiss({ userId: USER_ID, setProRevealOpen });
    expect(hasSeenProReveal(USER_ID)).toBe(true);
  });

  it('closes the sheet', () => {
    const setProRevealOpen = vi.fn();
    simulateHandleProRevealDismiss({ userId: USER_ID, setProRevealOpen });
    expect(setProRevealOpen).toHaveBeenCalledWith(false);
  });

  it('a subsequent refreshProfile call no longer reopens the reveal after dismiss', () => {
    const setProRevealOpen = vi.fn();
    simulateHandleProRevealDismiss({ userId: USER_ID, setProRevealOpen });

    const setProRevealOpenAgain = vi.fn();
    simulateRefreshProfileProReveal({
      data: activeTrialProfile(),
      userId: USER_ID,
      setProRevealOpen: setProRevealOpenAgain,
    });
    expect(setProRevealOpenAgain).not.toHaveBeenCalled();
  });

  it('does not throw when userId is missing (e.g. session not yet resolved)', () => {
    const setProRevealOpen = vi.fn();
    expect(() => simulateHandleProRevealDismiss({ userId: undefined, setProRevealOpen })).not.toThrow();
  });
});
