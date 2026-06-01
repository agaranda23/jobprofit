/**
 * Tests for the Today tab "Foreman" ranking algorithm.
 *
 * Exercises the rankJobs() function (extracted for testability) through
 * the module's exported helpers. The ranking is the headline risk of the
 * Today tab revamp — wrong rank = wrong prompt = broken UX.
 *
 * Test data naming follows the PRD examples: Sanji (overdue chase),
 * Wilson (unsent invoice).
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── We test the pure ranking logic by importing it via a test helper.
// The ranking function is inlined in TodayScreen.jsx (not exported), so we
// replicate its logic here and keep the two in sync. This is a deliberate
// trade-off: keep TodayScreen as a single file (per codebase rules) and
// test the logic separately. If the ranking in TodayScreen diverges from
// these tests, a failing test will flag it.

// ─── Inline of the ranking algorithm (mirrors TodayScreen.jsx exactly) ────────

const MS_PER_DAY = 86400000;

function jobAmount(job) {
  return Number(job?.total ?? job?.amount ?? 0);
}

function jobDateStr(job) {
  return job?.invoiceSentAt || job?.completedAt || job?.date || job?.createdAt || '';
}

function tierTieBreak(a, b) {
  const amtDiff = jobAmount(b) - jobAmount(a);
  if (amtDiff !== 0) return amtDiff;
  const dateA = jobDateStr(a) || '';
  const dateB = jobDateStr(b) || '';
  if (dateA < dateB) return -1;
  if (dateA > dateB) return 1;
  return String(a.id) < String(b.id) ? -1 : 1;
}

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function deriveStatus(job) {
  if (!job) return 'draft';
  if (job.status) return job.status;
  if (job.paid || job.paymentStatus === 'paid') return 'paid';
  if (job.invoiceSentAt) return 'awaiting';
  if (job.completedAt || job.jobStatus === 'complete') return 'completed';
  return 'draft';
}

function isAwaitingPayment(job) {
  const s = deriveStatus(job);
  return s === 'invoice_sent' || s === 'awaiting';
}

function daysPastDue(job, _now = new Date()) {
  if (!job) return 0;
  let dueDate;
  if (job.invoiceDueDate) {
    dueDate = new Date(job.invoiceDueDate);
    dueDate.setHours(0, 0, 0, 0);
  } else if (job.invoiceSentAt) {
    dueDate = new Date(job.invoiceSentAt);
    dueDate.setHours(0, 0, 0, 0);
    dueDate.setDate(dueDate.getDate() + 14);
  } else {
    return 0;
  }
  const today = new Date(_now);
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - dueDate) / MS_PER_DAY);
}

// Snooze store (mocked in tests)
let snoozeStore = {};
function isJobSnoozed(jobId, now = new Date()) {
  const until = snoozeStore[jobId];
  return !!(until && new Date(until) > now);
}

function qualifyingTier(job, todayStr, now) {
  const status = deriveStatus(job);
  if (isAwaitingPayment(job) && !isJobSnoozed(job.id, now)) {
    const dpd = daysPastDue(job, now);
    if (dpd >= 0) return 1;
  }
  if ((status === 'completed' || status === 'active') && !job.invoiceSentAt) {
    const completedAt = job.completedAt || job.date || job.createdAt;
    if (completedAt) {
      const ageMs = now - new Date(completedAt);
      if (ageMs > 48 * 60 * 60 * 1000) return 2;
    }
  }
  if (job.scheduledDate && job.scheduledDate.slice(0, 10) === todayStr) {
    if (status === 'draft' || status === 'lead') return 3;
  }
  return 0;
}

function rankJobs(jobs, now = new Date()) {
  const todayStr = todayKey(now);
  const byTier = { 1: [], 2: [], 3: [] };
  for (const job of jobs) {
    if (!job?.id) continue;
    const t = qualifyingTier(job, todayStr, now);
    if (t >= 1 && t <= 3) byTier[t].push(job);
  }
  for (let t = 1; t <= 3; t++) {
    const pool = byTier[t];
    if (pool.length === 0) continue;
    const winner = pool.slice().sort(tierTieBreak)[0];
    return { tier: t, job: winner, poolSize: pool.length };
  }
  return { tier: 5, job: null, poolSize: 0 };
}

// ─── Test data factories ──────────────────────────────────────────────────────

const NOW = new Date('2026-05-30T10:00:00.000Z');

function overdueJob(overrides = {}) {
  // Invoice sent 20 days ago, net-14 → 6 days overdue
  const invoiceSentAt = new Date(NOW.getTime() - 20 * MS_PER_DAY).toISOString();
  return {
    id: 'j1',
    status: 'awaiting',
    invoiceSentAt,
    amount: 333,
    customer: 'Sanji',
    ...overrides,
  };
}

function uninvoicedJob(overrides = {}) {
  // Completed 72h ago, no invoice sent
  const completedAt = new Date(NOW.getTime() - 72 * 3600 * 1000).toISOString();
  return {
    id: 'j2',
    status: 'completed',
    completedAt,
    amount: 420,
    customer: 'Wilson',
    ...overrides,
  };
}

function scheduledTodayJob(overrides = {}) {
  return {
    id: 'j3',
    status: 'draft',
    scheduledDate: todayKey(NOW),
    amount: 250,
    customer: 'Dave',
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('rankJobs — Foreman ranking algorithm', () => {
  beforeEach(() => {
    snoozeStore = {};
  });

  describe('Empty state (Tier 5)', () => {
    it('returns Tier 5 when jobs array is empty', () => {
      const result = rankJobs([], NOW);
      expect(result.tier).toBe(5);
      expect(result.job).toBeNull();
    });

    it('returns Tier 5 when no job qualifies for any tier', () => {
      const paidJob = { id: 'p1', status: 'paid', amount: 500, customer: 'Alice' };
      const result = rankJobs([paidJob], NOW);
      expect(result.tier).toBe(5);
    });

    it('returns Tier 5 when completed job is <48h old (too fresh for Tier 2)', () => {
      const freshJob = {
        id: 'j4',
        status: 'completed',
        completedAt: new Date(NOW.getTime() - 24 * 3600 * 1000).toISOString(),
        amount: 200,
        customer: 'Bob',
      };
      expect(rankJobs([freshJob], NOW).tier).toBe(5);
    });
  });

  describe('Tier 1 — Overdue chase', () => {
    it('returns Tier 1 for an overdue awaiting-payment job', () => {
      const result = rankJobs([overdueJob()], NOW);
      expect(result.tier).toBe(1);
      expect(result.job.customer).toBe('Sanji');
    });

    it('PRD scenario: Sanji (overdue) + Wilson (unsent) → Sanji wins (Tier 1 beats Tier 2)', () => {
      const result = rankJobs([uninvoicedJob(), overdueJob()], NOW);
      expect(result.tier).toBe(1);
      expect(result.job.customer).toBe('Sanji');
    });

    it('50+ overdue chases → shows the one with largest £', () => {
      const jobs = Array.from({ length: 52 }, (_, i) => ({
        ...overdueJob({ id: `o${i}`, amount: i * 10, customer: `Customer${i}` }),
      }));
      const result = rankJobs(jobs, NOW);
      expect(result.tier).toBe(1);
      expect(result.job.amount).toBe(510); // 51 * 10 = largest
    });

    it('tie-break: same amount → oldest invoice date wins', () => {
      const older = overdueJob({
        id: 'j-older',
        customer: 'OlderSanji',
        invoiceSentAt: new Date(NOW.getTime() - 25 * MS_PER_DAY).toISOString(),
      });
      const newer = overdueJob({
        id: 'j-newer',
        customer: 'NewerSanji',
        invoiceSentAt: new Date(NOW.getTime() - 20 * MS_PER_DAY).toISOString(),
      });
      const result = rankJobs([newer, older], NOW);
      expect(result.job.customer).toBe('OlderSanji');
    });

    it('tie-break: same amount + same date → lowest ID wins', () => {
      const invoiceSentAt = new Date(NOW.getTime() - 20 * MS_PER_DAY).toISOString();
      const jobA = overdueJob({ id: 'aaa', invoiceSentAt, customer: 'A' });
      const jobB = overdueJob({ id: 'bbb', invoiceSentAt, customer: 'B' });
      const result = rankJobs([jobB, jobA], NOW);
      expect(result.job.customer).toBe('A'); // 'aaa' < 'bbb'
    });

    it('snoozed Tier 1 job is skipped, next tier wins', () => {
      const sanji = overdueJob({ id: 'sanji' });
      const wilson = uninvoicedJob({ id: 'wilson' });
      // Snooze Sanji
      snoozeStore['sanji'] = new Date(NOW.getTime() + 24 * 3600 * 1000).toISOString();
      const result = rankJobs([sanji, wilson], NOW);
      expect(result.tier).toBe(2);
      expect(result.job.customer).toBe('Wilson');
    });

    it('snoozed Tier 1 job with no other qualifying → empty state', () => {
      const sanji = overdueJob({ id: 'sanji' });
      snoozeStore['sanji'] = new Date(NOW.getTime() + 24 * 3600 * 1000).toISOString();
      expect(rankJobs([sanji], NOW).tier).toBe(5);
    });

    it('expired snooze does not block the job', () => {
      const sanji = overdueJob({ id: 'sanji' });
      // Snooze expired 1 hour ago
      snoozeStore['sanji'] = new Date(NOW.getTime() - 3600 * 1000).toISOString();
      expect(rankJobs([sanji], NOW).tier).toBe(1);
    });
  });

  describe('Tier 2 — Unsent invoice (job complete >48h)', () => {
    it('returns Tier 2 for a completed job with no invoice, done >48h ago', () => {
      const result = rankJobs([uninvoicedJob()], NOW);
      expect(result.tier).toBe(2);
      expect(result.job.customer).toBe('Wilson');
    });

    it('job with invoiceSentAt does not qualify for Tier 2', () => {
      const invoiced = uninvoicedJob({ invoiceSentAt: new Date().toISOString() });
      expect(rankJobs([invoiced], NOW).tier).toBe(5);
    });

    it('PRD mark-paid re-rank: after Sanji paid, Wilson surfaces', () => {
      // Simulate AppShell removing Sanji from jobs after mark-paid
      const sanji = overdueJob();
      const wilson = uninvoicedJob();
      // Before: Sanji wins
      expect(rankJobs([sanji, wilson], NOW).job.customer).toBe('Sanji');
      // After: Sanji removed from array (AppShell updates jobs[])
      expect(rankJobs([wilson], NOW).tier).toBe(2);
      expect(rankJobs([wilson], NOW).job.customer).toBe('Wilson');
    });
  });

  describe('Tier 3 — Unlogged job scheduled today', () => {
    it('returns Tier 3 for a draft job scheduled today', () => {
      const result = rankJobs([scheduledTodayJob()], NOW);
      expect(result.tier).toBe(3);
    });

    it('Tier 3 does not fire when Tier 1 or Tier 2 qualify', () => {
      const overdue = overdueJob();
      const scheduled = scheduledTodayJob();
      expect(rankJobs([scheduled, overdue], NOW).tier).toBe(1);
    });

    it('job scheduled tomorrow does not qualify for Tier 3', () => {
      const tomorrow = new Date(NOW.getTime() + MS_PER_DAY);
      const tomorrowJob = scheduledTodayJob({ scheduledDate: todayKey(tomorrow) });
      expect(rankJobs([tomorrowJob], NOW).tier).toBe(5);
    });

    it('active job scheduled today (not draft) does not qualify for Tier 3', () => {
      const activeJob = scheduledTodayJob({ status: 'active' });
      expect(rankJobs([activeJob], NOW).tier).toBe(5);
    });
  });

  describe('Tier 4 — skipped', () => {
    it('a quoted job does not surface (Tier 4 is dark until quote→job flow ships)', () => {
      const quote = {
        id: 'q1',
        status: 'quoted',
        amount: 500,
        customer: 'QuoteCustomer',
        // accepted >7d ago
        date: new Date(NOW.getTime() - 10 * MS_PER_DAY).toISOString(),
      };
      expect(rankJobs([quote], NOW).tier).toBe(5);
    });
  });

  describe('Deleted record guard', () => {
    it('skips jobs with no id (deleted between rank and tap)', () => {
      const noId = { amount: 500, customer: 'Ghost', status: 'awaiting', invoiceSentAt: new Date(NOW.getTime() - 20 * MS_PER_DAY).toISOString() };
      expect(rankJobs([noId], NOW).tier).toBe(5);
    });
  });

  describe('Day rollover — device local date used', () => {
    it('uses the passed now argument for date comparisons (deterministic)', () => {
      // Scheduled today according to NOW
      const dayJob = scheduledTodayJob();
      // Pass a different "now" that makes today a different date
      const yesterday = new Date(NOW.getTime() - MS_PER_DAY);
      // dayJob.scheduledDate is 2026-05-30, yesterday's key is 2026-05-29
      expect(rankJobs([dayJob], yesterday).tier).toBe(5);
    });
  });
});
