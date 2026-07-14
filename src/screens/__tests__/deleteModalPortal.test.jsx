// @vitest-environment jsdom
/**
 * Regression test for fix/delete-modal-portal-nav-overlap
 *
 * Root cause: the confirm-delete modal (.modal-backdrop, opened via
 * setConfirmDeleteJob) was rendered INLINE inside WorkScreen, a descendant of
 * .dp-viewport (position:fixed; z-index:0 — its own stacking context). A
 * position:fixed descendant of a stacking-context ancestor is contained within
 * that context, so the modal's z-index:400 was trapped inside .dp-viewport's
 * layer — .bottom-nav (a z-index:100 SIBLING of .dp-viewport) painted above the
 * whole subtree, hiding the Delete/Cancel buttons. The modal was also a child of
 * the pager's touch subtree, so tap-hold-drag on the dialog bubbled into the
 * horizontal swipe handler and navigated back to Jobs.
 *
 * Fix: the modal is now createPortal()'d to document.body, exactly like the
 * sibling confirmBookJob modal immediately below it. This test asserts that the
 * backdrop mounts as a direct child of document.body once the dialog is open —
 * mirroring the pattern in stageMoveSheetPortal.test.jsx.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';

// ── Module mocks (match screenSmoke.test.jsx / stageMoveSheetPortal.test.jsx) ─

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
  deleteJobWithData: vi.fn().mockResolvedValue(null),
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

function openDeleteConfirmDialog() {
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
  const paidStageTile = document.querySelector('.stage-tile--paid');
  fireEvent.click(paidStageTile);

  // Open the ⋯ job-options menu on the Paid job tile.
  const dotsButton = screen.getByRole('button', { name: /job options/i });
  fireEvent.click(dotsButton);

  // Tap the Delete action chip — this calls handleRequestDeleteJob, which sets
  // confirmDeleteJob and opens the confirm-delete dialog. It does NOT run the
  // actual delete (that only happens after the dialog's own Delete button is
  // tapped), so deleteJobWithData is never invoked by this test.
  const deleteAction = screen.getByRole('menuitem', { name: 'Delete' });
  fireEvent.click(deleteAction);
}

describe('Confirm-delete modal portal (fix/delete-modal-portal-nav-overlap)', () => {
  afterEach(() => {
    // Explicit cleanup ensures portalled nodes (rendered into document.body via
    // createPortal) are removed before the next test, not just the React root div.
    cleanup();
    vi.clearAllMocks();
  });

  it('backdrop renders as a direct child of document.body (not inside .dp-viewport)', () => {
    openDeleteConfirmDialog();

    const dialog = screen.getByRole('alertdialog', { name: /.+/ });
    expect(dialog).toBeTruthy();

    // The backdrop must be a direct child of document.body (portalled) — this
    // is what escapes the .dp-viewport stacking context so .bottom-nav (a
    // sibling of .dp-viewport) no longer paints over the dialog's buttons.
    const backdrop = document.body.querySelector('.modal-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop.parentElement).toBe(document.body);

    // Confirm it is NOT nested inside a .dp-viewport ancestor.
    expect(backdrop.closest('.dp-viewport')).toBeNull();
  });

  it('preserves existing behaviour: tapping the scrim dismisses with no delete', () => {
    openDeleteConfirmDialog();

    const backdrop = document.body.querySelector('.modal-backdrop');
    fireEvent.click(backdrop);

    expect(document.body.querySelector('.modal-backdrop')).toBeNull();
  });

  it('preserves existing behaviour: Cancel dismisses with no delete', () => {
    openDeleteConfirmDialog();

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(document.body.querySelector('.modal-backdrop')).toBeNull();
  });
});
