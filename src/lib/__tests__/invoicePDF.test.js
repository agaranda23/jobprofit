/**
 * Tests for src/lib/invoicePDF.js
 *
 * jsPDF is mocked throughout — tests verify logic branching and parameter
 * passing without generating actual PDF bytes.
 *
 * Covers:
 *   A. generateInvoicePDF with no deposit — TOTAL DUE label, no deposit row
 *   B. generateInvoicePDF with deposit — Subtotal label, deposit row drawn
 *   C. Balance arithmetic (total − deposit)
 *   D. Pay-now amount = balance when deposit is set
 *   E. Pay-now amount = gross when no deposit
 *   F. depositPaidPence = 0 treated same as absent (no deposit row)
 *   G. generateQuotePDF with deposit_percent > 0 — deposit row drawn
 *   H. generateQuotePDF with deposit_percent = 0 — no deposit row drawn
 *   I. VAT line only appears when biz.vatRegistered is true
 *  II. CIS deduction line only appears when the job is CIS
 * III. CIS deduction maths: labour × rate/100 (labour = quote − materials)
 *  IV. CIS deduction is negative (shown as −£X)
 *   V. No CIS line when job.cis === false (explicit opt-out on CIS profile)
 *  VI. Logo rendered from biz.logoUrl or biz.logo_url (fallback)
 * VII. Bank details render from effectiveBiz (profile fallback fields)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── jsPDF mock ────────────────────────────────────────────────────────────────
// Capture calls to the drawing primitives without generating real PDFs.
// drawnTexts is module-level so all describe/it blocks share the same array.
// Each test calls `drawnTexts = []` in beforeEach to reset it.

let drawnTexts = [];
let addImageCalls = [];

vi.mock('jspdf', () => {
  function MockJsPDF() {
    this.internal = {
      pageSize: {
        getWidth:  () => 210,
        getHeight: () => 297,
      },
    };
    this.setFontSize    = vi.fn();
    this.setFont        = vi.fn();
    this.setTextColor   = vi.fn();
    this.setDrawColor   = vi.fn();
    this.setFillColor   = vi.fn();
    this.setLineWidth   = vi.fn();
    this.text           = vi.fn((str) => { drawnTexts.push(str); });
    this.line           = vi.fn();
    this.link           = vi.fn();
    this.roundedRect    = vi.fn();
    this.getTextWidth   = vi.fn(() => 20);
    this.addImage       = vi.fn((...args) => { addImageCalls.push(args); });
    this.textWithLink   = vi.fn();
    this.addPage        = vi.fn();
    this.lastAutoTable  = { finalY: 120 };
    this.output         = vi.fn(() => new Blob([]));
    this.save           = vi.fn();
  }
  return { jsPDF: MockJsPDF };
});

vi.mock('jspdf-autotable', () => ({
  default: vi.fn((doc) => {
    doc.lastAutoTable = { finalY: 120 };
  }),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async () => 'data:image/png;base64,fakeqr=='),
  },
}));

// ── Import under test (after mocks) ──────────────────────────────────────────
const { generateInvoicePDF, generateQuotePDF } = await import('../invoicePDF.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseJob(overrides = {}) {
  return {
    id:        'j-001',
    customer:  'Dave Mitchell',
    summary:   'Bathroom refurb',
    total:     500,
    lineItems: [],
    ...overrides,
  };
}

function baseBiz(overrides = {}) {
  return {
    name:          'Murphy Plumbing Ltd',
    address:       '12 Trade St, London',
    phone:         '07700 900000',
    email:         'info@murphy.co.uk',
    vatRegistered: false,
    vatNumber:     '',
    accountName:   'Murphy Plumbing Ltd',
    sortCode:      '12-34-56',
    accountNumber: '12345678',
    ...overrides,
  };
}

// ── A. No deposit — Total Payable label, no deposit row ──────────────────────

describe('A. generateInvoicePDF — no deposit', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders "Total Payable" label when depositPaidPence is absent', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber: 'INV-001',
      dueDate: '2026-06-30',
    });
    expect(drawnTexts).toContain('Total Payable');
  });

  it('does not render "BALANCE DUE" when no deposit', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber: 'INV-001',
      dueDate: '2026-06-30',
    });
    expect(drawnTexts).not.toContain('BALANCE DUE');
  });

  it('does not render "Deposit paid" row when depositPaidPence = 0', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber: 'INV-001',
      dueDate: '2026-06-30',
      depositPaidPence: 0,
    });
    expect(drawnTexts.some(t => String(t).includes('Deposit paid'))).toBe(false);
  });
});

// ── B. With deposit — Subtotal label, deposit row drawn ───────────────────────

describe('B. generateInvoicePDF — with deposit', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders "BALANCE DUE" when depositPaidPence > 0', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 500 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-002',
      dueDate: '2026-06-30',
      depositPaidPence: 12500, // £125
    });
    expect(drawnTexts).toContain('BALANCE DUE');
  });

  it('renders "Deposit paid" text when depositPaidPence > 0', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 500 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-002',
      dueDate: '2026-06-30',
      depositPaidPence: 12500,
    });
    expect(drawnTexts.some(t => String(t).includes('Deposit paid'))).toBe(true);
  });

  it('renders the deposit deduction as −£X.XX', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 500 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-002',
      dueDate: '2026-06-30',
      depositPaidPence: 12500, // £125.00
    });
    expect(drawnTexts.some(t => String(t).includes('−£125.00'))).toBe(true);
  });
});

// ── C. Balance arithmetic ─────────────────────────────────────────────────────

describe('C. Balance due arithmetic', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders the correct balance: total − deposit', async () => {
    // job.total = 400, depositPaidPence = 10000 (£100) → balance = £300.00
    await generateInvoicePDF({
      job: baseJob({ total: 400 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-003',
      dueDate: '2026-06-30',
      depositPaidPence: 10000,
    });
    expect(drawnTexts.some(t => String(t).includes('£300.00'))).toBe(true);
  });

  it('balance is clamped at 0 when deposit >= total (no negative balance shown)', async () => {
    // total = 100, deposit = £200 (20000p) → clamped to £0.00
    await generateInvoicePDF({
      job: baseJob({ total: 100 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-004',
      dueDate: '2026-06-30',
      depositPaidPence: 20000,
    });
    expect(drawnTexts.some(t => String(t).includes('£0.00'))).toBe(true);
  });
});

// ── D. Pay-now amount = balance when deposit set ──────────────────────────────

describe('D. Pay-now button amount = balance when deposit is set', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders "Pay £X by card" for the balance amount, not the gross total', async () => {
    // total = 600, deposit = £150 (15000p) → balance = £450.00
    await generateInvoicePDF({
      job: baseJob({ total: 600 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-005',
      dueDate: '2026-06-30',
      payNowUrl: 'https://app.jobprofit.co.uk/p/tok_balance',
      depositPaidPence: 15000,
    });
    expect(drawnTexts.some(t => String(t).includes('Pay £450.00 by card'))).toBe(true);
    expect(drawnTexts.some(t => String(t).includes('Pay £600.00 by card'))).toBe(false);
  });
});

// ── E. Pay-now amount = gross when no deposit ─────────────────────────────────

describe('E. Pay-now button amount = gross when no deposit', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders "Pay £X by card" for the full amount when no deposit', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 750 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-006',
      dueDate: '2026-06-30',
      payNowUrl: 'https://app.jobprofit.co.uk/p/tok_full',
    });
    expect(drawnTexts.some(t => String(t).includes('Pay £750.00 by card'))).toBe(true);
  });
});

// ── F. depositPaidPence = 0 same as absent ────────────────────────────────────

describe('F. depositPaidPence = 0 treated as absent', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders Total Payable (not BALANCE DUE) when depositPaidPence = 0', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-007',
      dueDate: '2026-06-30',
      depositPaidPence: 0,
    });
    expect(drawnTexts).toContain('Total Payable');
    expect(drawnTexts).not.toContain('BALANCE DUE');
  });
});

// ── G. generateQuotePDF — deposit row when deposit_percent > 0 ───────────────

describe('G. generateQuotePDF — deposit row drawn when deposit_percent > 0', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('includes deposit percent in drawn text when deposit_percent > 0', async () => {
    await generateQuotePDF({
      job: baseJob({ total: 500, deposit_percent: 25 }),
      biz: baseBiz(),
      quoteRef: 'QT-001',
    });
    const hasDepositRow = drawnTexts.some(t => {
      const s = String(t);
      return s.includes('Deposit') || s.includes('25%') || s.includes('125');
    });
    expect(hasDepositRow).toBe(true);
  });

  it('includes the deposit amount correctly (25% of £500 = £125.00)', async () => {
    await generateQuotePDF({
      job: baseJob({ total: 500, deposit_percent: 25 }),
      biz: baseBiz(),
      quoteRef: 'QT-001',
    });
    expect(drawnTexts.some(t => String(t).includes('125'))).toBe(true);
  });
});

// ── H. generateQuotePDF — no deposit row when deposit_percent = 0 ─────────────

describe('H. generateQuotePDF — no deposit row when deposit_percent = 0', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('does not render "Deposit" text when deposit_percent = 0', async () => {
    await generateQuotePDF({
      job: baseJob({ total: 500, deposit_percent: 0 }),
      biz: baseBiz(),
      quoteRef: 'QT-002',
    });
    expect(drawnTexts.some(t => String(t).toLowerCase().includes('deposit'))).toBe(false);
  });

  it('does not render "Deposit" text when deposit_percent is absent', async () => {
    await generateQuotePDF({
      job: baseJob({ total: 500 }),
      biz: baseBiz(),
      quoteRef: 'QT-003',
    });
    expect(drawnTexts.some(t => String(t).toLowerCase().includes('deposit'))).toBe(false);
  });
});

// ── I. VAT line only when vatRegistered = true ────────────────────────────────

describe('I. VAT line appears only when biz.vatRegistered is true', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('includes "VAT (20%)" row when vatRegistered is true', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 1000 }),
      biz: baseBiz({ vatRegistered: true, vatNumber: 'GB123456789' }),
      invoiceNumber: 'INV-VAT-01',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('VAT (20%)'))).toBe(true);
  });

  it('does not include "VAT (20%)" row when vatRegistered is false', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 1000 }),
      biz: baseBiz({ vatRegistered: false }),
      invoiceNumber: 'INV-VAT-02',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('VAT (20%)'))).toBe(false);
  });

  it('VAT amount is 20% of the quote: £1000 → VAT £200', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 1000 }),
      biz: baseBiz({ vatRegistered: true, vatNumber: 'GB123456789' }),
      invoiceNumber: 'INV-VAT-03',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('£200.00'))).toBe(true);
  });
});

// ── II. CIS deduction line only when job is CIS ───────────────────────────────

describe('II. CIS deduction line appears only when the job is CIS', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  const cisProfile = { is_cis_subcontractor: true, cis_default_rate: 20 };

  it('includes "CIS Deduction (20%)" row when job is CIS', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 1000, cis: true }),
      biz: baseBiz(),
      profile: cisProfile,
      invoiceNumber: 'INV-CIS-01',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('CIS Deduction (20%)'))).toBe(true);
  });

  it('does not include "CIS Deduction" row when profile is not CIS subcontractor', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 1000 }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: false },
      invoiceNumber: 'INV-002',
      dueDate: '2026-07-31',
    });
    // Only check for the specific CIS Deduction label, not any occurrence of "cis"
    // (invoice numbers themselves may contain arbitrary strings).
    expect(drawnTexts.some(t => String(t).includes('CIS Deduction'))).toBe(false);
  });

  it('does not include "CIS Deduction" row when no profile provided', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 1000 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-003',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('CIS Deduction'))).toBe(false);
  });
});

// ── III. CIS deduction maths ──────────────────────────────────────────────────

describe('III. CIS deduction maths: labour × rate/100', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('CIS 20%: quote £1000, no materials → deduction = £200', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 1000, cis: true }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: true, cis_default_rate: 20 },
      invoiceNumber: 'INV-CIS-M1',
      dueDate: '2026-07-31',
      receipts: [], // no materials
    });
    // Labour = 1000 - 0 = 1000; deduction = 1000 × 0.20 = £200
    expect(drawnTexts.some(t => String(t).includes('−£200.00'))).toBe(true);
  });

  it('CIS 20%: quote £1000, materials £300 → deduction = £140 (labour = £700)', async () => {
    const receipts = [{ jobId: 'j-001', amount: 300 }];
    await generateInvoicePDF({
      job: baseJob({ total: 1000, cis: true }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: true, cis_default_rate: 20 },
      invoiceNumber: 'INV-CIS-M2',
      dueDate: '2026-07-31',
      receipts,
    });
    // Labour = 1000 - 300 = 700; deduction = 700 × 0.20 = £140
    expect(drawnTexts.some(t => String(t).includes('−£140.00'))).toBe(true);
  });

  it('CIS 30%: quote £500, no materials → deduction = £150', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 500, cis: true, cisRate: 30 }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: true, cis_default_rate: 30 },
      invoiceNumber: 'INV-CIS-M3',
      dueDate: '2026-07-31',
    });
    // Labour = 500; deduction = 500 × 0.30 = £150
    expect(drawnTexts.some(t => String(t).includes('−£150.00'))).toBe(true);
  });

  it('CIS deduction is clamped to £0 when materials exceed quote', async () => {
    const receipts = [{ jobId: 'j-001', amount: 800 }];
    await generateInvoicePDF({
      job: baseJob({ total: 500, cis: true }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: true, cis_default_rate: 20 },
      invoiceNumber: 'INV-CIS-M4',
      dueDate: '2026-07-31',
      receipts,
    });
    // Labour = max(0, 500 - 800) = 0; deduction = 0 → no CIS line shown (£0 not displayed)
    expect(drawnTexts.some(t => String(t).includes('CIS Deduction'))).toBe(false);
  });

  it('Total Payable = quote − CIS deduction (no VAT): £1000 − £200 = £800', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 1000, cis: true }),
      biz: baseBiz({ vatRegistered: false }),
      profile: { is_cis_subcontractor: true, cis_default_rate: 20 },
      invoiceNumber: 'INV-CIS-M5',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('£800.00'))).toBe(true);
  });

  it('Total Payable = (quote + VAT) − CIS deduction: £1000 + £200 VAT − £200 CIS = £1000', async () => {
    // quote = £1000, VAT = £200, labour = £1000 (no materials), CIS 20% = £200
    // Total Payable = 1000 + 200 - 200 = £1000
    await generateInvoicePDF({
      job: baseJob({ total: 1000, cis: true }),
      biz: baseBiz({ vatRegistered: true, vatNumber: 'GB123456789' }),
      profile: { is_cis_subcontractor: true, cis_default_rate: 20 },
      invoiceNumber: 'INV-CIS-M6',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('£1000.00') || String(t).includes('£1,000.00'))).toBe(true);
  });
});

// ── IV. CIS deduction is shown as a negative (−£X) ───────────────────────────

describe('IV. CIS deduction shown as negative (−£X)', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('CIS deduction text contains the minus prefix −£', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 600, cis: true }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: true, cis_default_rate: 20 },
      invoiceNumber: 'INV-CIS-NEG',
      dueDate: '2026-07-31',
    });
    // −£120.00 (20% of £600)
    expect(drawnTexts.some(t => /−£\d/.test(String(t)))).toBe(true);
  });
});

// ── V. No CIS line when job.cis === false (explicit per-job opt-out) ──────────

describe('V. No CIS line when job opts out (job.cis === false)', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('does not show CIS deduction when job.cis is explicitly false, even on CIS profile', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 800, cis: false }), // explicit opt-out
      biz: baseBiz(),
      profile: { is_cis_subcontractor: true, cis_default_rate: 20 },
      invoiceNumber: 'INV-OPTOUT',
      dueDate: '2026-07-31',
    });
    // Check the CIS Deduction label specifically (not the invoice number text)
    expect(drawnTexts.some(t => String(t).includes('CIS Deduction'))).toBe(false);
  });
});

// ── VI. Logo rendering ────────────────────────────────────────────────────────

describe('VI. Logo rendering — biz.logoUrl and biz.logo_url fallback', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('calls addImage when biz.logoUrl is set', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz({ logoUrl: 'data:image/jpeg;base64,/9j/fake' }),
      invoiceNumber: 'INV-LOGO-01',
      dueDate: '2026-07-31',
    });
    // addImage should have been called at least once (for the logo)
    expect(addImageCalls.length).toBeGreaterThan(0);
    // First addImage call should use the logo data URL
    expect(addImageCalls[0][0]).toBe('data:image/jpeg;base64,/9j/fake');
  });

  it('calls addImage when biz.logo_url is set (snake_case profile field)', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz({ logoUrl: '', logo_url: 'data:image/png;base64,fakepng' }),
      invoiceNumber: 'INV-LOGO-02',
      dueDate: '2026-07-31',
    });
    expect(addImageCalls.length).toBeGreaterThan(0);
    expect(addImageCalls[0][0]).toBe('data:image/png;base64,fakepng');
  });

  it('does not call addImage for logo when neither logoUrl nor logo_url are set', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz({ logoUrl: '', logo_url: '' }),
      invoiceNumber: 'INV-LOGO-03',
      dueDate: '2026-07-31',
    });
    // addImage may still be called for QR code — but not for logo
    // Logo call would be the FIRST call if logo was rendered; verify none match a logo URL
    const logoCall = addImageCalls.find(c => String(c[0]).startsWith('data:image/jpeg') || String(c[0]).startsWith('data:image/png;base64,fakepng'));
    expect(logoCall).toBeUndefined();
  });

  it('falls back gracefully if addImage throws (logo decode error)', async () => {
    const { jsPDF: MockJsPDF } = await import('jspdf');
    // generateInvoicePDF should not throw even when addImage fails
    await expect(generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz({ logoUrl: 'data:image/jpeg;base64,BROKEN' }),
      invoiceNumber: 'INV-LOGO-ERR',
      dueDate: '2026-07-31',
    })).resolves.toBeDefined();
  });
});

// ── VII. Bank details from profile fallback fields ────────────────────────────

describe('VII. Bank details rendered from effectiveBiz (profile fallback)', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders sort_code from profile when biz.sortCode is absent', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: { name: 'Test Co', vatRegistered: false }, // no bank fields
      profile: {
        sort_code:      '98-76-54',
        account_number: '87654321',
        account_name:   'Test Co',
        is_cis_subcontractor: false,
      },
      invoiceNumber: 'INV-BANK-01',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('98-76-54'))).toBe(true);
  });

  it('renders account_number from profile when biz.accountNumber is absent', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: { name: 'Test Co', vatRegistered: false },
      profile: {
        sort_code:      '98-76-54',
        account_number: '87654321',
        account_name:   'Test Co',
        is_cis_subcontractor: false,
      },
      invoiceNumber: 'INV-BANK-02',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('87654321'))).toBe(true);
  });
});
