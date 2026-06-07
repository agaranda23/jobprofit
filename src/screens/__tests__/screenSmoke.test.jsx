// @vitest-environment jsdom
/**
 * Screen render smoke tests — feat/render-smoke-tests
 *
 * Same rationale as componentSmoke.test.jsx: mount each screen with realistic
 * props and edge-case data, assert no throw. Covers the surfaces most likely
 * to develop render-time crashes from undefined-access bugs similar to the
 * P0 CIS isCisUser ReferenceError.
 *
 * Screens covered:
 *   - FinanceScreen (Money tab) — CIS user vs non-CIS, empty data, free vs Pro
 *   - TodayScreen              — all-clear, overdue, finished-not-invoiced, stale-quote states
 *   - WorkScreen               — empty + populated jobs list, with stage filter
 *   - SettingsScreen           — CIS sheet, theme picker, profile undefined
 *   - PublicQuoteView          — single-line quote, itemised; accepted vs not
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
// @testing-library/jest-dom matchers are extended globally via src/test-setup.js

// ── Mock network/browser-API modules ─────────────────────────────────────────

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
    INSIGHT_LOCKED:     'insight_locked',
    WHITELABEL_FOOTER:  'whitelabel_footer',
    AUTO_CHASE_LOCKED:  'auto_chase_locked',
    SETTINGS:           'settings',
    TRIAL_BANNER:       'trial_banner',
    TODAY_PILL:         'today_pill',
    UPGRADE_BANNER:     'upgrade_banner',
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
  downloadOrShareCsv: vi.fn(),
}));

vi.mock('../../lib/realtime', () => ({
  subscribeToJobs: vi.fn().mockReturnValue(() => {}),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOOP = () => {};

function makeJob(overrides = {}) {
  return {
    id: overrides.id ?? 'j1',
    customer: overrides.customer ?? 'Alan Test',
    amount: overrides.amount ?? 500,
    total: overrides.total ?? 500,
    paid: overrides.paid ?? false,
    status: overrides.status ?? 'active',
    paymentStatus: overrides.paymentStatus ?? 'unpaid',
    jobStatus: overrides.jobStatus ?? 'active',
    date: overrides.date ?? '2026-05-01',
    customerPhone: overrides.customerPhone ?? '07700 900000',
    lineItems: overrides.lineItems ?? [],
    photos: overrides.photos ?? [],
    jobNotes: overrides.jobNotes ?? [],
    payments: overrides.payments ?? [],
    ...overrides,
  };
}

function makeReceipt(overrides = {}) {
  return {
    id: overrides.id ?? 'r1',
    amount: overrides.amount ?? 120,
    label: overrides.label ?? 'Materials',
    date: overrides.date ?? '2026-05-05',
    jobId: overrides.jobId ?? null,
    ...overrides,
  };
}

const SESSION = { user: { id: 'user-123', email: 'test@example.com' } };
const BIZ = { name: 'Test Plumbing Ltd', email: 'test@example.com' };
const PROFILE_FREE = { plan: 'free', is_cis_subcontractor: false };
const PROFILE_PRO  = { plan: 'pro',  is_cis_subcontractor: false };
const PROFILE_CIS  = { plan: 'pro',  is_cis_subcontractor: true, cis_default_rate: 20 };

// ── FinanceScreen ─────────────────────────────────────────────────────────────

import FinanceScreen from '../FinanceScreen';

describe('FinanceScreen render smoke', () => {
  afterEach(() => vi.clearAllMocks());

  it('mounts cleanly with no jobs, no receipts (all-empty state)', () => {
    expect(() =>
      render(
        <FinanceScreen
          jobs={[]}
          receipts={[]}
          session={SESSION}
          profile={PROFILE_FREE}
          biz={BIZ}
          onAvatarClick={NOOP}
          onUpgrade={NOOP}
          onGoToJobs={NOOP}
          onGoToSettings={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly for a non-CIS free user with jobs and receipts', () => {
    expect(() =>
      render(
        <FinanceScreen
          jobs={[makeJob({ paid: true }), makeJob({ id: 'j2', amount: 300 })]}
          receipts={[makeReceipt()]}
          session={SESSION}
          profile={PROFILE_FREE}
          biz={BIZ}
          onAvatarClick={NOOP}
          onUpgrade={NOOP}
          onGoToJobs={NOOP}
          onGoToSettings={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly for a Pro user', () => {
    expect(() =>
      render(
        <FinanceScreen
          jobs={[makeJob({ paid: true, amount: 1000 })]}
          receipts={[makeReceipt({ amount: 200 })]}
          session={SESSION}
          profile={PROFILE_PRO}
          biz={BIZ}
          onAvatarClick={NOOP}
          onUpgrade={NOOP}
          onGoToJobs={NOOP}
          onGoToSettings={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly for a CIS Pro user', () => {
    expect(() =>
      render(
        <FinanceScreen
          jobs={[makeJob({ paid: true, amount: 800, cis: true, cisRate: 20 })]}
          receipts={[]}
          session={SESSION}
          profile={PROFILE_CIS}
          biz={BIZ}
          onAvatarClick={NOOP}
          onUpgrade={NOOP}
          onGoToJobs={NOOP}
          onGoToSettings={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly when profile is null', () => {
    expect(() =>
      render(
        <FinanceScreen
          jobs={[]}
          receipts={[]}
          session={null}
          profile={null}
          biz={{}}
          onAvatarClick={NOOP}
          onUpgrade={NOOP}
          onGoToJobs={NOOP}
          onGoToSettings={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with overheads set on profile', () => {
    const profileWithOverheads = {
      ...PROFILE_PRO,
      overheads: [
        { id: 'oh1', label: 'Van insurance', amount: 200, is_active: true },
        { id: 'oh2', label: 'Phone', amount: 50, is_active: true },
      ],
    };
    expect(() =>
      render(
        <FinanceScreen
          jobs={[makeJob({ paid: true, amount: 1500 })]}
          receipts={[]}
          session={SESSION}
          profile={profileWithOverheads}
          biz={BIZ}
          onAvatarClick={NOOP}
          onUpgrade={NOOP}
          onGoToJobs={NOOP}
          onGoToSettings={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with all-paid jobs (no outstanding debt)', () => {
    const jobs = [
      makeJob({ id: 'a', paid: true, amount: 600 }),
      makeJob({ id: 'b', paid: true, amount: 400 }),
    ];
    expect(() =>
      render(
        <FinanceScreen
          jobs={jobs}
          receipts={[]}
          session={SESSION}
          profile={PROFILE_PRO}
          biz={BIZ}
          onAvatarClick={NOOP}
          onUpgrade={NOOP}
          onGoToJobs={NOOP}
          onGoToSettings={NOOP}
        />
      )
    ).not.toThrow();
  });
});

// ── TodayScreen ───────────────────────────────────────────────────────────────

import TodayScreen from '../TodayScreen';

describe('TodayScreen render smoke', () => {
  afterEach(() => vi.clearAllMocks());

  it('mounts cleanly in all-clear state (no actionable items)', () => {
    expect(() =>
      render(
        <TodayScreen
          jobs={[makeJob({ paid: true })]}
          receipts={[]}
          onAddJob={NOOP}
          onUpdateJob={NOOP}
          onOpenDetailed={NOOP}
          onMarkPaid={NOOP}
          onJobTap={NOOP}
          onNavigateToMoney={NOOP}
          profile={PROFILE_FREE}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with empty jobs array', () => {
    expect(() =>
      render(
        <TodayScreen
          jobs={[]}
          receipts={[]}
          onAddJob={NOOP}
          onUpdateJob={NOOP}
          onOpenDetailed={NOOP}
          onMarkPaid={NOOP}
          onJobTap={NOOP}
          onNavigateToMoney={NOOP}
          profile={PROFILE_FREE}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with an overdue job (Tier 1 NBA)', () => {
    const overdueJob = makeJob({
      id: 'ov1',
      status: 'invoice_sent',
      overdue: true,
      invoiceDueDate: '2026-04-01',
      paid: false,
      amount: 750,
    });
    expect(() =>
      render(
        <TodayScreen
          jobs={[overdueJob]}
          receipts={[]}
          onAddJob={NOOP}
          onUpdateJob={NOOP}
          onOpenDetailed={NOOP}
          onMarkPaid={NOOP}
          onJobTap={NOOP}
          onNavigateToMoney={NOOP}
          profile={PROFILE_FREE}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with a finished-not-invoiced job (Tier 2 NBA)', () => {
    const finishedJob = makeJob({
      id: 'fn1',
      status: 'complete',
      paid: false,
      invoiceStatus: null,
      date: '2026-05-01',
      amount: 900,
    });
    expect(() =>
      render(
        <TodayScreen
          jobs={[finishedJob]}
          receipts={[]}
          onAddJob={NOOP}
          onUpdateJob={NOOP}
          onOpenDetailed={NOOP}
          onMarkPaid={NOOP}
          onJobTap={NOOP}
          onNavigateToMoney={NOOP}
          profile={PROFILE_FREE}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with a stale sent quote (Tier 3 NBA)', () => {
    const staleQuote = makeJob({
      id: 'sq1',
      status: 'quoted',
      quoteStatus: 'sent',
      quoteSentAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
      amount: 1200,
    });
    expect(() =>
      render(
        <TodayScreen
          jobs={[staleQuote]}
          receipts={[]}
          onAddJob={NOOP}
          onUpdateJob={NOOP}
          onOpenDetailed={NOOP}
          onMarkPaid={NOOP}
          onJobTap={NOOP}
          onNavigateToMoney={NOOP}
          profile={PROFILE_FREE}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with profile: null', () => {
    expect(() =>
      render(
        <TodayScreen
          jobs={[]}
          receipts={[]}
          onAddJob={NOOP}
          onUpdateJob={NOOP}
          onOpenDetailed={NOOP}
          onMarkPaid={NOOP}
          onJobTap={NOOP}
          onNavigateToMoney={NOOP}
          profile={null}
        />
      )
    ).not.toThrow();
  });
});

// ── WorkScreen ────────────────────────────────────────────────────────────────

import WorkScreen from '../WorkScreen';

describe('WorkScreen render smoke', () => {
  afterEach(() => vi.clearAllMocks());

  it('mounts cleanly with no jobs (empty state)', () => {
    expect(() =>
      render(
        <WorkScreen
          jobs={[]}
          receipts={[]}
          onNewJob={NOOP}
          onAddJob={NOOP}
          onAddPayment={NOOP}
          onUpdateJob={NOOP}
          onDeleteJob={NOOP}
          onAddReceipt={NOOP}
          onDeleteReceipt={NOOP}
          biz={BIZ}
          profile={PROFILE_FREE}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with a populated jobs list', () => {
    const jobs = [
      makeJob({ id: 'a', status: 'lead' }),
      makeJob({ id: 'b', status: 'quoted', amount: 300 }),
      makeJob({ id: 'c', status: 'active', amount: 500 }),
      makeJob({ id: 'd', status: 'invoice_sent', amount: 400 }),
      makeJob({ id: 'e', status: 'invoice_sent', overdue: true, amount: 200 }),
      makeJob({ id: 'f', status: 'paid', amount: 600, paid: true }),
    ];
    expect(() =>
      render(
        <WorkScreen
          jobs={jobs}
          receipts={[makeReceipt({ jobId: 'c' })]}
          onNewJob={NOOP}
          onAddJob={NOOP}
          onAddPayment={NOOP}
          onUpdateJob={NOOP}
          onDeleteJob={NOOP}
          onAddReceipt={NOOP}
          onDeleteReceipt={NOOP}
          biz={BIZ}
          profile={PROFILE_FREE}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with profile: null', () => {
    expect(() =>
      render(
        <WorkScreen
          jobs={[makeJob()]}
          receipts={[]}
          onNewJob={NOOP}
          onAddJob={NOOP}
          onAddPayment={NOOP}
          onUpdateJob={NOOP}
          onDeleteJob={NOOP}
          onAddReceipt={NOOP}
          onDeleteReceipt={NOOP}
          biz={BIZ}
          profile={null}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with a CIS profile', () => {
    expect(() =>
      render(
        <WorkScreen
          jobs={[makeJob({ cis: true, cisRate: 20 })]}
          receipts={[]}
          onNewJob={NOOP}
          onAddJob={NOOP}
          onAddPayment={NOOP}
          onUpdateJob={NOOP}
          onDeleteJob={NOOP}
          onAddReceipt={NOOP}
          onDeleteReceipt={NOOP}
          biz={BIZ}
          profile={PROFILE_CIS}
        />
      )
    ).not.toThrow();
  });
});

// ── SettingsScreen ────────────────────────────────────────────────────────────

import SettingsScreen from '../SettingsScreen';

describe('SettingsScreen render smoke', () => {
  afterEach(() => vi.clearAllMocks());

  it('mounts cleanly with a full profile (free plan)', () => {
    expect(() =>
      render(
        <SettingsScreen
          session={SESSION}
          profile={PROFILE_FREE}
          jobs={[makeJob()]}
          receipts={[makeReceipt()]}
          onSignOut={NOOP}
          onOpenWizard={NOOP}
          onProfileUpdate={NOOP}
          onOpenJob={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly for a Pro user', () => {
    expect(() =>
      render(
        <SettingsScreen
          session={SESSION}
          profile={PROFILE_PRO}
          jobs={[makeJob()]}
          receipts={[]}
          onSignOut={NOOP}
          onOpenWizard={NOOP}
          onProfileUpdate={NOOP}
          onOpenJob={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with a CIS profile (CIS sheet section visible)', () => {
    expect(() =>
      render(
        <SettingsScreen
          session={SESSION}
          profile={PROFILE_CIS}
          jobs={[]}
          receipts={[]}
          onSignOut={NOOP}
          onOpenWizard={NOOP}
          onProfileUpdate={NOOP}
          onOpenJob={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly when profile is null', () => {
    expect(() =>
      render(
        <SettingsScreen
          session={SESSION}
          profile={null}
          jobs={[]}
          receipts={[]}
          onSignOut={NOOP}
          onOpenWizard={NOOP}
          onProfileUpdate={NOOP}
          onOpenJob={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly when profile is undefined', () => {
    expect(() =>
      render(
        <SettingsScreen
          session={SESSION}
          profile={undefined}
          jobs={[]}
          receipts={[]}
          onSignOut={NOOP}
          onOpenWizard={NOOP}
          onProfileUpdate={NOOP}
          onOpenJob={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with overheads set on profile', () => {
    const profileWithOverheads = {
      ...PROFILE_PRO,
      overheads: [
        { id: 'oh1', label: 'Van insurance', amount: 200, is_active: true },
      ],
    };
    expect(() =>
      render(
        <SettingsScreen
          session={SESSION}
          profile={profileWithOverheads}
          jobs={[]}
          receipts={[]}
          onSignOut={NOOP}
          onOpenWizard={NOOP}
          onProfileUpdate={NOOP}
          onOpenJob={NOOP}
        />
      )
    ).not.toThrow();
  });
});

// ── PublicQuoteView ───────────────────────────────────────────────────────────

import PublicQuoteView from '../PublicQuoteView';

describe('PublicQuoteView render smoke', () => {
  afterEach(() => vi.clearAllMocks());

  it('mounts cleanly with a valid token (loading state while fetch resolves)', () => {
    // fetchPublicJob is mocked to return { data: null, error: 'not found' }.
    // The component shows a loading/error state synchronously on first render.
    expect(() =>
      render(<PublicQuoteView token="valid-token-abc123" />)
    ).not.toThrow();
  });

  it('mounts cleanly with an invalid token (validation failure path)', () => {
    // isValidToken will return false for a clearly invalid token.
    // The component should render an error state without crashing.
    expect(() =>
      render(<PublicQuoteView token="invalid!" />)
    ).not.toThrow();
  });

  it('mounts cleanly when token prop is undefined', () => {
    expect(() =>
      render(<PublicQuoteView token={undefined} />)
    ).not.toThrow();
  });

  it('mounts cleanly when token is an empty string', () => {
    expect(() =>
      render(<PublicQuoteView token="" />)
    ).not.toThrow();
  });
});

// ── PublicInvoiceView ─────────────────────────────────────────────────────────

import PublicInvoiceView from '../PublicInvoiceView';

describe('PublicInvoiceView render smoke', () => {
  afterEach(() => vi.clearAllMocks());

  it('mounts cleanly with a valid UUID token (loading state while fetch resolves)', () => {
    // fetchPublicJob + fetch-public-invoice are pending on mount.
    // Component should render the loading skeleton without crashing.
    expect(() =>
      render(<PublicInvoiceView token="a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11" />)
    ).not.toThrow();
  });

  it('mounts cleanly with an invalid token (validation failure → error state)', () => {
    // isValidToken returns false; component renders the error card immediately.
    expect(() =>
      render(<PublicInvoiceView token="invalid!" />)
    ).not.toThrow();
  });

  it('mounts cleanly when token is undefined', () => {
    expect(() =>
      render(<PublicInvoiceView token={undefined} />)
    ).not.toThrow();
  });

  it('mounts cleanly when token is an empty string', () => {
    expect(() =>
      render(<PublicInvoiceView token="" />)
    ).not.toThrow();
  });
});
