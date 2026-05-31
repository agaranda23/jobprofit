/**
 * Tests for nextBestAction.js — pure ranking helper for the Today hero card.
 *
 * All injected functions (isAwaitingFn, daysPastDueFn, deriveStatusFn) mirror
 * the real implementations from jobStatus.js / chaseLadder.js so the tests
 * cover real business logic, not stubs.
 */

import { describe, it, expect } from 'vitest';
import {
  isOverdueChase,
  isUnbilledComplete,
  isStaleSentQuote,
  qualifyingTier,
  rankNextBestAction,
  tierTieBreak,
  jobAmount,
  nbaLabel,
  nbaHeadline,
  nbaMeta,
  nbaCta,
} from '../nextBestAction.js';

// ── Minimal real implementations (no mocking for core logic) ──────────────────

const MS_PER_DAY = 86400000;
const NOW = new Date('2026-05-31T10:00:00.000Z');
const EMPTY_SNOOZE = {};

function deriveStatus(job) {
  if (!job) return 'draft';
  if (job.status) return job.status;
  if (job.paid || job.paymentStatus === 'paid') return 'paid';
  if (job.invoiceSentAt) return 'awaiting';
  if (job.completedAt || job.jobStatus === 'complete') return 'completed';
  return 'draft';
}

function isAwaiting(job) {
  const s = deriveStatus(job);
  return s === 'invoice_sent' || s === 'awaiting';
}

function daysPastDue(job, now = new Date()) {
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
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - dueDate) / MS_PER_DAY);
}

// ── Job factories ─────────────────────────────────────────────────────────────

function overdueJob(overrides = {}) {
  return {
    id: 'j-overdue',
    status: 'awaiting',
    invoiceSentAt: new Date(NOW.getTime() - 20 * MS_PER_DAY).toISOString(),
    amount: 400,
    customer: 'Sanji',
    ...overrides,
  };
}

function uninvoicedJob(overrides = {}) {
  return {
    id: 'j-uninvoiced',
    status: 'completed',
    completedAt: new Date(NOW.getTime() - 72 * 3600 * 1000).toISOString(),
    amount: 350,
    customer: 'Wilson',
    ...overrides,
  };
}

function staleSentQuoteJob(overrides = {}) {
  return {
    id: 'j-stale-quote',
    status: 'quoted',
    quoteSentAt: new Date(NOW.getTime() - 5 * MS_PER_DAY).toISOString(),
    amount: 800,
    customer: 'Dave',
    ...overrides,
  };
}

function rank(jobs, snoozeStore = EMPTY_SNOOZE) {
  return rankNextBestAction(jobs, NOW, snoozeStore, isAwaiting, daysPastDue, deriveStatus);
}

// ── jobAmount ─────────────────────────────────────────────────────────────────

describe('jobAmount', () => {
  it('reads amount field', () => expect(jobAmount({ amount: 100 })).toBe(100));
  it('prefers total over amount', () => expect(jobAmount({ total: 200, amount: 100 })).toBe(200));
  it('returns 0 for missing fields', () => expect(jobAmount({})).toBe(0));
  it('returns 0 for null job', () => expect(jobAmount(null)).toBe(0));
});

// ── tierTieBreak ──────────────────────────────────────────────────────────────

describe('tierTieBreak', () => {
  it('sorts larger amount first', () => {
    const a = { id: 'a', amount: 100 };
    const b = { id: 'b', amount: 200 };
    expect([a, b].sort(tierTieBreak)[0]).toBe(b);
  });

  it('same amount — older date wins (smaller date string = older)', () => {
    const older = { id: 'older', amount: 100, invoiceSentAt: '2026-05-01T00:00:00Z' };
    const newer = { id: 'newer', amount: 100, invoiceSentAt: '2026-05-20T00:00:00Z' };
    expect([newer, older].sort(tierTieBreak)[0]).toBe(older);
  });

  it('same amount + same date — lowest ID wins', () => {
    const date = '2026-05-01T00:00:00Z';
    const a = { id: 'aaa', amount: 100, invoiceSentAt: date };
    const b = { id: 'bbb', amount: 100, invoiceSentAt: date };
    expect([b, a].sort(tierTieBreak)[0]).toBe(a);
  });
});

// ── isOverdueChase (Tier 1) ───────────────────────────────────────────────────

