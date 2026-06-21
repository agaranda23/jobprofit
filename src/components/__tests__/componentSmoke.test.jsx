// @vitest-environment jsdom
/**
 * Component render smoke tests — feat/render-smoke-tests
 *
 * These tests MOUNT each key component with realistic props and assert it
 * renders without throwing. They catch the class of bug that hit production
 * on 2026-05-31: a ReferenceError in JobDetailDrawer caused a blank white
 * screen on every job open. Unit tests for helper functions would not catch
 * a render-time crash — these tests do.
 *
 * Convention note: all other tests in this project use 'node' env and no
 * testing-library. These smoke tests are the deliberate exception — they
 * need 'jsdom' and @testing-library/react because the goal is
 * "does this component MOUNT cleanly", not "does the helper return X".
 *
 * Mocking strategy: mock every module that makes network calls or uses
 * browser APIs absent from jsdom (Supabase, store, billing, OCR, PDF,
 * push, telemetry, voice). Pure-logic lib functions are NOT mocked —
 * they run real code so logic regressions surface here too.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';
// @testing-library/jest-dom matchers are extended globally via src/test-setup.js

// ── Mock network/browser-API modules ────────────────────────────────────────
// Must come before any component import so vi.mock hoisting works correctly.

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

// ── Test fixtures ─────────────────────────────────────────────────────────────

/** Minimal job that passes every null-guard in JobDetailDrawer */
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

const BIZ = { name: 'Test Plumbing Ltd', email: 'test@example.com' };
const PROFILE_FREE = { plan: 'free', is_cis_subcontractor: false };
const PROFILE_PRO  = { plan: 'pro',  is_cis_subcontractor: false };
const PROFILE_CIS  = { plan: 'pro',  is_cis_subcontractor: true, cis_default_rate: 20 };
const NOOP = () => {};

// ── JobDetailDrawer ───────────────────────────────────────────────────────────

import JobDetailDrawer from '../JobDetailDrawer';

function renderDrawer({ job = makeJob(), profile = PROFILE_FREE, biz = BIZ, receipts = [] } = {}) {
  return render(
    <JobDetailDrawer
      job={job}
      receipts={receipts}
      biz={biz}
      profile={profile}
      jobs={[job]}
      onUpdateJob={NOOP}
      onAddReceipt={NOOP}
      onDeleteReceipt={NOOP}
      onAddPayment={NOOP}
      onClose={NOOP}
    />
  );
}

describe('JobDetailDrawer — profile edge cases (null-guard regression)', () => {
  afterEach(() => vi.clearAllMocks());

  it('mounts cleanly when profile is null (the P0 root cause scenario)', () => {
    expect(() => renderDrawer({ profile: null })).not.toThrow();
  });

  it('mounts cleanly when profile is undefined', () => {
    expect(() => renderDrawer({ profile: undefined })).not.toThrow();
  });

  it('mounts cleanly when profile is an empty object {}', () => {
    expect(() => renderDrawer({ profile: {} })).not.toThrow();
  });

  it('mounts cleanly for a CIS user (is_cis_subcontractor: true)', () => {
    expect(() => renderDrawer({ profile: PROFILE_CIS })).not.toThrow();
  });

  it('mounts cleanly for a non-CIS free user', () => {
    expect(() => renderDrawer({ profile: PROFILE_FREE })).not.toThrow();
  });

  it('mounts cleanly for a Pro user', () => {
    expect(() => renderDrawer({ profile: PROFILE_PRO })).not.toThrow();
  });
});

