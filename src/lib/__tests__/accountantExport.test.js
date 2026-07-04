import { describe, it, expect } from 'vitest';
import {
  formatDateUK,
  resolveExportPeriod,
  buildXeroSalesInvoicesCsv,
  buildXeroBillsCsv,
  buildQuickBooksInvoicesCsv,
  buildQuickBooksExpensesCsv,
  buildPaymentsCsv,
  buildAccountantExportFiles,
  buildAccountantExportZipBlob,
} from '../accountantExport.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return {
    id: 'job-1',
    customer: 'Alan Smith',
    summary: 'Bathroom retile',
    total: 1200,
    amount: 1200,
    status: 'invoice_sent',
    paymentStatus: 'awaiting',
    invoiceNumber: 'INV-001',
    invoiceSentAt: '2025-06-10T09:00:00.000Z',
    invoiceDueDate: '2025-06-24',
    date: '2025-06-01',
    ...overrides,
  };
}

function makeReceipt(overrides = {}) {
  return {
    id: 555,
    label: 'Screwfix',
    amount: 120,
    vat: 20,
    date: '2025-06-05',
    ...overrides,
  };
}

function parseCsv(csv) {
  const lines = csv.trim().split('\n');
  const headers = lines[0].split(',');
  return {
    headers,
    rows: lines.slice(1).map(line => {
      // naive split good enough for these fixtures (no embedded commas in these tests
      // except the dedicated escaping test, which checks raw string content instead)
      const values = line.split(',');
      const obj = {};
      headers.forEach((h, i) => { obj[h] = values[i]; });
      return obj;
    }),
  };
}

// ── formatDateUK ──────────────────────────────────────────────────────────────

describe('formatDateUK', () => {
  it('formats an ISO date as DD/MM/YYYY', () => {
    expect(formatDateUK('2025-06-10')).toBe('10/06/2025');
  });

  it('formats a full ISO datetime as DD/MM/YYYY', () => {
    expect(formatDateUK('2025-06-10T09:00:00.000Z')).toBe('10/06/2025');
  });

  it('returns empty string for falsy input', () => {
    expect(formatDateUK('')).toBe('');
    expect(formatDateUK(null)).toBe('');
    expect(formatDateUK(undefined)).toBe('');
  });

  it('returns empty string for unparseable input', () => {
    expect(formatDateUK('not-a-date')).toBe('');
  });
});

// ── resolveExportPeriod ───────────────────────────────────────────────────────

describe('resolveExportPeriod', () => {
  it('this_tax_year — bounds the current UK tax year', () => {
    const now = new Date('2026-07-01T12:00:00Z');
    const { start, end, label } = resolveExportPeriod('this_tax_year', { now });
    expect(label).toBe('2026-27');
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3); // April
    expect(start.getDate()).toBe(6);
    expect(end.getFullYear()).toBe(2027);
  });

  it('last_tax_year — bounds the PREVIOUS UK tax year', () => {
    const now = new Date('2026-07-01T12:00:00Z');
    const { start, end, label } = resolveExportPeriod('last_tax_year', { now });
    expect(label).toBe('2025-26');
    expect(start.getFullYear()).toBe(2025);
    expect(end.getFullYear()).toBe(2026);
  });

  it('this_quarter — bounds the current calendar quarter', () => {
    const now = new Date('2026-05-15T12:00:00Z');
    const { start, end, label } = resolveExportPeriod('this_quarter', { now });
    expect(label).toBe('2026-Q2');
    expect(start.getMonth()).toBe(3); // Apr
    expect(end.getMonth()).toBe(5); // Jun
  });

  it('custom — uses the supplied start/end', () => {
    const { start, end, label } = resolveExportPeriod('custom', {
      customStart: '2026-01-01',
      customEnd: '2026-03-31',
    });
    expect(label).toBe('2026-01-01_to_2026-03-31');
    expect(start.getMonth()).toBe(0);
    expect(end.getMonth()).toBe(2);
  });

  it('custom — with no dates supplied, bounds are null (no filtering)', () => {
    const { start, end } = resolveExportPeriod('custom', {});
    expect(start).toBeNull();
    expect(end).toBeNull();
  });
});

// ── buildXeroSalesInvoicesCsv ─────────────────────────────────────────────────

