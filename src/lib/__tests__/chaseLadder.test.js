import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getChaseState,
  recordChase,
  clearChase,
  computeTier,
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

describe('computeTier', () => {
  it('returns 1 when state is null (never chased)', () => {
    expect(computeTier(null)).toBe(1);
  });

  it('returns 1 when chased once but < 7 days ago', () => {
    const state = {
      count: 1,
      lastChasedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      firstChasedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(computeTier(state)).toBe(1);
  });

  it('returns 2 when chased once AND exactly 7 days have passed', () => {
    const state = {
      count: 1,
      lastChasedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      firstChasedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(computeTier(state)).toBe(2);
  });

  it('returns 3 when chased twice AND ≥7 days since last chase', () => {
    const lastChased = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const state = {
      count: 2,
      lastChasedAt: lastChased,
      firstChasedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(computeTier(state)).toBe(3);
  });

  it('returns 4 when chased 3+ times AND ≥7 days since last chase', () => {
    const lastChased = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const state = {
      count: 3,
      lastChasedAt: lastChased,
      firstChasedAt: new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(computeTier(state)).toBe(4);
  });

  it('returns 1 when chased twice but < 7 days since last chase', () => {
    const state = {
      count: 2,
      lastChasedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      firstChasedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(computeTier(state)).toBe(1);
  });

  it('is injectable with a custom now date (test helper)', () => {
    const fixedNow = new Date('2025-01-20T12:00:00Z');
    const state = {
      count: 1,
      lastChasedAt: new Date('2025-01-13T12:00:00Z').toISOString(), // exactly 7 days before
      firstChasedAt: new Date('2025-01-13T12:00:00Z').toISOString(),
    };
    expect(computeTier(state, fixedNow)).toBe(2);
  });
});

// ── buildChaseMessage — 6+ cases (per tier, with/without amountPaid) ──────

describe('buildChaseMessage', () => {
  const base = { name: 'Dave', amountOutstanding: '£350', daysSinceDue: 10, amountPaid: 0 };

  it('tier 1: produces friendly reminder without any prefix', () => {
    const msg = buildChaseMessage({ ...base, tier: 1 });
    expect(msg).toContain('just a friendly reminder');
    expect(msg).toContain('Dave');
    expect(msg).toContain('£350');
  });

  it('tier 2: names the figure and days outstanding', () => {
    const msg = buildChaseMessage({ ...base, tier: 2 });
    expect(msg).toContain('just a nudge');
    expect(msg).toContain('£350');
    expect(msg).toContain('10 days');
  });

  it('tier 2 with amountPaid > 0: prepends thanks phrase', () => {
    const msg = buildChaseMessage({ ...base, tier: 2, amountPaid: 100 });
    expect(msg).toMatch(/^Thanks for the £100/);
  });

  it('tier 3: asks for payment date confirmation', () => {
    const msg = buildChaseMessage({ ...base, tier: 3 });
    expect(msg).toContain('chasing this one more time');
    expect(msg).toContain('confirm a payment date');
  });

  it('tier 3 with amountPaid > 0: prepends part-payment thanks', () => {
    const msg = buildChaseMessage({ ...base, tier: 3, amountPaid: 50 });
    expect(msg).toMatch(/^Thanks for the part-payment/);
  });

  it('tier 4+ reuses tier-3 copy (no further escalation)', () => {
    const tier3msg = buildChaseMessage({ ...base, tier: 3 });
    const tier4msg = buildChaseMessage({ ...base, tier: 4 });
    expect(tier4msg).toBe(tier3msg);
  });

  it('falls back to "there" when name is empty', () => {
    const msg = buildChaseMessage({ ...base, tier: 1, name: '' });
    expect(msg).toContain('Hi there');
  });
});

// ── buildChaseLink ────────────────────────────────────────────────────────

describe('buildChaseLink', () => {
  it('returns null when phone is empty', () => {
    expect(buildChaseLink({ phone: '', name: 'Dave', amountOutstanding: '£100', daysSinceDue: 5, tier: 1 })).toBeNull();
  });

  it('strips leading zero and prefixes 44', () => {
    const url = buildChaseLink({ phone: '07700900123', name: 'Dave', amountOutstanding: '£100', daysSinceDue: 5, tier: 1 });
    expect(url).toContain('wa.me/447700900123');
  });

  it('strips leading + from international numbers', () => {
    const url = buildChaseLink({ phone: '+447700900123', name: 'Dave', amountOutstanding: '£100', daysSinceDue: 5, tier: 1 });
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

  it('returns "Last chased today" for same-day chase', () => {
    const state = { lastChasedAt: new Date().toISOString() };
    expect(lastChasedLabel(state)).toBe('Last chased today');
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