describe('isOverdueChase — Tier 1', () => {
  it('true for overdue awaiting job', () => {
    expect(isOverdueChase(overdueJob(), NOW, EMPTY_SNOOZE, isAwaiting, daysPastDue)).toBe(true);
  });

  it('false for snoozed job', () => {
    const snoozed = { 'j-overdue': new Date(NOW.getTime() + MS_PER_DAY).toISOString() };
    expect(isOverdueChase(overdueJob(), NOW, snoozed, isAwaiting, daysPastDue)).toBe(false);
  });

  it('false for draft job', () => {
    const draft = { id: 'x', status: 'draft', amount: 200 };
    expect(isOverdueChase(draft, NOW, EMPTY_SNOOZE, isAwaiting, daysPastDue)).toBe(false);
  });

  it('true for invoice due exactly today (0 days past due)', () => {
    const dueToday = overdueJob({
      invoiceSentAt: new Date(NOW.getTime() - 14 * MS_PER_DAY).toISOString(),
    });
    expect(isOverdueChase(dueToday, NOW, EMPTY_SNOOZE, isAwaiting, daysPastDue)).toBe(true);
  });

  it('false when invoice not yet due (13 days since sent = 1 day before due)', () => {
    const notDueYet = overdueJob({
      invoiceSentAt: new Date(NOW.getTime() - 13 * MS_PER_DAY).toISOString(),
    });
    expect(isOverdueChase(notDueYet, NOW, EMPTY_SNOOZE, isAwaiting, daysPastDue)).toBe(false);
  });
});

// ── isUnbilledComplete (Tier 2) ───────────────────────────────────────────────

describe('isUnbilledComplete — Tier 2', () => {
  it('true for completed job >48h ago, no invoice', () => {
    expect(isUnbilledComplete(uninvoicedJob(), NOW, deriveStatus)).toBe(true);
  });

  it('false for completed job <48h ago (grace period)', () => {
    const fresh = uninvoicedJob({
      completedAt: new Date(NOW.getTime() - 24 * 3600 * 1000).toISOString(),
    });
    expect(isUnbilledComplete(fresh, NOW, deriveStatus)).toBe(false);
  });

  it('false when invoice has already been sent', () => {
    const invoiced = uninvoicedJob({ invoiceSentAt: NOW.toISOString() });
    expect(isUnbilledComplete(invoiced, NOW, deriveStatus)).toBe(false);
  });

  it('false for paid job', () => {
    const paid = { id: 'x', status: 'paid', completedAt: new Date(NOW.getTime() - 72 * 3600000).toISOString() };
    expect(isUnbilledComplete(paid, NOW, deriveStatus)).toBe(false);
  });

  it('true for active-status job >48h ago (old stage model compat)', () => {
    const active = uninvoicedJob({ status: 'active' });
    expect(isUnbilledComplete(active, NOW, deriveStatus)).toBe(true);
  });
});

// ── isStaleSentQuote (Tier 3) ─────────────────────────────────────────────────

describe('isStaleSentQuote — Tier 3', () => {
  it('true for quoted job with quoteSentAt ≥3 days ago', () => {
    expect(isStaleSentQuote(staleSentQuoteJob(), NOW, deriveStatus)).toBe(true);
  });

  it('false when quote sent <3 days ago (not yet stale)', () => {
    const fresh = staleSentQuoteJob({
      quoteSentAt: new Date(NOW.getTime() - 2 * MS_PER_DAY).toISOString(),
    });
    expect(isStaleSentQuote(fresh, NOW, deriveStatus)).toBe(false);
  });

  it('false when status is not quoted', () => {
    const lead = staleSentQuoteJob({ status: 'lead' });
    expect(isStaleSentQuote(lead, NOW, deriveStatus)).toBe(false);
  });

  it('false when quoteSentAt is missing (draft quote)', () => {
    const noSentAt = staleSentQuoteJob({ quoteSentAt: undefined });
    expect(isStaleSentQuote(noSentAt, NOW, deriveStatus)).toBe(false);
  });

  it('false when quote has been accepted (quoteStatus=accepted)', () => {
    const accepted = staleSentQuoteJob({ quoteStatus: 'accepted' });
    expect(isStaleSentQuote(accepted, NOW, deriveStatus)).toBe(false);
  });

  it('false when quote has acceptedAt set (customer signed)', () => {
    const signed = staleSentQuoteJob({ acceptedAt: NOW.toISOString() });
    expect(isStaleSentQuote(signed, NOW, deriveStatus)).toBe(false);
  });
});

// ── rankNextBestAction — tier priority ────────────────────────────────────────

