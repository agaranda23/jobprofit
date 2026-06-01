/**
 * chaseReminders.test.js
 *
 * Tests for the pure helper functions in _lib/chaseTierHelpers.js:
 *   - daysPastDueShared  — overdue age calculation
 *   - computeTierShared  — tier from overdue age
 *   - shouldSendChaseReminder — cadence gate (the headline unit)
 *
 * No network, no Supabase, no push — these are pure functions.
 */

import { describe, it, expect } from 'vitest';
import {
  daysPastDueShared,
  computeTierShared,
  shouldSendChaseReminder,
  DEFAULT_PAYMENT_TERMS_DAYS,
} from '../_lib/chaseTierHelpers.js';

// ── test helpers ──────────────────────────────────────────────────────────────

/** Returns a Date that is `days` days ago from `now`. */
function daysAgo(days, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - days);
  return d;
}

/** ISO date string for a date `days` days ago. */
function isoAgo(days, now = new Date()) {
  return daysAgo(days, now).toISOString();
}

/** ISO date string for a date `days` days in the future. */
function isoFuture(days, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const NOW = new Date('2026-06-01T09:00:00.000Z');

// ── daysPastDueShared ─────────────────────────────────────────────────────────

describe('daysPastDueShared', () => {
  it('returns 0 when no invoice dates present', () => {
    expect(daysPastDueShared({}, NOW)).toBe(0);
    expect(daysPastDueShared(null, NOW)).toBe(0);
  });

  it('returns positive days when invoiceDueDate is in the past', () => {
    const job = { invoiceDueDate: isoAgo(5, NOW) };
    expect(daysPastDueShared(job, NOW)).toBe(5);
  });

  it('returns negative when invoiceDueDate is in the future', () => {
    const job = { invoiceDueDate: isoFuture(3, NOW) };
    expect(daysPastDueShared(job, NOW)).toBeLessThan(0);
  });

  it('falls back to invoiceSentAt + DEFAULT_PAYMENT_TERMS_DAYS when no invoiceDueDate', () => {
    // invoiceSentAt 10 days ago → due date was 3 days ago (10 - 7 = 3)
    const job = { invoiceSentAt: isoAgo(10, NOW) };
    expect(daysPastDueShared(job, NOW)).toBe(10 - DEFAULT_PAYMENT_TERMS_DAYS);
  });

  it('prefers invoiceDueDate over invoiceSentAt fallback', () => {
    const job = {
      invoiceSentAt: isoAgo(20, NOW),   // would give 13 days overdue
      invoiceDueDate: isoAgo(5, NOW),   // should give 5 days overdue
    };
    expect(daysPastDueShared(job, NOW)).toBe(5);
  });
});

// ── computeTierShared ─────────────────────────────────────────────────────────

describe('computeTierShared', () => {
  it('returns 0 for pre-due jobs', () => {
    const job = { invoiceDueDate: isoFuture(2, NOW) };
    expect(computeTierShared(job, NOW)).toBe(0);
  });

  it('returns "grace" for due-today (daysPastDue = 0)', () => {
    const job = { invoiceDueDate: NOW.toISOString() };
    expect(computeTierShared(job, NOW)).toBe('grace');
  });

  it('returns tier 1 for 1–6 days overdue', () => {
    for (const d of [1, 3, 6]) {
      const job = { invoiceDueDate: isoAgo(d, NOW) };
      expect(computeTierShared(job, NOW)).toBe(1);
    }
  });

  it('returns tier 2 for 7–13 days overdue', () => {
    for (const d of [7, 10, 13]) {
      const job = { invoiceDueDate: isoAgo(d, NOW) };
      expect(computeTierShared(job, NOW)).toBe(2);
    }
  });

  it('returns tier 3 for 14+ days overdue', () => {
    for (const d of [14, 20, 60]) {
      const job = { invoiceDueDate: isoAgo(d, NOW) };
      expect(computeTierShared(job, NOW)).toBe(3);
    }
  });
});

// ── shouldSendChaseReminder ───────────────────────────────────────────────────

describe('shouldSendChaseReminder', () => {
  it('returns false for tier 0 (pre-due)', () => {
    expect(shouldSendChaseReminder({ currentTier: 0, chaseRemindedTier: null, chaseRemindedAt: null }, NOW)).toBe(false);
  });

  it('returns false for grace tier', () => {
    expect(shouldSendChaseReminder({ currentTier: 'grace', chaseRemindedTier: null, chaseRemindedAt: null }, NOW)).toBe(false);
  });

  it('returns true for first-ever reminder (no prior state)', () => {
    expect(shouldSendChaseReminder({ currentTier: 1, chaseRemindedTier: null, chaseRemindedAt: null }, NOW)).toBe(true);
    expect(shouldSendChaseReminder({ currentTier: 2, chaseRemindedTier: null, chaseRemindedAt: null }, NOW)).toBe(true);
    expect(shouldSendChaseReminder({ currentTier: 3, chaseRemindedTier: null, chaseRemindedAt: null }, NOW)).toBe(true);
  });

  it('returns true when tier has escalated', () => {
    // Was reminded at tier 1 yesterday, now at tier 2
    expect(shouldSendChaseReminder({
      currentTier: 2,
      chaseRemindedTier: 1,
      chaseRemindedAt: isoAgo(1, NOW),
    }, NOW)).toBe(true);

    // Was reminded at tier 2, now at tier 3
    expect(shouldSendChaseReminder({
      currentTier: 3,
      chaseRemindedTier: 2,
      chaseRemindedAt: isoAgo(1, NOW),
    }, NOW)).toBe(true);
  });

  it('returns false when already reminded at current tier (tier 1)', () => {
    expect(shouldSendChaseReminder({
      currentTier: 1,
      chaseRemindedTier: 1,
      chaseRemindedAt: isoAgo(3, NOW),
    }, NOW)).toBe(false);
  });

  it('returns false when already reminded at current tier (tier 2)', () => {
    expect(shouldSendChaseReminder({
      currentTier: 2,
      chaseRemindedTier: 2,
      chaseRemindedAt: isoAgo(3, NOW),
    }, NOW)).toBe(false);
  });

  // ── Tier 3 re-reminder rules ──────────────────────────────────────────────

  it('returns true for tier 3 re-reminder when 7+ days since last reminder', () => {
    expect(shouldSendChaseReminder({
      currentTier: 3,
      chaseRemindedTier: 3,
      chaseRemindedAt: isoAgo(7, NOW),
    }, NOW)).toBe(true);

    expect(shouldSendChaseReminder({
      currentTier: 3,
      chaseRemindedTier: 3,
      chaseRemindedAt: isoAgo(10, NOW),
    }, NOW)).toBe(true);
  });

  it('returns false for tier 3 re-reminder when fewer than 7 days since last', () => {
    expect(shouldSendChaseReminder({
      currentTier: 3,
      chaseRemindedTier: 3,
      chaseRemindedAt: isoAgo(6, NOW),
    }, NOW)).toBe(false);

    expect(shouldSendChaseReminder({
      currentTier: 3,
      chaseRemindedTier: 3,
      chaseRemindedAt: isoAgo(1, NOW),
    }, NOW)).toBe(false);
  });

  it('returns false for tier 3 re-reminder when reminded today (same day)', () => {
    expect(shouldSendChaseReminder({
      currentTier: 3,
      chaseRemindedTier: 3,
      chaseRemindedAt: NOW.toISOString(),
    }, NOW)).toBe(false);
  });

  it('handles undefined chaseRemindedTier the same as null (first reminder)', () => {
    expect(shouldSendChaseReminder({
      currentTier: 1,
      chaseRemindedTier: undefined,
      chaseRemindedAt: undefined,
    }, NOW)).toBe(true);
  });
});