describe('JobDetailDrawer — job field edge cases', () => {
  it('job with amount undefined (no price set)', () => {
    expect(() =>
      renderDrawer({ job: makeJob({ amount: undefined, total: undefined }) })
    ).not.toThrow();
  });

  it('job with amount: 0 (zero-price)', () => {
    expect(() => renderDrawer({ job: makeJob({ amount: 0, total: 0 }) })).not.toThrow();
  });

  it('job with receipts linked to it', () => {
    const job = makeJob();
    expect(() =>
      renderDrawer({
        job,
        receipts: [{ id: 'r1', jobId: 'j1', amount: 120, label: 'Screws', date: '2026-05-02' }],
      })
    ).not.toThrow();
  });

  it('job with no customer name (customer: null)', () => {
    expect(() => renderDrawer({ job: makeJob({ customer: null }) })).not.toThrow();
  });

  it('job with line items', () => {
    expect(() =>
      renderDrawer({
        job: makeJob({ lineItems: [{ desc: 'Labour', cost: 300 }, { desc: 'Parts', cost: 200 }] }),
      })
    ).not.toThrow();
  });

  it('job with notes', () => {
    expect(() =>
      renderDrawer({
        job: makeJob({ notes: 'Needs key from neighbour', jobNotes: [{ id: 'n1', subject: 'Visit', body: 'Arrived 9am', date: '2026-05-01T09:00:00Z' }] }),
      })
    ).not.toThrow();
  });
});

describe('JobDetailDrawer — stage/status matrix', () => {
  const cases = [
    { status: 'lead' },
    { status: 'quoted', quoteStatus: 'draft' },
    { status: 'quoted', quoteStatus: 'sent' },
    { status: 'quoted', quoteStatus: 'accepted' },
    { status: 'active' },
    { status: 'complete' },
    { status: 'invoice_sent', overdue: false },
    { status: 'invoice_sent', overdue: true, invoiceDueDate: '2026-04-01' },
    { status: 'paid', paid: true, paymentStatus: 'paid' },
  ];

  for (const overrides of cases) {
    it(`mounts cleanly: status=${overrides.status}${overrides.overdue ? ' (overdue)' : ''}${overrides.quoteStatus ? ` quoteStatus=${overrides.quoteStatus}` : ''}`, () => {
      expect(() => renderDrawer({ job: makeJob(overrides) })).not.toThrow();
    });
  }
});

describe('JobDetailDrawer — payment states', () => {
  it('paid job (paid: true, paymentStatus: paid)', () => {
    expect(() =>
      renderDrawer({ job: makeJob({ paid: true, paymentStatus: 'paid', status: 'paid' }) })
    ).not.toThrow();
  });

  it('part-paid job (one payment recorded, balance remaining)', () => {
    const job = makeJob({
      amount: 500,
      paid: false,
      payments: [{ id: 'p1', amount: 200, date: '2026-05-10', method: 'cash', note: '' }],
    });
    expect(() => renderDrawer({ job })).not.toThrow();
  });

  it('overdue job', () => {
    expect(() =>
      renderDrawer({
        job: makeJob({ status: 'invoice_sent', overdue: true, invoiceDueDate: '2026-04-01' }),
      })
    ).not.toThrow();
  });
});

describe('JobDetailDrawer — CIS and tax-meta fields', () => {
  it('job with excludeFromTax: true (non-CIS profile)', () => {
    expect(() =>
      renderDrawer({ job: makeJob({ excludeFromTax: true }), profile: PROFILE_FREE })
    ).not.toThrow();
  });

  it('job with cis: true on a CIS profile', () => {
    expect(() =>
      renderDrawer({ job: makeJob({ cis: true, cisRate: 20 }), profile: PROFILE_CIS })
    ).not.toThrow();
  });

  it('job with cis: false (per-job opt-out) on a CIS profile', () => {
    expect(() =>
      renderDrawer({ job: makeJob({ cis: false }), profile: PROFILE_CIS })
    ).not.toThrow();
  });

  it('CIS profile + job.cis is null (inherits profile default)', () => {
    expect(() =>
      renderDrawer({ job: makeJob({ cis: null }), profile: PROFILE_CIS })
    ).not.toThrow();
  });
});

// ── StageStrip ───────────────────────────────────────────────────────────────

import StageStrip from '../StageStrip';

function deriveStatusFn(job) {
  if (job.status === 'lead') return 'Lead';
  if (job.status === 'quoted') return 'Quoted';
  if (job.status === 'active') return 'On';
  if (job.status === 'invoice_sent') return job.overdue ? 'Overdue' : 'Invoiced';
  if (job.status === 'paid') return 'Paid';
  return 'Lead';
}

