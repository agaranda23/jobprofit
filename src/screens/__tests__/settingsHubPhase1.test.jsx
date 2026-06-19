// @vitest-environment jsdom
/**
 * settingsHubPhase1.test.jsx — QAE-specced coverage for feat/settings-hub-phase-1
 *
 * 9 specs covering:
 *   1.  Hub renders all 8 category rows
 *   2.  Tapping "Invoices & quotes" opens the Invoices sub-screen
 *   3.  Tapping "Get paid" opens the Get paid sub-screen
 *   4.  Back button (aria-label="Back to Settings") returns to hub
 *   5.  Browser popstate event returns to hub
 *   6.  scrollTarget='overheads' navigates to Costs sub-screen
 *   7.  onScrollTargetConsumed fires exactly once on scrollTarget='overheads'
 *   8.  SubscriptionCard — free plan shows "Free"
 *   9.  SubscriptionCard — active trial shows "N days left" copy
 *
 * jsdom stubs:
 *   - Element.prototype.scrollIntoView (not implemented in jsdom)
 *   - history.pushState (real, but spied to avoid jsdom navigation errors)
 *
 * Follows project convention: matches the mock harness in screenSmoke.test.jsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// ── jsdom stubs ───────────────────────────────────────────────────────────────

// scrollIntoView is not implemented by jsdom — stub it so hub rows that call it
// (Account & business, Notifications, etc.) don't throw.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // Spy on history.pushState so navigateToSubScreen doesn't cause jsdom errors.
  vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

// ── Module mocks (match screenSmoke.test.jsx harness) ────────────────────────

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

function makeTrialProfile(daysLeft = 5) {
  const endsAt = new Date(Date.now() + daysLeft * 24 * 60 * 60 * 1000).toISOString();
  return { plan: 'trial', trial_ends_at: endsAt, is_cis_subcontractor: false };
}

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

// ── Specs ─────────────────────────────────────────────────────────────────────

describe('SettingsScreen hub — category rows', () => {
  it('renders all 8 expected category rows on the hub', () => {
    renderHub();

    // The hub is a <SectionCard title="Settings"> containing 8 <HubCategoryRow>
    // buttons. Some labels (e.g. "Account & business") also appear in the
    // inline Phase-2 section cards below the hub, so use getAllByText and
    // confirm at least one matching element exists for each label.
    const expectedLabels = [
      'Invoices & Quotes',
      'Get Paid',
      'Costs',
      'Account & Business',
      'Notifications',
      'Data & Privacy',
      'Help & FAQ',
      'App',
    ];

    for (const label of expectedLabels) {
      const matches = screen.getAllByText(label);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('SettingsScreen hub — sub-screen navigation', () => {
  it('tapping "Invoices & Quotes" renders the Invoices sub-screen header', () => {
    renderHub();

    fireEvent.click(screen.getByText('Invoices & Quotes'));

    // SubScreenHeader renders an <h1> with the sub-screen title
    expect(screen.getByRole('heading', { name: 'Invoices & Quotes' })).toBeTruthy();
  });

  it('tapping "Get Paid" renders the Get Paid sub-screen header', () => {
    renderHub();

    fireEvent.click(screen.getByText('Get Paid'));

    expect(screen.getByRole('heading', { name: 'Get Paid' })).toBeTruthy();
  });
});

describe('SettingsScreen hub — back navigation', () => {
  it('back button (aria-label="Back to Settings") returns to hub', () => {
    renderHub();

    // Navigate into a sub-screen first
    fireEvent.click(screen.getByText('Invoices & Quotes'));

    // Confirm we're in the sub-screen
    expect(screen.getByRole('heading', { name: 'Invoices & Quotes' })).toBeTruthy();

    // Tap the back button
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }));

    // Hub is visible again — all 8 rows should be present
    expect(screen.getByText('Invoices & Quotes')).toBeTruthy();
    expect(screen.getByText('Get Paid')).toBeTruthy();
  });

  it('browser popstate event returns to hub from a sub-screen', () => {
    renderHub();

    // Navigate into a sub-screen
    fireEvent.click(screen.getByText('Get Paid'));
    expect(screen.getByRole('heading', { name: 'Get Paid' })).toBeTruthy();

    // Fire the popstate event (browser/PWA hardware back button)
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    });

    // Hub should be visible again
    expect(screen.getByText('Invoices & Quotes')).toBeTruthy();
  });
});

describe('SettingsScreen hub — scrollTarget deep-link', () => {
  it('scrollTarget="overheads" navigates directly to the Costs sub-screen', () => {
    renderHub(PROFILE_FREE, {
      scrollTarget: 'overheads',
      onScrollTargetConsumed: NOOP,
    });

    // Should land on the Costs sub-screen header immediately
    expect(screen.getByRole('heading', { name: 'Costs' })).toBeTruthy();
  });

  it('onScrollTargetConsumed fires exactly once when scrollTarget="overheads"', () => {
    const onScrollTargetConsumed = vi.fn();

    renderHub(PROFILE_FREE, {
      scrollTarget: 'overheads',
      onScrollTargetConsumed,
    });

    expect(onScrollTargetConsumed).toHaveBeenCalledTimes(1);
  });
});

describe('SubscriptionCard — plan state display', () => {
  it('free plan shows "Free" as the current plan value', () => {
    renderHub(PROFILE_FREE);

    // The SubscriptionCard Row renders label="Current plan" value="Free"
    // The value text is "Free" in the hub view for free users
    expect(screen.getByText('Free')).toBeTruthy();
  });

  it('active trial shows "days left" in the plan value', () => {
    const trialProfile = makeTrialProfile(7);
    renderHub(trialProfile);

    // SubscriptionCard renders: "Free trial · N days left"
    // UNLOCK_PRO_FOR_ALL is false in plan.js so the trial branch is reached
    const trialText = screen.getByText(/days left/i);
    expect(trialText).toBeTruthy();
  });
});
