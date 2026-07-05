import { describe, it, expect } from 'vitest';
import {
  normaliseCustomerName,
  groupByCustomer,
  getCustomerJobs,
  buildTimeline,
  bucketEvents,
  computeLifetime,
} from '../customerTimeline.js';

// ── normaliseCustomerName ────────────────────────────────────────────────
describe('normaliseCustomerName', () => {
  it('trims and lowercases', () => {
    expect(normaliseCustomerName('  Sarah Jones  ')).toBe('sarah jones');
  });
  it('returns empty string for null/undefined/empty', () => {
    expect(normaliseCustomerName(null)).toBe('');
    expect(normaliseCustomerName(undefined)).toBe('');
    expect(normaliseCustomerName('')).toBe('');
    expect(normaliseCustomerName('   ')).toBe('');
  });
});

// ── groupByCustomer ───────────────────────────────────────────────────────
describe('groupByCustomer', () => {
  it('buckets jobs by normalised customer name', () => {
    const jobs = [
      { id: '1', customer: 'Sarah Jones' },
      { id: '2', customer: 'sarah jones' }, // same person, different case
      { id: '3', customer: 'Bob Smith' },
    ];
    const buckets = groupByCustomer(jobs);
    expect(Object.keys(buckets)).toEqual(['sarah jones', 'bob smith']);
    expect(buckets['sarah jones'].map(j => j.id)).toEqual(['1', '2']);
    expect(buckets['bob smith'].map(j => j.id)).toEqual(['3']);
  });

  it('skips jobs with null/empty/whitespace-only customer name', () => {
    const jobs = [
      { id: '1', customer: null },
      { id: '2', customer: '' },
      { id: '3', customer: '   ' },
      { id: '4', customer: 'Real Customer' },
    ];
    const buckets = groupByCustomer(jobs);
    expect(Object.keys(buckets)).toEqual(['real customer']);
    expect(buckets['real customer'].map(j => j.id)).toEqual(['4']);
  });

  it('returns {} for empty/undefined input', () => {
    expect(groupByCustomer([])).toEqual({});
    expect(groupByCustomer(undefined)).toEqual({});
  });
});

// ── getCustomerJobs ───────────────────────────────────────────────────────
describe('getCustomerJobs', () => {
  it('returns every job sharing the same normalised customer name, job included', () => {
    const jobA = { id: '1', customer: 'Sarah Jones' };
    const jobB = { id: '2', customer: 'Sarah Jones' };
    const jobC = { id: '3', customer: 'Bob Smith' };
    expect(getCustomerJobs(jobA, [jobA, jobB, jobC]).map(j => j.id)).toEqual(['1', '2']);
  });

  it('returns just [job] when job has no customer name', () => {
    const job = { id: '1', customer: '' };
    expect(getCustomerJobs(job, [job, { id: '2', customer: 'Bob' }])).toEqual([job]);
  });

  it('returns [] when job is falsy', () => {
    expect(getCustomerJobs(null, [{ id: '1', customer: 'Bob' }])).toEqual([]);
  });
});

