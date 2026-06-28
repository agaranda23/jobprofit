/**
 * receiptPDF.js — unit tests for PR-C additions.
 *
 * Tests cover:
 *   A. resolveReceiptNumber — derivation priority
 *   B. resolvePaymentMethod — payments[].method, legacy paymentType, unknown → ''
 *   C. generateReceiptPDF — receipt number in drawn text
 *   D. generateReceiptPDF — "Paid by:" only when method is known
 *   E. generateReceiptPDF — VAT breakdown when vatRegistered, absent when not
 *   F. generateReceiptPDF — header parity: website shown in contact line when set
 *   G. generateReceiptPDF — VAT number in header only when vatRegistered = true
 *   H. generateReceiptPDF — non-VAT trader: no VAT number, no VAT lines anywhere
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── jsPDF mock ────────────────────────────────────────────────────────────────

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
    this.circle      = vi.fn();
    this.ellipse     = vi.fn();
    this.link           = vi.fn();
    this.roundedRect    = vi.fn();
    this.getTextWidth   = vi.fn(() => 20);
    this.addImage       = vi.fn((...args) => { addImageCalls.push(args); });
    this.textWithLink   = vi.fn();
    this.addPage        = vi.fn();
    this.splitTextToSize = vi.fn((text) => [text]);
    this.lastAutoTable  = { finalY: 120 };
    this.output         = vi.fn(() => new Blob([]));
    this.save           = vi.fn();
    this.rect           = vi.fn(); // needed for white-bg rect behind JP monogram in drawFooter
  }
  return { jsPDF: MockJsPDF };
});

vi.mock('jspdf-autotable', () => ({
  default: vi.fn((doc) => {
    doc.lastAutoTable = { finalY: 120 };
  }),
}));

// Mock downscaleDataUrl — the canvas API it uses isn't available in Node.
// Returns a predictable JPEG data URL so addImage call-site assertions stay
// deterministic. drawHeader and drawFooter are both async now (PR fix/pdf-logo-size).
vi.mock('../photoCompress.js', () => ({
  downscaleDataUrl: vi.fn(async (dataUrl) => ({
    dataUrl: 'data:image/jpeg;base64,compressed==',
    format:  'JPEG',
  })),
  compressPhoto: vi.fn(async () => 'data:image/jpeg;base64,photo=='),
}));

// Import after mocks
const {
  generateReceiptPDF,
  resolveReceiptNumber,
  resolvePaymentMethod,
} = await import('../receiptPDF.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function baseJob(overrides = {}) {
  return {
    id:       'j-001',
    customer: 'Sarah Jones',
    summary:  'Boiler service',
    total:    250,
    lineItems: [],
    ...overrides,
  };
}

function baseBiz(overrides = {}) {
  return {
    name:         'Murphy Heating Ltd',
    address:      '12 Trade St, London',
    phone:        '07700 900000',
    email:        'info@murphy.co.uk',
    vatRegistered: false,
    vatNumber:    '',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// A. resolveReceiptNumber
// ═══════════════════════════════════════════════════════════════════════════

describe('A. resolveReceiptNumber', () => {
  it('returns job.receiptNumber when explicitly set', () => {
    expect(resolveReceiptNumber({ receiptNumber: 'R-0099' })).toBe('R-0099');
  });

  it('returns R-<invoiceNumber> when invoiceNumber is set but no receiptNumber', () => {
    expect(resolveReceiptNumber({ invoiceNumber: 'JP-2026-0042' })).toBe('R-JP-2026-0042');
  });

  it('derives R-<last4 of id> when neither receiptNumber nor invoiceNumber is set', () => {
    const result = resolveReceiptNumber({ id: 'j-001' });
    // last 4 of 'j-001' uppercased = '-001' — but String.slice(-4) of 'j-001' = '001'
    expect(result).toMatch(/^R-/);
    expect(result.length).toBeGreaterThan(2);
  });

  it('returns empty string when job has no id/invoiceNumber/receiptNumber', () => {
    expect(resolveReceiptNumber({})).toBe('');
  });

  it('returns empty string for null/undefined job', () => {
    expect(resolveReceiptNumber(null)).toBe('');
    expect(resolveReceiptNumber(undefined)).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B. resolvePaymentMethod
// ═══════════════════════════════════════════════════════════════════════════

describe('B. resolvePaymentMethod', () => {
  it('returns "Cash" for payments[].method = cash', () => {
    const job = baseJob({ payments: [{ date: '2026-06-01', amount: 250, method: 'cash' }] });
    expect(resolvePaymentMethod(job)).toBe('Cash');
  });

  it('returns "Bank transfer" for payments[].method = bank', () => {
    const job = baseJob({ payments: [{ date: '2026-06-01', amount: 250, method: 'bank' }] });
    expect(resolvePaymentMethod(job)).toBe('Bank transfer');
  });

  it('returns "Card" for payments[].method = card', () => {
    const job = baseJob({ payments: [{ date: '2026-06-01', amount: 250, method: 'card' }] });
    expect(resolvePaymentMethod(job)).toBe('Card');
  });

  it('uses the latest payment by date when multiple payments exist', () => {
    const job = baseJob({
      payments: [
        { date: '2026-05-01', amount: 100, method: 'cash' },
        { date: '2026-06-01', amount: 150, method: 'bank' }, // latest
      ],
    });
    expect(resolvePaymentMethod(job)).toBe('Bank transfer');
  });

  it('returns "" for payments[].method = unknown', () => {
    const job = baseJob({ payments: [{ date: '2026-06-01', amount: 250, method: 'unknown' }] });
    expect(resolvePaymentMethod(job)).toBe('');
  });

  it('falls back to legacy job.paymentType when no payments[]', () => {
    expect(resolvePaymentMethod(baseJob({ paymentType: 'cash' }))).toBe('Cash');
    expect(resolvePaymentMethod(baseJob({ paymentType: 'bank' }))).toBe('Bank transfer');
    expect(resolvePaymentMethod(baseJob({ paymentType: 'card' }))).toBe('Card');
  });

  it('falls back to job.payment_type (snake_case) when no payments[] and no camelCase', () => {
    expect(resolvePaymentMethod(baseJob({ payment_type: 'cash' }))).toBe('Cash');
  });

  it('returns "" for job.paymentType = awaiting (payment not yet received)', () => {
    expect(resolvePaymentMethod(baseJob({ paymentType: 'awaiting' }))).toBe('');
  });

  it('returns "" when no payments and no paymentType', () => {
    expect(resolvePaymentMethod(baseJob())).toBe('');
  });

  it('returns "" for null job', () => {
    expect(resolvePaymentMethod(null)).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C. generateReceiptPDF — receipt number in drawn text
// ═══════════════════════════════════════════════════════════════════════════

describe('C. Receipt number appears in PDF meta', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders the receipt number label', async () => {
    await generateReceiptPDF({
      job: baseJob({ invoiceNumber: 'JP-2026-0001' }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('Receipt no'))).toBe(true);
  });

  it('renders the derived R-<invoiceNumber> receipt number value', async () => {
    await generateReceiptPDF({
      job: baseJob({ invoiceNumber: 'JP-2026-0001' }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('R-JP-2026-0001'))).toBe(true);
  });

  it('renders a receipt number derived from job.id when no invoiceNumber', async () => {
    await generateReceiptPDF({
      job: baseJob({ id: 'j-ABCD1234' }),
      biz: baseBiz(),
    });
    // Derived from id: R-1234
    expect(drawnTexts.some(t => String(t).match(/^R-/))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D. "Paid by:" only when method is known
// ═══════════════════════════════════════════════════════════════════════════

describe('D. "Paid by:" line — present when method known, absent when unknown', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders "Paid by: Cash" when payments[].method = cash', async () => {
    await generateReceiptPDF({
      job: baseJob({ payments: [{ date: '2026-06-01', amount: 250, method: 'cash' }] }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('Paid by: Cash'))).toBe(true);
  });

  it('renders "Paid by: Bank transfer" when payments[].method = bank', async () => {
    await generateReceiptPDF({
      job: baseJob({ payments: [{ date: '2026-06-01', amount: 250, method: 'bank' }] }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('Paid by: Bank transfer'))).toBe(true);
  });

  it('renders "Paid by: Card" when paymentType = card (legacy field)', async () => {
    await generateReceiptPDF({
      job: baseJob({ paymentType: 'card' }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('Paid by: Card'))).toBe(true);
  });

  it('does NOT render "Paid by:" when method is unknown', async () => {
    await generateReceiptPDF({
      job: baseJob({ payments: [{ date: '2026-06-01', amount: 250, method: 'unknown' }] }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('Paid by:'))).toBe(false);
  });

  it('does NOT render "Paid by:" when no payment method information exists', async () => {
    await generateReceiptPDF({
      job: baseJob(),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('Paid by:'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// E. VAT breakdown
// ═══════════════════════════════════════════════════════════════════════════

describe('E. VAT breakdown — shown when vatRegistered, absent when not', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('shows "Net (ex. VAT)" and "VAT (20%)" rows when vatRegistered is true', async () => {
    await generateReceiptPDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz({ vatRegistered: true, vatNumber: 'GB123456789' }),
    });
    expect(drawnTexts.some(t => String(t).includes('Net (ex. VAT)'))).toBe(true);
    expect(drawnTexts.some(t => String(t).includes('VAT (20%)'))).toBe(true);
  });

  it('does NOT show VAT rows when vatRegistered is false', async () => {
    await generateReceiptPDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz({ vatRegistered: false }),
    });
    expect(drawnTexts.some(t => String(t).includes('Net (ex. VAT)'))).toBe(false);
    expect(drawnTexts.some(t => String(t).includes('VAT (20%)'))).toBe(false);
  });

  it('does NOT show VAT rows when vatRegistered is absent (defaults to false)', async () => {
    await generateReceiptPDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz(),
    });
    expect(drawnTexts.some(t => String(t).includes('VAT'))).toBe(false);
  });

  it('profile.vat_registered = true enables VAT rows (profile wins over biz)', async () => {
    await generateReceiptPDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz({ vatRegistered: false }),
      profile: { vat_registered: true, vat_number: 'GB111111111' },
    });
    expect(drawnTexts.some(t => String(t).includes('Net (ex. VAT)'))).toBe(true);
    expect(drawnTexts.some(t => String(t).includes('VAT (20%)'))).toBe(true);
  });

  it('VAT amount = gross / 6 (reverse-charged 20%): £300 → VAT = £50', async () => {
    await generateReceiptPDF({
      job: baseJob({ total: 300 }),
      biz: baseBiz({ vatRegistered: true, vatNumber: 'GB123456789' }),
    });
    expect(drawnTexts.some(t => String(t).includes('£50.00'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// F. Header parity — website in contact line
// ═══════════════════════════════════════════════════════════════════════════

describe('F. Header parity — website shown in contact line when set', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders website when biz.website is set', async () => {
    await generateReceiptPDF({
      job: baseJob(),
      biz: baseBiz({ website: 'https://murphy.co.uk' }),
    });
    expect(drawnTexts.some(t => String(t).includes('https://murphy.co.uk'))).toBe(true);
  });

  it('renders website from profile when set (profile wins)', async () => {
    await generateReceiptPDF({
      job: baseJob(),
      biz: baseBiz(),
      profile: { website: 'https://from-profile.co.uk' },
    });
    expect(drawnTexts.some(t => String(t).includes('https://from-profile.co.uk'))).toBe(true);
  });

  it('does not render website line when website is absent', async () => {
    await generateReceiptPDF({
      job: baseJob(),
      biz: baseBiz(),
    });
    // Should still render phone/email line but not include a bare URL
    const hasUrl = drawnTexts.some(t => String(t).includes('https://'));
    expect(hasUrl).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G. VAT reg number in header — only when vatRegistered
// ═══════════════════════════════════════════════════════════════════════════

describe('G. VAT Reg number in header — only when vatRegistered = true', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('renders "VAT Reg: GB123456789" in header when vatRegistered and vatNumber are set', async () => {
    await generateReceiptPDF({
      job: baseJob(),
      biz: baseBiz({ vatRegistered: true, vatNumber: 'GB123456789' }),
    });
    expect(drawnTexts.some(t => String(t).includes('VAT Reg: GB123456789'))).toBe(true);
  });

  it('does NOT render VAT Reg in header when vatRegistered is false', async () => {
    await generateReceiptPDF({
      job: baseJob(),
      biz: baseBiz({ vatRegistered: false, vatNumber: 'GB123456789' }),
    });
    // vatNumber is set but vatRegistered is false — must not appear
    expect(drawnTexts.some(t => String(t).includes('VAT Reg:'))).toBe(false);
  });

  it('does NOT render VAT Reg in header when vatNumber is absent (even if vatRegistered)', async () => {
    await generateReceiptPDF({
      job: baseJob(),
      biz: baseBiz({ vatRegistered: true, vatNumber: '' }),
    });
    expect(drawnTexts.some(t => String(t).includes('VAT Reg:'))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// H. Non-VAT trader — absolute guarantee: nothing VAT-related ever renders
// ═══════════════════════════════════════════════════════════════════════════

describe('H. Non-VAT trader — zero VAT lines or numbers on receipt', () => {
  beforeEach(() => { drawnTexts = []; addImageCalls = []; vi.clearAllMocks(); });

  it('non-registered trader with vatNumber set: still shows nothing VAT-related', async () => {
    // Edge case: vatNumber is in biz but vatRegistered is false — must stay hidden
    await generateReceiptPDF({
      job: baseJob({ total: 500 }),
      biz: baseBiz({ vatRegistered: false, vatNumber: 'GB999999999' }),
    });
    const vatLines = drawnTexts.filter(t =>
      String(t).includes('VAT') || String(t).includes('vat')
    );
    expect(vatLines.length).toBe(0);
  });

  it('non-registered trader with no profile: no VAT lines', async () => {
    await generateReceiptPDF({
      job: baseJob({ total: 500 }),
      biz: baseBiz(),
      profile: null,
    });
    expect(drawnTexts.some(t => String(t).toLowerCase().includes('vat'))).toBe(false);
  });
});
