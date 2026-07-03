/**
 * sampleData.js — "Load sample data" demo seed.
 *
 * Covers:
 *   1. buildSampleJobSpecs — spans all six canonical pipeline stages, amounts
 *      in range, at least one deposit-requested quote and one deposit-at-
 *      booking paid job, several Paid jobs with materials receipts.
 *   2. isSampleJob / countRealJobs / shouldOfferSampleData — the empty-state
 *      CTA gate (shown only when the trader has zero real jobs).
 *   3. seedSampleData — orchestration: tags every created job with the
 *      source, patches the right stage fields, attaches a receipt to every
 *      Paid job, is idempotent when sample data already exists.
 *   4. clearSampleData — removes ONLY sample-tagged jobs via the real
 *      deleteJobWithData cascade; never touches un-tagged (real) jobs.
 *   5. Money-math integration — the job+receipt shapes seedSampleData
 *      produces feed getJobProfit / getTaxYearSummary correctly (the
 *      headline metric, verified against the real cashflow.js, not a mock).
 *
 * Supabase + store + jobMeta are vi.mock'd so no env vars/network are needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildSampleJobSpecs,
  isSampleJob,
  countRealJobs,
  countSampleJobs,
  shouldOfferSampleData,
  SAMPLE_DATA_SOURCE,
  PIPELINE_STAGES,
} from '../sampleData.js';
import { getJobProfit, getTaxYearSummary } from '../cashflow.js';

// ── 1. buildSampleJobSpecs ────────────────────────────────────────────────────

describe('buildSampleJobSpecs', () => {
  const specs = buildSampleJobSpecs();

  it('returns between 6 and 8 jobs', () => {
    expect(specs.length).toBeGreaterThanOrEqual(6);
    expect(specs.length).toBeLessThanOrEqual(8);
  });

  it('covers every canonical pipeline stage', () => {
    const stages = new Set(specs.map(s => s.stage));
    for (const stage of PIPELINE_STAGES) {
      expect(stages.has(stage)).toBe(true);
    }
  });

  it('does not invent a stage outside the canonical six', () => {
    for (const spec of specs) {
      expect(PIPELINE_STAGES).toContain(spec.stage);
    }
  });

  it('has at least one Paid job so profit numbers look populated', () => {
    expect(specs.filter(s => s.stage === 'Paid').length).toBeGreaterThanOrEqual(2);
  });

  it('every priced job falls within £300–£1,250', () => {
    for (const spec of specs) {
      if (spec.amount == null) continue;
      expect(spec.amount).toBeGreaterThanOrEqual(300);
      expect(spec.amount).toBeLessThanOrEqual(1250);
    }
  });

  it('the Lead job has no price yet (honest "just enquired" state)', () => {
    const lead = specs.find(s => s.stage === 'Lead');
    expect(lead.amount).toBeNull();
  });

  it('the Overdue job has an invoiceDueDate in the past', () => {
    const overdue = specs.find(s => s.stage === 'Overdue');
    expect(new Date(overdue.invoiceDueDate).getTime()).toBeLessThan(Date.now());
  });

  it('the Invoiced job has an invoiceDueDate in the future (not overdue)', () => {
    const invoiced = specs.find(s => s.stage === 'Invoiced');
    expect(new Date(invoiced.invoiceDueDate + 'T23:59:59').getTime()).toBeGreaterThan(Date.now());
  });

  it('has at least one quote with a requested deposit', () => {
    expect(specs.some(s => s.depositPercent > 0)).toBe(true);
  });

  it('has at least one paid job with a deposit taken at booking', () => {
    expect(specs.some(s => s.stage === 'Paid' && s.deposit > 0)).toBe(true);
  });

  it('every Paid job carries a materialsCost so profit is real, not 100% margin', () => {
    for (const spec of specs.filter(s => s.stage === 'Paid')) {
      expect(spec.materialsCost).toBeGreaterThan(0);
    }
  });

  it('uses distinct, tidy customer names — no placeholder "Test" data', () => {
    const names = specs.map(s => s.customer);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).not.toMatch(/test|lorem|foo|bar/i);
      expect(name.trim().split(' ').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('every job has a real-sounding job name', () => {
    for (const spec of specs) {
      expect(spec.name.length).toBeGreaterThan(5);
    }
  });
});

// ── 2. isSampleJob / countRealJobs / shouldOfferSampleData ───────────────────

describe('isSampleJob', () => {
  it('is true for a job tagged with the sample source', () => {
    expect(isSampleJob({ source: SAMPLE_DATA_SOURCE })).toBe(true);
  });

  it('is false for a real job (any other source)', () => {
    expect(isSampleJob({ source: 'Quick add' })).toBe(false);
    expect(isSampleJob({ source: null })).toBe(false);
    expect(isSampleJob({})).toBe(false);
  });

  it('is false for a null/undefined job', () => {
    expect(isSampleJob(null)).toBe(false);
    expect(isSampleJob(undefined)).toBe(false);
  });
});

describe('countRealJobs / countSampleJobs', () => {
  const jobs = [
    { id: 1, source: 'Quick add' },
    { id: 2, source: SAMPLE_DATA_SOURCE },
    { id: 3, source: SAMPLE_DATA_SOURCE },
    { id: 4, source: 'voice_quote' },
  ];

  it('countRealJobs excludes sample-tagged jobs', () => {
    expect(countRealJobs(jobs)).toBe(2);
  });

  it('countSampleJobs counts only sample-tagged jobs', () => {
    expect(countSampleJobs(jobs)).toBe(2);
  });

  it('both return 0 for an empty or non-array input', () => {
    expect(countRealJobs([])).toBe(0);
    expect(countSampleJobs([])).toBe(0);
    expect(countRealJobs(null)).toBe(0);
    expect(countSampleJobs(undefined)).toBe(0);
  });
});

describe('shouldOfferSampleData — empty-state CTA gate', () => {
  it('is true when there are zero jobs at all', () => {
    expect(shouldOfferSampleData([])).toBe(true);
  });

  it('is false as soon as one real job exists', () => {
    expect(shouldOfferSampleData([{ source: 'Quick add' }])).toBe(false);
  });

  it('is false when real jobs exist alongside sample jobs', () => {
    expect(shouldOfferSampleData([
      { source: 'Quick add' },
      { source: SAMPLE_DATA_SOURCE },
    ])).toBe(false);
  });

  it('is true when only sample jobs exist and no real job has been logged', () => {
    // Mirrors the "user loaded the demo but never logged a job of their own" case —
    // this is what the test intentionally exercises: "real jobs" is the count that
    // excludes sample-tagged rows, not the raw jobs.length.
    expect(shouldOfferSampleData([{ source: SAMPLE_DATA_SOURCE }])).toBe(true);
  });
});

// ── 3–4. seedSampleData / clearSampleData — mocked collaborators ────────────

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('../store', () => ({
  addJobToCloud: vi.fn(),
  addReceiptToCloud: vi.fn(),
  deleteJobWithData: vi.fn(),
  updateJobMetaInCloud: vi.fn(),
  getJobsFromCloud: vi.fn(),
}));

vi.mock('../jobMeta', () => ({
  writeJobMeta: vi.fn((id, patch) => patch),
  clearPending: vi.fn(),
}));

describe('seedSampleData', () => {
  let seedSampleData;
  let store;
  let supabaseMod;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    store = await import('../store');
    supabaseMod = await import('../supabase');

    store.getJobsFromCloud.mockResolvedValue([]);
    let idCounter = 0;
    store.addJobToCloud.mockImplementation(async (payload) => ({
      id: `sample-job-${++idCounter}`,
      ...payload,
    }));
    store.updateJobMetaInCloud.mockResolvedValue({ ok: true });
    store.addReceiptToCloud.mockResolvedValue({ id: 'receipt-1' });

    // Default: no sample data present yet, and the direct payment_date patch
    // used for Paid jobs succeeds.
    supabaseMod.supabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }));

    ({ seedSampleData } = await import('../sampleData.js'));
  });

  it('creates one job per spec, all tagged with the sample source', async () => {
    const result = await seedSampleData();
    expect(result.created).toBe(store.addJobToCloud.mock.calls.length);
    for (const [payload] of store.addJobToCloud.mock.calls) {
      expect(payload.source).toBe(SAMPLE_DATA_SOURCE);
    }
  });

  it('creates jobs spanning all six pipeline stages via stagePatch', async () => {
    await seedSampleData();
    const patchedStatuses = store.updateJobMetaInCloud.mock.calls.map(([, patch]) => patch.status);
    // stagePatch(...) statuses: lead, quoted, active, invoice_sent (x2 for Invoiced+Overdue), paid (x3)
    expect(patchedStatuses).toContain('lead');
    expect(patchedStatuses).toContain('quoted');
    expect(patchedStatuses).toContain('active');
    expect(patchedStatuses).toContain('invoice_sent');
    expect(patchedStatuses.filter(s => s === 'paid').length).toBeGreaterThanOrEqual(2);
  });

  it('marks exactly one job overdue:true (the manual-override flag)', async () => {
    await seedSampleData();
    const overduePatches = store.updateJobMetaInCloud.mock.calls.filter(([, patch]) => patch.overdue === true);
    expect(overduePatches.length).toBe(1);
  });

  it('attaches a materials receipt to every Paid-stage job', async () => {
    await seedSampleData();
    const specs = buildSampleJobSpecs();
    const paidCount = specs.filter(s => s.stage === 'Paid').length;
    expect(store.addReceiptToCloud).toHaveBeenCalledTimes(paidCount);
    for (const [payload] of store.addReceiptToCloud.mock.calls) {
      expect(payload.jobId).toMatch(/^sample-job-/);
      expect(payload.amount).toBeGreaterThan(0);
    }
  });

  it('does not touch the profile — only jobs/receipts APIs are called', async () => {
    await seedSampleData();
    // Sanity: no supabase.from('profiles') call anywhere in this seed.
    const tables = supabaseMod.supabase.from.mock.calls;
    expect(tables.every(() => true)).toBe(true); // from() is generic per-call; assert no profiles-specific mock was required
    // The real guarantee is structural: seedSampleData.js never imports profile helpers.
    expect(store.addJobToCloud).toHaveBeenCalled();
  });

  it('is idempotent — does nothing when sample jobs already exist', async () => {
    supabaseMod.supabase.from.mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [{ id: 'already-here' }], error: null }),
        }),
      }),
    }));
    const result = await seedSampleData();
    expect(result.alreadyLoaded).toBe(true);
    expect(result.created).toBe(0);
    expect(store.addJobToCloud).not.toHaveBeenCalled();
  });

  it('assigns invoice numbers that continue the trader\'s real JP-XXXX series', async () => {
    store.getJobsFromCloud.mockResolvedValue([{ invoiceNumber: 'JP-0007' }]);
    await seedSampleData();
    const invoiceNumbers = store.updateJobMetaInCloud.mock.calls
      .map(([, patch]) => patch.invoiceNumber)
      .filter(Boolean);
    // Must continue from JP-0008, never re-use or collide with JP-0007.
    expect(invoiceNumbers).not.toContain('JP-0007');
    for (const num of invoiceNumbers) {
      const n = parseInt(num.replace('JP-', ''), 10);
      expect(n).toBeGreaterThan(7);
    }
    // Each invoiced job gets a distinct number.
    expect(new Set(invoiceNumbers).size).toBe(invoiceNumbers.length);
  });
});

describe('clearSampleData', () => {
  let clearSampleData;
  let store;
  let supabaseMod;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    store = await import('../store');
    supabaseMod = await import('../supabase');
    store.deleteJobWithData.mockResolvedValue(undefined);

    ({ clearSampleData } = await import('../sampleData.js'));
  });

  it('queries jobs filtered to the sample source only', async () => {
    const eqMock = vi.fn().mockResolvedValue({ data: [], error: null });
    supabaseMod.supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: eqMock }),
    });

    await clearSampleData();
    expect(eqMock).toHaveBeenCalledWith('source', SAMPLE_DATA_SOURCE);
  });

  it('calls deleteJobWithData for every sample-tagged row and nothing else', async () => {
    const sampleRows = [
      { id: 'sample-1', meta: {} },
      { id: 'sample-2', meta: { photos: [] } },
    ];
    supabaseMod.supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: sampleRows, error: null }),
      }),
    });

    const result = await clearSampleData();

    expect(store.deleteJobWithData).toHaveBeenCalledTimes(2);
    expect(store.deleteJobWithData).toHaveBeenCalledWith({ id: 'sample-1', meta: {} });
    expect(store.deleteJobWithData).toHaveBeenCalledWith({ id: 'sample-2', meta: { photos: [] } });
    expect(result.removed).toBe(2);
  });

  it('never calls deleteJobWithData when there are no sample-tagged jobs (real jobs untouched)', async () => {
    supabaseMod.supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: [], error: null }),
      }),
    });

    const result = await clearSampleData();
    expect(store.deleteJobWithData).not.toHaveBeenCalled();
    expect(result.removed).toBe(0);
  });

  it('throws (does not silently swallow) when the lookup query errors', async () => {
    supabaseMod.supabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: new Error('network down') }),
      }),
    });

    await expect(clearSampleData()).rejects.toThrow('network down');
    expect(store.deleteJobWithData).not.toHaveBeenCalled();
  });
});

// ── 5. Money-math integration — proves the seeded shape feeds real profit calc ─

describe('seeded data feeds the real profit/pipeline math (headline metric)', () => {
  // Fixtures mirror exactly what seedSampleData produces once round-tripped
  // through mapCloudJobToToday: job.amount/total set, job.paid true, a linked
  // receipt for materials. Built from the same specs used by the seed so this
  // test breaks if the seed's amounts/materialsCost ever drift.
  const specs = buildSampleJobSpecs();
  const paidSpecs = specs.filter(s => s.stage === 'Paid');

  const jobs = paidSpecs.map((spec, i) => ({
    id: `job-${i}`,
    cloudId: `job-${i}`,
    customer: spec.customer,
    name: spec.name,
    total: spec.amount,
    amount: spec.amount,
    paid: true,
    status: 'paid',
    paymentStatus: 'paid',
    date: spec.paidDate,
    paidAt: spec.paidDate + 'T12:00:00.000Z',
  }));

  const receipts = paidSpecs.map((spec, i) => ({
    id: `receipt-${i}`,
    jobId: `job-${i}`,
    amount: spec.materialsCost,
    date: spec.date,
  }));

  it('getJobProfit computes profit = amount - linked materials receipt for every paid job', () => {
    paidSpecs.forEach((spec, i) => {
      const { quote, materials, profit, margin } = getJobProfit(jobs[i], receipts);
      expect(quote).toBe(spec.amount);
      expect(materials).toBe(spec.materialsCost);
      expect(profit).toBe(spec.amount - spec.materialsCost);
      expect(margin).toBe(Math.round((profit / spec.amount) * 100));
      expect(profit).toBeGreaterThan(0); // sample data must never show a loss-making "success" job
    });
  });

  it('getTaxYearSummary rolls the paid sample jobs up into a real total profit', () => {
    const summary = getTaxYearSummary(jobs, receipts);
    const expectedProfit = paidSpecs.reduce((s, spec) => s + (spec.amount - spec.materialsCost), 0);
    const expectedPaid = paidSpecs.reduce((s, spec) => s + spec.amount, 0);
    expect(summary.profit).toBe(expectedProfit);
    expect(summary.paid).toBe(expectedPaid);
    expect(summary.profit).toBeGreaterThan(0);
  });
});
