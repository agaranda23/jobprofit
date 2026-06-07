/**
 * trialConversion.test.js — Unit tests for the trial-end conversion flow helpers.
 *
 * Covers:
 *   - trialJustExpired        (plan.js)
 *   - isTrialLastDay          (plan.js)
 *   - trialEndSheetDismissedToday / recordTrialEndSheetDismissed (plan.js)
 *   - hasDropToFreeSeen / markDropToFreeSeen (plan.js)
 *   - flipExpiredTrialToFree now writes drop_to_free_seen (plan.js)
 *   - deriveProofLine          (ProUpgradeSheet — exported helper)
 *   - formatChargeDate         (ProUpgradeSheet — exported helper)
 *   - shouldShowPreChargeReminder (PreChargeReminderBanner — exported helper)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  trialJustExpired,
  isTrialLastDay,
  trialEndSheetDismissedToday,
  recordTrialEndSheetDismissed,
  hasDropToFreeSeen,
  markDropToFreeSeen,
  flipExpiredTrialToFree,
  DROP_TO_FREE_SEEN_KEY,
  TRIAL_END_SHEET_DISMISSED_KEY,
} from '../plan.js';
import {
  deriveProofLine,
  formatChargeDate,
  shouldShowPreChargeReminder,
  PRE_CHARGE_REMINDER_DISMISSED_KEY,
} from '../trialConversion.js';

// ── localStorage mock ─────────────────────────────────────────────────────────
// Vitest runs in node environment where localStorage is undefined.
// We provide a minimal in-memory mock so the localStorage-gated helpers
// behave as they would in the browser.

const _store = {};
const _localStorageMock = {
  getItem: (key) => _store[key] ?? null,
  setItem: (key, val) => { _store[key] = String(val); },
  removeItem: (key) => { delete _store[key]; },
  clear: () => { Object.keys(_store).forEach(k => delete _store[k]); },
};

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: _localStorageMock,
    writable: true,
    configurable: true,
  });
}

function clearRelevantKeys() {
  globalThis.localStorage?.removeItem(DROP_TO_FREE_SEEN_KEY);
  globalThis.localStorage?.removeItem(TRIAL_END_SHEET_DISMISSED_KEY);
  globalThis.localStorage?.removeItem(PRE_CHARGE_REMINDER_DISMISSED_KEY);
}

beforeEach(() => { clearRelevantKeys(); });
afterEach(() => { clearRelevantKeys(); });

// ── Fixture helpers ───────────────────────────────────────────────────────────

function trialProfile(endsAtMs, plan = 'trial') {
  return { plan, trial_ends_at: new Date(endsAtMs).toISOString() };
}

// ── trialJustExpired ──────────────────────────────────────────────────────────

describe('trialJustExpired', () => {
  it('returns true when plan=trial and trial_ends_at is in the past', () => {
    const now   = new Date('2026-06-15T12:00:00Z');
    const past  = new Date('2026-06-14T12:00:00Z').getTime();
    expect(trialJustExpired(trialProfile(past), now)).toBe(true);
  });

  it('returns false when trial is still active', () => {
    const now    = new Date('2026-06-15T12:00:00Z');
    const future = new Date('2026-06-16T12:00:00Z').getTime();
    expect(trialJustExpired(trialProfile(future), now)).toBe(false);
  });

  it('returns false when plan=free (already flipped)', () => {
    const now  = new Date('2026-06-15T12:00:00Z');
    const past = new Date('2026-06-14T12:00:00Z').getTime();
    expect(trialJustExpired(trialProfile(past, 'free'), now)).toBe(false);
  });

  it('returns false when plan=pro', () => {
    const now  = new Date('2026-06-15T12:00:00Z');
    const past = new Date('2026-06-14T12:00:00Z').getTime();
    expect(trialJustExpired(trialProfile(past, 'pro'), now)).toBe(false);
  });

  it('returns false for null profile', () => {
    expect(trialJustExpired(null)).toBe(false);
  });

  it('returns false when trial_ends_at is missing', () => {
    expect(trialJustExpired({ plan: 'trial' })).toBe(false);
  });
});

// ── isTrialLastDay ────────────────────────────────────────────────────────────

describe('isTrialLastDay', () => {
  it('returns true when trial_ends_at is within the next 24h', () => {
    const now     = new Date('2026-06-15T12:00:00Z');
    // 10 hours left
    const endsAt  = new Date('2026-06-15T22:00:00Z').getTime();
    expect(isTrialLastDay(trialProfile(endsAt), now)).toBe(true);
  });

  it('returns false when trial has more than 24h left', () => {
    const now    = new Date('2026-06-15T12:00:00Z');
    // 36 hours left
    const endsAt = new Date('2026-06-17T00:00:00Z').getTime();
    expect(isTrialLastDay(trialProfile(endsAt), now)).toBe(false);
  });

  it('returns false when trial has already expired', () => {
    const now  = new Date('2026-06-15T12:00:00Z');
    const past = new Date('2026-06-14T12:00:00Z').getTime();
    expect(isTrialLastDay(trialProfile(past), now)).toBe(false);
  });

  it('returns false for a free profile', () => {
    const now    = new Date('2026-06-15T12:00:00Z');
    const endsAt = new Date('2026-06-15T22:00:00Z').getTime();
    expect(isTrialLastDay(trialProfile(endsAt, 'free'), now)).toBe(false);
  });

  it('returns false for null profile', () => {
    expect(isTrialLastDay(null)).toBe(false);
  });
});

// ── trialEndSheetDismissedToday / recordTrialEndSheetDismissed ────────────────

describe('trialEndSheetDismissedToday', () => {
  it('returns false when nothing is stored', () => {
    const now = new Date('2026-06-15T10:00:00Z');
    expect(trialEndSheetDismissedToday(now)).toBe(false);
  });

  it('returns true after recordTrialEndSheetDismissed is called for today', () => {
    const now = new Date('2026-06-15T10:00:00Z');
    recordTrialEndSheetDismissed(now);
    expect(trialEndSheetDismissedToday(now)).toBe(true);
  });

  it('returns false on a different day than when dismissed', () => {
    const dismissedOn = new Date('2026-06-15T10:00:00Z');
    const tomorrow    = new Date('2026-06-16T10:00:00Z');
    recordTrialEndSheetDismissed(dismissedOn);
    expect(trialEndSheetDismissedToday(tomorrow)).toBe(false);
  });
});

// ── hasDropToFreeSeen / markDropToFreeSeen ────────────────────────────────────

describe('hasDropToFreeSeen / markDropToFreeSeen', () => {
  it('returns false before markDropToFreeSeen is called', () => {
    expect(hasDropToFreeSeen()).toBe(false);
  });

  it('returns true after markDropToFreeSeen is called', () => {
    markDropToFreeSeen();
    expect(hasDropToFreeSeen()).toBe(true);
  });
});

// ── flipExpiredTrialToFree now writes drop_to_free_seen ───────────────────────

describe('flipExpiredTrialToFree — writes drop_to_free_seen=true', () => {
  function makeSupabase(updateSpy = vi.fn().mockResolvedValue({ error: null })) {
    return {
      from: vi.fn(() => ({
        update: vi.fn((patch) => {
          updateSpy(patch);
          return { eq: vi.fn().mockResolvedValue({ error: null }) };
        }),
      })),
    };
  }

  it('writes { plan: "free", drop_to_free_seen: true } to Supabase', async () => {
    const spy = vi.fn();
    const sb = makeSupabase(spy);
    const past = new Date(Date.now() - 86400000).toISOString();
    await flipExpiredTrialToFree(sb, 'user-1', { plan: 'trial', trial_ends_at: past });
    expect(spy).toHaveBeenCalledWith({ plan: 'free', drop_to_free_seen: true });
  });

  it('does not write when trial is still active', async () => {
    const spy = vi.fn();
    const sb = makeSupabase(spy);
    const future = new Date(Date.now() + 86400000).toISOString();
    await flipExpiredTrialToFree(sb, 'user-1', { plan: 'trial', trial_ends_at: future });
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not write when plan is not trial', async () => {
    const spy = vi.fn();
    const sb = makeSupabase(spy);
    const past = new Date(Date.now() - 86400000).toISOString();
    await flipExpiredTrialToFree(sb, 'user-1', { plan: 'free', trial_ends_at: past });
    expect(spy).not.toHaveBeenCalled();
  });

  it('is safe with null supabase', async () => {
    await expect(
      flipExpiredTrialToFree(null, 'user-1', { plan: 'trial', trial_ends_at: new Date().toISOString() })
    ).resolves.toBeUndefined();
  });

  it('is safe with missing userId', async () => {
    const sb = makeSupabase();
    await expect(
      flipExpiredTrialToFree(sb, '', { plan: 'trial', trial_ends_at: new Date().toISOString() })
    ).resolves.toBeUndefined();
  });
});

// ── deriveProofLine ───────────────────────────────────────────────────────────

describe('deriveProofLine', () => {
  it('returns tier=light for an empty jobs array', () => {
    const result = deriveProofLine([]);
    expect(result.tier).toBe('light');
    expect(result.paidTotal).toBeNull();
  });

  it('returns tier=strong when at least one paid job with positive total', () => {
    const jobs = [
      { status: 'paid', total: 450, paid: true, paymentStatus: 'paid' },
    ];
    const result = deriveProofLine(jobs);
    expect(result.tier).toBe('strong');
    expect(result.paidTotal).toBe('£450');
  });

  it('formats paidTotal as £ with en-GB locale', () => {
    const jobs = [
      { status: 'paid', total: 1250, paid: true },
      { status: 'paid', total: 750, paid: true },
    ];
    const result = deriveProofLine(jobs);
    expect(result.paidTotal).toBe('£2,000');
  });

  it('returns tier=medium when invoices sent but none paid', () => {
    const jobs = [
      { status: 'invoice_sent', total: 300, invoiceSentAt: '2026-06-01T10:00:00Z' },
      { status: 'invoice_sent', total: 200, invoiceSentAt: '2026-06-02T10:00:00Z' },
    ];
    const result = deriveProofLine(jobs);
    expect(result.tier).toBe('medium');
    expect(result.invoiceCount).toBe(2);
  });

  it('does NOT return £0 paidTotal — falls back to light when paid total is 0', () => {
    // A job with paid=true but total=0 should not produce a £0 proof line
    const jobs = [{ status: 'paid', total: 0, paid: true }];
    const result = deriveProofLine(jobs);
    // paidTotal is null when rawPaidTotal === 0, so tier falls through to light
    expect(result.paidTotal).toBeNull();
    expect(result.tier).toBe('light');
  });

  it('counts quoteCount only for jobs with a positive total or amount', () => {
    const jobs = [
      { status: 'quote', total: 500 },
      { status: 'quote', total: 0 }, // should not count
      { status: 'quote', amount: 200 },
    ];
    const result = deriveProofLine(jobs);
    expect(result.quoteCount).toBe(2);
  });
});

// ── formatChargeDate ──────────────────────────────────────────────────────────

describe('formatChargeDate', () => {
  it('returns trial_ends_at + 30 days formatted as "D Mmm"', () => {
    // 2026-07-01 + 30 days = 2026-07-31
    expect(formatChargeDate('2026-07-01T00:00:00Z')).toBe('31 Jul');
  });

  it('rolls over months correctly', () => {
    // 2026-07-15 + 30 days = 2026-08-14
    expect(formatChargeDate('2026-07-15T00:00:00Z')).toBe('14 Aug');
  });

  it('returns a fallback string for null input', () => {
    expect(formatChargeDate(null)).toBe('30 days from now');
  });

  it('returns a fallback string for undefined input', () => {
    expect(formatChargeDate(undefined)).toBe('30 days from now');
  });
});

// ── shouldShowPreChargeReminder ───────────────────────────────────────────────

describe('shouldShowPreChargeReminder', () => {
  it('returns true when charge is within 5 days', () => {
    // trial_ends_at is 25 days ago → charge = 5 days ago + 30 = in 5 days
    const now = new Date('2026-06-15T12:00:00Z');
    // charge date: now + 3 days
    const trialEndsAt = new Date(now.getTime() - 27 * 86400000).toISOString();
    const profile = { plan: 'trial', trial_ends_at: trialEndsAt };
    // 30 - 27 = 3 days until charge → within 5 day window
    expect(shouldShowPreChargeReminder(profile, now)).toBe(true);
  });

  it('returns false when charge is more than 5 days away', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    // trial started today → charge in 30 days (way outside window)
    const trialEndsAt = new Date(now.getTime()).toISOString();
    const profile = { plan: 'trial', trial_ends_at: trialEndsAt };
    expect(shouldShowPreChargeReminder(profile, now)).toBe(false);
  });

  it('returns false when charge has already passed', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    // charge was yesterday (trial_ends_at = 31 days ago)
    const trialEndsAt = new Date(now.getTime() - 31 * 86400000).toISOString();
    const profile = { plan: 'trial', trial_ends_at: trialEndsAt };
    expect(shouldShowPreChargeReminder(profile, now)).toBe(false);
  });

  it('returns false when plan is not trial', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const trialEndsAt = new Date(now.getTime() - 27 * 86400000).toISOString();
    const profile = { plan: 'pro', trial_ends_at: trialEndsAt };
    expect(shouldShowPreChargeReminder(profile, now)).toBe(false);
  });

  it('returns false when dismissed today', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const trialEndsAt = new Date(now.getTime() - 27 * 86400000).toISOString();
    const profile = { plan: 'trial', trial_ends_at: trialEndsAt };

    try {
      localStorage.setItem(PRE_CHARGE_REMINDER_DISMISSED_KEY, '2026-06-15');
    } catch { return; } // skip if localStorage unavailable

    expect(shouldShowPreChargeReminder(profile, now)).toBe(false);
  });

  it('returns false for null profile', () => {
    expect(shouldShowPreChargeReminder(null)).toBe(false);
  });
});
