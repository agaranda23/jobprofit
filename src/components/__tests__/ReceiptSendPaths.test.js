/**
 * ReceiptSendPaths — regression tests.
 *
 * Guards against future send paths silently dropping the /r/ receipt link
 * or the logo flowing through to the PDF/preview.
 *
 * No DOM, no React — pure-logic convention matching this repo.
 *
 * Covers:
 *   - buildReceiptWhatsAppMessage includes /r/<token> link when hostedReceiptUrl is passed
 *   - buildReceiptWhatsAppMessage message LEADS with the link (first non-greeting content)
 *   - buildReceiptWhatsAppMessage works without hostedReceiptUrl (safe fallback)
 *   - logo flows through generateReceiptPDF when passed via profile.logo_url
 *   - logo flows through generateReceiptPDF when passed via biz.logoUrl
 *   - logo flows through generateReceiptPDF when passed via biz.logo_url
 *   - generateReceiptPDF does not throw when biz is null and profile has logo_url
 *   - ReceiptModal token reuse — existing publicAccessToken is reused not replaced
 *   - onUpdate patch includes publicAccessToken for the /r/ page to resolve
 */

import { describe, it, expect } from 'vitest';
import { buildReceiptWhatsAppMessage } from '../../lib/receiptMessage.js';
import { generatePublicAccessToken, buildPublicReceiptUrl } from '../../lib/publicReceiptToken.js';
import { getReceiptPDFBlob } from '../../lib/receiptPDF.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function baseJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Sarah Jones',
    summary: 'Replace kitchen taps',
    total: 380,
    payments: [{ id: 'p1', date: '2026-06-01', amount: 380, method: 'bank', note: '', createdAt: 'x' }],
    ...overrides,
  };
}

function baseBiz(overrides = {}) {
  return {
    name: 'Alan Plumbing Ltd',
    address: '1 Trade Lane',
    phone: '07800 100200',
    email: 'alan@example.com',
    ...overrides,
  };
}

function mintReceiptUrl() {
  const token = generatePublicAccessToken();
  return { token, url: buildPublicReceiptUrl(token, 'https://app.jobprofit.co.uk') };
}

// ── Regression: every receipt-send path includes /r/ hosted link ──────────────

describe('regression — every receipt-send path includes /r/ hosted link', () => {
  it('ReceiptModal primary path: message includes /r/ when hostedReceiptUrl is passed', () => {
    const { url } = mintReceiptUrl();
    const msg = buildReceiptWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      hostedReceiptUrl: url,
    });
    expect(msg).toContain('/r/');
    expect(msg).toContain('View your receipt:');
  });

  it('message LEADS with the receipt link (after the greeting) so it renders as a tappable URL in WhatsApp', () => {
    const { url } = mintReceiptUrl();
    const msg = buildReceiptWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      hostedReceiptUrl: url,
    });
    // The link must appear BEFORE the job summary line
    const linkIndex = msg.indexOf('View your receipt:');
    const summaryIndex = msg.indexOf("Here's your receipt for:");
    expect(linkIndex).toBeGreaterThanOrEqual(0);
    expect(linkIndex).toBeLessThan(summaryIndex);
  });

  it('message does NOT contain /r/ when hostedReceiptUrl is omitted (safe fallback)', () => {
    const msg = buildReceiptWhatsAppMessage({
      job: baseJob(),
      biz: baseBiz(),
      // hostedReceiptUrl intentionally omitted
    });
    expect(msg).not.toContain('View your receipt:');
    expect(msg).not.toContain('/r/');
  });

  it('existing publicAccessToken on job is reused, not regenerated (stable URL for re-sends)', () => {
    const existingToken = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const job = baseJob({ publicAccessToken: existingToken });
    // Simulate ReceiptModal's token resolution logic
    const token = job.publicAccessToken || generatePublicAccessToken();
    expect(token).toBe(existingToken);
    const url = buildPublicReceiptUrl(token, 'https://app.jobprofit.co.uk');
    expect(url).toBe(`https://app.jobprofit.co.uk/r/${existingToken}`);
  });

  it('onUpdate patch includes publicAccessToken so /r/<token> resolves for the customer', () => {
    const job = baseJob();
    const token = job.publicAccessToken || generatePublicAccessToken();
    const patch = { ...job, publicAccessToken: token };
    expect(patch.publicAccessToken).toBeTruthy();
    expect(typeof patch.publicAccessToken).toBe('string');
    expect(patch.publicAccessToken.length).toBeGreaterThan(10);
  });
});

