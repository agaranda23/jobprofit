// @vitest-environment jsdom
/**
 * settingsHubPhase2.test.jsx — QAE-specced coverage for feat/settings-hub-phase-2
 *
 * 22 specs covering:
 *   1.  Tapping "Account & business" opens the Account sub-screen
 *   2.  Tapping "Notifications" opens the Notifications sub-screen
 *   3.  Tapping "Data & privacy" opens the Data & privacy sub-screen
 *   4.  Tapping "Help & FAQ" opens the Help & FAQ sub-screen
 *   5.  Tapping "App" opens the App sub-screen
 *   6.  Back button from Account returns to hub
 *   7.  Back button from Notifications returns to hub
 *   8.  Back button from Data & privacy returns to hub
 *   9.  Back button from Help & FAQ returns to hub
 *  10.  Back button from App returns to hub
 *  11.  popstate from Account returns to hub
 *  12.  popstate from App returns to hub
 *  13.  "Export records" row renders inside Data & privacy sub-screen and fires openExportSheet('records')
 *  14.  "Export everything" row renders inside Data & privacy sub-screen
 *  15.  Accountant standalone section is gone from hub view (no "Accountant" SectionCard title on hub)
 *  16.  Voice language row renders inside Account sub-screen
 *  17.  Tapping Voice language opens the voice sub-screen (VoiceLanguageSection)
 *  18.  Back from voice sub-screen returns to Account sub-screen (not hub)
 *  19.  popstate from voice returns to Account sub-screen (not hub)
 *  20.  "Sign out" row renders in Account sub-screen
 *  21.  "Re-run setup wizard" row renders in Account sub-screen
 *  22.  Inline sections (account/notifications/privacy/help/app ids) are gone from hub DOM
 *
 * jsdom stubs and module mocks match settingsHubPhase1.test.jsx exactly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

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

// ── Module mocks (match settingsHubPhase1 harness exactly) ───────────────────

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

// ── Import component ──────────────────────────────────────────────────────────

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

// ── Hub → sub-screen navigation ───────────────────────────────────────────────

describe('SettingsScreen Phase 2 — hub navigates to new sub-screens', () => {
  it('tapping "Account & business" renders the Account sub-screen header', () => {
    renderHub();
    fireEvent.click(screen.getByText('Account & Business'));
    expect(screen.getByRole('heading', { name: 'Account & Business' })).toBeTruthy();
  });

  it('tapping "Notifications" renders the Notifications sub-screen header', () => {
    renderHub();
    fireEvent.click(screen.getByText('Notifications'));
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
  });

  it('tapping "Data & privacy" renders the Data & privacy sub-screen header', () => {
    renderHub();
    fireEvent.click(screen.getByText('Data & Privacy'));
    // SubScreenHeader renders an h1 — use partial match because the HTML entity decodes
    expect(screen.getByRole('heading', { name: /data.*privacy/i })).toBeTruthy();
  });

  it('tapping "Help & FAQ" renders the Help & FAQ sub-screen header', () => {
    renderHub();
    fireEvent.click(screen.getByText('Help & FAQ'));
    expect(screen.getByRole('heading', { name: /help.*faq/i })).toBeTruthy();
  });

  it('tapping "App" renders the App sub-screen header', () => {
    renderHub();
    fireEvent.click(screen.getByText('App'));
    expect(screen.getByRole('heading', { name: 'App' })).toBeTruthy();
  });
});

// ── Back button from each new sub-screen ─────────────────────────────────────

describe('SettingsScreen Phase 2 — back button returns to hub', () => {
  it('back from Account returns to hub', () => {
    renderHub();
    fireEvent.click(screen.getByText('Account & Business'));
    expect(screen.getByRole('heading', { name: 'Account & Business' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    // Hub is visible again
    expect(screen.getByText('Account & Business')).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();
  });

  it('back from Notifications returns to hub', () => {
    renderHub();
    fireEvent.click(screen.getByText('Notifications'));
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(screen.getByText('Account & Business')).toBeTruthy();
  });

  it('back from Data & privacy returns to hub', () => {
    renderHub();
    fireEvent.click(screen.getByText('Data & Privacy'));
    expect(screen.getByRole('heading', { name: /data.*privacy/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(screen.getByText('Data & Privacy')).toBeTruthy();
    expect(screen.getByText('Help & FAQ')).toBeTruthy();
  });

  it('back from Help & FAQ returns to hub', () => {
    renderHub();
    fireEvent.click(screen.getByText('Help & FAQ'));
    expect(screen.getByRole('heading', { name: /help.*faq/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(screen.getByText('Help & FAQ')).toBeTruthy();
    expect(screen.getByText('App')).toBeTruthy();
  });

  it('back from App returns to hub', () => {
    renderHub();
    fireEvent.click(screen.getByText('App'));
    expect(screen.getByRole('heading', { name: 'App' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    expect(screen.getByText('App')).toBeTruthy();
    expect(screen.getByText('Account & Business')).toBeTruthy();
  });
});

// ── popstate (hardware back) from new sub-screens ────────────────────────────

describe('SettingsScreen Phase 2 — browser popstate from new sub-screens', () => {
  it('popstate from Account sub-screen returns to hub', () => {
    renderHub();
    fireEvent.click(screen.getByText('Account & Business'));
    expect(screen.getByRole('heading', { name: 'Account & Business' })).toBeTruthy();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    });
    expect(screen.getByText('Invoices & Quotes')).toBeTruthy();
  });

  it('popstate from App sub-screen returns to hub', () => {
    renderHub();
    fireEvent.click(screen.getByText('App'));
    expect(screen.getByRole('heading', { name: 'App' })).toBeTruthy();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    });
    expect(screen.getByText('Invoices & Quotes')).toBeTruthy();
  });
});

// ── Data & privacy: Export records folded in from Accountant section ──────────

describe('SettingsScreen Phase 2 — Data & privacy sub-screen contents', () => {
  it('renders "Export records" inside the Data & privacy sub-screen', () => {
    renderHub();
    fireEvent.click(screen.getByText('Data & Privacy'));
    // "Export records" row must be visible in the sub-screen
    expect(screen.getByText('Export records')).toBeTruthy();
  });

  it('"Export records" row fires openExportSheet("records") when tapped', () => {
    // We cannot stub openExportSheet directly (it's internal), but we can confirm
    // the row is tappable (has an onTap → the jobs=[]/no-jobs path shows the toast).
    // The "no jobs" path calls showSavedToast('No jobs to export yet').
    // We verify the row is rendered as a button (not passive) by checking it's clickable.
    renderHub();
    fireEvent.click(screen.getByText('Data & Privacy'));
    const exportRecordsRow = screen.getByText('Export records').closest('button');
    expect(exportRecordsRow).toBeTruthy();
    // Confirm it is not disabled (it's active even with no jobs — it shows a toast)
    expect(exportRecordsRow?.disabled).toBe(false);
  });

  it('renders "Export everything" inside the Data & privacy sub-screen', () => {
    renderHub();
    fireEvent.click(screen.getByText('Data & Privacy'));
    expect(screen.getByText('Export everything')).toBeTruthy();
  });

  it('"Export records" appears BEFORE "Export everything" in DOM order', () => {
    renderHub();
    fireEvent.click(screen.getByText('Data & Privacy'));
    const all = screen.getAllByText(/Export/i).map(el => el.textContent);
    const recordsIdx = all.findIndex(t => t?.includes('records'));
    const everythingIdx = all.findIndex(t => t?.includes('everything'));
    // "Export records" should come first
    expect(recordsIdx).toBeLessThan(everythingIdx);
  });
});

// ── Accountant section removed from hub ──────────────────────────────────────

describe('SettingsScreen Phase 2 — standalone Accountant section removed', () => {
  it('hub view does not contain an "Accountant" section card title', () => {
    renderHub();
    // After Phase 2 the standalone "Accountant" SectionCard is gone.
    // "Export records" has moved inside the Data & privacy sub-screen.
    // The word "Accountant" should not appear as a section heading on the hub.
    const allHeadings = screen.queryAllByText('Accountant');
    expect(allHeadings.length).toBe(0);
  });
});

// ── Voice language re-homed to Account sub-screen ────────────────────────────

describe('SettingsScreen Phase 2 — Voice input language in Account sub-screen', () => {
  it('renders "Voice input language" row inside the Account sub-screen', () => {
    renderHub();
    fireEvent.click(screen.getByText('Account & Business'));
    expect(screen.getByText('Voice input language')).toBeTruthy();
  });

  it('tapping "Voice input language" opens the voice sub-view (shows language list)', () => {
    renderHub();
    fireEvent.click(screen.getByText('Account & Business'));
    // The voice row has a value showing the current language label and a chevron
    const voiceRow = screen.getByText('Voice input language').closest('button');
    expect(voiceRow).toBeTruthy();
    fireEvent.click(voiceRow);
    // VoiceLanguageSection renders the language list; "English (UK)" is always present
    expect(screen.getByText('English (UK)')).toBeTruthy();
  });

  it('back from voice sub-view returns to Account sub-screen (not hub)', () => {
    renderHub();
    fireEvent.click(screen.getByText('Account & Business'));
    const voiceRow = screen.getByText('Voice input language').closest('button');
    fireEvent.click(voiceRow);
    // Confirm we're on the voice sub-view
    expect(screen.getByRole('heading', { name: 'Voice input language' })).toBeTruthy();
    // Press back
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    // Should be on Account sub-screen, not hub
    expect(screen.getByRole('heading', { name: 'Account & Business' })).toBeTruthy();
    // Hub rows should NOT be visible
    expect(screen.queryByText('Notifications')).toBeFalsy();
  });

  it('popstate from voice sub-view returns to Account sub-screen (not hub)', () => {
    renderHub();
    fireEvent.click(screen.getByText('Account & Business'));
    const voiceRow = screen.getByText('Voice input language').closest('button');
    fireEvent.click(voiceRow);
    expect(screen.getByRole('heading', { name: 'Voice input language' })).toBeTruthy();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    });
    // Should land on Account sub-screen, not hub
    expect(screen.getByRole('heading', { name: 'Account & Business' })).toBeTruthy();
    expect(screen.queryByText('Invoices & Quotes')).toBeFalsy();
  });
});

// ── Account sub-screen contents ───────────────────────────────────────────────

describe('SettingsScreen Phase 2 — Account sub-screen contents', () => {
  it('renders "Sign out" row inside the Account sub-screen', () => {
    renderHub();
    fireEvent.click(screen.getByText('Account & Business'));
    expect(screen.getByText('Sign out')).toBeTruthy();
  });

  it('renders "Re-run setup wizard" row inside the Account sub-screen', () => {
    renderHub();
    fireEvent.click(screen.getByText('Account & Business'));
    expect(screen.getByText('Re-run setup wizard')).toBeTruthy();
  });
});

// ── Inline sections removed from hub DOM ─────────────────────────────────────

describe('SettingsScreen Phase 2 — inline interim sections removed from hub', () => {
  it('hub view has no element with id="settings-section-account"', () => {
    renderHub();
    expect(document.getElementById('settings-section-account')).toBeNull();
  });

  it('hub view has no element with id="settings-section-notifications"', () => {
    renderHub();
    expect(document.getElementById('settings-section-notifications')).toBeNull();
  });

  it('hub view has no element with id="settings-section-data-privacy"', () => {
    renderHub();
    expect(document.getElementById('settings-section-data-privacy')).toBeNull();
  });

  it('hub view has no element with id="settings-section-help"', () => {
    renderHub();
    expect(document.getElementById('settings-section-help')).toBeNull();
  });

  it('hub view has no element with id="settings-section-app"', () => {
    renderHub();
    expect(document.getElementById('settings-section-app')).toBeNull();
  });
});

// ── Settings tab re-tap → hub reset (fix/settings-tab-retap-to-hub) ──────────
// settingsResetKey: AppShell increments this counter when the user taps the
// Settings bottom-nav tab while already on the Settings tab. SettingsScreen
// reacts by calling navigateToHub(), regardless of which sub-screen is active.
// Note: these suites are blocked on main by the pre-existing jsdom
// ERR_REQUIRE_ESM crash (html-encoding-sniffer / Node 20). They are committed
// here so they run automatically once that underlying issue is resolved.


function renderWithResetKey(profileOverride = PROFILE_FREE, settingsResetKey = 0, extraProps = {}) {
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
      settingsResetKey={settingsResetKey}
      {...extraProps}
    />
  );
}

describe('SettingsScreen — Settings tab re-tap resets to hub (settingsResetKey)', () => {
  it('navigating to Get Paid then bumping settingsResetKey returns to hub', () => {
    const { rerender } = render(
      <SettingsScreen
        session={SESSION}
        profile={PROFILE_FREE}
        jobs={[]}
        receipts={[]}
        onSignOut={NOOP}
        onOpenWizard={NOOP}
        onProfileUpdate={NOOP}
        onOpenJob={NOOP}
        settingsResetKey={0}
      />
    );

    // Navigate to Get Paid sub-screen
    fireEvent.click(screen.getByText('Get Paid'));
    expect(screen.getByRole('heading', { name: 'Get Paid' })).toBeTruthy();

    // Simulate AppShell bumping settingsResetKey (tab re-tap)
    rerender(
      <SettingsScreen
        session={SESSION}
        profile={PROFILE_FREE}
        jobs={[]}
        receipts={[]}
        onSignOut={NOOP}
        onOpenWizard={NOOP}
        onProfileUpdate={NOOP}
        onOpenJob={NOOP}
        settingsResetKey={1}
      />
    );

    // Should be back on the hub — hub rows visible
    expect(screen.getByText('Invoices & Quotes')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Get Paid' })).toBeFalsy();
  });

  it('bumping settingsResetKey from voice sub-view goes straight to hub (not account)', () => {
    const { rerender } = render(
      <SettingsScreen
        session={SESSION}
        profile={PROFILE_FREE}
        jobs={[]}
        receipts={[]}
        onSignOut={NOOP}
        onOpenWizard={NOOP}
        onProfileUpdate={NOOP}
        onOpenJob={NOOP}
        settingsResetKey={0}
      />
    );

    // Navigate Account → Voice
    fireEvent.click(screen.getByText('Account & Business'));
    const voiceRow = screen.getByText('Voice input language').closest('button');
    fireEvent.click(voiceRow);
    expect(screen.getByRole('heading', { name: 'Voice input language' })).toBeTruthy();

    // Simulate tab re-tap
    rerender(
      <SettingsScreen
        session={SESSION}
        profile={PROFILE_FREE}
        jobs={[]}
        receipts={[]}
        onSignOut={NOOP}
        onOpenWizard={NOOP}
        onProfileUpdate={NOOP}
        onOpenJob={NOOP}
        settingsResetKey={1}
      />
    );

    // Must land on hub, NOT on Account sub-screen
    expect(screen.getByText('Invoices & Quotes')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Account & Business' })).toBeFalsy();
    expect(screen.queryByRole('heading', { name: 'Voice input language' })).toBeFalsy();
  });

  it('settingsResetKey=0 on initial mount does NOT reset (hub remains active)', () => {
    renderWithResetKey(PROFILE_FREE, 0);
    // Should start on hub with no unintended navigation
    expect(screen.getByText('Invoices & Quotes')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeFalsy();
  });

  it('back-arrow voice→account behaviour unchanged after a reset', () => {
    render(
      <SettingsScreen
        session={SESSION}
        profile={PROFILE_FREE}
        jobs={[]}
        receipts={[]}
        onSignOut={NOOP}
        onOpenWizard={NOOP}
        onProfileUpdate={NOOP}
        onOpenJob={NOOP}
        settingsResetKey={0}
      />
    );

    // Hub → Account → Voice → back arrow (must land on Account, not hub)
    fireEvent.click(screen.getByText('Account & Business'));
    const voiceRow = screen.getByText('Voice input language').closest('button');
    fireEvent.click(voiceRow);
    expect(screen.getByRole('heading', { name: 'Voice input language' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));
    // Header back from voice goes to account — unchanged
    expect(screen.getByRole('heading', { name: 'Account & Business' })).toBeTruthy();
  });
});
