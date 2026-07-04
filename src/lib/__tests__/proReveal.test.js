/**
 * proReveal.test.js — Unit tests for the "You've got Pro" reveal gating.
 *
 * Covers:
 *   - hasSeenProReveal / markProRevealSeen (per-user localStorage flag)
 *   - shouldShowProReveal:
 *       fires when isTrialActive + flag unset
 *       does NOT fire when the flag is already set
 *       does NOT fire when not on a trial (free/expired)
 *       does NOT fire when paid (plan='pro')
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  hasSeenProReveal,
  markProRevealSeen,
  shouldShowProReveal,
} from '../proReveal.js';

// ── localStorage mock (same pattern as trialConversion.test.js / dropToFreeDismiss.test.js) ──

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

const USER_ID = 'user-123';

function activeTrialProfile(overrides = {}) {
  return {
    plan: 'trial',
    trial_ends_at: new Date(Date.now() + 5 * 86400000).toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  globalThis.localStorage.clear();
});
afterEach(() => {
  globalThis.localStorage.clear();
});

describe('hasSeenProReveal / markProRevealSeen', () => {
  it('reports unseen before markProRevealSeen is called', () => {
    expect(hasSeenProReveal(USER_ID)).toBe(false);
  });

  it('reports seen after markProRevealSeen is called', () => {
    markProRevealSeen(USER_ID);
    expect(hasSeenProReveal(USER_ID)).toBe(true);
  });

  it('is scoped per-user — marking one user does not mark another', () => {
    markProRevealSeen(USER_ID);
    expect(hasSeenProReveal('someone-else')).toBe(false);
  });

  it('fails "seen" (true) when userId is missing — never fires without an id', () => {
    expect(hasSeenProReveal(null)).toBe(true);
    expect(hasSeenProReveal(undefined)).toBe(true);
  });
});

describe('shouldShowProReveal', () => {
  it('fires when isTrialActive is true and the flag is unset', () => {
    expect(shouldShowProReveal(activeTrialProfile(), USER_ID)).toBe(true);
  });

  it('does NOT fire when the flag is already set', () => {
    markProRevealSeen(USER_ID);
    expect(shouldShowProReveal(activeTrialProfile(), USER_ID)).toBe(false);
  });

  it('does NOT fire when not on a trial (plan=free)', () => {
    expect(shouldShowProReveal({ plan: 'free', trial_ends_at: null }, USER_ID)).toBe(false);
  });

  it('does NOT fire when the trial has expired', () => {
    const expired = activeTrialProfile({ trial_ends_at: new Date(Date.now() - 86400000).toISOString() });
    expect(shouldShowProReveal(expired, USER_ID)).toBe(false);
  });

  it('does NOT fire when paid (plan=pro)', () => {
    expect(shouldShowProReveal({ plan: 'pro', trial_ends_at: null }, USER_ID)).toBe(false);
  });

  it('does NOT fire when profile is null/undefined (still loading)', () => {
    expect(shouldShowProReveal(null, USER_ID)).toBe(false);
    expect(shouldShowProReveal(undefined, USER_ID)).toBe(false);
  });
});
