import { describe, it, expect } from 'vitest';
import { buildJobsCsv, buildEverythingCsv, deriveAccountFields } from '../exportCsv.js';

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

// ── Fixtures for account-level tests ─────────────────────────────────────────

function makeProfile(overrides = {}) {
  return {
    first_name: 'Alan',
    last_name: 'Smith',
    business_name: 'Smith Plumbing Ltd',
    email: 'alan@smithplumbing.com',
    phone: '07700900000',
    address: '10 High Street, London',
    website: 'https://smithplumbing.com',
    vat_number: 'GB123456789',
    utr_number: '1234567890',
    plan: 'pro',
    created_at: '2026-01-15T10:00:00Z',
    // secrets that must NOT appear in export
    sort_code: '20-00-00',
    account_number: '99887766',
    stripe_customer_id: 'cus_abc123',
    stripe_subscription_id: 'sub_xyz',
    ...overrides,
  };
}

function makeSession(overrides = {}) {
  return { user: { email: 'login@example.com', ...overrides } };
}

// ── deriveAccountFields ───────────────────────────────────────────────────────

describe('deriveAccountFields', () => {
  it('includes first_name, last_name, business_name', () => {
    const fields = deriveAccountFields(makeProfile(), makeSession());
    const keys = fields.map(([k]) => k);
    expect(keys).toContain('First name');
    expect(keys).toContain('Last name');
    expect(keys).toContain('Business name');
  });

  it('uses login email from session for "Login email" field', () => {
    const fields = deriveAccountFields(makeProfile(), makeSession());
    const loginRow = fields.find(([k]) => k === 'Login email');
    expect(loginRow).toBeDefined();
    expect(loginRow[1]).toBe('login@example.com');
  });

  it('uses profile.email for "Business email" field', () => {
    const fields = deriveAccountFields(makeProfile(), makeSession());
    const bizRow = fields.find(([k]) => k === 'Business email');
    expect(bizRow[1]).toBe('alan@smithplumbing.com');
  });

  it('includes phone, address, website', () => {
    const fields = deriveAccountFields(makeProfile(), makeSession());
    const keys = fields.map(([k]) => k);
    expect(keys).toContain('Phone');
    expect(keys).toContain('Address');
    expect(keys).toContain('Website');
  });

  it('includes VAT number and UTR number', () => {
    const fields = deriveAccountFields(makeProfile(), makeSession());
    const keys = fields.map(([k]) => k);
    expect(keys).toContain('VAT number');
    expect(keys).toContain('UTR number');
  });

  it('includes plan and account created date', () => {
    const fields = deriveAccountFields(makeProfile(), makeSession());
    const planRow = fields.find(([k]) => k === 'Plan');
    expect(planRow[1]).toBe('pro');
    const createdRow = fields.find(([k]) => k === 'Account created');
    expect(createdRow[1]).toMatch(/2026/);
  });

  it('does NOT include sort_code or account_number', () => {
    const fields = deriveAccountFields(makeProfile(), makeSession());
    const keys = fields.map(([k]) => k);
    expect(keys).not.toContain('sort_code');
    expect(keys).not.toContain('Sort code');
    expect(keys).not.toContain('account_number');
    expect(keys).not.toContain('Account number');
  });

  it('does NOT include Stripe internal IDs', () => {
    const fields = deriveAccountFields(makeProfile(), makeSession());
    const values = fields.map(([, v]) => v);
    expect(values).not.toContain('cus_abc123');
    expect(values).not.toContain('sub_xyz');
  });

  it('handles null profile gracefully — returns array of mostly-empty rows', () => {
    const fields = deriveAccountFields(null, makeSession());
    expect(Array.isArray(fields)).toBe(true);
    expect(fields.length).toBeGreaterThan(0);
    const loginRow = fields.find(([k]) => k === 'Login email');
    expect(loginRow[1]).toBe('login@example.com');
  });

  it('handles null session gracefully — login email is empty string', () => {
    const fields = deriveAccountFields(makeProfile(), null);
    const loginRow = fields.find(([k]) => k === 'Login email');
    expect(loginRow[1]).toBe('');
  });

  it('falls back to account_name when business_name is blank', () => {
    const fields = deriveAccountFields(
      makeProfile({ business_name: null, account_name: 'Smith Co' }),
      makeSession(),
    );
    const bizRow = fields.find(([k]) => k === 'Business name');
    expect(bizRow[1]).toBe('Smith Co');
  });

  it('defaults plan to "free" when profile.plan is null', () => {
    const fields = deriveAccountFields(makeProfile({ plan: null }), makeSession());
    const planRow = fields.find(([k]) => k === 'Plan');
    expect(planRow[1]).toBe('free');
  });
});

// ── buildJobsCsv — records export must NOT contain account fields ─────────────

