// @vitest-environment jsdom
/**
 * deleteAccountExport.test.jsx
 *
 * Coverage for feat/export-before-delete:
 *   1.  Delete-account confirm dialog renders the "Take your records with you"
 *       export callout above the destructive warning.
 *   2.  The "Download your records" button is present and enabled.
 *   3.  Tapping "Download your records" opens the existing "Export everything"
 *       format sheet (CSV/XLSX/PDF) — reused, not duplicated.
 *   4.  Picking a format (CSV) triggers the real export path
 *       (buildEverythingCsv + downloadOrShareCsv) and closes the format sheet.
 *   5.  The delete-account dialog is still open and untouched after exporting —
 *       the export step never auto-deletes or auto-closes the delete flow.
 *   6.  The destructive "Permanently delete my account" button is still present,
 *       still disabled until "DELETE" is typed — confirms we did not touch the
 *       deletion confirmation logic, only added a step in front of it.
 *
 * Module mock harness matches settingsHubPhase2.test.jsx / settingsImportEntry.test.jsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// ── jsdom stubs ───────────────────────────────────────────────────────────────

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ── Module mocks ──────────────────────────────────────────────────────────────

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
  addJobToCloud: vi.fn().mockResolvedValue({ id: 'imported-job-1' }),
}));

vi.mock('../../lib/telemetry', () => ({
  logTelemetry: vi.fn(),
  setLastUpgradeTrigger: vi.fn(),
  getLastUpgradeTrigger: vi.fn(),
  UPGRADE_TRIGGERS: {
    INSIGHT_LOCKED:    'insight_locked',
    WHITELABEL_FOOTER: 'whitelabel_footer',
    AUTO_CHASE_LOCKED: 'auto_chase_locked',
    SETTINGS:          'settings',
    TRIAL_BANNER:      'trial_banner',
    TODAY_PILL:        'today_pill',
    UPGRADE_BANNER:    'upgrade_banner',
  },
}));

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

const buildEverythingCsv  = vi.fn().mockReturnValue('csv,data');
const buildJobsCsv        = vi.fn().mockReturnValue('csv,data');
const downloadOrShareCsv  = vi.fn().mockResolvedValue(undefined);
const downloadOrShare     = vi.fn().mockResolvedValue(undefined);

vi.mock('../../lib/exportCsv', () => ({
  buildJobsCsv: (...args) => buildJobsCsv(...args),
  buildEverythingCsv: (...args) => buildEverythingCsv(...args),
  downloadOrShareCsv: (...args) => downloadOrShareCsv(...args),
  downloadOrShare: (...args) => downloadOrShare(...args),
}));

vi.mock('../../lib/exportPdf', () => ({
  buildJobsPdf: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/exportXlsx', () => ({
  buildJobsXlsx: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/realtime', () => ({
  subscribeToJobs: vi.fn().mockReturnValue(() => {}),
}));

// ── Component under test ──────────────────────────────────────────────────────

import SettingsScreen from '../SettingsScreen';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOOP = () => {};
const SESSION = { user: { id: 'user-123', email: 'test@example.com' }, access_token: 'token-abc' };
const PROFILE_FREE = { plan: 'free', is_cis_subcontractor: false };
const JOBS = [{ id: 'job-1', customer: 'Test Customer', amount: 250, status: 'paid' }];

function renderHub(extraProps = {}) {
  return render(
    <SettingsScreen
      session={SESSION}
      profile={PROFILE_FREE}
      jobs={JOBS}
      receipts={[]}
      onSignOut={NOOP}
      onOpenWizard={NOOP}
      onProfileUpdate={NOOP}
      onOpenJob={NOOP}
      {...extraProps}
    />
  );
}

/** Navigate Settings hub → Data & Privacy → open the Delete account dialog. */
function openDeleteAccountDialog() {
  fireEvent.click(screen.getByText('Data & Privacy'));
  fireEvent.click(screen.getByText('Delete account').closest('button'));
}

// ── Specs ─────────────────────────────────────────────────────────────────────

describe('Delete account — export-before-delete step', () => {
  it('renders the "Take your records with you" export callout inside the delete dialog', () => {
    renderHub();
    openDeleteAccountDialog();
    expect(screen.getByRole('dialog', { name: 'Delete account' })).toBeTruthy();
    expect(screen.getByText('Take your records with you')).toBeTruthy();
    expect(screen.getByText(/Download it first/)).toBeTruthy();
  });

  it('renders an enabled "Download your records" button', () => {
    renderHub();
    openDeleteAccountDialog();
    const exportBtn = screen.getByRole('button', { name: /Download your records/ });
    expect(exportBtn).toBeTruthy();
    expect(exportBtn.disabled).toBe(false);
  });

  it('tapping "Download your records" opens the "Export everything" format sheet', () => {
    renderHub();
    openDeleteAccountDialog();
    fireEvent.click(screen.getByRole('button', { name: /Download your records/ }));
    expect(screen.getByRole('dialog', { name: 'Export everything' })).toBeTruthy();
  });

  it('picking CSV from the format sheet runs the real export path', async () => {
    renderHub();
    openDeleteAccountDialog();
    fireEvent.click(screen.getByRole('button', { name: /Download your records/ }));
    fireEvent.click(screen.getByText('Spreadsheet (CSV)'));
    // buildEverythingCsv (not buildJobsCsv) confirms this is the "everything" free
    // data-portability export, not the accountant-only records export.
    await vi.waitFor(() => {
      expect(buildEverythingCsv).toHaveBeenCalledWith(JOBS, [], PROFILE_FREE, SESSION);
      expect(downloadOrShareCsv).toHaveBeenCalled();
    });
  });

  it('the format sheet closes after export and the delete dialog is still open', async () => {
    renderHub();
    openDeleteAccountDialog();
    fireEvent.click(screen.getByRole('button', { name: /Download your records/ }));
    fireEvent.click(screen.getByText('Spreadsheet (CSV)'));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Export everything' })).toBeNull();
    });
    // Delete dialog is still there — export never auto-deletes or auto-closes it.
    expect(screen.getByRole('dialog', { name: 'Delete account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Permanently delete my account/ })).toBeTruthy();
  });

  it('the destructive delete button is still present and still gated on typing DELETE', () => {
    renderHub();
    openDeleteAccountDialog();
    const deleteBtn = screen.getByRole('button', { name: /Permanently delete my account/ });
    expect(deleteBtn.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('Type DELETE to confirm'), {
      target: { value: 'DELETE' },
    });
    expect(deleteBtn.disabled).toBe(false);
  });
});
