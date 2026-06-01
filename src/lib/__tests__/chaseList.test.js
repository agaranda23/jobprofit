import { describe, it, expect, vi } from 'vitest';
import { buildChaseList } from '../chaseList.js';

// ── localStorage mock (needed by chaseLadder via import chain) ────────────────
function makeLocalStorageMock() {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
}
vi.stubGlobal('localStorage', makeLocalStorageMock());

// Fixed "now" so tests don't drift
const NOW = new Date('2026-05-31T10:00:00');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function invoicedJob(overrides = {}) {
  // Default: invoice sent 10 days ago → 3 days overdue on net-7
  return {
    id: 'job-1',
    customer: 'Alan Smith',
    summary: 'Bathroom tiles',
    amount: 1200,
    total: 1200,
    status: 'invoice_sent',
    paymentStatus: 'awaiting',
    paid: false,
    invoiceSentAt: '2026-05-21T09:00:00', // 10 days before NOW → 3 days past net-7
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildChaseList', () => {
  it('returns an empty array when no jobs are passed', () => {
    expect(buildChaseList([], NOW)).toEqual([]);
  });

  it('returns an empty array when jobs is undefined', () => {
    expect(buildChaseList(undefined, NOW)).toEqual([]);
  });

  it('excludes paid jobs', () => {
    const job = invoicedJob({ paid: true, status: 'paid', paymentStatus: 'paid' });
    expect(buildChaseList([job], NOW)).toHaveLength(0);
  });

  it('excludes cancelled jobs', () => {
    const job = invoicedJob({ status: 'cancelled' });
    expect(buildChaseList([job], NOW)).toHaveLength(0);
  });

  it('excludes draft jobs', () => {
    const job = invoicedJob({ status: 'draft' });
    expect(buildChaseList([job], NOW)).toHaveLength(0);
  });

  it('excludes jobs with no invoice sent', () => {
    const job = {
      id: 'job-lead',
      customer: 'Bob',
      amount: 500,
      total: 500,
      status: 'lead',
      paymentStatus: 'unpaid',
      paid: false,
    };
    expect(buildChaseList([job], NOW)).toHaveLength(0);
  });

  it('excludes pre-due jobs (daysPastDue < 1)', () => {
    // Due date is tomorrow
    const tomorrow = new Date(NOW);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const job = invoicedJob({
      invoiceSentAt: null,
      invoiceDueDate: tomorrow.toISOString().slice(0, 10),
    });
    expect(buildChaseList([job], NOW)).toHaveLength(0);
  });

  it('excludes jobs in the grace window (daysPastDue === 0)', () => {
    // Due today — daysPastDue = 0
    const job = invoicedJob({
      invoiceSentAt: null,
      invoiceDueDate: '2026-05-31',
    });
    expect(buildChaseList([job], NOW)).toHaveLength(0);
  });

  it('includes jobs that are 1+ days past due', () => {
    const job = invoicedJob(); // 3 days past net-7 due date
    const result = buildChaseList([job], NOW);
    expect(result).toHaveLength(1);
    expect(result[0].customer).toBe('Alan Smith');
  });

  it('includes jobs detected as overdue via invoiceDueDate', () => {
    const job = invoicedJob({
      invoiceSentAt: null,
      invoiceDueDate: '2026-05-28', // 3 days ago
    });
    const result = buildChaseList([job], NOW);
    expect(result).toHaveLength(1);
    expect(result[0].daysPastDue).toBe(3);
  });

  it('includes jobs with legacy paymentStatus=awaiting', () => {
    const job = {
      id: 'leg-1',
      customer: 'Legacy',
      amount: 600,
      total: 600,
      paymentStatus: 'awaiting',
      paid: false,
      invoiceSentAt: '2026-05-20T00:00:00', // 11 days ago → 4 days past net-7
    };
    expect(buildChaseList([job], NOW)).toHaveLength(1);
  });

  it('sorts most urgent (highest daysPastDue) first', () => {
    const urgent = invoicedJob({
      id: 'job-urgent',
      invoiceSentAt: '2026-05-10T00:00:00', // 21 days ago → 14 days past net-7
    });
    const mild = invoicedJob({
      id: 'job-mild',
      invoiceSentAt: '2026-05-21T00:00:00', // 10 days ago → 3 days past net-7
    });
    const result = buildChaseList([mild, urgent], NOW);
    expect(result[0].id).toBe('job-urgent');
    expect(result[1].id).toBe('job-mild');
  });

  it('breaks ties by outstanding amount descending', () => {
    // Both 3 days past due — higher amount goes first
    const big = invoicedJob({ id: 'big', customer: 'Big', total: 5000, amount: 5000 });
    const small = invoicedJob({ id: 'small', customer: 'Small', total: 200, amount: 200 });
    const result = buildChaseList([small, big], NOW);
    expect(result[0].id).toBe('big');
  });

  it('correctly reports outstanding amount from total', () => {
    const job = invoicedJob({ amount: 900, total: 1200 });
    const result = buildChaseList([job], NOW);
    expect(result[0].outstanding).toBe(1200); // total wins over amount
  });

  it('correctly reports outstanding amount from amount when total is absent', () => {
    const job = invoicedJob({ total: undefined, amount: 750 });
    const result = buildChaseList([job], NOW);
    expect(result[0].outstanding).toBe(750);
  });

  it('returns tier from chaseLadder.computeTier', () => {
    // 21 days past net-7 → daysPastDue = 14 → tier 3
    const job = invoicedJob({ invoiceSentAt: '2026-05-10T00:00:00' });
    const result = buildChaseList([job], NOW);
    expect(result[0].tier).toBe(3);
  });

  it('returns tier 1 for 1-6 days past due', () => {
    // 8 days ago → 1 day past net-7
    const job = invoicedJob({ invoiceSentAt: '2026-05-23T00:00:00' });
    const result = buildChaseList([job], NOW);
    expect(result[0].tier).toBe(1);
  });

  it('includes jobs detected via overdue manual flag', () => {
    const job = {
      id: 'manual-overdue',
      customer: 'Fred',
      amount: 400,
      total: 400,
      status: 'invoice_sent',
      paymentStatus: 'awaiting',
      paid: false,
      overdue: true,
      invoiceDueDate: '2026-05-28', // 3 days past due
    };
    expect(buildChaseList([job], NOW)).toHaveLength(1);
  });

  it('handles a mix of qualifying and non-qualifying jobs correctly', () => {
    const paid = invoicedJob({ id: 'paid', paid: true, status: 'paid' });
    const lead = { id: 'lead', customer: 'Lead', amount: 100, status: 'lead', paid: false };
    const chaseMe = invoicedJob({ id: 'chase', invoiceSentAt: '2026-05-21T00:00:00' });

    const result = buildChaseList([paid, lead, chaseMe], NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('chase');
  });
});
