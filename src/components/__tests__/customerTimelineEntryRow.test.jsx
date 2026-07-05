// @vitest-environment jsdom
/**
 * Customer Timeline entry row — the "See all work with {FirstName} · {n} jobs"
 * row added to CustomerCard inside JobDetailDrawer.jsx.
 *
 * Covers:
 *  1. Row is hidden when the customer has only this one job.
 *  2. Row appears (with the right job count) when the customer has ≥1 other job.
 *  3. Tapping the row opens CustomerTimelineSheet (its dialog becomes visible).
 *
 * Mocking strategy mirrors componentSmoke.test.jsx — mock every module that
 * makes network calls or uses browser APIs absent from jsdom; pure-logic lib
 * functions are left real so grouping/timeline logic is exercised for real.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

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
  getReceiptSignedUrl: vi.fn().mockResolvedValue(''),
  revokePublicLink: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/telemetry', () => ({
  logTelemetry: vi.fn(),
  setLastUpgradeTrigger: vi.fn(),
  getLastUpgradeTrigger: vi.fn(),
  UPGRADE_TRIGGERS: {},
}));

vi.mock('../../lib/billing', () => ({
  startCheckout: vi.fn().mockResolvedValue({}),
  startCheckoutWithCoupon: vi.fn().mockResolvedValue({}),
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

vi.mock('../../lib/realtime', () => ({
  subscribeToJobs: vi.fn().mockReturnValue(() => {}),
  subscribeToJob: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
}));

import JobDetailDrawer from '../JobDetailDrawer';

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
    createdAt: '2026-05-01T09:00:00Z',
    customerPhone: '07700 900000',
    lineItems: [],
    photos: [],
    jobNotes: [],
    payments: [],
    ...overrides,
  };
}

const BIZ = { name: 'Test Plumbing Ltd', email: 'test@example.com' };
const PROFILE_FREE = { plan: 'free', is_cis_subcontractor: false };
const NOOP = () => {};

function renderDrawer({ job, jobs, receipts = [] }) {
  return render(
    <JobDetailDrawer
      job={job}
      jobs={jobs}
      receipts={receipts}
      biz={BIZ}
      profile={PROFILE_FREE}
      onUpdateJob={NOOP}
      onAddReceipt={NOOP}
      onDeleteReceipt={NOOP}
      onUpdateReceipt={NOOP}
      onAddPayment={NOOP}
      onClose={NOOP}
      onOpenJob={NOOP}
    />
  );
}

describe('Customer Timeline entry row', () => {
  afterEach(() => { vi.clearAllMocks(); cleanup(); });

  it('is hidden when the customer has only this one job', () => {
    const job = makeJob();
    renderDrawer({ job, jobs: [job] });
    expect(screen.queryByText(/See all work with/)).not.toBeInTheDocument();
  });

  it('appears with the right job count when the customer has other jobs', () => {
    const jobA = makeJob({ id: 'a', summary: 'Bathroom refit' });
    const jobB = makeJob({ id: 'b', summary: 'Kitchen tap', createdAt: '2026-05-02T09:00:00Z' });
    const jobC = makeJob({ id: 'c', summary: 'Boiler service', createdAt: '2026-05-03T09:00:00Z' });
    renderDrawer({ job: jobA, jobs: [jobA, jobB, jobC] });
    expect(screen.getByText('See all work with Alan · 3 jobs')).toBeInTheDocument();
  });

  it('is hidden for a customer with a different name (no false-positive grouping)', () => {
    const jobA = makeJob({ id: 'a', customer: 'Alan Test' });
    const jobB = makeJob({ id: 'b', customer: 'Someone Else', createdAt: '2026-05-02T09:00:00Z' });
    renderDrawer({ job: jobA, jobs: [jobA, jobB] });
    expect(screen.queryByText(/See all work with/)).not.toBeInTheDocument();
  });

  it('tapping the row opens CustomerTimelineSheet', () => {
    const jobA = makeJob({ id: 'a', summary: 'Bathroom refit' });
    const jobB = makeJob({ id: 'b', summary: 'Kitchen tap', createdAt: '2026-05-02T09:00:00Z' });
    renderDrawer({ job: jobA, jobs: [jobA, jobB] });

    fireEvent.click(screen.getByText('See all work with Alan · 2 jobs'));

    expect(screen.getByRole('dialog', { name: /Timeline with Alan Test/ })).toBeInTheDocument();
  });
});
