import { describe, it, expect } from 'vitest';
import { buildJobsCsv } from '../exportCsv.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return {
    id: 'job-1',
    date: '2026-05-01',
    customer: 'Alan Smith',
    summary: 'Bathroom tiles',
    amount: 1200,
    total: 1200,
    status: 'paid',
    paymentStatus: 'paid',
    paid: true,
    paymentDate: '2026-05-10',
    ...overrides,
  };
}

function makeReceipt(overrides = {}) {
  return {
    id: 'rec-1',
    jobId: 'job-1',
    amount: 250,
    date: '2026-05-02',
    ...overrides,
  };
}

function parseCsv(csv) {
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (values[i] || '').trim(); });
    return obj;
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('buildJobsCsv', () => {
  it('returns a header row and one data row for a single job', () => {
    const csv = buildJobsCsv([makeJob()], []);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Date');
    expect(lines[0]).toContain('Customer');
    expect(lines[0]).toContain('Invoiced £');
    expect(lines[0]).toContain('Profit £');
  });

  it('returns only the header for an empty jobs array', () => {
    const csv = buildJobsCsv([], []);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Date');
  });

  it('returns only the header when jobs is undefined', () => {
    const csv = buildJobsCsv(undefined, undefined);
    expect(csv.trim().split('\n')).toHaveLength(1);
  });

  it('computes costs from linked receipts and derives profit correctly', () => {
    const jobs = [makeJob({ id: 'job-1', total: 1200, paid: true })];
    const receipts = [
      makeReceipt({ jobId: 'job-1', amount: 300 }),
      makeReceipt({ id: 'rec-2', jobId: 'job-1', amount: 100 }),
    ];
    const rows = parseCsv(buildJobsCsv(jobs, receipts));
    expect(Number(rows[0]['Costs £'])).toBe(400);
    expect(Number(rows[0]['Profit £'])).toBe(800);
    expect(Number(rows[0]['Invoiced £'])).toBe(1200);
  });

  it('does NOT include receipts for a different job', () => {
    const jobs = [makeJob({ id: 'job-1', total: 500 })];
    const receipts = [makeReceipt({ jobId: 'job-99', amount: 200 })];
    const rows = parseCsv(buildJobsCsv(jobs, receipts));
    expect(Number(rows[0]['Costs £'])).toBe(0);
    expect(Number(rows[0]['Profit £'])).toBe(500);
  });

  it('matches receipts by cloudId when id does not match', () => {
    const jobs = [makeJob({ id: 'uuid-abc', cloudId: 'uuid-abc', total: 800 })];
    const receipts = [makeReceipt({ jobId: 'uuid-abc', amount: 150 })];
    const rows = parseCsv(buildJobsCsv(jobs, receipts));
    expect(Number(rows[0]['Costs £'])).toBe(150);
    expect(Number(rows[0]['Profit £'])).toBe(650);
  });

  it('sets Status to Paid for a paid job', () => {
    const rows = parseCsv(buildJobsCsv([makeJob({ paid: true, status: 'paid' })], []));
    expect(rows[0]['Status']).toBe('Paid');
  });

  it('sets Status to Lead for a lead job', () => {
    const rows = parseCsv(buildJobsCsv([makeJob({ paid: false, status: 'lead', paymentStatus: 'unpaid' })], []));
    expect(rows[0]['Status']).toBe('Lead');
  });

  it('sets Status to Invoiced for invoice_sent status', () => {
    const rows = parseCsv(buildJobsCsv([makeJob({ paid: false, status: 'invoice_sent', paymentStatus: 'awaiting' })], []));
    expect(rows[0]['Status']).toBe('Invoiced');
  });

  it('sets Status to Cancelled when paymentStatus is cancelled', () => {
    const rows = parseCsv(buildJobsCsv([makeJob({ paid: false, status: 'active', paymentStatus: 'cancelled' })], []));
    expect(rows[0]['Status']).toBe('Cancelled');
  });

  it('populates Paid date for paid jobs', () => {
    const rows = parseCsv(buildJobsCsv([makeJob({ paid: true, paymentDate: '2026-05-15' })], []));
    expect(rows[0]['Paid date']).toBe('2026-05-15');
  });

  it('leaves Paid date blank for unpaid jobs', () => {
    const rows = parseCsv(buildJobsCsv([makeJob({ paid: false, status: 'lead', paymentStatus: 'unpaid' })], []));
    expect(rows[0]['Paid date']).toBe('');
  });

  it('escapes commas in customer name with double-quoting', () => {
    const jobs = [makeJob({ customer: 'Smith, Alan', total: 500 })];
    const csv = buildJobsCsv(jobs, []);
    expect(csv).toContain('"Smith, Alan"');
  });

  it('escapes double-quotes in summary', () => {
    const jobs = [makeJob({ summary: 'The "best" job', total: 100 })];
    const csv = buildJobsCsv(jobs, []);
    expect(csv).toContain('"The ""best"" job"');
  });

  it('handles jobs with null/undefined amount gracefully (zero cost, zero profit)', () => {
    const jobs = [makeJob({ amount: null, total: null })];
    const rows = parseCsv(buildJobsCsv(jobs, []));
    expect(Number(rows[0]['Invoiced £'])).toBe(0);
    expect(Number(rows[0]['Profit £'])).toBe(0);
  });

  it('produces one row per job for a multi-job array', () => {
    const jobs = [makeJob({ id: 'j1' }), makeJob({ id: 'j2' })];
    const csv = buildJobsCsv(jobs, []);
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('uses total over amount when both are set', () => {
    const jobs = [makeJob({ amount: 500, total: 1500 })];
    const rows = parseCsv(buildJobsCsv(jobs, []));
    expect(Number(rows[0]['Invoiced £'])).toBe(1500);
  });

  it('uses job.name as Customer fallback when customer is missing', () => {
    const jobs = [makeJob({ customer: undefined, name: 'Bob the Plumber' })];
    const rows = parseCsv(buildJobsCsv(jobs, []));
    expect(rows[0]['Customer']).toBe('Bob the Plumber');
  });
});
