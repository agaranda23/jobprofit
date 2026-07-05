// @vitest-environment jsdom
/**
 * customersListToggle.test.jsx — feat/customers-list
 *
 * The People/Jobs segmented toggle at the top of WorkScreen (the Jobs tab).
 * Default stays Jobs (unchanged view); selecting People swaps the list area
 * to a searchable customer list built from groupByCustomer/computeLifetime
 * (src/lib/customerTimeline.js) — same underlying jobs+receipts data, no
 * second timeline, no 5th bottom-nav tab.
 *
 * Covers:
 *   1. Toggle renders, defaults to Jobs, and the existing Jobs view is
 *      byte-for-byte present (stage strip + job tile) with People untouched.
 *   2. Selecting People swaps the list area to the customer list; selecting
 *      Jobs again restores the original view.
 *   3. One row per named customer (groupByCustomer), correct lifetime figures
 *      (jobs count, billed, owed only when > 0).
 *   4. Search filters the People list by name.
 *   5. Tapping a customer opens CustomerTimelineSheet with that customer's data.
 *   6. Empty state when there are no named customers.
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

import WorkScreen from '../WorkScreen';

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

afterEach(() => vi.clearAllMocks());

// ── 1. Toggle default + Jobs view unchanged ──────────────────────────────────

describe('WorkScreen — People/Jobs toggle (feat/customers-list)', () => {
  it('renders the toggle with Jobs selected by default, and the existing Jobs view (stage strip + tile) untouched', () => {
    render(<WorkScreen {...DEFAULT_PROPS} jobs={[makeJob({ customer: 'Dave Wilson' })]} />);

    const jobsTab = screen.getByRole('tab', { name: 'Jobs' });
    const peopleTab = screen.getByRole('tab', { name: 'People' });
    expect(jobsTab).toBeInTheDocument();
    expect(peopleTab).toBeInTheDocument();
    expect(jobsTab.getAttribute('aria-selected')).toBe('true');
    expect(peopleTab.getAttribute('aria-selected')).toBe('false');

    // Stage strip (Jobs-only concept) is present; People list is not rendered.
    expect(screen.getByPlaceholderText('Search name, job or street')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search customers by name or phone')).not.toBeInTheDocument();
  });

  it('selecting People swaps the list area to the customer list; selecting Jobs restores the Jobs view', () => {
    render(<WorkScreen {...DEFAULT_PROPS} jobs={[makeJob({ customer: 'Dave Wilson' })]} />);

    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    expect(screen.getByRole('tab', { name: 'People' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByPlaceholderText('Search customers by name or phone')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search name, job or street')).not.toBeInTheDocument();
    expect(screen.getByText('Dave Wilson')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Jobs' }));
    expect(screen.getByRole('tab', { name: 'Jobs' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByPlaceholderText('Search name, job or street')).toBeInTheDocument();
    expect(screen.queryByText('Dave Wilson · Fix boiler')).not.toBeInTheDocument();
  });
});

// ── 2. People list content ────────────────────────────────────────────────────

describe('WorkScreen — People list content', () => {
  it('renders one row per named customer with correct lifetime figures (jobs, billed, owed)', () => {
    const jobs = [
      makeJob({ id: 'j1', customer: 'Dave Wilson', total: 500, createdAt: '2026-06-01T09:00:00Z' }),
      makeJob({ id: 'j2', customer: 'Dave Wilson', total: 300, createdAt: '2026-06-05T09:00:00Z' }),
      makeJob({ id: 'j3', customer: 'Sarah Jones', total: 200, paid: true, paidAt: '2026-06-03T09:00:00Z', createdAt: '2026-06-02T09:00:00Z', payments: [{ amount: 200, date: '2026-06-03T09:00:00Z' }] }),
    ];
    render(<WorkScreen {...DEFAULT_PROPS} jobs={jobs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));

    // Dave Wilson: 2 jobs, £800 billed, £800 owed (nothing paid).
    const daveRow = screen.getByRole('button', { name: 'Open timeline with Dave Wilson' });
    expect(daveRow.textContent).toMatch(/2 jobs.*£800 billed.*£800 owed/);

    // Sarah Jones: 1 job, £200 billed, fully paid — no "owed" segment.
    const sarahRow = screen.getByRole('button', { name: 'Open timeline with Sarah Jones' });
    expect(sarahRow.textContent).toMatch(/1 job.*£200 billed/);
    expect(sarahRow.textContent).not.toMatch(/owed/);
  });

  it('skips jobs with no customer name (groupByCustomer contract)', () => {
    const jobs = [
      makeJob({ id: 'j1', customer: '' }),
      makeJob({ id: 'j2', customer: 'Dave Wilson' }),
    ];
    render(<WorkScreen {...DEFAULT_PROPS} jobs={jobs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    expect(screen.getByText('Dave Wilson')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Open timeline with/ })).toHaveLength(1);
  });

  it('shows the empty state when there are no named customers yet', () => {
    render(<WorkScreen {...DEFAULT_PROPS} jobs={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    expect(screen.getByText('No customers yet')).toBeInTheDocument();
    expect(screen.getByText('Your customers show up here as you log jobs.')).toBeInTheDocument();
  });
});

// ── 3. Search ─────────────────────────────────────────────────────────────────

describe('WorkScreen — People list search', () => {
  it('filters the customer list by name', () => {
    const jobs = [
      makeJob({ id: 'j1', customer: 'Dave Wilson' }),
      makeJob({ id: 'j2', customer: 'Sarah Jones' }),
    ];
    render(<WorkScreen {...DEFAULT_PROPS} jobs={jobs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    expect(screen.getByText('Dave Wilson')).toBeInTheDocument();
    expect(screen.getByText('Sarah Jones')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search customers by name or phone'), {
      target: { value: 'sarah' },
    });
    expect(screen.getByText('Sarah Jones')).toBeInTheDocument();
    expect(screen.queryByText('Dave Wilson')).not.toBeInTheDocument();
  });

  it('shows a no-match state when the search has no results', () => {
    const jobs = [makeJob({ id: 'j1', customer: 'Dave Wilson' })];
    render(<WorkScreen {...DEFAULT_PROPS} jobs={jobs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    fireEvent.change(screen.getByPlaceholderText('Search customers by name or phone'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No customers match “zzz”')).toBeInTheDocument();
  });
});

// ── 4. Tapping a customer opens CustomerTimelineSheet ────────────────────────

describe('WorkScreen — tapping a customer opens CustomerTimelineSheet', () => {
  it('opens the sheet with that customer\'s jobs and lifetime figures', () => {
    const jobs = [
      makeJob({ id: 'j1', customer: 'Dave Wilson', summary: 'Fix boiler', total: 500, createdAt: '2026-06-01T09:00:00Z' }),
      makeJob({ id: 'j2', customer: 'Dave Wilson', summary: 'Repipe bathroom', total: 300, createdAt: '2026-06-05T09:00:00Z' }),
    ];
    render(<WorkScreen {...DEFAULT_PROPS} jobs={jobs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open timeline with Dave Wilson' }));

    // Sheet header shows the customer name; feed shows both of their jobs.
    expect(screen.getByRole('dialog', { name: 'Timeline with Dave Wilson' })).toBeInTheDocument();
    expect(screen.getAllByText('Fix boiler').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Repipe bathroom').length).toBeGreaterThan(0);
    // Lifetime strip totals both jobs.
    expect(screen.getByText('£800 billed')).toBeInTheDocument();
  });

  it('tapping an event for the other job in the sheet calls through to handleOpenJob and opens the drawer', () => {
    const jobs = [
      makeJob({ id: 'j1', customer: 'Dave Wilson', summary: 'Fix boiler', createdAt: '2026-06-01T09:00:00Z' }),
      makeJob({ id: 'j2', customer: 'Dave Wilson', summary: 'Repipe bathroom', createdAt: '2026-06-05T09:00:00Z' }),
    ];
    render(<WorkScreen {...DEFAULT_PROPS} jobs={jobs} />);
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open timeline with Dave Wilson' }));

    // Newest event ("Job created" for Repipe bathroom, j2) sits first — tap it.
    const rows = screen.getAllByText('Job created');
    fireEvent.click(rows[0].closest('button'));

    // Sheet closes, drawer opens on that job — its summary is now visible in the drawer.
    expect(screen.queryByRole('dialog', { name: 'Timeline with Dave Wilson' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Repipe bathroom').length).toBeGreaterThan(0);
  });

  it('the Call chip in the sheet still logs via onUpdateJob (logComms)', () => {
    const onUpdateJob = vi.fn();
    const jobs = [makeJob({ id: 'j1', customer: 'Dave Wilson', customerPhone: '07700900000' })];
    render(<WorkScreen {...DEFAULT_PROPS} jobs={jobs} onUpdateJob={onUpdateJob} />);
    fireEvent.click(screen.getByRole('tab', { name: 'People' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open timeline with Dave Wilson' }));

    fireEvent.click(screen.getByText('Call').closest('a'));
    expect(onUpdateJob).toHaveBeenCalledTimes(1);
    expect(onUpdateJob.mock.calls[0][0]).toMatchObject({
      id: 'j1',
      commsLog: [expect.objectContaining({ type: 'call' })],
    });
  });
});
