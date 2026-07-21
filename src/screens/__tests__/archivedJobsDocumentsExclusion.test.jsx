// @vitest-environment jsdom
/**
 * archivedJobsDocumentsExclusion.test.jsx — feat/archived-jobs-view
 *
 * WorkScreen passes `visibleJobs` (jobs with archived/deleted ones filtered
 * out), not the raw `jobs` prop, into DocumentSearchOverlay — see
 * WorkScreen.jsx's `jobs={visibleJobs}` on the DocumentSearchOverlay render,
 * a few lines below the "feat/archived-jobs-view edge case #10" comment.
 * That prop swap shipped with zero coverage; this locks the behaviour in so
 * a future refactor can't silently let archived jobs leak back into
 * Documents search. Mount/mocking scaffolding copied from
 * documentsFindabilityV1.test.jsx.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Network / browser API mocks (copied from documentsFindabilityV1.test.jsx) ─

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select:   vi.fn().mockReturnThis(),
      insert:   vi.fn().mockReturnThis(),
      update:   vi.fn().mockReturnThis(),
      delete:   vi.fn().mockReturnThis(),
      eq:       vi.fn().mockReturnThis(),
      in:       vi.fn().mockReturnThis(),
      order:    vi.fn().mockReturnThis(),
      limit:    vi.fn().mockReturnThis(),
      single:   vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    auth: {
      getSession:        vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    channel: vi.fn(() => ({
      on:          vi.fn().mockReturnThis(),
      subscribe:   vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    })),
  },
}));

vi.mock('../../lib/store', () => ({
  uploadJobPhoto:     vi.fn().mockResolvedValue({ url: 'https://example.com/photo.jpg' }),
  getSignedPhotoUrl:  vi.fn().mockResolvedValue('https://example.com/signed.jpg'),
  deleteJobPhoto:     vi.fn().mockResolvedValue(null),
  deleteJobFromCloud: vi.fn().mockResolvedValue(null),
  fetchPublicJob:     vi.fn().mockResolvedValue({ data: null, error: 'not found' }),
}));

vi.mock('../../lib/telemetry', () => ({
  logTelemetry:          vi.fn(),
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
  startCheckout:     vi.fn().mockResolvedValue({}),
  openBillingPortal: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/pushSubscribe', () => ({
  isPushSupported:       vi.fn().mockReturnValue(false),
  getSubscriptionStatus: vi.fn().mockResolvedValue('unsupported'),
  subscribe:             vi.fn().mockResolvedValue(null),
  unsubscribe:           vi.fn().mockResolvedValue(false),
}));

vi.mock('../../lib/plan', () => ({
  isPro:                        vi.fn().mockReturnValue(false),
  isTrial:                      vi.fn().mockReturnValue(false),
  trialDaysLeft:                vi.fn().mockReturnValue(0),
  planAllowsPro:                vi.fn().mockReturnValue(false),
  isTrialActive:                vi.fn().mockReturnValue(false),
  canSendInvoice:               vi.fn().mockReturnValue(true),
  countInvoicesSentThisMonth:   vi.fn().mockReturnValue(0),
  showJobProfitFooter:          vi.fn().mockReturnValue(false),
  eligibleForWhiteLabelNudge:   vi.fn().mockReturnValue(false),
  trialJustExpired:             vi.fn().mockReturnValue(false),
  isTrialLastDay:               vi.fn().mockReturnValue(false),
  trialEndSheetDismissedToday:  vi.fn().mockReturnValue(false),
  recordTrialEndSheetDismissed: vi.fn(),
  hasDropToFreeSeen:            vi.fn().mockReturnValue(false),
  markDropToFreeSeen:           vi.fn(),
  UNLOCK_PRO_FOR_ALL:           false,
  FREE_MONTHLY_INVOICE_LIMIT:   Infinity,
}));

vi.mock('../../lib/consent', () => ({
  getAnalyticsConsent: vi.fn().mockReturnValue(true),
}));

vi.mock('../../lib/estimatorQuota', () => ({
  checkEstimatorQuota: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('../../lib/exportCsv', () => ({
  downloadOrShare:     vi.fn().mockResolvedValue(undefined),
  downloadOrShareCsv:  vi.fn().mockResolvedValue(undefined),
  buildJobsCsv:        vi.fn().mockReturnValue(''),
  buildEverythingCsv:  vi.fn().mockReturnValue(''),
  deriveJobRows:       vi.fn().mockReturnValue([]),
  deriveAccountFields: vi.fn().mockReturnValue([]),
}));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const NOOP = () => {};
const BIZ  = { name: 'Test Plumbing Ltd', email: 'test@example.com' };
const PROFILE_FREE = { plan: 'free', is_cis_subcontractor: false };

function makeJob(overrides = {}) {
  return {
    id:        overrides.id        ?? 'j1',
    customer:  overrides.customer  ?? 'Bob Smith',
    name:      overrides.name      ?? 'Fix boiler',
    summary:   overrides.summary   ?? 'Fix boiler',
    status:    overrides.status    ?? 'lead',
    paid:      overrides.paid      ?? false,
    amount:    overrides.amount    ?? 0,
    total:     overrides.total     ?? overrides.amount ?? 0,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...overrides,
  };
}

const DEFAULT_WORKSCREEN_PROPS = {
  receipts:        [],
  onNewJob:        NOOP,
  onAddJob:        NOOP,
  onAddPayment:    NOOP,
  onUpdateJob:     NOOP,
  onDeleteJob:     NOOP,
  onAddReceipt:    NOOP,
  onDeleteReceipt: NOOP,
  biz:             BIZ,
  profile:         PROFILE_FREE,
};

// ── Imports (deferred until after mocks are set up) ───────────────────────────

import WorkScreen from '../WorkScreen';

describe('WorkScreen — Documents overlay excludes archived jobs (feat/archived-jobs-view)', () => {
  afterEach(() => vi.clearAllMocks());

  it('never surfaces an archived job in Documents search, while a non-archived job still shows', () => {
    const archivedJob = makeJob({
      id:       'j-archived',
      customer: 'Ghost Customer',
      name:     'Ghost Customer',
      summary:  'Old fence repair',
      archived: true,
      meta:     { archived: true, archivedAt: '2026-06-01T00:00:00Z' },
    });
    const activeJob = makeJob({
      id:       'j-active',
      customer: 'Live Customer',
      name:     'Live Customer',
      summary:  'New boiler install',
    });

    render(
      <WorkScreen {...DEFAULT_WORKSCREEN_PROPS} jobs={[archivedJob, activeJob]} />
    );

    // Documents pill — fires 'work_documents_open', opens the overlay.
    fireEvent.click(screen.getByRole('button', { name: /find a quote, invoice, receipt or job/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    // Overlay opens on the "Quotes" tab by default — switch to "All jobs" so
    // both fixtures are in scope (neither has quoteSentAt set).
    fireEvent.click(screen.getByRole('tab', { name: /all jobs/i }));

    // Archived job must never appear, by name or by job summary.
    expect(screen.queryByText('Ghost Customer')).toBeNull();
    expect(screen.queryByText('Old fence repair')).toBeNull();

    // Non-archived job must still be findable.
    expect(screen.getByText('Live Customer')).toBeTruthy();
    expect(screen.getByText('New boiler install')).toBeTruthy();
  });
});
