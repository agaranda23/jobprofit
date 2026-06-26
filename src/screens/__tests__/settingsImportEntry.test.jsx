// @vitest-environment jsdom
/**
 * settingsImportEntry.test.jsx
 *
 * Coverage for feat/settings-import-entry:
 *   1.  "Import jobs" row renders inside the Data & Privacy sub-screen
 *   2.  "Import jobs" row is tappable (not disabled/passive)
 *   3.  "Import jobs" appears BEFORE "Export records" in the Data & Privacy sub-screen
 *   4.  Tapping "Import jobs" opens the import modal (role=dialog, aria-label="Import jobs")
 *   5.  Import modal contains the SpreadsheetImporter upload phase drop-zone
 *   6.  Close button (aria-label="Close") dismisses the import modal
 *   7.  Clicking the modal backdrop dismisses the import modal
 *   8.  Import row has no Pro gate — free user sees it without an upgrade sheet
 *
 * Module mock harness is identical to settingsHubPhase2.test.jsx,
 * extended with addJobToCloud in the store mock.
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

vi.mock('../../lib/exportCsv', () => ({
  buildJobsCsv: vi.fn().mockReturnValue('csv,data'),
  buildEverythingCsv: vi.fn().mockReturnValue('csv,data'),
  downloadOrShareCsv: vi.fn(),
  downloadOrShare: vi.fn(),
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
const SESSION = { user: { id: 'user-123', email: 'test@example.com' } };
const PROFILE_FREE = { plan: 'free', is_cis_subcontractor: false };

function renderHub(profileOverride = PROFILE_FREE, extraProps = {}) {
  return render(
    <SettingsScreen
      session={SESSION}
      profile={profileOverride}
      jobs={[]}
      receipts={[]}
      onSignOut={NOOP}
      onOpenWizard={NOOP}
      onProfileUpdate={NOOP}
      onOpenJob={NOOP}
      {...extraProps}
    />
  );
}

/** Navigate to the Data & Privacy sub-screen from the hub. */
function openDataPrivacy() {
  fireEvent.click(screen.getByText('Data & Privacy'));
}

// ── Specs ─────────────────────────────────────────────────────────────────────

describe('Settings import entry — row visibility', () => {
  it('renders "Import jobs" inside the Data & Privacy sub-screen', () => {
    renderHub();
    openDataPrivacy();
    expect(screen.getByText('Import jobs')).toBeTruthy();
  });

  it('"Import jobs" row is tappable (not disabled)', () => {
    renderHub();
    openDataPrivacy();
    const row = screen.getByText('Import jobs').closest('button');
    expect(row).toBeTruthy();
    expect(row?.disabled).toBe(false);
  });

  it('"Import jobs" row shows the "CSV or Excel" value hint', () => {
    renderHub();
    openDataPrivacy();
    expect(screen.getByText('CSV or Excel')).toBeTruthy();
  });

  it('"Import jobs" appears before "Export records" in DOM order', () => {
    renderHub();
    openDataPrivacy();
    // Collect all text content from the sub-screen buttons
    const buttons = Array.from(document.querySelectorAll('.settings-row'));
    const labels  = buttons.map(b => b.textContent ?? '');
    const importIdx  = labels.findIndex(t => t.includes('Import jobs'));
    const exportIdx  = labels.findIndex(t => t.includes('Export records'));
    expect(importIdx).toBeGreaterThanOrEqual(0);
    expect(exportIdx).toBeGreaterThanOrEqual(0);
    expect(importIdx).toBeLessThan(exportIdx);
  });
});

describe('Settings import entry — modal open/close', () => {
  it('tapping "Import jobs" opens the import dialog', () => {
    renderHub();
    openDataPrivacy();
    fireEvent.click(screen.getByText('Import jobs').closest('button'));
    expect(screen.getByRole('dialog', { name: 'Import jobs' })).toBeTruthy();
  });

  it('import modal contains the SpreadsheetImporter upload phase drop-zone', () => {
    renderHub();
    openDataPrivacy();
    fireEvent.click(screen.getByText('Import jobs').closest('button'));
    // SpreadsheetImporter's upload phase renders the "Drop your spreadsheet here" region
    expect(screen.getByText('Drop your spreadsheet here')).toBeTruthy();
  });

  it('import modal contains the "Choose file" button', () => {
    renderHub();
    openDataPrivacy();
    fireEvent.click(screen.getByText('Import jobs').closest('button'));
    expect(screen.getByText('Choose file')).toBeTruthy();
  });

  it('close button (aria-label="Close") dismisses the import modal', () => {
    renderHub();
    openDataPrivacy();
    fireEvent.click(screen.getByText('Import jobs').closest('button'));
    // Modal is open
    expect(screen.getByRole('dialog', { name: 'Import jobs' })).toBeTruthy();
    // Tap the close button
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    // Modal is gone
    expect(screen.queryByRole('dialog', { name: 'Import jobs' })).toBeNull();
  });

  it('clicking the backdrop dismisses the import modal', () => {
    renderHub();
    openDataPrivacy();
    fireEvent.click(screen.getByText('Import jobs').closest('button'));
    expect(screen.getByRole('dialog', { name: 'Import jobs' })).toBeTruthy();
    // The backdrop is the dialog element itself (click propagates unless inner div stops it)
    const backdrop = screen.getByRole('dialog', { name: 'Import jobs' });
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog', { name: 'Import jobs' })).toBeNull();
  });
});

describe('Settings import entry — no Pro gate', () => {
  it('free user can open the import modal without seeing an upgrade sheet', () => {
    renderHub(PROFILE_FREE);
    openDataPrivacy();
    fireEvent.click(screen.getByText('Import jobs').closest('button'));
    // Import dialog is open
    expect(screen.getByRole('dialog', { name: 'Import jobs' })).toBeTruthy();
    // ProUpgradeSheet should NOT be in the DOM
    expect(screen.queryByRole('dialog', { name: /upgrade/i })).toBeNull();
    expect(screen.queryByText(/upgrade to Pro/i)).toBeNull();
  });
});
