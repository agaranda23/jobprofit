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
    this.text            = vi.fn((str) => { drawnTexts.push(str); });
    this.line            = vi.fn();
    this.link            = vi.fn();
    this.roundedRect     = vi.fn();
    this.getTextWidth    = vi.fn(() => 20);
    this.addImage        = vi.fn((...args) => { addImageCalls.push(args); });
    this.textWithLink    = vi.fn();
    this.addPage         = vi.fn();
    this.splitTextToSize = vi.fn((text) => [text]);
    this.lastAutoTable   = { finalY: 120 };
    this.output          = vi.fn(() => new Blob([]));
    this.save            = vi.fn();
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

// Mock downscaleDataUrl — the canvas API it uses isn't available in jsdom.
// Returns a predictable JPEG data URL so addImage call-site assertions stay
// deterministic. The shape { dataUrl, format } mirrors the real implementation.
vi.mock('../photoCompress.js', () => ({
  downscaleDataUrl: vi.fn(async (dataUrl) => ({
    dataUrl: 'data:image/jpeg;base64,compressed==',
    format:  'JPEG',
  })),
  compressPhoto: vi.fn(async () => 'data:image/jpeg;base64,photo=='),
}));

// ── Import under test (after mocks) ──────────────────────────────────────────
const { generateInvoicePDF, generateQuotePDF, logoUrlToBase64 } = await import('../invoicePDF.js');

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

  it('VAT is the portion within the gross: £1200 gross → VAT £200 (not £240)', async () => {
    // Prices are VAT-inclusive. £1200 gross = £1000 net + £200 VAT.
    // Old bug (add-on): would have shown £1200 + £240 = £1440 total due. Fixed.
    await generateInvoicePDF({
      job: baseJob({ total: 1200 }),
      biz: baseBiz({ vatRegistered: true, vatNumber: 'GB123456789' }),
      invoiceNumber: 'INV-VAT-03',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('£200.00'))).toBe(true);
  });

  it('Total Payable = entered gross (VAT-inclusive, not inflated): £1200 → £1200', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 1200 }),
      biz: baseBiz({ vatRegistered: true, vatNumber: 'GB123456789' }),
      invoiceNumber: 'INV-VAT-04',
      dueDate: '2026-07-31',
    });
    // Total Payable should be £1200, not £1440 (old bug: 1200 + 240)
    expect(drawnTexts.some(t => String(t).includes('£1200.00') || String(t).includes('£1,200.00'))).toBe(true);
    expect(drawnTexts.some(t => String(t).includes('£1440') || String(t).includes('£1,440'))).toBe(false);
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

  it('Total Payable = gross − CIS deduction (VAT-inclusive pricing): £1200 gross − £240 CIS = £960', async () => {
    // gross = £1200 (VAT-inclusive). Labour = £1200, CIS 20% = £240.
    // Total Payable = £1200 − £240 = £960.
    // (Old bug: would have computed 1200 + 240 VAT − 240 CIS = £1200, inflating the total.)
    await generateInvoicePDF({
      job: baseJob({ total: 1200, cis: true }),
      biz: baseBiz({ vatRegistered: true, vatNumber: 'GB123456789' }),
      profile: { is_cis_subcontractor: true, cis_default_rate: 20 },
      invoiceNumber: 'INV-CIS-M6',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('£960.00') || String(t).includes('£960'))).toBe(true);
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
    // Logo is downscaled before addImage — the first call receives the mock's
    // compressed output, not the raw input, and the format is always JPEG.
    expect(addImageCalls[0][0]).toBe('data:image/jpeg;base64,compressed==');
    expect(addImageCalls[0][1]).toBe('JPEG');
  });

  it('calls addImage when biz.logo_url is set (snake_case profile field)', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz({ logoUrl: '', logo_url: 'data:image/png;base64,fakepng' }),
      invoiceNumber: 'INV-LOGO-02',
      dueDate: '2026-07-31',
    });
    expect(addImageCalls.length).toBeGreaterThan(0);
    // PNG logos are also downscaled and converted to JPEG before embedding.
    expect(addImageCalls[0][0]).toBe('data:image/jpeg;base64,compressed==');
    expect(addImageCalls[0][1]).toBe('JPEG');
  });

  it('does not call addImage for logo when neither logoUrl nor logo_url are set', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz({ logoUrl: '', logo_url: '' }),
      invoiceNumber: 'INV-LOGO-03',
      dueDate: '2026-07-31',
    });
    // When no logo is set, downscaleDataUrl must not be called.
    const { downscaleDataUrl } = await import('../photoCompress.js');
    expect(downscaleDataUrl).not.toHaveBeenCalled();
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

