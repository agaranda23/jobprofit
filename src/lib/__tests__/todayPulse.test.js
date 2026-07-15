import { describe, it, expect } from 'vitest';
import { waitingToCollectTotal, jobsOn, jobsOnCount, oldestOnJob, daysOnCount, daysOnLabel, weekOverWeek } from '../todayPulse';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function invoiceSentJob(id, amount, { paid = false } = {}) {
  return { id, amount, total: amount, status: 'invoice_sent', paid, invoiceSentAt: new Date().toISOString() };
}

function activeJob(id, amount) {
  return { id, amount, total: amount, status: 'active' };
}

function completeJob(id, amount) {
  return { id, amount, total: amount, status: 'complete' };
}

function leadJob(id, amount) {
  return { id, amount, total: amount, status: 'lead' };
}

function paidJobOn(id, amount, daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return { id, amount, total: amount, status: 'paid', paid: true, date: d.toISOString(), createdAt: d.toISOString() };
}

// ── waitingToCollectTotal ──────────────────────────────────────────────────────

describe('waitingToCollectTotal', () => {
  it('sums only invoice-sent (awaiting-payment) jobs', () => {
    const jobs = [invoiceSentJob('j1', 500), invoiceSentJob('j2', 300), paidJobOn('j3', 200, 1)];
    expect(waitingToCollectTotal(jobs)).toBe(800);
  });

  it('excludes paid jobs even if flagged invoice_sent (paid:true overrides deriveStatus fallback fields, not the canonical status — still counted if status stays invoice_sent)', () => {
    // deriveStatus prioritises the canonical `status` field, so an invoice_sent
    // job is awaiting-payment regardless of a stray paid flag — this pins that
    // behaviour rather than assuming it, since it drives real money.
    const jobs = [invoiceSentJob('j1', 500, { paid: true })];
    expect(waitingToCollectTotal(jobs)).toBe(500);
  });

  it('excludes lead/quote/active jobs — nothing has been invoiced yet', () => {
    const jobs = [leadJob('j1', 500), activeJob('j2', 300)];
    expect(waitingToCollectTotal(jobs)).toBe(0);
  });

  it('returns 0 for an empty jobs list (never fabricates a figure)', () => {
    expect(waitingToCollectTotal([])).toBe(0);
  });
});

// ── jobsOn / jobsOnCount ─────────────────────────────────────────────────────

describe('jobsOn', () => {
  it('returns the actual On job objects (not just a count)', () => {
    const on1 = activeJob('j1', 100);
    const on2 = completeJob('j2', 200);
    const jobs = [on1, on2, leadJob('j3', 50)];
    expect(jobsOn(jobs)).toEqual([on1, on2]);
  });

  it('returns an empty array — never throws — for an empty jobs list', () => {
    expect(jobsOn([])).toEqual([]);
  });

  it('returns an empty array when no job is On', () => {
    const jobs = [invoiceSentJob('j1', 100), paidJobOn('j2', 200, 1), leadJob('j3', 50)];
    expect(jobsOn(jobs)).toEqual([]);
  });
});

describe('jobsOnCount', () => {
  it('counts active and complete-but-not-invoiced jobs as "On"', () => {
    const jobs = [activeJob('j1', 100), completeJob('j2', 200), leadJob('j3', 50)];
    expect(jobsOnCount(jobs)).toBe(2);
  });

  it('does not count invoiced/paid/lead jobs', () => {
    const jobs = [invoiceSentJob('j1', 100), paidJobOn('j2', 200, 1), leadJob('j3', 50)];
    expect(jobsOnCount(jobs)).toBe(0);
  });

  it('returns 0 for an empty jobs list', () => {
    expect(jobsOnCount([])).toBe(0);
  });

  it('stays in lockstep with jobsOn — count always equals jobsOn(jobs).length', () => {
    const jobs = [activeJob('j1', 100), completeJob('j2', 200), leadJob('j3', 50), invoiceSentJob('j4', 400)];
    expect(jobsOnCount(jobs)).toBe(jobsOn(jobs).length);
  });
});

// ── oldestOnJob ──────────────────────────────────────────────────────────────