// ── buildTimeline ─────────────────────────────────────────────────────────
describe('buildTimeline', () => {
  it('emits an event for every slice-1 field present on the job', () => {
    const job = {
      id: 'j1',
      customer: 'Sarah Jones',
      summary: 'Bathroom refit',
      total: 2250,
      createdAt: '2026-06-01T09:00:00Z',
      quoteSentAt: '2026-06-02T10:00:00Z',
      quoteLinkOpenedAt: '2026-06-02T11:00:00Z',
      acceptedAt: '2026-06-03T12:00:00Z',
      invoiceSentAt: '2026-06-10T09:00:00Z',
      paidAt: '2026-06-15T09:00:00Z',
      payments: [
        { date: '2026-06-14', amount: 500, method: 'bank', type: 'deposit' },
      ],
      jobNotes: [
        { id: 'n1', subject: 'Access', body: 'Key under the mat', date: '2026-06-05T08:00:00Z' },
      ],
    };
    const events = buildTimeline([job], []);
    const types = events.map(e => e.type);

    expect(types).toEqual(
      expect.arrayContaining([
        'created', 'quote_sent', 'quote_opened', 'accepted',
        'invoice_sent', 'payment', 'paid_in_full', 'note',
      ])
    );
    expect(events.length).toBe(8);

    const quoteSent = events.find(e => e.type === 'quote_sent');
    expect(quoteSent.summary).toBe('Quote sent — £2,250');

    const opened = events.find(e => e.type === 'quote_opened');
    expect(opened.summary).toBe('Sarah opened your quote');

    const payment = events.find(e => e.type === 'payment');
    expect(payment.summary).toBe('Paid £500 deposit — bank transfer');

    const note = events.find(e => e.type === 'note');
    expect(note.summary).toBe('Note: "Access"');

    const paidInFull = events.find(e => e.type === 'paid_in_full');
    expect(paidInFull.summary).toBe('Paid in full — £2,250');
  });

  it('matches receipts by job.id OR job.cloudId and emits a receipt event', () => {
    const job = { id: 'local-1', cloudId: 'cloud-abc', customer: 'Bob', createdAt: '2026-06-01' };
    const receipts = [
      { jobId: 'cloud-abc', label: 'Screwfix', amount: 42.5, date: '2026-06-02' },
      { jobId: 'someone-else', label: 'Wrong job', amount: 10, date: '2026-06-02' },
    ];
    const events = buildTimeline([job], receipts);
    const receiptEvents = events.filter(e => e.type === 'receipt');
    expect(receiptEvents.length).toBe(1);
    expect(receiptEvents[0].summary).toBe('Receipt added — Screwfix £42.50');
  });

  it('sorts events descending by timestamp (newest first)', () => {
    const job = {
      id: 'j1', customer: 'Bob',
      createdAt: '2026-06-01T09:00:00Z',
      quoteSentAt: '2026-06-05T09:00:00Z',
      acceptedAt: '2026-06-03T09:00:00Z',
    };
    const events = buildTimeline([job], []);
    const tsList = events.map(e => e.ts);
    const sorted = [...tsList].sort((a, b) => b - a);
    expect(tsList).toEqual(sorted);
    expect(events[0].type).toBe('quote_sent'); // latest ts
  });

  it('adds a quiet job-name sub-label only when the customer has multiple jobs', () => {
    const jobA = { id: '1', customer: 'Sarah', summary: 'Bathroom refit', createdAt: '2026-06-01' };
    const jobB = { id: '2', customer: 'Sarah', summary: 'Kitchen tap', createdAt: '2026-06-02' };

    const singleJobEvents = buildTimeline([jobA], []);
    expect(singleJobEvents.every(e => e.sub === '')).toBe(true);

    const multiJobEvents = buildTimeline([jobA, jobB], []);
    expect(multiJobEvents.find(e => e.jobId === '1').sub).toBe('Bathroom refit');
    expect(multiJobEvents.find(e => e.jobId === '2').sub).toBe('Kitchen tap');
  });

  it('emits nothing for a job with none of the slice-1 fields set', () => {
    const job = { id: 'j1', customer: 'Bob' }; // no createdAt even
    expect(buildTimeline([job], [])).toEqual([]);
  });
});