// ── VIII. logoUrlToBase64 — converts remote URLs to base64 data URLs ──────────
//
// This is the fix for the logo-not-rendering bug: jsPDF.addImage() cannot
// reliably fetch remote https:// URLs. logoUrlToBase64 pre-fetches the image
// so addImage always receives a data URL.

describe('VIII. logoUrlToBase64', () => {
  it('returns null for a null/empty input', async () => {
    expect(await logoUrlToBase64(null)).toBeNull();
    expect(await logoUrlToBase64('')).toBeNull();
  });

  it('passes through an already-base64 data URL unchanged', async () => {
    const dataUrl = 'data:image/png;base64,abc123==';
    expect(await logoUrlToBase64(dataUrl)).toBe(dataUrl);
  });

  it('returns null when fetch fails (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const result = await logoUrlToBase64('https://example.com/logo.png');
    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns null when fetch returns a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, blob: vi.fn() }));
    const result = await logoUrlToBase64('https://example.com/logo.png');
    expect(result).toBeNull();
    vi.unstubAllGlobals();
  });

  it('converts a remote URL to a base64 data URL via FileReader', async () => {
    const fakeBlob = new Blob(['fake-image-bytes'], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => fakeBlob }));

    // Mock FileReader as a class so `new FileReader()` works.
    const fakeDataUrl = 'data:image/png;base64,ZmFrZS1pbWFnZS1ieXRlcw==';
    class MockFileReader {
      constructor() {
        this.result = fakeDataUrl;
        this.onloadend = null;
        this.onerror = null;
      }
      readAsDataURL() {
        Promise.resolve().then(() => { if (this.onloadend) this.onloadend(); });
      }
    }
    vi.stubGlobal('FileReader', MockFileReader);

    const result = await logoUrlToBase64('https://example.com/logo.png');
    expect(result).toBe(fakeDataUrl);

    vi.unstubAllGlobals();
  });
});

// ── VIII. Materials margin-leak fix — itemise_documents toggle ────────────────