describe('buildXeroSalesInvoicesCsv', () => {
  it('emits the exact Xero column headers, in order', () => {
    const csv = buildXeroSalesInvoicesCsv([], {});
    const headerLine = csv.split('\n')[0];
    expect(headerLine).toBe(
      'ContactName,InvoiceNumber,InvoiceDate,DueDate,Description,Quantity,UnitAmount,AccountCode,TaxType,Currency'
    );
  });

  it('one row per invoice line — multi-line invoice repeats InvoiceNumber', () => {
    const job = makeJob({
      lineItems: [
        { desc: 'Labour', cost: 600 },
        { desc: 'Materials', cost: 600 },
      ],
    });
    const { rows } = parseCsv(buildXeroSalesInvoicesCsv([job], {}));
    expect(rows).toHaveLength(2);
    expect(rows[0]['InvoiceNumber']).toBe('INV-001');
    expect(rows[1]['InvoiceNumber']).toBe('INV-001');
    expect(rows[0]['Description']).toBe('Labour');
    expect(rows[1]['Description']).toBe('Materials');
  });

  it('falls back to a single line from job.summary/total when no lineItems', () => {
    const job = makeJob({ lineItems: undefined, total: 1200 });
    const { rows } = parseCsv(buildXeroSalesInvoicesCsv([job], { isVatRegistered: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0]['Description']).toBe('Bathroom retile');
    // 1200 gross at 20% VAT => net 1000.00
    expect(rows[0]['UnitAmount']).toBe('1000.00');
  });

  it('formats dates as DD/MM/YYYY', () => {
    const { rows } = parseCsv(buildXeroSalesInvoicesCsv([makeJob()], {}));
    expect(rows[0]['InvoiceDate']).toBe('10/06/2025');
    expect(rows[0]['DueDate']).toBe('24/06/2025');
  });

  it('falls back to invoiceDate + payment_terms_days when invoiceDueDate is absent', () => {
    const job = makeJob({ invoiceDueDate: undefined });
    const { rows } = parseCsv(
      buildXeroSalesInvoicesCsv([job], { profile: { payment_terms_days: 7 } })
    );
    // invoiceSentAt = 2025-06-10 + 7 days = 2025-06-17
    expect(rows[0]['DueDate']).toBe('17/06/2025');
  });

  it('TaxType is "20% (VAT on Income)" when VAT-registered', () => {
    const { rows } = parseCsv(buildXeroSalesInvoicesCsv([makeJob()], { isVatRegistered: true }));
    expect(rows[0]['TaxType']).toBe('20% (VAT on Income)');
  });

  it('TaxType is "No VAT" when not VAT-registered, and UnitAmount equals the full gross', () => {
    const job = makeJob({ lineItems: [{ desc: 'Job', cost: 500 }] });
    const { rows } = parseCsv(buildXeroSalesInvoicesCsv([job], { isVatRegistered: false }));
    expect(rows[0]['TaxType']).toBe('No VAT');
    expect(rows[0]['UnitAmount']).toBe('500.00');
  });

  it('Currency is always GBP', () => {
    const { rows } = parseCsv(buildXeroSalesInvoicesCsv([makeJob()], {}));
    expect(rows[0]['Currency']).toBe('GBP');
  });

  it('excludes jobs with no invoiceNumber (leads/quotes)', () => {
    const job = makeJob({ invoiceNumber: '' });
    const csv = buildXeroSalesInvoicesCsv([job], {});
    expect(csv.trim().split('\n')).toHaveLength(1); // header only
  });

  it('excludes cancelled jobs even if invoiceNumber is set', () => {
    const job = makeJob({ status: 'cancelled', paymentStatus: 'cancelled' });
    const csv = buildXeroSalesInvoicesCsv([job], {});
    expect(csv.trim().split('\n')).toHaveLength(1);
  });

  it('filters out invoices outside the supplied date range', () => {
    const inPeriod = makeJob({ id: 'a', invoiceNumber: 'INV-A', invoiceSentAt: '2025-06-10T00:00:00Z' });
    const outOfPeriod = makeJob({ id: 'b', invoiceNumber: 'INV-B', invoiceSentAt: '2024-01-01T00:00:00Z' });
    const start = new Date('2025-04-06');
    const end = new Date('2026-04-05T23:59:59');
    const { rows } = parseCsv(buildXeroSalesInvoicesCsv([inPeriod, outOfPeriod], { start, end }));
    expect(rows).toHaveLength(1);
    expect(rows[0]['InvoiceNumber']).toBe('INV-A');
  });

  it('escapes a comma in the customer name', () => {
    const job = makeJob({ customer: 'Smith, Alan' });
    const csv = buildXeroSalesInvoicesCsv([job], {});
    expect(csv).toContain('"Smith, Alan"');
  });

  it('escapes double-quotes in the description', () => {
    const job = makeJob({ lineItems: [{ desc: 'The "best" tiling', cost: 100 }] });
    const csv = buildXeroSalesInvoicesCsv([job], {});
    expect(csv).toContain('"The ""best"" tiling"');
  });

  it('AccountCode is always blank (deliberate — see module header)', () => {
    const { rows } = parseCsv(buildXeroSalesInvoicesCsv([makeJob()], {}));
    expect(rows[0]['AccountCode']).toBe('');
  });

  it('amounts are plain numbers — no £ symbol, no thousands comma', () => {
    const job = makeJob({ lineItems: [{ desc: 'Big job', cost: 12000 }] });
    const csv = buildXeroSalesInvoicesCsv([job], { isVatRegistered: false });
    expect(csv).not.toContain('£');
    expect(csv).not.toContain('12,000');
    expect(csv).toContain('12000.00');
  });

  it('handles an empty jobs array — header only', () => {
    expect(buildXeroSalesInvoicesCsv([], {}).trim().split('\n')).toHaveLength(1);
  });
});

// ── buildXeroBillsCsv ─────────────────────────────────────────────────────────

describe('buildXeroBillsCsv', () => {
  it('emits the exact Xero Bills headers, in order', () => {
    const headerLine = buildXeroBillsCsv([], {}).split('\n')[0];
    expect(headerLine).toBe('ContactName,InvoiceNumber,InvoiceDate,Description,Quantity,UnitAmount,AccountCode,TaxType');
  });

  it('uses the receipt merchant/label as ContactName', () => {
    const { rows } = parseCsv(buildXeroBillsCsv([makeReceipt({ label: 'Wickes' })], {}));
    expect(rows[0]['ContactName']).toBe('Wickes');
  });

  it('nets out the receipt\'s OWN recorded VAT figure when VAT-registered', () => {
    const receipt = makeReceipt({ amount: 120, vat: 20 });
    const { rows } = parseCsv(buildXeroBillsCsv([receipt], { isVatRegistered: true }));
    expect(rows[0]['UnitAmount']).toBe('100.00');
    expect(rows[0]['TaxType']).toBe('20% (VAT on Expenses)');
  });

  it('uses the FULL gross amount when not VAT-registered (no VAT to reclaim)', () => {
    const receipt = makeReceipt({ amount: 120, vat: 20 });
    const { rows } = parseCsv(buildXeroBillsCsv([receipt], { isVatRegistered: false }));
    expect(rows[0]['UnitAmount']).toBe('120.00');
    expect(rows[0]['TaxType']).toBe('No VAT');
  });

  it('uses the receipt\'s own invoiceNumber when present', () => {
    const receipt = makeReceipt({ invoiceNumber: 'SUP-REF-42' });
    const { rows } = parseCsv(buildXeroBillsCsv([receipt], {}));
    expect(rows[0]['InvoiceNumber']).toBe('SUP-REF-42');
  });

  it('generates a stable fallback ref when the receipt has no invoiceNumber', () => {
    const receipt = makeReceipt({ id: 777, invoiceNumber: null });
    const { rows } = parseCsv(buildXeroBillsCsv([receipt], {}));
    expect(rows[0]['InvoiceNumber']).toBe('RCPT-777');
  });

  it('Quantity is always 1', () => {
    const { rows } = parseCsv(buildXeroBillsCsv([makeReceipt()], {}));
    expect(rows[0]['Quantity']).toBe('1');
  });

  it('filters receipts outside the supplied date range', () => {
    const inPeriod = makeReceipt({ id: 1, date: '2025-06-05' });
    const outOfPeriod = makeReceipt({ id: 2, date: '2020-01-01' });
    const start = new Date('2025-04-06');
    const end = new Date('2026-04-05T23:59:59');
    const { rows } = parseCsv(buildXeroBillsCsv([inPeriod, outOfPeriod], { start, end }));
    expect(rows).toHaveLength(1);
  });
});

// ── buildQuickBooksInvoicesCsv ────────────────────────────────────────────────

describe('buildQuickBooksInvoicesCsv', () => {
  it('emits the expected QuickBooks Invoices headers', () => {
    const headerLine = buildQuickBooksInvoicesCsv([], {}).split('\n')[0];
    expect(headerLine).toBe('InvoiceNo,Customer,InvoiceDate,DueDate,Description,Qty,Amount,TaxAmount');
  });

  it('Amount + TaxAmount reconciles to the gross the customer paid', () => {
    const job = makeJob({ lineItems: [{ desc: 'Job', cost: 240 }] });
    const { rows } = parseCsv(buildQuickBooksInvoicesCsv([job], { isVatRegistered: true }));
    const amount = Number(rows[0]['Amount']);
    const taxAmount = Number(rows[0]['TaxAmount']);
    expect(Math.round((amount + taxAmount) * 100) / 100).toBe(240);
    expect(rows[0]['TaxAmount']).toBe('40.00');
  });

  it('TaxAmount is 0.00 when not VAT-registered', () => {
    const job = makeJob({ lineItems: [{ desc: 'Job', cost: 240 }] });
    const { rows } = parseCsv(buildQuickBooksInvoicesCsv([job], { isVatRegistered: false }));
    expect(rows[0]['TaxAmount']).toBe('0.00');
    expect(rows[0]['Amount']).toBe('240.00');
  });

  it('excludes non-invoiced jobs', () => {
    const job = makeJob({ invoiceNumber: '' });
    expect(buildQuickBooksInvoicesCsv([job], {}).trim().split('\n')).toHaveLength(1);
  });
});

// ── buildQuickBooksExpensesCsv ────────────────────────────────────────────────

describe('buildQuickBooksExpensesCsv', () => {
  it('emits Date, Description, Amount headers', () => {
    expect(buildQuickBooksExpensesCsv([], {}).split('\n')[0]).toBe('Date,Description,Amount');
  });

  it('Amount is the full gross (actual money out)', () => {
    const { rows } = parseCsv(buildQuickBooksExpensesCsv([makeReceipt({ amount: 84.5 })], {}));
    expect(rows[0]['Amount']).toBe('84.50');
  });
});

// ── buildPaymentsCsv ──────────────────────────────────────────────────────────

describe('buildPaymentsCsv', () => {
  it('includes only paid jobs', () => {
    const paid = makeJob({ id: 'p1', paid: true, paymentDate: '2025-07-01', total: 1200 });
    const unpaid = makeJob({ id: 'p2', paid: false, paymentStatus: 'awaiting' });
    const { rows } = parseCsv(buildPaymentsCsv([paid, unpaid], {}));
    expect(rows).toHaveLength(1);
    expect(rows[0]['Amount']).toBe('1200.00');
  });
});

// ── buildAccountantExportFiles (orchestrator) ─────────────────────────────────

describe('buildAccountantExportFiles', () => {
  it('xero platform returns Sales Invoices + Bills + Payments files with OHNAR-prefixed names', () => {
    const { files, zipFilename } = buildAccountantExportFiles({
      platform: 'xero',
      jobs: [makeJob()],
      receipts: [makeReceipt()],
      period: 'this_tax_year',
      now: new Date('2025-07-01'),
    });
    const names = files.map(f => f.filename);
    expect(names).toContain('OHNAR-Xero-Sales-Invoices-2025-26.csv');
    expect(names).toContain('OHNAR-Xero-Bills-2025-26.csv');
    expect(names).toContain('OHNAR-Xero-Payments-2025-26.csv');
    expect(zipFilename).toBe('OHNAR-Xero-Export-2025-26.zip');
  });

  it('quickbooks platform returns Invoices + Expenses + Payments files', () => {
    const { files, zipFilename } = buildAccountantExportFiles({
      platform: 'quickbooks',
      jobs: [makeJob()],
      receipts: [makeReceipt()],
      period: 'this_tax_year',
      now: new Date('2025-07-01'),
    });
    const names = files.map(f => f.filename);
    expect(names).toContain('OHNAR-QuickBooks-Invoices-2025-26.csv');
    expect(names).toContain('OHNAR-QuickBooks-Expenses-2025-26.csv');
    expect(names).toContain('OHNAR-QuickBooks-Payments-2025-26.csv');
    expect(zipFilename).toBe('OHNAR-QuickBooks-Export-2025-26.zip');
  });
});

// ── buildAccountantExportZipBlob ───────────────────────────────────────────────

describe('buildAccountantExportZipBlob', () => {
  it('produces a ZIP blob containing every supplied file with matching content', async () => {
    const files = [
      { filename: 'a.csv', content: 'col1,col2\nfoo,bar' },
      { filename: 'b.csv', content: 'x,y\n1,2' },
    ];
    const blob = await buildAccountantExportZipBlob(files);
    expect(blob).toBeInstanceOf(Blob);

    // Round-trip through JSZip to verify the archive actually contains what we put in.
    // Node's Blob has no FileReader (browser-only), so JSZip can't read a Blob
    // directly in this test environment — convert to ArrayBuffer first, which
    // JSZip supports everywhere. The production code path (real browser) uses
    // the Blob returned above directly with downloadOrShare(), unaffected by this.
    const { default: JSZip } = await import('jszip');
    const arrayBuffer = await blob.arrayBuffer();
    const loaded = await JSZip.loadAsync(arrayBuffer);
    expect(Object.keys(loaded.files).sort()).toEqual(['a.csv', 'b.csv']);
    const aContent = await loaded.files['a.csv'].async('string');
    expect(aContent).toBe('col1,col2\nfoo,bar');
  });
});