// ── buildTimeline — Capture Layer Slice A (commsLog) ───────────────────────
describe('buildTimeline — commsLog events', () => {
  const baseJob = { id: 'j1', customer: 'Dave Smith' };

  it('renders a call event with the exact soft-true copy', () => {
    const job = { ...baseJob, commsLog: [{ id: 'C-1', type: 'call', date: '2026-07-01T09:00:00Z' }] };
    const events = buildTimeline([job], []);
    const ev = events.find(e => e.type === 'call');
    expect(ev.summary).toBe('Called Dave');
    expect(ev.icon).toBe('phone');
    expect(ev.commsId).toBe('C-1');
  });

  it('renders a whatsapp event with the exact copy', () => {
    const job = { ...baseJob, commsLog: [{ id: 'C-2', type: 'whatsapp', date: '2026-07-01T09:00:00Z' }] };
    const events = buildTimeline([job], []);
    const ev = events.find(e => e.type === 'whatsapp');
    expect(ev.summary).toBe('Messaged Dave on WhatsApp');
    expect(ev.icon).toBe('whatsapp');
  });

  it('renders an sms event with the exact copy', () => {
    const job = { ...baseJob, commsLog: [{ id: 'C-3', type: 'sms', date: '2026-07-01T09:00:00Z' }] };
    const events = buildTimeline([job], []);
    const ev = events.find(e => e.type === 'sms');
    expect(ev.summary).toBe('Texted Dave');
    expect(ev.icon).toBe('text');
  });

  it('renders a review event with the exact copy', () => {
    const job = { ...baseJob, commsLog: [{ id: 'C-4', type: 'review', date: '2026-07-01T09:00:00Z' }] };
    const events = buildTimeline([job], []);
    const ev = events.find(e => e.type === 'review');
    expect(ev.summary).toBe('Asked Dave for a review');
    expect(ev.icon).toBe('review');
  });

  it('falls back to "them" when the job has no customer name', () => {
    const job = { id: 'j1', customer: '', commsLog: [{ id: 'C-1', type: 'call', date: '2026-07-01T09:00:00Z' }] };
    const events = buildTimeline([job], []);
    expect(events.find(e => e.type === 'call').summary).toBe('Called them');
  });

  it('skips an unknown/future commsLog type defensively', () => {
    const job = { ...baseJob, commsLog: [{ id: 'C-9', type: 'carrier-pigeon', date: '2026-07-01T09:00:00Z' }] };
    expect(buildTimeline([job], [])).toEqual([]);
  });

  it('skips a commsLog entry with no date', () => {
    const job = { ...baseJob, commsLog: [{ id: 'C-1', type: 'call' }] };
    expect(buildTimeline([job], [])).toEqual([]);
  });
});

// ── bucketEvents ──────────────────────────────────────────────────────────
describe('bucketEvents', () => {
  // Fixed "now" (late in the month, so a "this month, >6 days ago" bucket
  // exists without spilling into the previous calendar month).
  const NOW = new Date('2026-07-20T15:00:00');

  function ev(ts) {
    return { ts: new Date(ts).getTime(), type: 'note', icon: 'note', summary: 'x' };
  }

  it('buckets into Today / This week / This month / {Month} / {Year} in order', () => {
    const events = [
      ev('2026-07-20T09:00:00'), // today
      ev('2026-07-16T09:00:00'), // this week (4 days ago)
      ev('2026-07-05T09:00:00'), // this month (15 days ago, same month)
      ev('2026-05-15T09:00:00'), // May (same year, different month)
      ev('2025-01-01T09:00:00'), // 2025 (different year)
    ];
    const groups = bucketEvents(events, NOW);
    expect(groups.map(g => g.label)).toEqual(['Today', 'This week', 'This month', 'May', '2025']);
    groups.forEach(g => expect(g.events.length).toBe(1));
  });

  it('groups multiple same-day events under one Today header', () => {
    const events = [ev('2026-07-20T09:00:00'), ev('2026-07-20T14:00:00')];
    const groups = bucketEvents(events, NOW);
    expect(groups.length).toBe(1);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].events.length).toBe(2);
  });
});

// ── computeLifetime ───────────────────────────────────────────────────────
describe('computeLifetime', () => {
  it('sums billed (total||amount) and paid (payments) across all jobs, clamps owed at 0', () => {
    const jobs = [
      { id: '1', total: 1000, payments: [{ amount: 400 }] },
      { id: '2', amount: 500, payments: [{ amount: 500 }] }, // fully paid via `amount` fallback
    ];
    const result = computeLifetime(jobs);
    expect(result.billed).toBe(1500);
    expect(result.paid).toBe(900);
    expect(result.owed).toBe(600);
    expect(result.jobCount).toBe(2);
  });

  it('clamps owed at 0 when overpaid', () => {
    const jobs = [{ id: '1', total: 100, payments: [{ amount: 150 }] }];
    const result = computeLifetime(jobs);
    expect(result.owed).toBe(0);
  });

  it('returns zeros for an empty job list', () => {
    expect(computeLifetime([])).toEqual({ billed: 0, paid: 0, owed: 0, jobCount: 0 });
  });
});