describe('VIII. itemise_documents toggle gates labour/materials display', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('hides "Labour" and "Additional costs" rows when itemise_documents is false (default)', async () => {
    const receipts = [{ jobId: 'j-001', amount: 200 }];
    await generateInvoicePDF({
      job: baseJob({ total: 800, cis: false }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: false, itemise_documents: false },
      invoiceNumber: 'INV-ITEM-01',
      dueDate: '2026-07-31',
      receipts,
    });
    expect(drawnTexts.some(t => String(t).includes('Labour'))).toBe(false);
    expect(drawnTexts.some(t => String(t).includes('Additional costs'))).toBe(false);
  });

  it('hides labour/materials rows when profile has no itemise_documents field (absent defaults to false)', async () => {
    const receipts = [{ jobId: 'j-001', amount: 150 }];
    await generateInvoicePDF({
      job: baseJob({ total: 600 }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: false }, // no itemise_documents key
      invoiceNumber: 'INV-ITEM-02',
      dueDate: '2026-07-31',
      receipts,
    });
    expect(drawnTexts.some(t => String(t).includes('Labour'))).toBe(false);
    expect(drawnTexts.some(t => String(t).includes('Additional costs'))).toBe(false);
  });

  it('shows "Labour" and "Additional costs" rows when itemise_documents is true', async () => {
    const receipts = [{ jobId: 'j-001', amount: 200 }];
    await generateInvoicePDF({
      job: baseJob({ total: 800 }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: false, itemise_documents: true },
      invoiceNumber: 'INV-ITEM-03',
      dueDate: '2026-07-31',
      receipts,
    });
    expect(drawnTexts.some(t => String(t).includes('Labour'))).toBe(true);
    expect(drawnTexts.some(t => String(t).includes('Additional costs'))).toBe(true);
  });

  it('CRITICAL: CIS deduction still uses materials when itemise_documents is false', async () => {
    // quote = £1000, materials = £300, labour = £700, CIS 20% → £140
    // Even with itemise_documents=false, CIS deduction must be £140 (not £200)
    const receipts = [{ jobId: 'j-001', amount: 300 }];
    await generateInvoicePDF({
      job: baseJob({ total: 1000, cis: true }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: true, cis_default_rate: 20, itemise_documents: false },
      invoiceNumber: 'INV-ITEM-CIS-01',
      dueDate: '2026-07-31',
      receipts,
    });
    // CIS deduction is always shown (legal requirement), correct amount despite hidden labour/mats
    expect(drawnTexts.some(t => String(t).includes('CIS Deduction (20%)'))).toBe(true);
    expect(drawnTexts.some(t => String(t).includes('−£140.00'))).toBe(true);
    // Labour and materials should NOT be shown
    expect(drawnTexts.some(t => String(t).includes('Labour'))).toBe(false);
    expect(drawnTexts.some(t => String(t).includes('Additional costs'))).toBe(false);
  });

  it('Total Payable is shown correctly regardless of itemise_documents setting', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 500 }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: false, itemise_documents: false },
      invoiceNumber: 'INV-ITEM-TOTAL-01',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('Total Payable'))).toBe(true);
    expect(drawnTexts.some(t => String(t).includes('£500.00'))).toBe(true);
  });
});

// ── IX. Quote "valid until" + quote number ────────────────────────────────────

describe('IX. generateQuotePDF — valid until + quote number', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders "Valid until" in the quote meta fields', async () => {
    await generateQuotePDF({
      job: baseJob({ date: '2026-06-01' }),
      biz: baseBiz(),
      profile: { quote_validity_days: 30 },
    });
    expect(drawnTexts.some(t => String(t).includes('Valid until'))).toBe(true);
  });

  it('renders "Quote ref" label in the quote meta fields', async () => {
    await generateQuotePDF({
      job: baseJob({ id: 'j-001' }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('Quote ref'))).toBe(true);
  });

  it('uses job.quoteNumber when present', async () => {
    await generateQuotePDF({
      job: baseJob({ quoteNumber: 'Q-0042' }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('Q-0042'))).toBe(true);
  });

  it('derives valid-until date correctly: 2026-06-01 + 30 days = 01/07/2026', async () => {
    await generateQuotePDF({
      job: baseJob({ date: '2026-06-01' }),
      biz: baseBiz(),
      profile: { quote_validity_days: 30 },
    });
    // 2026-06-01 + 30 days = 2026-07-01
    expect(drawnTexts.some(t => String(t).includes('01/07/2026'))).toBe(true);
  });
});

// ── X. Invoice auto due date from payment_terms_days ─────────────────────────

describe('X. Invoice auto due date from payment_terms_days', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders a "Due" meta field even when no explicit dueDate is supplied', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 400 }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: false, payment_terms_days: 14 },
      invoiceNumber: 'INV-DUE-01',
      // dueDate intentionally omitted — should auto-compute
    });
    expect(drawnTexts.some(t => String(t).includes('Due'))).toBe(true);
  });

  it('explicit dueDate takes precedence over payment_terms_days', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 400 }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: false, payment_terms_days: 14 },
      invoiceNumber: 'INV-DUE-02',
      dueDate: '2026-08-15',
    });
    expect(drawnTexts.some(t => String(t).includes('15/08/2026'))).toBe(true);
  });
});

// ── XI. Thank you line on invoice ─────────────────────────────────────────────