describe('buildJobsCsv — records export excludes account/profile fields', () => {
  it('does not contain "Account information" section header', () => {
    const csv = buildJobsCsv([makeJob()], []);
    expect(csv).not.toContain('Account information');
  });

  it('does not contain personal account field labels', () => {
    const csv = buildJobsCsv([makeJob()], []);
    expect(csv).not.toContain('First name');
    expect(csv).not.toContain('Business name');
    expect(csv).not.toContain('Login email');
    expect(csv).not.toContain('VAT number');
  });

  it('starts with the jobs header row, not an account header', () => {
    const csv = buildJobsCsv([makeJob()], []);
    const firstLine = csv.split('\n')[0];
    expect(firstLine).toContain('Date');
    expect(firstLine).toContain('Customer');
    expect(firstLine).toContain('Invoiced');
  });
});

// ── buildEverythingCsv — must include account section AND jobs ledger ─────────

describe('buildEverythingCsv — everything export includes account and jobs', () => {
  it('contains "Account information" section header', () => {
    const csv = buildEverythingCsv([makeJob()], [], makeProfile(), makeSession());
    expect(csv).toContain('Account information');
  });

  it('contains account field labels in output', () => {
    const csv = buildEverythingCsv([makeJob()], [], makeProfile(), makeSession());
    expect(csv).toContain('First name');
    expect(csv).toContain('Business name');
    expect(csv).toContain('Login email');
    expect(csv).toContain('VAT number');
    expect(csv).toContain('UTR number');
  });

  it('contains the actual profile field values', () => {
    const csv = buildEverythingCsv([makeJob()], [], makeProfile(), makeSession());
    expect(csv).toContain('Alan');
    expect(csv).toContain('Smith Plumbing Ltd');
    expect(csv).toContain('login@example.com');
    expect(csv).toContain('alan@smithplumbing.com');
    expect(csv).toContain('GB123456789');
    expect(csv).toContain('1234567890');
  });

  it('contains a jobs ledger section with the standard header columns', () => {
    const csv = buildEverythingCsv([makeJob()], [], makeProfile(), makeSession());
    expect(csv).toContain('Jobs ledger');
    expect(csv).toContain('Date');
    expect(csv).toContain('Customer');
    expect(csv).toContain('Invoiced');
  });

  it('contains the job data row after the jobs section header', () => {
    const csv = buildEverythingCsv([makeJob()], [], makeProfile(), makeSession());
    expect(csv).toContain('Alan Smith');
    expect(csv).toContain('Bathroom tiles');
    expect(csv).toContain('1200.00');
  });

  it('does NOT expose sort_code or account_number values', () => {
    const csv = buildEverythingCsv([makeJob()], [], makeProfile(), makeSession());
    expect(csv).not.toContain('20-00-00');
    expect(csv).not.toContain('99887766');
  });

  it('does NOT expose Stripe internal IDs', () => {
    const csv = buildEverythingCsv([makeJob()], [], makeProfile(), makeSession());
    expect(csv).not.toContain('cus_abc123');
    expect(csv).not.toContain('sub_xyz');
  });

  it('handles empty jobs array — account section still present', () => {
    const csv = buildEverythingCsv([], [], makeProfile(), makeSession());
    expect(csv).toContain('Account information');
    expect(csv).toContain('Jobs ledger');
    // No data rows after the jobs header (just the header itself)
    const idx = csv.indexOf('Jobs ledger');
    const afterLedger = csv.slice(idx);
    // The Date/Customer header row must be present
    expect(afterLedger).toContain('Date');
  });

  it('handles null profile — structure still emitted', () => {
    const csv = buildEverythingCsv([makeJob()], [], null, makeSession());
    expect(csv).toContain('Account information');
    expect(csv).toContain('Login email');
    expect(csv).toContain('login@example.com');
  });

  it('costs and profit maths are still correct in the jobs section', () => {
    const job = makeJob({ id: 'job-1', total: 1000 });
    const receipt = { id: 'r1', jobId: 'job-1', amount: 300 };
    const csv = buildEverythingCsv([job], [receipt], makeProfile(), makeSession());
    expect(csv).toContain('300.00');
    expect(csv).toContain('700.00');
  });
});

// ── Section isolation: records vs everything ──────────────────────────────────

describe('records vs everything section isolation', () => {
  it('records CSV is a strict subset — no account fields ever', () => {
    const recordsCsv = buildJobsCsv([makeJob()], []);
    const everythingCsv = buildEverythingCsv([makeJob()], [], makeProfile(), makeSession());
    // Account section present in everything
    expect(everythingCsv).toContain('Account information');
    // Absent from records
    expect(recordsCsv).not.toContain('Account information');
    // Both contain the jobs data
    expect(recordsCsv).toContain('Alan Smith');
    expect(everythingCsv).toContain('Alan Smith');
  });
});
