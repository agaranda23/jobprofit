/**
 * Tests for src/lib/invoicePDF.js — deposit-on-acceptance extensions (PR 4).
 *
 * jsPDF is mocked throughout — tests verify logic branching and parameter
 * passing without generating actual PDF bytes.
 *
 * Covers:
 *   A. generateInvoicePDF with no deposit — TOTAL DUE label, no deposit row
 *   B. generateInvoicePDF with deposit — Subtotal label, deposit row drawn
 *   C. Balance due = grossTotal − depositPaidPence (correct arithmetic)
 *   D. Pay-now amount is balance, not gross, when deposit is set
 *   E. Pay-now amount is gross when no deposit is set
 *   F. depositPaidPence = 0 treated same as absent (no deposit row)
 *   G. generateQuotePDF with deposit_percent > 0 — deposit row drawn
 *   H. generateQuotePDF with deposit_percent = 0 — no deposit row drawn
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── jsPDF mock ────────────────────────────────────────────────────────────────
// Capture calls to the drawing primitives without generating real PDFs.
// drawnTexts is module-level so all describe/it blocks share the same array.
// Each test calls `drawnTexts = []` in beforeEach to reset it.

let drawnTexts = [];

vi.mock('jspdf', () => {
  // jsPDF must be a real constructor (not an arrow fn) so `new jsPDF(...)` works.
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
    this.addImage       = vi.fn();
    this.textWithLink   = vi.fn();
    this.addPage        = vi.fn();
    this.lastAutoTable  = { finalY: 120 };
  }
  return { jsPDF: MockJsPDF };
});

vi.mock('jspdf-autotable', () => ({
  // autoTable(doc, options) — sets doc.lastAutoTable as a side effect
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
    name:    'Murphy Plumbing Ltd',
    address: '12 Trade St, London',
    phone:   '07700 900000',
    email:   'info@murphy.co.uk',
    ...overrides,
  };
}

// ── A. No deposit — TOTAL DUE label, no deposit row ──────────────────────────

describe('A. generateInvoicePDF — no deposit', () => {
  beforeEach(() => { drawnTexts = []; vi.clearAllMocks(); });

  it('renders "TOTAL DUE" label when depositPaidPence is absent', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber: 'INV-001',
      dueDate: '2026-06-30',
    });
    expect(drawnTexts).toContain('TOTAL DUE');
  });

  it('does not render "Subtotal" as totalLabel when no deposit', async () => {
    await generateInvoicePDF({
      job: baseJob(),
      biz: baseBiz(),
      invoiceNumber: 'INV-001',
      dueDate: '2026-06-30',
    });
    // "Subtotal" can appear in the drawTotals breakdown, but "BALANCE DUE" must not
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
  beforeEach(() => { drawnTexts = []; vi.clearAllMocks(); });

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
  beforeEach(() => { drawnTexts = []; vi.clearAllMocks(); });

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
  beforeEach(() => { drawnTexts = []; vi.clearAllMocks(); });

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
    // Pay-now button should show balance (£450.00), not gross (£600.00)
    expect(drawnTexts.some(t => String(t).includes('Pay £450.00 by card'))).toBe(true);
    expect(drawnTexts.some(t => String(t).includes('Pay £600.00 by card'))).toBe(false);
  });
});

// ── E. Pay-now amount = gross when no deposit ─────────────────────────────────

describe('E. Pay-now button amount = gross when no deposit', () => {
  beforeEach(() => { drawnTexts = []; vi.clearAllMocks(); });

  it('renders "Pay £X by card" for the full gross amount when no deposit', async () => {
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
  beforeEach(() => { drawnTexts = []; vi.clearAllMocks(); });

  it('renders TOTAL DUE (not BALANCE DUE) when depositPaidPence = 0', async () => {
    await generateInvoicePDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
      invoiceNumber: 'INV-007',
      dueDate: '2026-06-30',
      depositPaidPence: 0,
    });
    expect(drawnTexts).toContain('TOTAL DUE');
    expect(drawnTexts).not.toContain('BALANCE DUE');
  });
});

// ── G. generateQuotePDF — deposit row when deposit_percent > 0 ───────────────

describe('G. generateQuotePDF — deposit row drawn when deposit_percent > 0', () => {
  beforeEach(() => { drawnTexts = []; vi.clearAllMocks(); });

  it('includes deposit percent in drawn text when deposit_percent > 0', async () => {
    await generateQuotePDF({
      job: baseJob({ total: 500, deposit_percent: 25 }),
      biz: baseBiz(),
      quoteRef: 'QT-001',
    });
    // Should render something containing "25%" or "Deposit"
    const hasDepositRow = drawnTexts.some(t => {
      const s = String(t);
      return s.includes('Deposit') || s.includes('25%') || s.includes('125');
    });
    expect(hasDepositRow).toBe(true);
  });

  it('includes the deposit amount in pence correctly (25% of £500 = £125.00)', async () => {
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
  beforeEach(() => { drawnTexts = []; vi.clearAllMocks(); });

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