describe('XI. Invoice footer — "Thank you for your business."', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders thank-you text on the invoice', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-TY-01',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('Thank you for your business.'))).toBe(true);
  });

  it('does NOT render thank-you text on a quote PDF', async () => {
    await generateQuotePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('Thank you for your business.'))).toBe(false);
  });
});

// ── XII. Terms & conditions on invoice + quote (PR-C) ─────────────────────────

describe('XII. Terms & conditions — rendered on invoice/quote when set (PR-C)', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders "Terms & conditions" heading when biz.termsText is set on invoice', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz({ termsText: 'Payment due within 14 days.' }),
      invoiceNumber: 'INV-TERMS-01',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('Terms & conditions'))).toBe(true);
  });

  it('renders the actual terms text on invoice', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz({ termsText: 'All work guaranteed for 12 months.' }),
      invoiceNumber: 'INV-TERMS-02',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('All work guaranteed for 12 months.'))).toBe(true);
  });

  it('does NOT render "Terms & conditions" heading when termsText is empty', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz({ termsText: '' }),
      invoiceNumber: 'INV-TERMS-03',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('Terms & conditions'))).toBe(false);
  });

  it('does NOT render "Terms & conditions" when termsText is absent on invoice', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-TERMS-04',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('Terms & conditions'))).toBe(false);
  });

  it('renders "Terms & conditions" on quote when biz.termsText is set', async () => {
    await generateQuotePDF({
      job: baseJob({ total: 500 }),
      biz: baseBiz({ termsText: 'Quote valid 30 days. 50% deposit required.' }),
    });
    expect(drawnTexts.some(t => String(t).includes('Terms & conditions'))).toBe(true);
    expect(drawnTexts.some(t => String(t).includes('Quote valid 30 days. 50% deposit required.'))).toBe(true);
  });

  it('does NOT render "Terms & conditions" on quote when termsText is absent', async () => {
    await generateQuotePDF({
      job: baseJob({ total: 500 }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('Terms & conditions'))).toBe(false);
  });

  it('profile.terms_text flows through to invoice via effectiveBiz', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 400 }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: false, terms_text: 'Terms from profile.' },
      invoiceNumber: 'INV-TERMS-05',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('Terms from profile.'))).toBe(true);
  });
});

// ── XIII. Website in header contact line (PR-C) ───────────────────────────────

describe('XIII. Website in header contact line (PR-C)', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders website in the contact line of the invoice header when set', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz({ website: 'https://murphy.co.uk' }),
      invoiceNumber: 'INV-WEB-01',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('https://murphy.co.uk'))).toBe(true);
  });

  it('renders website from profile when set', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      profile: { is_cis_subcontractor: false, website: 'https://from-profile.co.uk' },
      invoiceNumber: 'INV-WEB-02',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('https://from-profile.co.uk'))).toBe(true);
  });

  it('renders website in the quote header when set', async () => {
    await generateQuotePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz({ website: 'https://murphy.co.uk' }),
    });
    expect(drawnTexts.some(t => String(t).includes('https://murphy.co.uk'))).toBe(true);
  });

  it('does NOT render website line when website is absent', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-WEB-03',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('https://'))).toBe(false);
  });
});

// ── White-label footer: hidePoweredBy flag ────────────────────────────────────
// Pro traders → footer HIDDEN. Free traders → footer SHOWN.
// These tests guard the anchor Pro perk on both invoice and quote PDFs.

