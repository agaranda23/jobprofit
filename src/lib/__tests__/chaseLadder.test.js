import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getChaseState,
  recordChase,
  clearChase,
  recordChaseCloud,
  clearChaseCloud,
  hydrateChaseState,
  computeTier,
  daysPastDue,
  daysUntilDue,
  buildChaseMessage,
  buildChaseLink,
  lastChasedLabel,
  DEFAULT_PAYMENT_TERMS_DAYS,
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

// ── computeTier — thresholds and grace window ─────────────────────────────
// computeTier(job, _now) is days-past-due based.
// 'grace': daysPastDue in [0, 1) — just flipped Overdue, chase bar silent
// Tier 1:  daysPastDue in [1, 7)  — light (Day 8 is first chase prompt)
// Tier 2:  daysPastDue in [7, 14) — firm
// Tier 3:  daysPastDue >= 14      — final
// Tier 0:  daysPastDue < 0        — pre-due

describe('computeTier', () => {
  it('returns "grace" for a job with no due date (daysPastDue returns 0, falls in grace band)', () => {
    expect(computeTier({})).toBe('grace');
  });

  it('returns "grace" when invoice is due today (0 days overdue — within 24h silent window)', () => {
    const fixedNow = new Date('2025-06-01T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe('grace');
  });

  it('returns 1 when 1 day overdue (Day 8 — grace window cleared, first chase prompt)', () => {
    const fixedNow = new Date('2025-06-02T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(1);
  });

  it('returns 1 when 3 days overdue (within 1-6 day band)', () => {
    const fixedNow = new Date('2025-06-04T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(1);
  });

  it('returns 1 when 6 days overdue (top of Tier 1 band)', () => {
    const fixedNow = new Date('2025-06-07T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(1);
  });

  it('returns 2 when exactly 7 days overdue', () => {
    const fixedNow = new Date('2025-06-08T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(2);
  });

  it('returns 2 when 10 days overdue (within 7-13 day band)', () => {
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

  it('returns 0 (pre-due) when due date is 2 days away — Tier 0 pre-due window', () => {
    const fixedNow = new Date('2025-05-30T12:00:00Z');
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

  it('computeTier never throws on a null/undefined job (returns "grace" via daysPastDue 0 fallback)', () => {
    expect(() => computeTier(null)).not.toThrow();
    expect(() => computeTier(undefined)).not.toThrow();
    expect(computeTier(null)).toBe('grace');
    expect(computeTier(undefined)).toBe('grace');
  });
});

// ── DEFAULT_PAYMENT_TERMS_DAYS — net-7 constant ───────────────────────────

describe('DEFAULT_PAYMENT_TERMS_DAYS', () => {
  it('is exported and equals 7 (net-7 default)', () => {
    expect(DEFAULT_PAYMENT_TERMS_DAYS).toBe(7);
  });

  it('daysPastDue uses net-7 fallback when no invoiceDueDate is set', () => {
    // Invoice sent exactly 7 days ago -> daysPastDue = 0 (due today)
    const invoiceSentAt = new Date('2025-06-01T00:00:00Z').toISOString();
    const job = { invoiceSentAt };
    const now = new Date('2025-06-08T12:00:00Z'); // 7 days after send
    expect(daysPastDue(job, now)).toBe(0);
  });

  it('daysPastDue net-7 fallback: 8 days after send -> 1 day past due', () => {
    const invoiceSentAt = new Date('2025-06-01T00:00:00Z').toISOString();
    const job = { invoiceSentAt };
    const now = new Date('2025-06-09T12:00:00Z'); // 8 days after send
    expect(daysPastDue(job, now)).toBe(1);
  });

  it('daysPastDue with explicit invoiceDueDate is NOT affected by DEFAULT_PAYMENT_TERMS_DAYS', () => {
    // net-30 commercial job: due 30 days after invoiceSentAt
    const invoiceSentAt = new Date('2025-06-01T00:00:00Z').toISOString();
    const invoiceDueDate = '2025-07-01'; // 30 days later
    const job = { invoiceSentAt, invoiceDueDate };
    const now = new Date('2025-06-09T12:00:00Z'); // 8 days after send — would be overdue net-7
    expect(daysPastDue(job, now)).toBeLessThan(0); // still pre-due (honoured explicit date)
  });
});

// ── daysUntilDue ──────────────────────────────────────────────────────────

describe('daysUntilDue', () => {
  it('returns positive when due date is in the future', () => {
    const job = { invoiceDueDate: '2025-06-10' };
    const now = new Date('2025-06-08T12:00:00Z');
    expect(daysUntilDue(job, now)).toBe(2);
  });

  it('returns 0 when due today', () => {
    const job = { invoiceDueDate: '2025-06-08' };
    const now = new Date('2025-06-08T12:00:00Z');
    expect(daysUntilDue(job, now)).toEqual(0);
  });

  it('returns negative when already past due', () => {
    const job = { invoiceDueDate: '2025-06-01' };
    const now = new Date('2025-06-08T12:00:00Z');
    expect(daysUntilDue(job, now)).toBe(-7);
  });

  it('returns 1 when due tomorrow (pre-due amber bar window)', () => {
    const job = { invoiceDueDate: '2025-06-09' };
    const now = new Date('2025-06-08T12:00:00Z');
    expect(daysUntilDue(job, now)).toBe(1);
  });
});

// ── buildChaseMessage — 6+ cases (per tier, with/without amountPaid) ──────
// v2 API: { customerName, amount, daysOverdue, tier, amountPaid, ... }

describe('buildChaseMessage', () => {
  const base = { customerName: 'Dave', amount: '£350', daysOverdue: 10, amountPaid: 0 };

  it('tier 0: pre-due heads-up — mentions the amount and no-action framing', () => {
    const msg = buildChaseMessage({ ...base, tier: 0, dueDate: '2025-06-15' });
    expect(msg).toContain('Dave');
    expect(msg).toContain('£350');
    expect(msg).toContain('No action needed yet');
  });

  it('tier 1: light nudge — "is on your radar" (not "has landed okay")', () => {
    const msg = buildChaseMessage({ ...base, tier: 1 });
    expect(msg).toContain('Dave');
    expect(msg).toContain('£350');
    expect(msg).toContain('just checking');
    expect(msg).toContain('is on your radar');
    expect(msg).not.toContain('has landed okay');
  });

  it('tier 2: firm follow-up — names the figure and days overdue', () => {
    const msg = buildChaseMessage({ ...base, tier: 2 });
    expect(msg).toContain('£350');
    expect(msg).toContain('10 days overdue');
    expect(msg).toContain('following up');
  });

  it('tier 2: does NOT contain "Happy to resend the details if useful"', () => {
    const msg = buildChaseMessage({ ...base, tier: 2 });
    expect(msg).not.toContain('Happy to resend the details if useful');
  });

  it('tier 2 with amountPaid > 0: prepends thanks phrase', () => {
    const msg = buildChaseMessage({ ...base, tier: 2, amountPaid: 100 });
    expect(msg).toMatch(/^Thanks for the £100/);
  });

  it('tier 3: final notice — "last one from me on this" (not "I need to chase this one last time")', () => {
    const msg = buildChaseMessage({ ...base, tier: 3 });
    expect(msg).toContain('£350');
    expect(msg).toContain('10 days overdue');
    expect(msg).toContain('last one from me on this');
    expect(msg).not.toContain('I need to chase this one last time');
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

  // ── B2B isBusinessCustomer flag (Ticket B) ────────────────────────────────

  it('tier 3 B2C (isB2B false, default): uses consumer copy, NO statutory-interest clause', () => {
    const msg = buildChaseMessage({ ...base, tier: 3, isB2B: false });
    expect(msg).toContain('last one from me on this');
    expect(msg).not.toContain('Late Payment of Commercial Debts');
    expect(msg).not.toContain('interest and compensation');
  });

  it('tier 3 B2B (isB2B true): emits statutory-interest copy, NOT consumer copy', () => {
    const msg = buildChaseMessage({ ...base, tier: 3, isB2B: true });
    expect(msg).toContain('Late Payment of Commercial Debts Act 1998');
    expect(msg).toContain('interest and compensation');
    expect(msg).not.toContain('last one from me on this');
  });

  it('tier 3 B2B: still includes the amount and days overdue', () => {
    const msg = buildChaseMessage({ ...base, tier: 3, isB2B: true });
    expect(msg).toContain('£350');
    expect(msg).toContain('10 days overdue');
  });

  it('tier 3 B2B: omitting isB2B defaults to B2C (safe for homeowners)', () => {
    const msg = buildChaseMessage({ ...base, tier: 3 });
    expect(msg).not.toContain('Late Payment of Commercial Debts');
  });

  it('tier 3 B2B: statutory copy is ONLY emitted at tier 3, not tier 1 or tier 2', () => {
    const msg1 = buildChaseMessage({ ...base, tier: 1, isB2B: true });
    const msg2 = buildChaseMessage({ ...base, tier: 2, isB2B: true });
    expect(msg1).not.toContain('Late Payment of Commercial Debts');
    expect(msg2).not.toContain('Late Payment of Commercial Debts');
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

// ── Cloud helpers — hydrateChaseState ─────────────────────────────────────
// These tests mock the Supabase client; they verify merge logic and
// graceful-degrade on error. They do NOT hit the real database.

function makeSupabaseMock({ rows = [], error = null, user = { id: 'user-abc' } } = {}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ error }),
      delete: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: rows[0] ?? null, error }),
      // chain: select().eq().eq() returns a thenable with { data, error }
      then: undefined, // handled by making eq() return a promise-like below
    })),
  };
}

// More granular mock for hydrateChaseState which calls .select().eq() and expects
// the final result directly (not .single()).
function makeHydrateMock({ rows = [], error = null, user = { id: 'user-abc' } } = {}) {
  const queryChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // The chain resolves when awaited
    then: (resolve) => resolve({ data: rows, error }),
  };
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn(() => queryChain),
  };
}

describe('hydrateChaseState — cloud-wins-on-freshness merge', () => {
  it('overlays cloud record into localStorage when cloud lastChasedAt is newer', async () => {
    const jobId = 'job-hydrate-1';
    // Seed a stale local record
    recordChase(jobId); // sets lastChasedAt = now
    const localState = getChaseState(jobId);

    // Cloud record is 2 hours AHEAD of what local has (simulated via a future timestamp)
    const cloudTs = new Date(new Date(localState.lastChasedAt).getTime() + 2 * 60 * 60 * 1000).toISOString();
    const cloudRows = [{
      job_id: jobId,
      chase_count: 5,
      last_chased_at: cloudTs,
      first_chased_at: localState.firstChasedAt,
    }];

    const mockClient = makeHydrateMock({ rows: cloudRows });
    await hydrateChaseState(mockClient);

    const merged = getChaseState(jobId);
    expect(merged.count).toBe(5);
    expect(merged.lastChasedAt).toBe(cloudTs);
  });

  it('keeps local record when local lastChasedAt is newer than cloud', async () => {
    const jobId = 'job-hydrate-2';
    recordChase(jobId);
    const localState = getChaseState(jobId);

    // Cloud record is 2 hours BEHIND local
    const cloudTs = new Date(new Date(localState.lastChasedAt).getTime() - 2 * 60 * 60 * 1000).toISOString();
    const cloudRows = [{
      job_id: jobId,
      chase_count: 1,
      last_chased_at: cloudTs,
      first_chased_at: cloudTs,
    }];

    const mockClient = makeHydrateMock({ rows: cloudRows });
    await hydrateChaseState(mockClient);

    const afterHydrate = getChaseState(jobId);
    // Local should be unchanged
    expect(afterHydrate.lastChasedAt).toBe(localState.lastChasedAt);
    expect(afterHydrate.count).toBe(localState.count);
  });

  it('does not throw and localStorage still works when cloud returns an error', async () => {
    const jobId = 'job-hydrate-3';
    recordChase(jobId);
    const localState = getChaseState(jobId);

    const errorMock = makeHydrateMock({ rows: null, error: { message: 'relation "job_chase_states" does not exist', code: '42P01' } });
    // Must not throw even with a missing-table error
    await expect(hydrateChaseState(errorMock)).resolves.toBeUndefined();

    // localStorage record is untouched
    expect(getChaseState(jobId)).toEqual(localState);
  });
});

describe('cloud write failure — graceful degrade', () => {
  it('recordChaseCloud swallows table-missing error and does not throw', async () => {
    const jobId = 'job-cloud-fail-1';
    recordChase(jobId); // localStorage write succeeds

    // Supabase returns the 42P01 "relation does not exist" error
    const failingMock = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn(() => ({
        upsert: vi.fn().mockResolvedValue({ error: { message: 'relation "job_chase_states" does not exist', code: '42P01' } }),
      })),
    };

    await expect(recordChaseCloud(jobId, failingMock)).resolves.toBeUndefined();
    // localStorage record is still intact
    expect(getChaseState(jobId)).not.toBeNull();
  });

  it('clearChaseCloud swallows table-missing error and does not throw', async () => {
    const jobId = 'job-cloud-fail-2';
    recordChase(jobId);

    const failingMock = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn(() => ({
        delete: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        then: (resolve) => resolve({ error: { message: 'relation "job_chase_states" does not exist', code: '42P01' } }),
      })),
    };

    await expect(clearChaseCloud(jobId, failingMock)).resolves.toBeUndefined();
  });

  it('hydrateChaseState is a no-op when user is not signed in', async () => {
    const noUserMock = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
    };
    await expect(hydrateChaseState(noUserMock)).resolves.toBeUndefined();
    expect(noUserMock.from).not.toHaveBeenCalled();
  });
});
