// @vitest-environment jsdom
/**
 * workRecordsView.test.jsx — feat/work-records-view
 *
 * Asserts that:
 *   1. The "Records" pill renders in WorkScreen's controls row.
 *   2. Clicking it opens the DocumentSearchOverlay (mode='jobs').
 *   3. Closing the overlay removes it from the DOM.
 *   4. TodayScreen renders the updated "Find a quote, invoice or job" label.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Network / browser API mocks ───────────────────────────────────────────────

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

vi.mock('../../lib/plan', () => ({
  isPro: vi.fn().mockReturnValue(false),
  isTrial: vi.fn().mockReturnValue(false),
  trialDaysLeft: vi.fn().mockReturnValue(0),
  planAllowsPro: vi.fn().mockReturnValue(false),
  isTrialActive: vi.fn().mockReturnValue(false),
  canSendInvoice: vi.fn().mockReturnValue(true),
  countInvoicesSentThisMonth: vi.fn().mockReturnValue(0),
  showJobProfitFooter: vi.fn().mockReturnValue(false),
  eligibleForWhiteLabelNudge: vi.fn().mockReturnValue(false),
  trialJustExpired: vi.fn().mockReturnValue(false),
  isTrialLastDay: vi.fn().mockReturnValue(false),
  trialEndSheetDismissedToday: vi.fn().mockReturnValue(false),
  recordTrialEndSheetDismissed: vi.fn(),
  hasDropToFreeSeen: vi.fn().mockReturnValue(false),
  markDropToFreeSeen: vi.fn(),
  UNLOCK_PRO_FOR_ALL: false,
  FREE_MONTHLY_INVOICE_LIMIT: Infinity,
}));

vi.mock('../../lib/consent', () => ({
  getAnalyticsConsent: vi.fn().mockReturnValue(true),
}));

vi.mock('../../lib/estimatorQuota', () => ({
  checkEstimatorQuota: vi.fn().mockResolvedValue({ allowed: true }),
}));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const NOOP = () => {};
const BIZ = { name: 'Test Plumbing Ltd', email: 'test@example.com' };
const PROFILE_FREE = { plan: 'free', is_cis_subcontractor: false };

function makeJob(overrides = {}) {
  return {
    id: overrides.id ?? 'j1',
    customer: overrides.customer ?? 'Bob Smith',
    name: overrides.name ?? 'Fix boiler',
    summary: overrides.summary ?? 'Fix boiler',
    status: overrides.status ?? 'lead',
    paid: overrides.paid ?? false,
    amount: overrides.amount ?? 0,
    total: overrides.total ?? overrides.amount ?? 0,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...overrides,
  };
}

const DEFAULT_PROPS = {
  jobs: [],
  receipts: [],
  onNewJob: NOOP,
  onAddJob: NOOP,
  onAddPayment: NOOP,
  onUpdateJob: NOOP,
  onDeleteJob: NOOP,
  onAddReceipt: NOOP,
  onDeleteReceipt: NOOP,
  biz: BIZ,
  profile: PROFILE_FREE,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

import WorkScreen from '../WorkScreen';
import TodayScreen from '../TodayScreen';

describe('WorkScreen — Documents entry point (feat/documents-findability-v1)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders the Documents pill in the controls row', () => {
    render(<WorkScreen {...DEFAULT_PROPS} />);
    // Button is always visible alongside the List/Calendar/All controls
    expect(screen.getByRole('button', { name: /find a quote, invoice, receipt or job/i })).toBeTruthy();
  });

  it('opens DocumentSearchOverlay in quotes mode (default) when Documents pill is tapped', () => {
    render(<WorkScreen {...DEFAULT_PROPS} jobs={[makeJob()]} />);
    const pill = screen.getByRole('button', { name: /find a quote, invoice, receipt or job/i });
    fireEvent.click(pill);
    // Default mode is now 'quotes' — the overlay dialog heading (h2) should be "Quotes"
    expect(screen.getByRole('heading', { name: 'Quotes' })).toBeTruthy();
  });

  it('closes the overlay when the close button is tapped', () => {
    render(<WorkScreen {...DEFAULT_PROPS} jobs={[makeJob()]} />);
    fireEvent.click(screen.getByRole('button', { name: /find a quote, invoice, receipt or job/i }));
    expect(screen.getByRole('heading', { name: 'Quotes' })).toBeTruthy();
    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('heading', { name: 'Quotes' })).toBeNull();
  });

  it('overlay renders all four mode-switcher tabs including Receipts', () => {
    render(<WorkScreen {...DEFAULT_PROPS} jobs={[makeJob()]} />);
    fireEvent.click(screen.getByRole('button', { name: /find a quote, invoice, receipt or job/i }));
    // All four tabs (feat/documents-findability-v1 added Receipts)
    expect(screen.getByRole('tab', { name: /all jobs/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /quotes/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /invoices/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /receipts/i })).toBeTruthy();
  });

  it('mode switcher changes the active mode when a tab is clicked', () => {
    render(<WorkScreen {...DEFAULT_PROPS} jobs={[makeJob()]} />);
    fireEvent.click(screen.getByRole('button', { name: /find a quote, invoice, receipt or job/i }));
    // Start in quotes — heading is "Quotes"
    expect(screen.getByRole('heading', { name: 'Quotes' })).toBeTruthy();
    // Switch to "All jobs"
    fireEvent.click(screen.getByRole('tab', { name: /all jobs/i }));
    // After switching, the h2 heading changes to "All jobs"
    expect(screen.getByRole('heading', { name: 'All jobs' })).toBeTruthy();
  });

  it('active mode tab has aria-selected=true', () => {
    render(<WorkScreen {...DEFAULT_PROPS} jobs={[makeJob()]} />);
    fireEvent.click(screen.getByRole('button', { name: /find a quote, invoice, receipt or job/i }));
    const quotesTab = screen.getByRole('tab', { name: /quotes/i });
    expect(quotesTab.getAttribute('aria-selected')).toBe('true');
    const allJobsTab = screen.getByRole('tab', { name: /all jobs/i });
    expect(allJobsTab.getAttribute('aria-selected')).toBe('false');
  });
});

// NOTE (JP-LU3, PR #467): The TodayScreen doc-finder row ("Find a quote, invoice or job")
// was intentionally removed as a redundant surface. The feature lives only in WorkScreen
// (Records pill in the controls row). The two TodayScreen assertions below were removed
// because the element they tested no longer exists — the feature was cut, not broken.