describe('white-label footer — hidePoweredBy flag', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; });

  it('invoice PDF shows "Sent with JobProfit" footer for a free trader (hidePoweredBy omitted)', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      invoiceNumber: 'JP-WL-01',
      dueDate: '2026-07-31',
    });
    expect(drawnTexts.some(t => String(t).includes('Sent with JobProfit'))).toBe(true);
  });

  it('invoice PDF shows "Sent with JobProfit" footer when hidePoweredBy is false', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      invoiceNumber: 'JP-WL-02',
      dueDate: '2026-07-31',
      hidePoweredBy: false,
    });
    expect(drawnTexts.some(t => String(t).includes('Sent with JobProfit'))).toBe(true);
  });

  it('invoice PDF HIDES "Sent with JobProfit" footer when hidePoweredBy is true (Pro trader)', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      invoiceNumber: 'JP-WL-03',
      dueDate: '2026-07-31',
      hidePoweredBy: true,
    });
    expect(drawnTexts.some(t => String(t).includes('Sent with JobProfit'))).toBe(false);
  });

  it('invoice PDF footer still has the business name line when hidePoweredBy is true', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz({ name: 'Murphy Plumbing Ltd' }),
      invoiceNumber: 'JP-WL-04',
      dueDate: '2026-07-31',
      hidePoweredBy: true,
    });
    // The main footer line (biz name) should still render
    expect(drawnTexts.some(t => String(t).includes('Murphy Plumbing Ltd') && String(t).includes('Generated'))).toBe(true);
  });

  it('quote PDF shows "Sent with JobProfit" footer for a free trader (hidePoweredBy omitted)', async () => {
    await generateQuotePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('Sent with JobProfit'))).toBe(true);
  });

  it('quote PDF HIDES "Sent with JobProfit" footer when hidePoweredBy is true (Pro trader)', async () => {
    await generateQuotePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      hidePoweredBy: true,
    });
    expect(drawnTexts.some(t => String(t).includes('Sent with JobProfit'))).toBe(false);
  });

  it('PDF footer includes jobprofit.co.uk URL for free traders', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      invoiceNumber: 'JP-WL-05',
      dueDate: '2026-07-31',
      hidePoweredBy: false,
    });
    expect(drawnTexts.some(t => String(t).includes('jobprofit.co.uk'))).toBe(true);
  });

  it('PDF footer does NOT include jobprofit.co.uk URL for Pro traders', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      invoiceNumber: 'JP-WL-06',
      dueDate: '2026-07-31',
      hidePoweredBy: true,
    });
    expect(drawnTexts.some(t => String(t).includes('jobprofit.co.uk'))).toBe(false);
  });
});

// ── Z. Auto-derive deposit from job.payments (bug fix: blank-note deposits) ──
//
// When depositPaidPence is not explicitly passed (defaults to 0), the PDF
// generator now reads job.payments[] and applies:
//   type === 'deposit'  →  structural flag (set by RecordPaymentModal v2)
//   /deposit/i on note  →  back-compat (Stripe webhook, old records)
// This ensures a blank-note deposit recorded via the Record Payment modal still
// shows the "Deposit paid" + "BALANCE DUE" credit lines on the PDF.