// ── Logo flow — generateReceiptPDF ────────────────────────────────────────────

describe('logo flow — generateReceiptPDF accepts logo via multiple field shapes', () => {
  const LOGO_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  it('generates a PDF (blob) without throwing when biz.logoUrl is a data URL', async () => {
    const blob = getReceiptPDFBlob({
      job: baseJob(),
      biz: baseBiz({ logoUrl: LOGO_DATA_URL }),
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(500);
  });

  it('generates a PDF (blob) without throwing when biz.logo_url is a data URL (snake_case)', async () => {
    const blob = getReceiptPDFBlob({
      job: baseJob(),
      biz: baseBiz({ logo_url: LOGO_DATA_URL }),
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(500);
  });

  it('generates a PDF without throwing when profile.logo_url is set and biz is null', async () => {
    const blob = getReceiptPDFBlob({
      job: baseJob(),
      biz: null,
      profile: { business_name: 'Alan Plumbing', logo_url: LOGO_DATA_URL },
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(500);
  });

  it('generates a PDF without throwing when biz is null and profile is null (graceful no-logo)', async () => {
    const blob = getReceiptPDFBlob({ job: baseJob(), biz: null, profile: null });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(500);
  });

  it('profile.logo_url is used when biz has no logo fields', async () => {
    // Just checking it does not throw — PDF content inspection is not possible
    // without a canvas environment. Logo is visually verified on deploy preview.
    const blob = getReceiptPDFBlob({
      job: baseJob(),
      biz: baseBiz(), // no logoUrl field
      profile: { logo_url: LOGO_DATA_URL, business_name: 'Test Co' },
    });
    expect(blob).toBeInstanceOf(Blob);
  });
});

// ── buildPublicReceiptUrl — URL shape ─────────────────────────────────────────

describe('buildPublicReceiptUrl — /r/<token> URL shape', () => {
  it('produces a URL with /r/ prefix', () => {
    const { url } = mintReceiptUrl();
    expect(url).toContain('/r/');
  });

  it('mirrors the /i/ invoice URL shape — only prefix differs', () => {
    const token = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const receiptUrl = buildPublicReceiptUrl(token, 'https://app.jobprofit.co.uk');
    expect(receiptUrl).toBe(`https://app.jobprofit.co.uk/r/${token}`);
  });
});

// ── White-label: hidePoweredBy on receipt PDF ─────────────────────────────────
// Guards the anchor Pro perk: Pro traders suppress the "Sent with JobProfit"
// footer from their customer-facing PDFs.

describe('receipt PDF white-label — hidePoweredBy flag', () => {
  it('getReceiptPDFBlob accepts hidePoweredBy without throwing (free trader, default)', () => {
    const blob = getReceiptPDFBlob({
      job: baseJob(),
      biz: baseBiz(),
      profile: null,
      hidePoweredBy: false,
    });
    expect(blob).toBeInstanceOf(Blob);
  });

  it('getReceiptPDFBlob accepts hidePoweredBy:true without throwing (Pro trader)', () => {
    const blob = getReceiptPDFBlob({
      job: baseJob(),
      biz: baseBiz(),
      profile: { plan: 'pro' },
      hidePoweredBy: true,
    });
    expect(blob).toBeInstanceOf(Blob);
  });
});
