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
import { render, fireEvent, screen, cleanup, within } from '@testing-library/react';

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
  // tapped), so onDeleteJob is never invoked by this test.
  //
  // The ⋯ menu renders BOTH variants into the DOM simultaneously — the desktop
  // dropdown (.jt-menu--dropdown) and the mobile sheet (.jt-menu--sheet) — each
  // with its own role="menuitem" "Delete" chip. CSS hides one per breakpoint, but
  // jsdom applies no CSS, so both are present. getByRole would throw on the double
  // match; getAllByRole()[0] clicks either — both call the same handleAction('Delete').
  const deleteAction = screen.getAllByRole('menuitem', { name: 'Delete' })[0];
  fireEvent.click(deleteAction);
}

describe('Confirm-delete modal portal (fix/delete-modal-portal-nav-overlap)', () => {
  afterEach(() => {
    // Explicit cleanup ensures portalled nodes (rendered into document.body via
    // createPortal) are removed before the next test, not just the React root div.
    cleanup();
    // Belt-and-braces: strip the shared body class in case a test left it set
    // (cleanup() should already run the effect teardown, but never leak it).
    document.body.classList.remove('overlay-open');
    vi.clearAllMocks();
  });

  it('backdrop renders as a direct child of document.body (portalled)', () => {
    openDeleteConfirmDialog();

    const dialog = screen.getByRole('alertdialog', { name: /.+/ });
    expect(dialog).toBeTruthy();

    // The backdrop must be a direct child of document.body (portalled) — this
    // is what escapes the .dp-viewport stacking context so .bottom-nav (a
    // sibling of .dp-viewport) no longer paints over the dialog's buttons.
    // NB: this assertion genuinely fails pre-fix (the backdrop used to mount deep
    // inside WorkScreen's own subtree, not as a direct child of document.body).
    const backdrop = document.body.querySelector('.modal-backdrop');
    expect(backdrop).not.toBeNull();
    expect(backdrop.parentElement).toBe(document.body);
  });

  it('sets body.overlay-open while open to gate the pager + hide the nav', () => {
    // Symptom 2 of the reported bug: tap-hold-drag on the dialog swiped back to
    // Jobs. The portal alone does not fully stop this (React synthetic touch
    // events still bubble to the pager along the React tree), so the dialog also
    // sets body.overlay-open, which useDashboardPager bails on and which hides
    // .bottom-nav via CSS. This is the discriminating guard for symptom 2.
    expect(document.body.classList.contains('overlay-open')).toBe(false);

    openDeleteConfirmDialog();

    expect(document.body.querySelector('.modal-backdrop')).not.toBeNull();
    expect(document.body.classList.contains('overlay-open')).toBe(true);
  });

  it('preserves existing behaviour: tapping the scrim dismisses with no delete, and clears overlay-open', () => {
    openDeleteConfirmDialog();
    expect(document.body.classList.contains('overlay-open')).toBe(true);

    const backdrop = document.body.querySelector('.modal-backdrop');
    fireEvent.click(backdrop);

    expect(document.body.querySelector('.modal-backdrop')).toBeNull();
    // Closing must release the pager gate, or the whole app would stay swipe-locked.
    expect(document.body.classList.contains('overlay-open')).toBe(false);
  });

  it('preserves existing behaviour: Cancel dismisses with no delete, and clears overlay-open', () => {
    openDeleteConfirmDialog();

    // Scope to the dialog so this can't collide with any other "Cancel" control.
    const dialog = screen.getByRole('alertdialog', { name: /.+/ });
    const cancelBtn = within(dialog).getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(document.body.querySelector('.modal-backdrop')).toBeNull();
    expect(document.body.classList.contains('overlay-open')).toBe(false);
  });
});