describe('rankNextBestAction — tier priority', () => {
  it('empty jobs → Tier 5 all-clear', () => {
    expect(rank([]).tier).toBe(5);
    expect(rank([]).job).toBeNull();
  });

  it('Tier 1 beats Tier 2 beats Tier 3', () => {
    const jobs = [staleSentQuoteJob(), uninvoicedJob(), overdueJob()];
    const result = rank(jobs);
    expect(result.tier).toBe(1);
    expect(result.job.customer).toBe('Sanji');
  });

  it('Tier 2 wins when no Tier 1 qualifiers', () => {
    expect(rank([uninvoicedJob(), staleSentQuoteJob()]).tier).toBe(2);
  });

  it('Tier 3 wins when only stale quote qualifies', () => {
    const result = rank([staleSentQuoteJob()]);
    expect(result.tier).toBe(3);
    expect(result.job.customer).toBe('Dave');
  });

  it('Tier 5 when only paid jobs', () => {
    const paid = { id: 'p1', status: 'paid', amount: 500 };
    expect(rank([paid]).tier).toBe(5);
  });

  it('snoozed Tier 1 → Tier 2 surfaces', () => {
    const overdue = overdueJob({ id: 'sanji' });
    const uninvoiced = uninvoicedJob();
    const snoozed = { sanji: new Date(NOW.getTime() + MS_PER_DAY).toISOString() };
    expect(rank([overdue, uninvoiced], snoozed).tier).toBe(2);
  });

  it('all-clear when all qualifying jobs are snoozed', () => {
    const overdue = overdueJob({ id: 'sanji' });
    const snoozed = { sanji: new Date(NOW.getTime() + MS_PER_DAY).toISOString() };
    expect(rank([overdue], snoozed).tier).toBe(5);
  });

  it('poolSize reflects how many qualify at winning tier', () => {
    const jobs = [overdueJob({ id: 'a' }), overdueJob({ id: 'b', amount: 200 })];
    const result = rank(jobs);
    expect(result.tier).toBe(1);
    expect(result.poolSize).toBe(2);
  });

  it('skips jobs with no id', () => {
    const ghost = { amount: 500, status: 'awaiting', invoiceSentAt: new Date(NOW.getTime() - 20 * MS_PER_DAY).toISOString() };
    expect(rank([ghost]).tier).toBe(5);
  });

  it('largest-£ wins tie-break at Tier 1', () => {
    const small = overdueJob({ id: 'a', amount: 100 });
    const large = overdueJob({ id: 'b', amount: 900 });
    expect(rank([small, large]).job.id).toBe('b');
  });
});

// ── Copy builders ─────────────────────────────────────────────────────────────

describe('nbaLabel', () => {
  it('returns CHASE for tier 1', () => expect(nbaLabel(1)).toBe('CHASE'));
  it('returns INVOICE for tier 2', () => expect(nbaLabel(2)).toBe('INVOICE'));
  it('returns FOLLOW UP for tier 3', () => expect(nbaLabel(3)).toBe('FOLLOW UP'));
  it('returns empty string for tier 5', () => expect(nbaLabel(5)).toBe(''));
});

describe('nbaHeadline', () => {
  it('Tier 1 — uses first name', () => {
    expect(nbaHeadline(1, { customer: 'Dave Smith' })).toBe('Chase Dave.');
  });
  it('Tier 2 — uses first name', () => {
    expect(nbaHeadline(2, { customer: 'Alice Cooper' })).toBe('Invoice Alice.');
  });
  it('Tier 3 — uses first name', () => {
    expect(nbaHeadline(3, { customer: 'Bob Jones' })).toBe("Follow up: Bob's quote.");
  });
  it('falls back gracefully when no customer name', () => {
    expect(nbaHeadline(1, {})).toBe('Chase for payment.');
    expect(nbaHeadline(2, {})).toBe('Send the invoice.');
    expect(nbaHeadline(3, {})).toBe('Follow up on your quote.');
  });
});

describe('nbaMeta', () => {
  it('Tier 2 shows correct hours-ago suffix', () => {
    const job = uninvoicedJob(); // 72h ago
    const result = nbaMeta(2, job, NOW);
    expect(result.suffix).toBe('done 3d ago');
    expect(result.negative).toBe(false);
  });

  it('Tier 3 shows days-since-sent suffix', () => {
    const job = staleSentQuoteJob(); // 5 days ago
    const result = nbaMeta(3, job, NOW);
    expect(result.suffix).toBe('sent 5 days ago');
    expect(result.negative).toBe(false);
  });

  it('Tier 3 singular day', () => {
    const job = staleSentQuoteJob({ quoteSentAt: new Date(NOW.getTime() - 1 * MS_PER_DAY).toISOString() });
    const result = nbaMeta(3, job, NOW);
    expect(result.suffix).toBe('sent 1 day ago');
  });

  it('Tier 3 shows fallback when no quoteSentAt', () => {
    const job = staleSentQuoteJob({ quoteSentAt: undefined });
    const result = nbaMeta(3, job, NOW);
    expect(result.suffix).toBe('awaiting reply');
  });
});

describe('nbaCta', () => {
  it('Tier 1 with phone → WhatsApp', () => {
    const job = { customerPhone: '07700900000', ...overdueJob() };
    expect(nbaCta(1, job).action).toBe('whatsapp');
  });

  it('Tier 1 with email only → email chase', () => {
    const job = { customerEmail: 'a@b.com', phone: '', ...overdueJob() };
    expect(nbaCta(1, job).action).toBe('email');
  });

  it('Tier 1 with no contact → open job', () => {
    const job = overdueJob({ customerPhone: '', phone: '', customerEmail: '', email: '' });
    expect(nbaCta(1, job).action).toBe('open');
  });

  it('Tier 2 → send invoice', () => {
    expect(nbaCta(2, uninvoicedJob()).action).toBe('send_invoice');
  });

  it('Tier 3 → open quote', () => {
    expect(nbaCta(3, staleSentQuoteJob()).action).toBe('open');
  });
});
