// @vitest-environment jsdom
/**
 * workScreenStageOverride.test.jsx — regression test for the stageOverride
 * persist leak (fix/today-voice-dup-and-card-nav follow-up).
 *
 * Bug: a one-off Today-card tap (e.g. "£X overdue" → Overdue) passed a
 * { stage, nonce } stageOverride prop into WorkScreen. The override effect
 * called setSelectedStage(stageOverride.stage), and the (unguarded) persist
 * effect wrote every selectedStage change to localStorage unconditionally —
 * so the one-off override silently clobbered the trader's real last MANUAL
 * Jobs filter. The next direct bottom-nav Jobs tap (which remounts WorkScreen
 * via AppShell's key prop) then lazy-initialised straight from the polluted
 * localStorage value, landing the trader on the override's stage instead of
 * their own last choice.
 *
 * This covers the fix: the override changes what's displayed but must never
 * persist, while a genuine manual stage-tile tap still persists as normal.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Network / browser API mocks (mirrors workRecordsView.test.jsx) ───────────

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
const FILTER_STORAGE_KEY = 'jp.workscreen.filter.v1';

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

import WorkScreen from '../WorkScreen';

function readPersistedFilter() {
  const raw = localStorage.getItem(FILTER_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function stageTile(stage) {
  return document.querySelector(`.stage-tile--${stage.toLowerCase()}`);
}

describe('WorkScreen — stageOverride must not leak into the persisted filter', () => {
  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('applies a Today-card stageOverride to the displayed stage without overwriting the trader\'s last manual filter in localStorage', () => {
    // Seed the trader's real last manual choice.
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ selectedStage: 'Paid', showAll: false }));

    render(<WorkScreen {...DEFAULT_PROPS} stageOverride={{ stage: 'Overdue', nonce: 1 }} />);

    // (1) The override lands on the displayed stage — Overdue tile is selected.
    const overdueTile = stageTile('Overdue');
    expect(overdueTile).not.toBeNull();
    expect(overdueTile.classList.contains('stage-tile--selected')).toBe(true);
    expect(overdueTile.getAttribute('aria-pressed')).toBe('true');

    // The Paid tile (the trader's real choice) must NOT still read as selected.
    const paidTile = stageTile('Paid');
    expect(paidTile.classList.contains('stage-tile--selected')).toBe(false);

    // (2) But the persisted filter is untouched — still the trader's own choice.
    const persisted = readPersistedFilter();
    expect(persisted).toEqual({ selectedStage: 'Paid', showAll: false });
  });

  it('still persists a genuine manual stage-tile tap made after an override was applied', () => {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ selectedStage: 'Paid', showAll: false }));
    render(<WorkScreen {...DEFAULT_PROPS} stageOverride={{ stage: 'Overdue', nonce: 1 }} />);

    // Sanity: override applied, nothing persisted yet.
    expect(readPersistedFilter()).toEqual({ selectedStage: 'Paid', showAll: false });

    // Trader manually taps a different stage tile on the strip.
    fireEvent.click(screen.getByRole('button', { name: /^LEAD/ }));

    const leadTile = stageTile('Lead');
    expect(leadTile.classList.contains('stage-tile--selected')).toBe(true);

    // This genuine manual choice DOES persist.
    expect(readPersistedFilter()).toEqual({ selectedStage: 'Lead', showAll: false });
  });

  it('a same-value override on an already-mounted screen does not stick and swallow a later manual re-selection of that stage', () => {
    // WorkScreen is normally already mounted (the dashboard pager keeps it
    // alive under Today) when a stageOverride prop arrives — it does NOT
    // remount for programmatic navigation, only for a direct bottom-nav Jobs
    // tap. Reproduce that: mount plain, then re-render with an override.
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ selectedStage: 'Overdue', showAll: false }));
    const { rerender } = render(<WorkScreen {...DEFAULT_PROPS} />);
    expect(readPersistedFilter()).toEqual({ selectedStage: 'Overdue', showAll: false });

    // A Today card points at the stage the trader is already viewing —
    // setSelectedStage(sameValue) is a no-op, so no re-render follows to let
    // the persist effect observe and clear the override guard.
    rerender(<WorkScreen {...DEFAULT_PROPS} stageOverride={{ stage: 'Overdue', nonce: 1 }} />);
    expect(readPersistedFilter()).toEqual({ selectedStage: 'Overdue', showAll: false });

    // Trader manually moves to a different stage — persists normally.
    fireEvent.click(screen.getByRole('button', { name: /^LEAD/ }));
    expect(readPersistedFilter()).toEqual({ selectedStage: 'Lead', showAll: false });

    // Trader manually moves BACK to Overdue — this must persist too. A stuck
    // override guard from the same-value override above would wrongly treat
    // this as override-driven and swallow the write.
    fireEvent.click(screen.getByRole('button', { name: /^OVERDUE/ }));
    expect(readPersistedFilter()).toEqual({ selectedStage: 'Overdue', showAll: false });
  });
});