describe('Z. generateInvoicePDF — auto-derive deposit from job.payments', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders "Deposit paid" when a payment has type:"deposit" and blank note (bug scenario)', async () => {
    const job = baseJob({
      total: 500,
      payments: [
        { id: 'p1', amount: 125, type: 'deposit', note: '', method: 'bank', date: '2026-06-01', createdAt: '2026-06-01T10:00:00Z' },
      ],
    });
    await generateInvoicePDF({ job, biz: baseBiz(), invoiceNumber: 'INV-Z1', dueDate: '2026-06-30' });
    expect(drawnTexts.some(t => String(t).includes('Deposit paid'))).toBe(true);
  });

  it('renders "BALANCE DUE" when a payment has type:"deposit" and blank note (bug scenario)', async () => {
    const job = baseJob({
      total: 500,
      payments: [
        { id: 'p1', amount: 125, type: 'deposit', note: '', method: 'bank', date: '2026-06-01', createdAt: '2026-06-01T10:00:00Z' },
      ],
    });
    await generateInvoicePDF({ job, biz: baseBiz(), invoiceNumber: 'INV-Z2', dueDate: '2026-06-30' });
    expect(drawnTexts).toContain('BALANCE DUE');
  });

  it('renders correct balance (£500 − £125 = £375.00) for blank-note type:deposit payment', async () => {
    const job = baseJob({
      total: 500,
      payments: [
        { id: 'p1', amount: 125, type: 'deposit', note: '', method: 'bank', date: '2026-06-01', createdAt: '2026-06-01T10:00:00Z' },
      ],
    });
    await generateInvoicePDF({ job, biz: baseBiz(), invoiceNumber: 'INV-Z3', dueDate: '2026-06-30' });
    expect(drawnTexts.some(t => String(t).includes('375.00'))).toBe(true);
  });

  it('still renders deposit credit via note fallback (Stripe "Deposit on acceptance")', async () => {
    const job = baseJob({
      total: 500,
      payments: [
        { id: 'p1', amount: 100, note: 'Deposit on acceptance', method: 'card', date: '2026-06-01', createdAt: '2026-06-01T10:00:00Z' },
      ],
    });
    await generateInvoicePDF({ job, biz: baseBiz(), invoiceNumber: 'INV-Z4', dueDate: '2026-06-30' });
    expect(drawnTexts.some(t => String(t).includes('Deposit paid'))).toBe(true);
    expect(drawnTexts).toContain('BALANCE DUE');
  });

  it('does NOT render deposit credit for a non-deposit payment with blank note and no type flag', async () => {
    const job = baseJob({
      total: 500,
      payments: [
        { id: 'p1', amount: 200, note: '', method: 'bank', date: '2026-06-01', createdAt: '2026-06-01T10:00:00Z' },
      ],
    });
    await generateInvoicePDF({ job, biz: baseBiz(), invoiceNumber: 'INV-Z5', dueDate: '2026-06-30' });
    expect(drawnTexts.some(t => String(t).includes('Deposit paid'))).toBe(false);
    expect(drawnTexts).not.toContain('BALANCE DUE');
  });

  it('explicit depositPaidPence still takes precedence over job.payments derivation', async () => {
    // Caller-supplied value wins — existing tests that pass depositPaidPence
    // explicitly should not change behaviour.
    const job = baseJob({ total: 500 }); // no payments[]
    await generateInvoicePDF({
      job,
      biz: baseBiz(),
      invoiceNumber: 'INV-Z6',
      dueDate: '2026-06-30',
      depositPaidPence: 5000, // £50 supplied explicitly
    });
    expect(drawnTexts.some(t => String(t).includes('Deposit paid'))).toBe(true);
    expect(drawnTexts).toContain('BALANCE DUE');
  });
});

// ── VI-A. Logo downscaling — downscaleDataUrl is called, format is JPEG ─────────────────────
// Regression guard: verifies that the logo compression path is exercised on
// every PDF generation. If downscaleDataUrl is not called, the user logo is
// being embedded at full resolution again (the 6 MB bug).

describe('VI-A. Logo downscaling — downscaleDataUrl is called for every logo', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('calls downscaleDataUrl with the logo URL and maxEdge=600 when a logo is present', async () => {
    const { downscaleDataUrl } = await import('../photoCompress.js');
    await generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz({ logoUrl: 'data:image/png;base64,biglogo==' }),
      invoiceNumber: 'INV-SCALE-01',
      dueDate: '2026-07-31',
    });
    expect(downscaleDataUrl).toHaveBeenCalledWith(
      'data:image/png;base64,biglogo==',
      600,
      0.85,
    );
  });

  it('calls downscaleDataUrl for the quote PDF logo too', async () => {
    const { downscaleDataUrl } = await import('../photoCompress.js');
    await generateQuotePDF({
      job: baseJob(),
      biz: baseBiz({ logoUrl: 'data:image/jpeg;base64,quotelogo==' }),
    });
    expect(downscaleDataUrl).toHaveBeenCalledWith(
      'data:image/jpeg;base64,quotelogo==',
      600,
      0.85,
    );
  });

  it('calls downscaleDataUrl for accepted signature with maxEdge=470, quality=0.80', async () => {
    const { downscaleDataUrl } = await import('../photoCompress.js');
    await generateQuotePDF({
      job: baseJob({ acceptedSignature: 'data:image/png;base64,sig==' }),
      biz: baseBiz(),
    });
    expect(downscaleDataUrl).toHaveBeenCalledWith(
      'data:image/png;base64,sig==',
      470,
      0.80,
    );
  });
});