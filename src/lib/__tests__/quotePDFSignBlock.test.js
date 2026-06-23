/**
 * Tests for the accept-quote link + QR block added to generateQuotePDF.
 *
 * Phase G-2 update: "Tap to view and sign" → "Tap to view and accept".
 * The CTA block is now skipped when quoteStatus is 'accepted' or 'declined',
 * in addition to the legacy acceptedSignature check.
 *
 * Covers:
 *   1. No crash when called with quoteUrl + qrDataUrl
 *   2. Backwards compat — no crash without quoteUrl/qrDataUrl
 *   3. No crash when qrDataUrl is empty (QR failed — button-only fallback)
 *   4. No crash when acceptedSignature is set (legacy signed)
 *   5. CTA drawn — "Tap to view and accept" text present for unsigned quote
 *   6. CTA skipped — text absent when quoteUrl is empty
 *   7. CTA skipped — text absent when acceptedSignature is present (legacy)
 *   8. CTA skipped — text absent when quoteStatus is accepted (G-2)
 *   9. CTA skipped — text absent when quoteStatus is declined (G-2)
 *  10. doc.link called with quoteUrl when CTA is shown
 *  11. doc.link NOT called when CTA is skipped
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── jsPDF mock (reuses the same shape as invoicePDF.test.js) ─────────────────

let drawnTexts = [];
let linkCalls = [];

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
    this.link           = vi.fn((...args) => { linkCalls.push(args); });
    this.roundedRect    = vi.fn();
    this.getTextWidth   = vi.fn(() => 20);
    this.addImage       = vi.fn();
    this.textWithLink   = vi.fn();
    this.addPage        = vi.fn();
    this.lastAutoTable  = { finalY: 120 };
    this.output         = vi.fn(fmt => fmt === 'arraybuffer' ? new ArrayBuffer(2000) : new Blob(['%PDF-1.4 fake']));
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

const { generateQuotePDF } = await import('../invoicePDF.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function baseJob(overrides = {}) {
  return {
    id:        'j-sign-01',
    customer:  'Test Customer',
    summary:   'Test job',
    total:     500,
    lineItems: [{ desc: 'Labour', cost: 500 }],
    ...overrides,
  };
}

function baseBiz(overrides = {}) {
  return {
    name:          'A Plumbing',
    vatRegistered: false,
    ...overrides,
  };
}

const TEST_URL = 'https://jobprofit.co.uk/q/tok_abc123';
// Minimal 1×1 PNG data URL (valid base64 — won't crash jsPDF addImage mock)
const TEST_QR  = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8//8/AwAI/AL+XJ8FQAAAAABJRU5ErkJggg==';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateQuotePDF — sign-quote link block', () => {
  beforeEach(() => { drawnTexts = []; linkCalls = []; vi.clearAllMocks(); });

  it('1. does not crash when called with quoteUrl + qrDataUrl', () => {
    expect(() =>
      generateQuotePDF({ job: baseJob(), biz: baseBiz(), quoteUrl: TEST_URL, qrDataUrl: TEST_QR })
    ).not.toThrow();
  });

  it('2. does not crash without quoteUrl/qrDataUrl (backwards compat)', () => {
    expect(() =>
      generateQuotePDF({ job: baseJob(), biz: baseBiz() })
    ).not.toThrow();
  });

  it('3. does not crash when qrDataUrl is empty (button-only fallback)', () => {
    expect(() =>
      generateQuotePDF({ job: baseJob(), biz: baseBiz(), quoteUrl: TEST_URL, qrDataUrl: '' })
    ).not.toThrow();
  });

  it('4. does not crash when acceptedSignature is set (legacy signed)', () => {
    const signedJob = { ...baseJob(), acceptedSignature: TEST_QR, acceptedAt: '2026-06-01T10:00:00Z' };
    expect(() =>
      generateQuotePDF({ job: signedJob, biz: baseBiz(), quoteUrl: TEST_URL, qrDataUrl: TEST_QR })
    ).not.toThrow();
  });

  it('5. renders "Tap to view and accept" text when quoteUrl is set and quote undecided', () => {
    generateQuotePDF({ job: baseJob(), biz: baseBiz(), quoteUrl: TEST_URL, qrDataUrl: TEST_QR });
    expect(drawnTexts.some(t => String(t).includes('Tap to view and accept'))).toBe(true);
  });

  it('6. does not render "Tap to view and accept" when quoteUrl is absent', () => {
    generateQuotePDF({ job: baseJob(), biz: baseBiz() });
    expect(drawnTexts.some(t => String(t).includes('Tap to view and accept'))).toBe(false);
  });

  it('7. does not render CTA when acceptedSignature is present (legacy pre-G-2 path)', () => {
    const signedJob = { ...baseJob(), acceptedSignature: TEST_QR, acceptedAt: '2026-06-01T10:00:00Z' };
    generateQuotePDF({ job: signedJob, biz: baseBiz(), quoteUrl: TEST_URL, qrDataUrl: TEST_QR });
    expect(drawnTexts.some(t => String(t).includes('Tap to view and accept'))).toBe(false);
  });

  it('8. does not render CTA when quoteStatus is accepted (G-2 button path)', () => {
    const acceptedJob = { ...baseJob(), quoteStatus: 'accepted', acceptedAt: '2026-06-23T10:00:00Z' };
    generateQuotePDF({ job: acceptedJob, biz: baseBiz(), quoteUrl: TEST_URL, qrDataUrl: TEST_QR });
    expect(drawnTexts.some(t => String(t).includes('Tap to view and accept'))).toBe(false);
  });

  it('9. does not render CTA when quoteStatus is declined (G-2 decline path)', () => {
    const declinedJob = { ...baseJob(), quoteStatus: 'declined', declinedAt: '2026-06-23T10:00:00Z' };
    generateQuotePDF({ job: declinedJob, biz: baseBiz(), quoteUrl: TEST_URL, qrDataUrl: TEST_QR });
    expect(drawnTexts.some(t => String(t).includes('Tap to view and accept'))).toBe(false);
  });

  it('10. doc.link is called with the quoteUrl when CTA is shown', () => {
    generateQuotePDF({ job: baseJob(), biz: baseBiz(), quoteUrl: TEST_URL, qrDataUrl: TEST_QR });
    const linkCall = linkCalls.find(c => c[4]?.url === TEST_URL);
    expect(linkCall).toBeDefined();
  });

  it('11. doc.link is NOT called with the quoteUrl when CTA is skipped (no quoteUrl)', () => {
    generateQuotePDF({ job: baseJob(), biz: baseBiz() });
    const linkCall = linkCalls.find(c => c[4]?.url === TEST_URL);
    expect(linkCall).toBeUndefined();
  });
});
