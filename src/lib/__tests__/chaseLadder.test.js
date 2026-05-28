import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getChaseState,
  recordChase,
  clearChase,
  computeTier,
  daysPastDue,
  buildChaseMessage,
  buildChaseLink,
  lastChasedLabel,
} from '../chaseLadder.js';

// ── localStorage mock ─────────────────────────────────────────────────────
// Vitest runs in Node — localStorage doesn't exist. Provide a minimal stub.

function makeLocalStorageMock() {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    _store: () => store,
  };
}

const localStorageMock = makeLocalStorageMock();
vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

// ── computeTier — 5+ cases ────────────────────────────────────────────────
// computeTier(job, _now) is days-past-due based (v2 API).
// Tier 0: pre-due; Tier 1: 0–6 days; Tier 2: 7–13 days; Tier 3: 14+ days.

describe('computeTier', () => {
  it('returns 1 for a job with no due date (daysPastDue returns 0, which falls in the 0–6 day Tier 1 band)', () => {
    expect(computeTier({})).toBe(1);
  });

  it('returns 1 when invoice is due today (0 days overdue)', () => {
    const fixedNow = new Date('2025-06-01T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(1);
  });

  it('returns 1 when 3 days overdue (within 0–6 day band)', () => {
    const fixedNow = new Date('2025-06-04T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(1);
  });

  it('returns 2 when exactly 7 days overdue', () => {
    const fixedNow = new Date('2025-06-08T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(2);
  });

  it('returns 2 when 10 days overdue (within 7–13 day band)', () => {
    const fixedNow = new Date('2025-06-11T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(2);
  });

  it('returns 3 when exactly 14 days overdue', () => {
    const fixedNow = new Date('2025-06-15T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(3);
  });

  it('returns 0 (pre-due) when due date is in the future', () => {
    const fixedNow = new Date('2025-05-20T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(0);
  });

  it('is injectable with a custom now date (test helper)', () => {
    const fixedNow = new Date('2025-01-20T12:00:00Z');
    const job = { invoiceDueDate: '2025-01-13' }; // exactly 7 days overdue
    expect(computeTier(job, fixedNow)).toBe(2);
  });
});

// ── daysPastDue — null safety (regression: Money tab blank-screen crash) ──
// FinanceScreen passes a job-shaped object whose chase state may be absent.
// A null/undefined arg must never throw — an unguarded read of
// `job.invoiceDueDate` previously crashed the whole Money tab to a blank screen.

describe('daysPastDue null safety', () => {
  it('returns 0 for a null job instead of throwing', () => {
    expect(() => daysPastDue(null)).not.toThrow();
    expect(daysPastDue(null)).toBe(0);
  });

  it('returns 0 for an undefined job instead of throwing', () => {
    expect(() => daysPastDue(undefined)).not.toThrow();
    expect(daysPastDue(undefined)).toBe(0);
  });

  it('returns 0 for a job with no invoice dates', () => {
    expect(daysPastDue({ id: 'j1', amount: 100 })).toBe(0);
  });

  it('computeTier never throws on a null/undefined job (returns 1 via daysPastDue safe fallback)', () => {
    expect(() => computeTier(null)).not.toThrow();
    expect(() => computeTier(undefined)).not.toThrow();
    expect(computeTier(null)).toBe(1);
    expect(computeTier(undefined)).toBe(1);
  });
});

// ── buildChaseMessage — 6+ cases (per tier, with/without amountPaid) ──────
// v2 API: { customerName, amount, daysOverdue, tier, amountPaid, ... }

describe('buildChaseMessage', () => {
  const base = { customerName: 'Dave', amount: '£350', daysOverdue: 10, amountPaid: 0 };

  it('tier 1: light nudge — mentions the amount and customer name', () => {
    const msg = buildChaseMessage({ ...base, tier: 1 });
    expect(msg).toContain('Dave');
    expect(msg).toContain('£350');
    expect(msg).toContain('just checking');
  });

  it('tier 2: firm follow-up — names the figure and days overdue', () => {
    const msg = buildChaseMessage({ ...base, tier: 2 });
    expect(msg).toContain('£350');
    expect(msg).toContain('10 days overdue');
    expect(msg).toContain('following up');
  });

  it('tier 2 with amountPaid > 0: prepends thanks phrase', () => {
    const msg = buildChaseMessage({ ...base, tier: 2, amountPaid: 100 });
    expect(msg).toMatch(/^Thanks for the £100/);
  });

  it('tier 3: final notice — mentions amount and days overdue', () => {
    const msg = buildChaseMessage({ ...base, tier: 3 });
    expect(msg).toContain('£350');
    expect(msg).toContain('10 days overdue');
    expect(msg).toContain('last time');
  });

  it('tier 3 with amountPaid > 0: prepends part-pay thanks (Thanks for the £N —)', () => {
    const msg = buildChaseMessage({ ...base, tier: 3, amountPaid: 50 });
    expect(msg).toMatch(/^Thanks for the £50/);
  });

  it('tier 4 is clamped to tier 3 (no further escalation above 3)', () => {
    const tier3msg = buildChaseMessage({ ...base, tier: 3 });
    const tier4msg = buildChaseMessage({ ...base, tier: 4 });
    expect(tier4msg).toBe(tier3msg);
  });

  it('falls back to "there" when customerName is empty', () => {
    const msg = buildChaseMessage({ ...base, tier: 1, customerName: '' });
    expect(msg).toContain('Hi there');
  });
});

// ── buildChaseLink ────────────────────────────────────────────────────────
// v2 API: { phone, customerName, amount, daysOverdue, tier, ... }

describe('buildChaseLink', () => {
  it('returns null when phone is empty', () => {
    expect(buildChaseLink({ phone: '', customerName: 'Dave', amount: '£100', daysOverdue: 5, tier: 1 })).toBeNull();
  });

  it('strips leading zero and prefixes 44', () => {
    const url = buildChaseLink({ phone: '07700900123', customerName: 'Dave', amount: '£100', daysOverdue: 5, tier: 1 });
    expect(url).toContain('wa.me/447700900123');
  });

  it('strips leading + from international numbers', () => {
    const url = buildChaseLink({ phone: '+447700900123', customerName: 'Dave', amount: '£100', daysOverdue: 5, tier: 1 });
    expect(url).toContain('wa.me/447700900123');
  });
});

// ── localStorage failure graceful-degrade ─────────────────────────────────

describe('localStorage failure — graceful degrade', () => {
  it('getChaseState returns null when localStorage.getItem throws', () => {
    localStorageMock.getItem.mockImplementationOnce(() => { throw new Error('SecurityError'); });
    expect(getChaseState('job-99')).toBeNull();
  });

  it('recordChase does not throw when localStorage.setItem throws', () => {
    // Pre-populate a state so getItem doesn't fail
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify({}));
    localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceededError'); });
    expect(() => recordChase('job-99')).not.toThrow();
  });
});

// ── recordChase / getChaseState / clearChase round-trip ───────────────────

describe('chase state round-trip', () => {
  it('getChaseState returns null for a job that has never been chased', () => {
    expect(getChaseState('new-job')).toBeNull();
  });

  it('recordChase sets count to 1 on first call', () => {
    recordChase('job-1');
    const state = getChaseState('job-1');
    expect(state.count).toBe(1);
    expect(state.firstChasedAt).toBeDefined();
    expect(state.lastChasedAt).toBeDefined();
  });

  it('recordChase increments count on second call and preserves firstChasedAt', () => {
    recordChase('job-2');
    const first = getChaseState('job-2').firstChasedAt;
    recordChase('job-2');
    const state = getChaseState('job-2');
    expect(state.count).toBe(2);
    expect(state.firstChasedAt).toBe(first);
  });

  it('clearChase removes the entry so getChaseState returns null', () => {
    recordChase('job-3');
    clearChase('job-3');
    expect(getChaseState('job-3')).toBeNull();
  });

  it('clearChase is a no-op for a job that was never chased', () => {
    expect(() => clearChase('nonexistent')).not.toThrow();
  });
});

// ── lastChasedLabel ───────────────────────────────────────────────────────

describe('lastChasedLabel', () => {
  it('returns null when state is null', () => {
    expect(lastChasedLabel(null)).toBeNull();
  });

  it('returns "Chased today" for same-day chase', () => {
    const state = { lastChasedAt: new Date().toISOString() };
    expect(lastChasedLabel(state)).toBe('Chased today');
  });

  it('returns "Last chased yesterday" for 1-day-ago chase', () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const state = { lastChasedAt: yesterday };
    expect(lastChasedLabel(state)).toBe('Last chased yesterday');
  });

  it('returns "Last chased Nd ago" for multi-day chases', () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const state = { lastChasedAt: fiveDaysAgo };
    expect(lastChasedLabel(state)).toBe('Last chased 5d ago');
  });
});
