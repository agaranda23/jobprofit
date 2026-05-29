/**
 * Tests for the Copy / Archive / Delete job actions added in
 * feat/wire-copy-archive-delete-job-actions.
 *
 * Covers:
 *  1. visibleJobs filter predicate — archived and deleted jobs are excluded.
 *  2. deleteJobFromCloud happy path — Supabase delete called, localStorage
 *     mirror entry removed, no throw on success.
 *  3. handleCopyJob payload shape — stage reset to Lead, invoice/payment
 *     fields cleared, customer + price carried over.
 *  4. Stage strip totals (calcRiskFigures) — archived/deleted jobs do NOT
 *     contribute to invoiced/overdue totals.
 *
 * No DOM, no React — pure logic mirrors. Supabase is vi.mock'd.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 1. visibleJobs filter predicate ──────────────────────────────────────────

/**
 * Mirror of the derivation in WorkScreen:
 *   const visibleJobs = jobs.filter(j => !j?.archived && !j?.meta?.archived && !j?.deleted && !j?.meta?.deleted);
 */
function filterVisible(jobs) {
  return jobs.filter(
    j => !j?.archived && !j?.meta?.archived && !j?.deleted && !j?.meta?.deleted
  );
}

describe('visibleJobs filter predicate', () => {
  const base = { id: 'J-0001', summary: 'Fix fence', amount: 250, status: 'active' };

  it('includes a plain active job', () => {
    expect(filterVisible([base])).toHaveLength(1);
  });

  it('excludes a job with top-level archived: true', () => {
    expect(filterVisible([{ ...base, archived: true }])).toHaveLength(0);
  });

  it('excludes a job with meta.archived: true', () => {
    expect(filterVisible([{ ...base, meta: { archived: true } }])).toHaveLength(0);
  });

  it('excludes a job with top-level deleted: true', () => {
    expect(filterVisible([{ ...base, deleted: true }])).toHaveLength(0);
  });

  it('excludes a job with meta.deleted: true', () => {
    expect(filterVisible([{ ...base, meta: { deleted: true } }])).toHaveLength(0);
  });

  it('includes a job with meta present but neither flag set', () => {
    expect(filterVisible([{ ...base, meta: { lineItems: [] } }])).toHaveLength(1);
  });

  it('handles null/undefined jobs gracefully without throwing', () => {
    // Optional chaining on null/undefined: !null?.archived === !undefined === true,
    // so null/undefined entries are NOT filtered out — they just don't throw.
    // In practice, AppShell never puts nulls into the jobs array; this confirms
    // the predicate is safe to evaluate against malformed entries.
    expect(() => filterVisible([null, undefined, base])).not.toThrow();
  });

  it('filters mixed list — only visible jobs remain', () => {
    const visible1 = { ...base, id: 'J-0002', status: 'lead' };
    const archived  = { ...base, id: 'J-0003', archived: true };
    const deleted   = { ...base, id: 'J-0004', deleted: true };
    const visible2  = { ...base, id: 'J-0005', status: 'quoted' };
    const result = filterVisible([visible1, archived, deleted, visible2]);
    expect(result.map(j => j.id)).toEqual(['J-0002', 'J-0005']);
  });
});

// ── 2. deleteJobFromCloud happy path ─────────────────────────────────────────

// We mock the supabase module before importing store.js so the real client
// is never constructed (avoids env-var requirements in CI).
vi.mock('../supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }) },
    from: vi.fn(),
  },
}));

// Also mock localStorage for the write() helper used by store.js
const localStorageData = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn(key => localStorageData[key] ?? null),
  setItem: vi.fn((key, val) => { localStorageData[key] = val; }),
  removeItem: vi.fn(key => { delete localStorageData[key]; }),
});

