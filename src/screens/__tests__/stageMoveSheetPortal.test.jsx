// @vitest-environment jsdom
/**
 * Regression test for fix/stage-move-sheet-portal
 *
 * Root cause: the mobile bottom-sheet (.jt-menu--sheet) and its backdrop
 * (.jt-backdrop) were rendered inline inside the .jt tile — a position:relative
 * element that creates its own stacking context. Fixed-position descendants of a
 * stacking-context ancestor paint within that context, so they appeared BEHIND
 * later sibling tiles even with high z-index values.
 *
 * Fix: both elements are now createPortal()'d to document.body, exactly like the
 * existing desktop dropdown. This test asserts that assertion.
 *
 * Scope: DOM portalling — we confirm the backdrop and sheet mount as direct
 * children of document.body (not inside a .jt tile) when the ⋯ menu is opened.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';

// ── Module mocks (match screenSmoke.test.jsx) ─────────────────────────────────

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    })),
  },
}));

vi.mock('../../lib/store', () => ({
  uploadJobPhoto: vi.fn().mockResolvedValue({ url: 'https://example.com/photo.jpg' }),
  getSignedPhotoUrl: vi.fn().mockResolvedValue('https://example.com/signed.jpg'),
  deleteJobPhoto: vi.fn().mockResolvedValue(null),
  deleteJobFromCloud: vi.fn().mockResolvedValue(null),
  fetchPublicJob: vi.fn().mockResolvedValue({ data: null, error: 'not found' }),
}));

vi.mock('../../lib/telemetry', () => ({ logTelemetry: vi.fn() }));
vi.mock('../../lib/billing', () => ({
  startCheckout: vi.fn().mockResolvedValue({}),
  openBillingPortal: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../lib/pushSubscribe', () => ({
  isPushSupported: vi.fn().mockReturnValue(false),
  getSubscriptionStatus: vi.fn().mockResolvedValue('unsupported'),
  subscribe: vi.fn().mockResolvedValue(null),
  unsubscribe: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../lib/invoicePDF', () => ({
  downloadInvoicePDF: vi.fn().mockResolvedValue(null),
  getInvoicePDFBlob: vi.fn().mockResolvedValue(new Blob()),
  downloadQuotePDF: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../lib/receiptPDF', () => ({
  downloadReceiptPDF: vi.fn().mockResolvedValue(null),
  getReceiptPDFBlob: vi.fn().mockResolvedValue(new Blob()),
}));
vi.mock('../../lib/photoCompress', () => ({
  compressPhoto: vi.fn().mockResolvedValue('data:image/jpeg;base64,abc'),
}));
vi.mock('../../lib/voiceParse', () => ({
  parseJobFromSpeech: vi.fn().mockResolvedValue({ customer: 'Alan', amount: 500 }),
}));
vi.mock('../../lib/receiptOCR', () => ({
  extractReceipt: vi.fn().mockResolvedValue({ merchant: 'Screwfix', total: 42 }),
}));
vi.mock('../../lib/exportCsv', () => ({
  buildJobsCsv: vi.fn().mockReturnValue('csv,data'),
  downloadOrShareCsv: vi.fn(),
}));
vi.mock('../../lib/realtime', () => ({
  subscribeToJobs: vi.fn().mockReturnValue(() => {}),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOOP = () => {};
const BIZ  = { name: 'Test Plumbing Ltd', email: 'test@example.com' };

function makePaidJob(overrides = {}) {
  return {
    id: 'j-paid',
    customer: 'Paid Customer',
    amount: 600,
    total: 600,
    paid: true,
    status: 'paid',
    paymentStatus: 'paid',
    jobStatus: 'paid',
    date: '2026-05-01',
    customerPhone: '07700 900001',
    lineItems: [],
    photos: [],
    jobNotes: [],
    payments: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

import WorkScreen from '../WorkScreen';

describe('StageChipDropdown — mobile sheet + backdrop portal (fix/stage-move-sheet-portal)', () => {
  afterEach(() => {
    // Explicit cleanup ensures portalled nodes (rendered into document.body via
    // createPortal) are removed before the next test, not just the React root div.
    cleanup();
    vi.clearAllMocks();
  });

  it('backdrop renders as a direct child of document.body (not inside a .jt tile)', () => {
    render(
      <WorkScreen
        jobs={[makePaidJob()]}
        receipts={[]}
        onNewJob={NOOP}
        onAddJob={NOOP}
        onAddPayment={NOOP}
        onUpdateJob={NOOP}
        onDeleteJob={NOOP}
        onAddReceipt={NOOP}
        onDeleteReceipt={NOOP}
        biz={BIZ}
        profile={{ plan: 'free', is_cis_subcontractor: false }}
      />
    );

    // Switch to the Paid stage so the tile and its dots button are rendered.
    const paidStage = screen.getByRole('button', { name: /PAID/i });
    fireEvent.click(paidStage);

    // Open the dots menu on the Paid job tile.
    const dotsButton = screen.getByRole('button', { name: /job options/i });
    fireEvent.click(dotsButton);

    // The backdrop must be a direct child of document.body (portalled).
    const backdrop = document.body.querySelector('.jt-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop.parentElement).toBe(document.body);
  });

  it('mobile sheet renders as a direct child of document.body (not inside a .jt tile)', () => {
    render(
      <WorkScreen
        jobs={[makePaidJob()]}
        receipts={[]}
        onNewJob={NOOP}
        onAddJob={NOOP}
        onAddPayment={NOOP}
        onUpdateJob={NOOP}
        onDeleteJob={NOOP}
        onAddReceipt={NOOP}
        onDeleteReceipt={NOOP}
        biz={BIZ}
        profile={{ plan: 'free', is_cis_subcontractor: false }}
      />
    );

    // Click the Paid stage-strip tile (class="stage-tile--paid") to show Paid jobs.
    // Avoids a multi-match with the job tile (role="button") by targeting the class directly.
    const paidStageTile = document.querySelector('.stage-tile--paid');
    fireEvent.click(paidStageTile);
    const dotsButton = screen.getByRole('button', { name: /job options/i });
    fireEvent.click(dotsButton);

    // The sheet must be a direct child of document.body (portalled).
    const sheet = document.body.querySelector('.jt-menu--sheet');
    expect(sheet).not.toBeNull();
    expect(sheet.parentElement).toBe(document.body);
  });

  it('tapping the backdrop closes the sheet', () => {
    render(
      <WorkScreen
        jobs={[makePaidJob()]}
        receipts={[]}
        onNewJob={NOOP}
        onAddJob={NOOP}
        onAddPayment={NOOP}
        onUpdateJob={NOOP}
        onDeleteJob={NOOP}
        onAddReceipt={NOOP}
        onDeleteReceipt={NOOP}
        biz={BIZ}
        profile={{ plan: 'free', is_cis_subcontractor: false }}
      />
    );

    // Click the Paid stage-strip tile (class="stage-tile--paid") to show Paid jobs.
    // Avoids a multi-match with the job tile (role="button") by targeting the class directly.
    const paidStageTile = document.querySelector('.stage-tile--paid');
    fireEvent.click(paidStageTile);
    const dotsButton = screen.getByRole('button', { name: /job options/i });
    fireEvent.click(dotsButton);

    const backdrop = document.body.querySelector('.jt-backdrop');
    expect(backdrop).not.toBeNull();

    fireEvent.click(backdrop);

    // After tapping the backdrop both the sheet and the backdrop should be gone.
    expect(document.body.querySelector('.jt-backdrop')).toBeNull();
    expect(document.body.querySelector('.jt-menu--sheet')).toBeNull();
  });

  it('desktop dropdown also renders as a direct child of document.body (unchanged)', () => {
    render(
      <WorkScreen
        jobs={[makePaidJob()]}
        receipts={[]}
        onNewJob={NOOP}
        onAddJob={NOOP}
        onAddPayment={NOOP}
        onUpdateJob={NOOP}
        onDeleteJob={NOOP}
        onAddReceipt={NOOP}
        onDeleteReceipt={NOOP}
        biz={BIZ}
        profile={{ plan: 'free', is_cis_subcontractor: false }}
      />
    );

    // Click the Paid stage-strip tile (class="stage-tile--paid") to show Paid jobs.
    // Avoids a multi-match with the job tile (role="button") by targeting the class directly.
    const paidStageTile = document.querySelector('.stage-tile--paid');
    fireEvent.click(paidStageTile);
    const dotsButton = screen.getByRole('button', { name: /job options/i });
    fireEvent.click(dotsButton);

    // Desktop dropdown must also be portalled (this was already correct pre-fix).
    const dropdown = document.body.querySelector('.jt-menu--dropdown');
    expect(dropdown).not.toBeNull();
    expect(dropdown.parentElement).toBe(document.body);
  });
});
