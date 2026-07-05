import { describe, it, expect } from 'vitest';
import { waitingToCollectTotal, jobsOnCount, weekOverWeek } from '../todayPulse';

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

// ── jobsOnCount ────────────────────────────────────────────────────────────────

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
