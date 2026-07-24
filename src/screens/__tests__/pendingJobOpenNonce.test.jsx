// @vitest-environment jsdom
/**
 * pendingJobOpenNonce.test.jsx — regression test for the pendingJobId /
 * pendingJobOpen open-drawer bug (button-audit fix, 2026-07-24).
 *
 * BUG: DashboardPager mounts WorkScreen once at app boot and keeps it mounted
 * across Today/Jobs/Money navigations (see dashboardPager.test.js). WorkScreen's
 * open-drawer effect used `useEffect(() => {...}, [])` — an EMPTY dep array —
 * so it only ever fired on that very first mount, when nothing had been tapped
 * yet. Every later "open this job" dispatch (Today's onJobTap, Settings'
 * onOpenJob, the ?job= deep link, the realtime Snackbar) updated AppShell's
 * pendingJobId on an already-mounted WorkScreen whose effect never re-ran, so
 * the drawer never opened — the trader landed on the plain Jobs list instead.
 *
 * FIX: pendingJobId became pendingJobOpen, a fresh { jobId, nonce } object on
 * every dispatch (mirrors workStageOverride — see workScreenStageOverride.test.jsx).
 * WorkScreen's effect now depends on it (and on `jobs`, so a dispatch that
 * lands before the jobs list has loaded still finds its target once jobs
 * arrive), and calls onPendingJobOpenConsumed once it succeeds so AppShell
 * clears pendingJobOpen — stopping a LATER cloud refresh of `jobs` (new array
 * reference, stale pendingJobOpen value) from re-opening a drawer the trader
 * has since closed.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Network / browser API mocks (mirrors workScreenStageOverride.test.jsx,
//    plus componentSmoke.test.jsx's JobDetailDrawer-specific mocks since this
//    file — unlike workScreenStageOverride — actually opens the drawer) ──────

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
  persistPublicToken: vi.fn().mockResolvedValue({ ok: true }),
  reissuePublicToken: vi.fn((job) => ({
    token: job?.publicAccessToken || 'mock-token-uuid',
    wasRevoked: false,
  })),
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
    ACCOUNTANT_EXPORT: 'accountant_export',
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

vi.mock('../../lib/photoCompress', () => ({
  compressPhoto: vi.fn().mockResolvedValue('data:image/jpeg;base64,abc'),
}));

vi.mock('../../lib/voiceCapture', () => ({
  startVoiceCapture: vi.fn(),
}));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const NOOP = () => {};
const BIZ = { name: 'Test Plumbing Ltd', email: 'test@example.com' };
const PROFILE_FREE = { plan: 'free', is_cis_subcontractor: false };

function makeJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Alan Test',
    amount: 500,
    total: 500,
    paid: false,
    status: 'active',
    paymentStatus: 'unpaid',
    jobStatus: 'active',
    quoteStatus: null,
    date: '2026-05-01',
    customerPhone: '07700 900000',
    lineItems: [],
    photos: [],
    jobNotes: [],
    payments: [],
    ...overrides,
  };
}

const DEFAULT_PROPS = {
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

function drawerOpenFor(job) {
  const sheet = document.querySelector('.job-detail-sheet');
  if (!sheet) return false;
  return sheet.textContent.includes(job.customer);
}

describe('WorkScreen — pendingJobOpen must open the drawer even when WorkScreen was already mounted', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('opens the drawer for the target job on first mount when pendingJobOpen is already set', async () => {
    const job = makeJob({ id: 'j1', customer: 'First Mount Customer' });
    render(
      <WorkScreen
        {...DEFAULT_PROPS}
        jobs={[job]}
        pendingJobOpen={{ jobId: 'j1', nonce: 1 }}
      />
    );
    await waitFor(() => expect(drawerOpenFor(job)).toBe(true));
  });

  it('opens the drawer on a SECOND dispatch to an already-mounted WorkScreen (the exact bug: empty-dep effect never re-fired)', async () => {
    const jobA = makeJob({ id: 'jA', customer: 'Job A Customer' });
    const jobB = makeJob({ id: 'jB', customer: 'Job B Customer' });
    const jobs = [jobA, jobB];

    // Mount with no pending job — simulates WorkScreen already alive under the
    // dashboard pager with nothing queued (the steady-state before any tap).
    const { rerender } = render(
      <WorkScreen {...DEFAULT_PROPS} jobs={jobs} pendingJobOpen={null} />
    );
    expect(document.querySelector('.job-detail-sheet')).toBeNull();

    // A Today card-body tap on job B dispatches a fresh { jobId, nonce } while
    // this WorkScreen instance is already mounted — the old empty-dep effect
    // would never see this.
    rerender(
      <WorkScreen {...DEFAULT_PROPS} jobs={jobs} pendingJobOpen={{ jobId: 'jB', nonce: 2 }} />
    );

    await waitFor(() => expect(drawerOpenFor(jobB)).toBe(true));
  });

  it('calls onPendingJobOpenConsumed exactly once after opening, so the caller can clear pendingJobOpen', async () => {
    const job = makeJob({ id: 'j1', customer: 'Consumed Customer' });
    const onPendingJobOpenConsumed = vi.fn();
    render(
      <WorkScreen
        {...DEFAULT_PROPS}
        jobs={[job]}
        pendingJobOpen={{ jobId: 'j1', nonce: 1 }}
        onPendingJobOpenConsumed={onPendingJobOpenConsumed}
      />
    );
    await waitFor(() => expect(onPendingJobOpenConsumed).toHaveBeenCalledTimes(1));
  });

  it('retries once jobs arrive: a dispatch that lands before jobs has loaded still opens the drawer once jobs is populated', async () => {
    const job = makeJob({ id: 'j1', customer: 'Late Arrival Customer' });
    const { rerender } = render(
      <WorkScreen {...DEFAULT_PROPS} jobs={[]} pendingJobOpen={{ jobId: 'j1', nonce: 1 }} />
    );
    expect(document.querySelector('.job-detail-sheet')).toBeNull();

    // Cloud sync lands — jobs arrives with the target now present, same
    // pendingJobOpen (not yet consumed).
    rerender(<WorkScreen {...DEFAULT_PROPS} jobs={[job]} pendingJobOpen={{ jobId: 'j1', nonce: 1 }} />);

    await waitFor(() => expect(drawerOpenFor(job)).toBe(true));
  });

  it('does NOT reopen a drawer the trader has since closed when jobs refreshes again with a stale (already-consumed→null) pendingJobOpen', async () => {
    const job = makeJob({ id: 'j1', customer: 'Stuck Drawer Customer' });
    const onPendingJobOpenConsumed = vi.fn();
    const { rerender } = render(
      <WorkScreen
        {...DEFAULT_PROPS}
        jobs={[job]}
        pendingJobOpen={{ jobId: 'j1', nonce: 1 }}
        onPendingJobOpenConsumed={onPendingJobOpenConsumed}
      />
    );
    await waitFor(() => expect(drawerOpenFor(job)).toBe(true));

    // Trader closes the drawer.
    fireEvent.click(screen.getByLabelText(/close/i));
    await waitFor(() => expect(document.querySelector('.job-detail-sheet')).toBeNull());

    // Real AppShell would have cleared pendingJobOpen to null once consumed
    // (via the onPendingJobOpenConsumed callback captured above) — simulate
    // that, alongside a fresh `jobs` array reference (a later cloud refresh).
    const refreshedJobs = [{ ...job }];
    rerender(
      <WorkScreen
        {...DEFAULT_PROPS}
        jobs={refreshedJobs}
        pendingJobOpen={null}
        onPendingJobOpenConsumed={onPendingJobOpenConsumed}
      />
    );

    // Must stay closed — this is exactly the "stuck-drawer" class of bug the
    // original empty-dep-array version was written to avoid.
    expect(document.querySelector('.job-detail-sheet')).toBeNull();
  });
});
