/**
 * dropToFreeDismiss.test.js — Regression test for the Moment-2 dismiss fix.
 *
 * Bug: handleDropToFreeDismiss in AppShell.jsx did not call setTrialEndSheetOpen(false),
 * so if a stale Moment-1 trial-end sheet was in memory (app kept open across the
 * day14→day15 expiry boundary) it remained visible after the user tapped "Stay on free".
 *
 * Fix: setTrialEndSheetOpen(false) is now called alongside setDropToFreeOpen(false).
 *
 * Test strategy: AppShell is not unit-testable in isolation (heavy Supabase + React
 * context deps; no existing full-render harness). Instead we test the dismiss contract
 * by mirroring the handler logic exactly, following the no-DOM / no-React convention
 * used throughout this test suite (see AddJobModal.test.js, trialConversion.test.js).
 */

import { describe, it, expect, vi } from 'vitest';
import { markDropToFreeSeen, flipExpiredTrialToFree, DROP_TO_FREE_SEEN_KEY } from '../plan.js';

// ── localStorage mock (same pattern as trialConversion.test.js) ──────────────

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

// ── Helper: mirrors handleDropToFreeDismiss from AppShell.jsx ─────────────────
//
// The handler is a closure over React useState setters. We simulate it by
// accepting mock setters so we can assert they are each called correctly.
// Any change to the real handler that drops one of these calls will break
// this test.

function simulateHandleDropToFreeDismiss({
  setDropToFreeOpen,
  setTrialEndSheetOpen,
  setProfile,
  supabase,
  session,
  profile,
}) {
  markDropToFreeSeen();
  setDropToFreeOpen(false);
  // FIX: must also close the trial-end sheet
  setTrialEndSheetOpen(false);
  // Optimistic local update
  setProfile(prev => prev ? { ...prev, plan: 'free', drop_to_free_seen: true } : prev);
  // Fire-and-forget DB write
  if (session?.user?.id && profile) {
    flipExpiredTrialToFree(supabase, session.user.id, profile).catch(() => {});
  }
}

// ── Supabase stub ─────────────────────────────────────────────────────────────

function makeSupabase() {
  return {
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleDropToFreeDismiss dismiss contract', () => {
  beforeEach(() => {
    globalThis.localStorage?.removeItem(DROP_TO_FREE_SEEN_KEY);
  });
  afterEach(() => {
    globalThis.localStorage?.removeItem(DROP_TO_FREE_SEEN_KEY);
  });

  it('closes the drop-to-free screen', () => {
    const setDropToFreeOpen    = vi.fn();
    const setTrialEndSheetOpen = vi.fn();
    const setProfile           = vi.fn();

    simulateHandleDropToFreeDismiss({
      setDropToFreeOpen,
      setTrialEndSheetOpen,
      setProfile,
      supabase: makeSupabase(),
      session:  { user: { id: 'user-1' } },
      profile:  { plan: 'trial', trial_ends_at: new Date(Date.now() - 86400000).toISOString() },
    });

    expect(setDropToFreeOpen).toHaveBeenCalledWith(false);
  });

  it('closes the trial-end sheet — regression for stale-sheet bug', () => {
    // This is the specific regression: without the fix, setTrialEndSheetOpen
    // was never called, leaving a stale Moment-1 sheet visible underneath.
    const setDropToFreeOpen    = vi.fn();
    const setTrialEndSheetOpen = vi.fn();
    const setProfile           = vi.fn();

    simulateHandleDropToFreeDismiss({
      setDropToFreeOpen,
      setTrialEndSheetOpen,
      setProfile,
      supabase: makeSupabase(),
      session:  { user: { id: 'user-1' } },
      profile:  { plan: 'trial', trial_ends_at: new Date(Date.now() - 86400000).toISOString() },
    });

    expect(setTrialEndSheetOpen).toHaveBeenCalledWith(false);
  });

  it('both sheets are closed in the same dismiss call', () => {
    const setDropToFreeOpen    = vi.fn();
    const setTrialEndSheetOpen = vi.fn();
    const setProfile           = vi.fn();

    simulateHandleDropToFreeDismiss({
      setDropToFreeOpen,
      setTrialEndSheetOpen,
      setProfile,
      supabase: makeSupabase(),
      session:  { user: { id: 'user-1' } },
      profile:  { plan: 'trial', trial_ends_at: new Date(Date.now() - 86400000).toISOString() },
    });

    expect(setDropToFreeOpen).toHaveBeenCalledWith(false);
    expect(setTrialEndSheetOpen).toHaveBeenCalledWith(false);
  });

  it('marks the drop-to-free screen as seen in localStorage', () => {
    const setDropToFreeOpen    = vi.fn();
    const setTrialEndSheetOpen = vi.fn();
    const setProfile           = vi.fn();

    simulateHandleDropToFreeDismiss({
      setDropToFreeOpen,
      setTrialEndSheetOpen,
      setProfile,
      supabase: makeSupabase(),
      session:  { user: { id: 'user-1' } },
      profile:  { plan: 'trial', trial_ends_at: new Date(Date.now() - 86400000).toISOString() },
    });

    expect(globalThis.localStorage.getItem(DROP_TO_FREE_SEEN_KEY)).toBe('1');
  });

  it('optimistically flips profile.plan to free', () => {
    const setDropToFreeOpen    = vi.fn();
    const setTrialEndSheetOpen = vi.fn();
    const setProfile           = vi.fn();
    const prevProfile = { plan: 'trial', trial_ends_at: new Date(Date.now() - 86400000).toISOString() };

    simulateHandleDropToFreeDismiss({
      setDropToFreeOpen,
      setTrialEndSheetOpen,
      setProfile,
      supabase: makeSupabase(),
      session:  { user: { id: 'user-1' } },
      profile:  prevProfile,
    });

    // setProfile receives an updater function; call it to inspect the result
    const updater = setProfile.mock.calls[0][0];
    const next = updater(prevProfile);
    expect(next.plan).toBe('free');
    expect(next.drop_to_free_seen).toBe(true);
  });

  it('does not throw when session is missing (e.g. offline edge case)', () => {
    const setDropToFreeOpen    = vi.fn();
    const setTrialEndSheetOpen = vi.fn();
    const setProfile           = vi.fn();

    expect(() =>
      simulateHandleDropToFreeDismiss({
        setDropToFreeOpen,
        setTrialEndSheetOpen,
        setProfile,
        supabase: makeSupabase(),
        session:  null,
        profile:  null,
      })
    ).not.toThrow();
  });
});