describe('oldestOnJob', () => {
  it('picks the job with the oldest date/createdAt among a set of On jobs', () => {
    const now = Date.now();
    const newer = { id: 'newer', date: new Date(now - 2 * 86400000).toISOString() };
    const older = { id: 'older', date: new Date(now - 6 * 86400000).toISOString() };
    expect(oldestOnJob([newer, older])).toBe(older);
  });

  it('does NOT tiebreak on price — picks oldest even when a newer job is worth more', () => {
    const now = Date.now();
    const newerBigJob = { id: 'newer', total: 5000, date: new Date(now - 1 * 86400000).toISOString() };
    const olderUnpriced = { id: 'older', total: 0, date: new Date(now - 10 * 86400000).toISOString() };
    expect(oldestOnJob([newerBigJob, olderUnpriced])).toBe(olderUnpriced);
  });

  it('returns null for an empty array (never fabricates a job)', () => {
    expect(oldestOnJob([])).toBe(null);
  });
});

// ── daysOnCount / daysOnLabel ────────────────────────────────────────────────

describe('daysOnCount', () => {
  it('floors whole days elapsed since date/createdAt', () => {
    const now = new Date('2026-07-15T12:00:00Z');
    const job = { date: '2026-07-12T09:00:00Z' }; // 3 days + a few hours
    expect(daysOnCount(job, now)).toBe(3);
  });

  it('returns 0 for a job that started today', () => {
    const now = new Date('2026-07-15T12:00:00Z');
    const job = { date: '2026-07-15T08:00:00Z' };
    expect(daysOnCount(job, now)).toBe(0);
  });

  it('never returns a negative number even if the timestamp is in the future', () => {
    const now = new Date('2026-07-15T12:00:00Z');
    const job = { date: '2026-07-20T12:00:00Z' };
    expect(daysOnCount(job, now)).toBe(0);
  });

  it('returns 0 (not a huge number) when both date and createdAt are missing', () => {
    const now = new Date('2026-07-15T12:00:00Z');
    expect(daysOnCount({}, now)).toBe(0);
  });
});

describe('daysOnLabel', () => {
  const now = new Date('2026-07-15T12:00:00Z');

  it('reads "just started" at 0 days', () => {
    expect(daysOnLabel({ date: '2026-07-15T08:00:00Z' }, now)).toBe('just started');
  });

  it('reads "on 1 day" (singular) at exactly 1 day', () => {
    expect(daysOnLabel({ date: '2026-07-14T12:00:00Z' }, now)).toBe('on 1 day');
  });

  it('reads "on N days" (plural) beyond 1 day', () => {
    expect(daysOnLabel({ date: '2026-07-12T12:00:00Z' }, now)).toBe('on 3 days');
  });
});

// ── weekOverWeek ─────────────────────────────────────────────────────────────

describe('weekOverWeek', () => {
  it('hasComparison is false when there is no job in the prior 7-day window', () => {
    const now = new Date();
    const jobs = [paidJobOn('j1', 200, 1)]; // this week only
    const result = weekOverWeek(jobs, now);
    expect(result.hasComparison).toBe(false);
  });

  it('hasComparison is true and delta is correct when both weeks have paid jobs', () => {
    const now = new Date();
    const jobs = [
      paidJobOn('this1', 500, 1),   // this week
      paidJobOn('last1', 300, 9),   // last week
    ];
    const result = weekOverWeek(jobs, now);
    expect(result.hasComparison).toBe(true);
    expect(result.thisWeekTotal).toBe(500);
    expect(result.lastWeekTotal).toBe(300);
    expect(result.delta).toBe(200);
  });

  it('delta can be negative when this week is behind last week', () => {
    const now = new Date();
    const jobs = [
      paidJobOn('this1', 100, 1),
      paidJobOn('last1', 400, 9),
    ];
    const result = weekOverWeek(jobs, now);
    expect(result.hasComparison).toBe(true);
    expect(result.delta).toBe(-300);
  });

  it('unpaid jobs (paid:false) do not contribute to either week total', () => {
    const now = new Date();
    const unpaidThisWeek = { id: 'u1', amount: 900, total: 900, paid: false, date: new Date(now.getTime() - 86400000).toISOString() };
    const jobs = [unpaidThisWeek, paidJobOn('last1', 300, 9)];
    const result = weekOverWeek(jobs, now);
    expect(result.thisWeekTotal).toBe(0);
  });

  it('returns hasComparison:false and zero totals for an empty jobs list', () => {
    const result = weekOverWeek([], new Date());
    expect(result).toEqual({ thisWeekTotal: 0, lastWeekTotal: 0, delta: 0, hasComparison: false });
  });
});
