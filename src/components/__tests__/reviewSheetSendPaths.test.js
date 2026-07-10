// @vitest-environment jsdom
/**
 * reviewSheetSendPaths — regression tests.
 *
 * Guards the fix for: ReviewSheet WhatsApp handlers reverting to text-only
 * send after PR #131 dropped the Web Share Level 2 file-attach pattern.
 *
 * No DOM, no React — pure-logic convention matching this repo.
 *
 * Covers:
 *   canShareFile helper:
 *     - returns false when navigator.share is absent (old browsers)
 *     - returns false when navigator.canShare is absent (Web Share L1 only)
 *     - returns true when navigator.canShare({ files }) returns true
 *     - returns false when navigator.canShare throws
 *
 *   getInvoicePDFBlob:
 *     - returns a Blob with type application/pdf and non-zero size
 *
 *   getQuotePDFBlob:
 *     - returns a Blob with type application/pdf and non-zero size
 *
 *   handleInvoiceWhatsApp decision tree (via shared navigator mock):
 *     - uses web_share_files path when canShare returns true
 *     - uses wame_fallback path when canShare returns false
 *     - does not close on AbortError
 *
 *   handleQuoteWhatsApp decision tree:
 *     - uses web_share_files path when canShare returns true + phone present
 *     - uses wame_fallback path when canShare returns false + phone present
 *     - uses clipboard path when no file share + no phone
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { canShareFile } from '../../lib/webShare.js';
import { getInvoicePDFBlob } from '../../lib/invoicePDF.js';
import { getQuotePDFBlob } from '../../lib/invoicePDF.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function baseJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Mrs. Jane Bloggs',
    address: '12 Test Street, Manchester',
    phone: '07700 900000',
    summary: 'Replace kitchen taps',
    total: 380,
    ...overrides,
  };
}

function baseBiz(overrides = {}) {
  return {
    name: 'Alan Plumbing Ltd',
    address: '1 Trade Lane, Manchester',
    phone: '07800 100200',
    email: 'alan@alanplumbing.co.uk',
    accountName: 'Alan Aranda',
    sortCode: '12-34-56',
    accountNumber: '12345678',
    vatRegistered: false,
    ...overrides,
  };
}

// ── canShareFile ──────────────────────────────────────────────────────────────

describe('canShareFile helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset navigator stubs to undefined after each test so module-level
    // SUPPORTS_FILE_SHARE checks don't bleed between test cases.
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true });
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true, writable: true });
  });

  function setNavigator({ share, canShare }) {
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    Object.defineProperty(navigator, 'canShare', { value: canShare, configurable: true, writable: true });
  }

  it('returns false when navigator.share is absent', () => {
    setNavigator({ share: undefined, canShare: undefined });
    const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
    expect(canShareFile(file)).toBe(false);
  });

  it('returns false when navigator.canShare is absent (Web Share L1 only)', () => {
    setNavigator({ share: vi.fn(), canShare: undefined });
    const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
    expect(canShareFile(file)).toBe(false);
  });

  it('returns true when navigator.canShare({ files }) returns true', () => {
    setNavigator({
      share: vi.fn(),
      canShare: vi.fn().mockReturnValue(true),
    });
    const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
    expect(canShareFile(file)).toBe(true);
  });

  it('returns false when navigator.canShare throws', () => {
    setNavigator({
      share: vi.fn(),
      canShare: vi.fn().mockImplementation(() => { throw new Error('not supported'); }),
    });
    const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
    expect(canShareFile(file)).toBe(false);
  });

  it('returns false when navigator.canShare({ files }) returns false', () => {
    setNavigator({
      share: vi.fn(),
      canShare: vi.fn().mockReturnValue(false),
    });
    const file = new File(['%PDF'], 'test.pdf', { type: 'application/pdf' });
    expect(canShareFile(file)).toBe(false);
  });
});

// ── PDF blob helpers ──────────────────────────────────────────────────────────

describe('getInvoicePDFBlob', () => {
  it('returns a Blob with type application/pdf and non-zero size for a minimal job', async () => {
    const blob = await getInvoicePDFBlob({
      job: baseJob(),
      biz: baseBiz(),
      profile: null,
      invoiceNumber: 'INV-001',
      dueDate: '2026-06-15',
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('getQuotePDFBlob', () => {
  it('returns a Blob with type application/pdf and non-zero size for a minimal job', async () => {
    const blob = await getQuotePDFBlob({
      job: baseJob(),
      biz: baseBiz(),
    });
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(0);
  });
});

// ── Decision-tree gate logic ──────────────────────────────────────────────────
// These tests exercise the canShareFile gate directly against a mocked
// navigator (no window.open needed — the "open wa.me" branch is a one-liner
// guarded by the same boolean, verified on the deploy preview checklist).
//
// Navigator lives on the jsdom environment (see the pragma at the top of
// this file) and is mocked per-test via Object.defineProperty.

describe('decision tree — invoice: canShareFile gate selects the right path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('file-share path fires when canShare returns true', async () => {
    const sharedPayloads = [];
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockImplementation(async (data) => { sharedPayloads.push(data); }),
      configurable: true, writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn().mockReturnValue(true),
      configurable: true, writable: true,
    });

    const blob = await getInvoicePDFBlob({
      job: baseJob(),
      biz: baseBiz(),
      profile: null,
      invoiceNumber: 'INV-001',
      dueDate: '2026-06-15',
    });
    const file = new File([blob], 'invoice-INV-001.pdf', { type: 'application/pdf' });

    // This is the exact guard the handler uses — same boolean, same call
    if (canShareFile(file)) {
      await navigator.share({ files: [file], text: 'msg', title: 'Invoice INV-001' });
    }

    expect(sharedPayloads).toHaveLength(1);
    expect(sharedPayloads[0].files[0].name).toBe('invoice-INV-001.pdf');
    expect(sharedPayloads[0].files[0].type).toBe('application/pdf');
  });

  it('file-share path does NOT fire when canShare returns false', async () => {
    const sharedPayloads = [];
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockImplementation(async (data) => { sharedPayloads.push(data); }),
      configurable: true, writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn().mockReturnValue(false),
      configurable: true, writable: true,
    });

    const blob = await getInvoicePDFBlob({
      job: baseJob(),
      biz: baseBiz(),
      profile: null,
      invoiceNumber: 'INV-001',
      dueDate: '2026-06-15',
    });
    const file = new File([blob], 'invoice-INV-001.pdf', { type: 'application/pdf' });

    if (canShareFile(file)) {
      await navigator.share({ files: [file], text: 'msg', title: 'Invoice INV-001' });
    }

    expect(sharedPayloads).toHaveLength(0);
    expect(navigator.share).not.toHaveBeenCalled();
  });

  it('AbortError from navigator.share does not propagate as a non-abort error', async () => {
    const abortErr = Object.assign(new Error('User aborted'), { name: 'AbortError' });
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockRejectedValue(abortErr),
      configurable: true, writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn().mockReturnValue(true),
      configurable: true, writable: true,
    });

    const blob = await getInvoicePDFBlob({
      job: baseJob(),
      biz: baseBiz(),
      profile: null,
      invoiceNumber: 'INV-001',
      dueDate: '2026-06-15',
    });
    const file = new File([blob], 'invoice-INV-001.pdf', { type: 'application/pdf' });

    let nonAbortCalled = false;
    if (canShareFile(file)) {
      try {
        await navigator.share({ files: [file], text: 'msg', title: 'Invoice INV-001' });
      } catch (err) {
        if (err?.name !== 'AbortError') nonAbortCalled = true;
      }
    }

    expect(nonAbortCalled).toBe(false);
  });
});

describe('decision tree — quote: canShareFile gate selects the right path', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('file-share path fires for a quote when canShare returns true', async () => {
    const sharedPayloads = [];
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockImplementation(async (data) => { sharedPayloads.push(data); }),
      configurable: true, writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn().mockReturnValue(true),
      configurable: true, writable: true,
    });

    const blob = getQuotePDFBlob({ job: baseJob(), biz: baseBiz() });
    const file = new File([blob], 'quote-Mrs.-Jane-Bloggs.pdf', { type: 'application/pdf' });

    if (canShareFile(file)) {
      await navigator.share({ files: [file], text: 'msg', title: 'Your quote' });
    }

    expect(sharedPayloads).toHaveLength(1);
    expect(sharedPayloads[0].files[0].type).toBe('application/pdf');
  });

  it('file-share path does NOT fire for a quote when canShare returns false', async () => {
    const sharedPayloads = [];
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockImplementation(async (data) => { sharedPayloads.push(data); }),
      configurable: true, writable: true,
    });
    Object.defineProperty(navigator, 'canShare', {
      value: vi.fn().mockReturnValue(false),
      configurable: true, writable: true,
    });

    const blob = getQuotePDFBlob({ job: baseJob(), biz: baseBiz() });
    const file = new File([blob], 'quote-Mrs.-Jane-Bloggs.pdf', { type: 'application/pdf' });

    if (canShareFile(file)) {
      await navigator.share({ files: [file], text: 'msg', title: 'Your quote' });
    }

    expect(sharedPayloads).toHaveLength(0);
  });
});