describe('deleteJobFromCloud', () => {
  let deleteJobFromCloud;
  let mockDelete;

  beforeEach(async () => {
    vi.resetModules();

    // Prime localStorage with one job to mirror
    localStorageData['jobprofit-app-data'] = JSON.stringify({
      jobs: [{ id: 'J-0001', cloudId: 'cloud-uuid-abc' }, { id: 'J-0002', cloudId: 'cloud-uuid-xyz' }],
      expenses: [],
      invoices: [],
    });

    // Build fresh Supabase mock chain: .from('jobs').delete().eq('id', jobId)
    mockDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const { supabase } = await import('../supabase');
    supabase.from.mockReturnValue({ delete: mockDelete });

    ({ deleteJobFromCloud } = await import('../store'));
  });

  it('calls supabase.from("jobs").delete().eq("id", jobId)', async () => {
    await deleteJobFromCloud('cloud-uuid-abc');
    expect(mockDelete).toHaveBeenCalledOnce();
    const eqMock = mockDelete.mock.results[0].value.eq;
    expect(eqMock).toHaveBeenCalledWith('id', 'cloud-uuid-abc');
  });

  it('removes the matching job from the localStorage mirror', async () => {
    await deleteJobFromCloud('cloud-uuid-abc');
    const stored = JSON.parse(localStorageData['jobprofit-app-data']);
    expect(stored.jobs.find(j => j.cloudId === 'cloud-uuid-abc')).toBeUndefined();
    // Other jobs survive
    expect(stored.jobs.find(j => j.cloudId === 'cloud-uuid-xyz')).toBeDefined();
  });

  it('does nothing when jobId is falsy', async () => {
    await deleteJobFromCloud(null);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

// ── 3. handleCopyJob payload shape ───────────────────────────────────────────

/**
 * Mirror of the payload construction in WorkScreen.handleCopyJob.
 * This is pure — no async, no side effects — so we can unit-test it directly.
 */
function buildCopyPayload(job) {
  return {
    customer: job.customer || job.name || '',
    name: job.summary || job.customer || job.name || 'Job',
    summary: job.summary || '',
    phone: job.phone || '',
    email: job.email || '',
    address: job.address || '',
    notes: job.notes || '',
    amount: job.total ?? job.amount ?? null,
    lineItems: job.lineItems ?? [],
    paid: false,
    status: 'lead',
    invoiceStatus: null,
    paidAt: null,
    invoiceSentAt: null,
    invoiceDueDate: null,
    overdue: false,
    source: 'Copy',
  };
}

describe('handleCopyJob payload shape', () => {
  const paidJob = {
    id: 'J-0001',
    summary: 'Paint kitchen',
    customer: 'Bob Smith',
    phone: '07700900000',
    email: 'bob@example.com',
    address: '10 Downing St',
    notes: 'Use eggshell finish',
    total: 1200,
    amount: 1000,
    lineItems: [{ desc: 'Labour', cost: 900 }, { desc: 'Materials', cost: 300 }],
    status: 'paid',
    paid: true,
    invoiceStatus: 'invoiced',
    paidAt: '2026-05-01T10:00:00Z',
    invoiceSentAt: '2026-04-28T09:00:00Z',
    invoiceDueDate: '2026-05-12',
    overdue: false,
  };

  it('stage is reset to Lead (status: "lead", paid: false)', () => {
    const p = buildCopyPayload(paidJob);
    expect(p.status).toBe('lead');
    expect(p.paid).toBe(false);
  });

  it('invoice and payment date fields are cleared', () => {
    const p = buildCopyPayload(paidJob);
    expect(p.invoiceStatus).toBeNull();
    expect(p.paidAt).toBeNull();
    expect(p.invoiceSentAt).toBeNull();
    expect(p.invoiceDueDate).toBeNull();
    expect(p.overdue).toBe(false);
  });

  it('carries over customer name', () => {
    const p = buildCopyPayload(paidJob);
    expect(p.customer).toBe('Bob Smith');
  });

  it('carries over job summary as name', () => {
    const p = buildCopyPayload(paidJob);
    expect(p.name).toBe('Paint kitchen');
    expect(p.summary).toBe('Paint kitchen');
  });

  it('carries over phone, email, address, notes', () => {
    const p = buildCopyPayload(paidJob);
    expect(p.phone).toBe('07700900000');
    expect(p.email).toBe('bob@example.com');
    expect(p.address).toBe('10 Downing St');
    expect(p.notes).toBe('Use eggshell finish');
  });

  it('uses total as the amount (total takes precedence)', () => {
    const p = buildCopyPayload(paidJob);
    expect(p.amount).toBe(1200);
  });

  it('falls back to amount when total is absent', () => {
    const { total, ...jobNoTotal } = paidJob;
    const p = buildCopyPayload(jobNoTotal);
    expect(p.amount).toBe(1000);
  });

  it('amount is null when neither total nor amount is set', () => {
    const p = buildCopyPayload({ summary: 'New lead', customer: 'Alice' });
    expect(p.amount).toBeNull();
  });

  it('carries over lineItems', () => {
    const p = buildCopyPayload(paidJob);
    expect(p.lineItems).toEqual(paidJob.lineItems);
  });

  it('lineItems defaults to [] when absent', () => {
    const p = buildCopyPayload({ summary: 'Plumbing' });
    expect(p.lineItems).toEqual([]);
  });

  it('source is "Copy"', () => {
    const p = buildCopyPayload(paidJob);
    expect(p.source).toBe('Copy');
  });
});

// ── 4. Stage strip totals exclude archived/deleted jobs ───────────────────────

/**
 * Mirror of WorkScreen.calcRiskFigures — the relevant slice (invoiced + overdue
 * totals). We call filterVisible first, as WorkScreen does:
 *   const visibleJobs = jobs.filter(...);
 *   const riskFigures = calcRiskFigures(visibleJobs);
 */
function isOverdueMirror(job) {
  if (job.invoiceDueDate) {
    const due = new Date(job.invoiceDueDate);
    due.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due < today;
  }
  return false;
}

function deriveDisplayStatusMirror(job) {
  if (job.status === 'lead') return 'Lead';
  if (job.status === 'quoted') return 'Quoted';
  if (job.status === 'paid') return 'Paid';
  if (job.status === 'active') return 'On';
  if (job.status === 'complete') return 'On';
  if (job.status === 'invoice_sent') {
    if (isOverdueMirror(job)) return 'Overdue';
    return 'Invoiced';
  }
  return 'Lead';
}

function calcRiskFiguresMirror(jobs) {
  let invoiced = 0;
  let overdue = 0;
  for (const j of jobs) {
    const status = deriveDisplayStatusMirror(j);
    const val = Number(j.total ?? j.amount ?? 0) || 0;
    if (status === 'Invoiced') invoiced += val;
    else if (status === 'Overdue') overdue += val;
  }
  return { invoiced, overdue, owed: invoiced + overdue };
}

describe('calcRiskFigures excludes archived/deleted jobs', () => {
  const pastDue = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const futureDue = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const overdueJob = {
    id: 'J-A', status: 'invoice_sent', invoiceDueDate: pastDue, total: 500,
  };
  const invoicedJob = {
    id: 'J-B', status: 'invoice_sent', invoiceDueDate: futureDue, total: 300,
  };
  const archivedOverdue = { ...overdueJob, id: 'J-C', archived: true, total: 999 };
  const deletedInvoiced = { ...invoicedJob, id: 'J-D', deleted: true, total: 888 };

  it('includes active overdue and invoiced jobs in totals', () => {
    const visible = filterVisible([overdueJob, invoicedJob]);
    const { overdue, invoiced } = calcRiskFiguresMirror(visible);
    expect(overdue).toBe(500);
    expect(invoiced).toBe(300);
  });

  it('excludes an archived overdue job from totals', () => {
    const visible = filterVisible([overdueJob, archivedOverdue]);
    const { overdue } = calcRiskFiguresMirror(visible);
    expect(overdue).toBe(500); // only the non-archived one
  });

  it('excludes a deleted invoiced job from totals', () => {
    const visible = filterVisible([invoicedJob, deletedInvoiced]);
    const { invoiced } = calcRiskFiguresMirror(visible);
    expect(invoiced).toBe(300); // only the non-deleted one
  });

  it('owed total is 0 when all jobs are archived/deleted', () => {
    const visible = filterVisible([archivedOverdue, deletedInvoiced]);
    const { owed } = calcRiskFiguresMirror(visible);
    expect(owed).toBe(0);
  });

  it('meta.archived jobs are also excluded', () => {
    const metaArchivedOverdue = { ...overdueJob, id: 'J-E', meta: { archived: true }, total: 777 };
    const visible = filterVisible([overdueJob, metaArchivedOverdue]);
    const { overdue } = calcRiskFiguresMirror(visible);
    expect(overdue).toBe(500);
  });
});