function formatAmountFn(v) {
  return Number(v || 0).toFixed(0);
}

describe('StageStrip render smoke', () => {
  it('mounts cleanly with an empty jobs array', () => {
    expect(() =>
      render(
        <StageStrip
          jobs={[]}
          selectedStage="On"
          showAll={false}
          onSelectStage={NOOP}
          deriveStatus={deriveStatusFn}
          formatAmount={formatAmountFn}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with jobs spanning all stages', () => {
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
        <StageStrip
          jobs={jobs}
          selectedStage="On"
          showAll={false}
          onSelectStage={NOOP}
          deriveStatus={deriveStatusFn}
          formatAmount={formatAmountFn}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly in showAll mode', () => {
    expect(() =>
      render(
        <StageStrip
          jobs={[makeJob()]}
          selectedStage="On"
          showAll={true}
          onSelectStage={NOOP}
          deriveStatus={deriveStatusFn}
          formatAmount={formatAmountFn}
        />
      )
    ).not.toThrow();
  });

  // PR #326 (b0507c4) intentionally removed the alert-dot from Overdue and the
  // SVG tick from Paid — both were pure decoration. This test now asserts that
  // neither tile renders those adornments (ensuring the removal stays clean).
  it('Overdue and Paid tiles render no decoration adornments (alert-dot/paid-tick removed in PR #326)', () => {
    const { container } = render(
      <StageStrip
        jobs={[]}
        selectedStage="On"
        showAll={false}
        onSelectStage={NOOP}
        deriveStatus={deriveStatusFn}
        formatAmount={formatAmountFn}
      />
    );
    const overdueTile = container.querySelector('.stage-tile--overdue');
    const paidTile    = container.querySelector('.stage-tile--paid');
    expect(overdueTile.querySelector('.stage-tile-alert-dot')).toBeNull();
    expect(paidTile.querySelector('.stage-tile-alert-dot')).toBeNull();
    expect(paidTile.querySelector('.stage-tile-paid-tick')).toBeNull();
  });
});

// ── ProfitBreakdownSheet ──────────────────────────────────────────────────────

import ProfitBreakdownSheet from '../ProfitBreakdownSheet';

describe('ProfitBreakdownSheet render smoke', () => {
  it('mounts cleanly when open=false', () => {
    expect(() =>
      render(
        <ProfitBreakdownSheet open={false} onClose={NOOP} job={makeJob()} receipts={[]} />
      )
    ).not.toThrow();
  });

  it('mounts cleanly when open=true with a priced job and receipts', () => {
    expect(() =>
      render(
        <ProfitBreakdownSheet
          open={true}
          onClose={NOOP}
          job={makeJob({ amount: 800, total: 800 })}
          receipts={[{ id: 'r1', jobId: 'j1', amount: 200, label: 'Materials', date: '2026-05-02' }]}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with no receipts (100% margin)', () => {
    expect(() =>
      render(
        <ProfitBreakdownSheet
          open={true}
          onClose={NOOP}
          job={makeJob({ amount: 500, total: 500 })}
          receipts={[]}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly with zero-price job', () => {
    expect(() =>
      render(
        <ProfitBreakdownSheet
          open={true}
          onClose={NOOP}
          job={makeJob({ amount: 0, total: 0 })}
          receipts={[]}
        />
      )
    ).not.toThrow();
  });
});

// ── RecordPaymentModal ────────────────────────────────────────────────────────

import RecordPaymentModal from '../RecordPaymentModal';

describe('RecordPaymentModal render smoke', () => {
  it('mounts cleanly for a standard unpaid job', () => {
    expect(() =>
      render(
        <RecordPaymentModal
          job={makeJob({ amount: 500 })}
          onAddPayment={NOOP}
          onClose={NOOP}
          flash={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly for a fully paid job (balance = 0)', () => {
    expect(() =>
      render(
        <RecordPaymentModal
          job={makeJob({ amount: 500, paid: true, paymentStatus: 'paid' })}
          onAddPayment={NOOP}
          onClose={NOOP}
          flash={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly for a part-paid job', () => {
    const job = makeJob({
      amount: 600,
      payments: [{ id: 'p1', amount: 200, date: '2026-05-10', method: 'cash', note: '' }],
    });
    expect(() =>
      render(
        <RecordPaymentModal job={job} onAddPayment={NOOP} onClose={NOOP} flash={NOOP} />
      )
    ).not.toThrow();
  });

  it('mounts cleanly when job.amount is undefined', () => {
    expect(() =>
      render(
        <RecordPaymentModal
          job={makeJob({ amount: undefined })}
          onAddPayment={NOOP}
          onClose={NOOP}
          flash={NOOP}
        />
      )
    ).not.toThrow();
  });
});

// ── ReceiptModal ──────────────────────────────────────────────────────────────

import ReceiptModal from '../ReceiptModal';

describe('ReceiptModal render smoke', () => {
  it('mounts cleanly for a paid job with biz set', () => {
    expect(() =>
      render(
        <ReceiptModal
          job={makeJob({ paid: true, paymentStatus: 'paid', status: 'paid', amount: 500 })}
          biz={BIZ}
          onClose={NOOP}
          flash={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly when biz is undefined', () => {
    expect(() =>
      render(
        <ReceiptModal
          job={makeJob({ paid: true, paymentStatus: 'paid', status: 'paid' })}
          biz={undefined}
          onClose={NOOP}
          flash={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly when biz is an empty object', () => {
    expect(() =>
      render(
        <ReceiptModal
          job={makeJob({ paid: true, paymentStatus: 'paid' })}
          biz={{}}
          onClose={NOOP}
          flash={NOOP}
        />
      )
    ).not.toThrow();
  });
});

// ── AddJobModal ───────────────────────────────────────────────────────────────

import AddJobModal from '../AddJobModal';

describe('AddJobModal render smoke', () => {
  it('mounts cleanly in default micro mode', () => {
    expect(() =>
      render(
        <AddJobModal
          onClose={NOOP}
          onSave={NOOP}
          onOpenDetailed={NOOP}
          defaultMode="micro"
          onSaveAndSend={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly in quote mode', () => {
    expect(() =>
      render(
        <AddJobModal
          onClose={NOOP}
          onSave={NOOP}
          onOpenDetailed={NOOP}
          defaultMode="quote"
          onSaveAndSend={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly in details mode', () => {
    expect(() =>
      render(
        <AddJobModal
          onClose={NOOP}
          onSave={NOOP}
          onOpenDetailed={NOOP}
          defaultMode="details"
          onSaveAndSend={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly without defaultMode (undefined fallback)', () => {
    expect(() =>
      render(
        <AddJobModal onClose={NOOP} onSave={NOOP} onOpenDetailed={NOOP} />
      )
    ).not.toThrow();
  });
});

// ── ReviewSheet ───────────────────────────────────────────────────────────────

import ReviewSheet from '../ReviewSheet';

describe('ReviewSheet render smoke', () => {
  it('mounts cleanly in quote mode', () => {
    expect(() =>
      render(
        <ReviewSheet
          mode="quote"
          job={makeJob({ amount: 500, total: 500, quoteStatus: 'draft' })}
          biz={BIZ}
          jobs={[makeJob()]}
          onClose={NOOP}
          onDismiss={NOOP}
          onUpdate={NOOP}
          flash={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly in invoice mode', () => {
    expect(() =>
      render(
        <ReviewSheet
          mode="invoice"
          job={makeJob({ amount: 500, total: 500, status: 'complete' })}
          biz={BIZ}
          jobs={[makeJob()]}
          onClose={NOOP}
          onDismiss={NOOP}
          onUpdate={NOOP}
          flash={NOOP}
        />
      )
    ).not.toThrow();
  });

  it('mounts cleanly when biz has no configured fields', () => {
    expect(() =>
      render(
        <ReviewSheet
          mode="invoice"
          job={makeJob({ amount: 300 })}
          biz={{}}
          jobs={[]}
          onClose={NOOP}
          onDismiss={NOOP}
          onUpdate={NOOP}
          flash={NOOP}
        />
      )
    ).not.toThrow();
  });
});
