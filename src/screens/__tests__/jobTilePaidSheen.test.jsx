// @vitest-environment jsdom
/**
 * jobTilePaidSheen.test.jsx — Phase 3 motion: the Paid finish-line sheen.
 *
 * Covers JobTile's not-Paid → Paid transition detector (WorkScreen.jsx),
 * which drives the one-shot .jt--paid-sheen class documented in index.css:
 *
 *   1. A job that is ALREADY Paid on first render never gets the sheen class
 *      (mount must stay silent — page load/refresh must not sweep).
 *   2. A genuine non-Paid → Paid transition (via re-render with new props,
 *      exactly how AppShell/WorkScreen flow a job update back down) DOES add
 *      the sheen class.
 *   3. The sheen class is removed automatically ~700ms later (one-shot —
 *      it must not linger indefinitely).
 *   4. Once it has fired and cleared, further re-renders that keep the job
 *      Paid (e.g. an unrelated field changing) do NOT re-add the class —
 *      no repeat-fire from ordinary re-renders/refetches.
 *   5. A job that goes Paid → un-paid → Paid again DOES fire a second time
 *      (this is a legitimate second transition, not a misfire).
 *
 * Mocking strategy matches the existing "WorkScreen render smoke" block in
 * screenSmoke.test.jsx — WorkScreen.jsx's module-level imports need the same
 * mocks whether we render the default export or (as here) the named JobTile
 * export directly, since importing either still evaluates the whole file.
 *
 * prefers-reduced-motion is enforced entirely in CSS (no JS branch — see the
 * .jt--paid-sheen comment in index.css), so it isn't asserted here; it's a
 * manual deploy-preview check (toggle Reduce Motion, confirm no sweep).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

// ── Mocks required to import WorkScreen.jsx (JobTile lives in this file) ───

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

import { JobTile } from '../WorkScreen';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOOP = () => {};

function makeJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Dave Jones',
    summary: 'Bathroom retile',
    amount: 500,
    total: 500,
    paid: false,
    status: 'active',
    paymentStatus: 'unpaid',
    jobStatus: 'active',
    date: '2026-05-01',
    customerPhone: '07700 900000',
    lineItems: [],
    photos: [],
    jobNotes: [],
    payments: [],
    ...overrides,
  };
}

const PAID_OVERRIDES = { status: 'paid', paid: true, paymentStatus: 'paid' };

function renderTile(job) {
  return render(
    <ul>
      <JobTile
        job={job}
        onSelect={NOOP}
        onSendInvoice={NOOP}
        onUpdateJob={NOOP}
        onNewJob={NOOP}
        onOpenJob={NOOP}
        onCopyJob={NOOP}
        onArchiveJob={NOOP}
        onDeleteJob={NOOP}
        biz={{}}
        onShowToast={NOOP}
        onViewReceipt={NOOP}
        onActionRedirect={NOOP}
        onCallJob={NOOP}
        onRequestBook={NOOP}
      />
    </ul>
  );
}

describe('JobTile — Paid finish-line sheen (Phase 3 motion)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does NOT fire the sheen for a job that is already Paid on first render (no sweep on page load)', () => {
    const { container } = renderTile(makeJob(PAID_OVERRIDES));
    expect(container.querySelector('.jt--paid-sheen')).toBeNull();
    expect(container.querySelector('.jt--paid')).not.toBeNull();
  });

  it('fires the sheen on a genuine non-Paid → Paid transition', () => {
    const job = makeJob();
    const { container, rerender } = renderTile(job);
    expect(container.querySelector('.jt--paid-sheen')).toBeNull();

    act(() => {
      rerender(
        <ul>
          <JobTile
            job={{ ...job, ...PAID_OVERRIDES }}
            onSelect={NOOP} onSendInvoice={NOOP} onUpdateJob={NOOP} onNewJob={NOOP}
            onOpenJob={NOOP} onCopyJob={NOOP} onArchiveJob={NOOP} onDeleteJob={NOOP}
            biz={{}} onShowToast={NOOP} onViewReceipt={NOOP} onActionRedirect={NOOP}
            onCallJob={NOOP} onRequestBook={NOOP}
          />
        </ul>
      );
    });

    expect(container.querySelector('.jt--paid-sheen')).not.toBeNull();
  });

  it('removes the sheen class automatically after the one-shot window (does not linger)', () => {
    const job = makeJob();
    const { container, rerender } = renderTile(job);

    act(() => {
      rerender(
        <ul>
          <JobTile
            job={{ ...job, ...PAID_OVERRIDES }}
            onSelect={NOOP} onSendInvoice={NOOP} onUpdateJob={NOOP} onNewJob={NOOP}
            onOpenJob={NOOP} onCopyJob={NOOP} onArchiveJob={NOOP} onDeleteJob={NOOP}
            biz={{}} onShowToast={NOOP} onViewReceipt={NOOP} onActionRedirect={NOOP}
            onCallJob={NOOP} onRequestBook={NOOP}
          />
        </ul>
      );
    });
    expect(container.querySelector('.jt--paid-sheen')).not.toBeNull();

    act(() => { vi.advanceTimersByTime(700); });

    expect(container.querySelector('.jt--paid-sheen')).toBeNull();
    // Still reads as Paid — only the transient sheen class is gone.
    expect(container.querySelector('.jt--paid')).not.toBeNull();
  });

  it('does NOT re-fire on a later re-render that keeps the job Paid (no repeat on refetch/reorder)', () => {
    const job = makeJob();
    const { container, rerender } = renderTile(job);
    const paidJob = { ...job, ...PAID_OVERRIDES };

    act(() => {
      rerender(
        <ul>
          <JobTile
            job={paidJob}
            onSelect={NOOP} onSendInvoice={NOOP} onUpdateJob={NOOP} onNewJob={NOOP}
            onOpenJob={NOOP} onCopyJob={NOOP} onArchiveJob={NOOP} onDeleteJob={NOOP}
            biz={{}} onShowToast={NOOP} onViewReceipt={NOOP} onActionRedirect={NOOP}
            onCallJob={NOOP} onRequestBook={NOOP}
          />
        </ul>
      );
    });
    act(() => { vi.advanceTimersByTime(700); });
    expect(container.querySelector('.jt--paid-sheen')).toBeNull();

    // Unrelated field changes (e.g. notes edited from the drawer) — a plain
    // refetch/re-render with the job still Paid must stay silent.
    act(() => {
      rerender(
        <ul>
          <JobTile
            job={{ ...paidJob, jobNotes: [{ text: 'left a key under the mat' }] }}
            onSelect={NOOP} onSendInvoice={NOOP} onUpdateJob={NOOP} onNewJob={NOOP}
            onOpenJob={NOOP} onCopyJob={NOOP} onArchiveJob={NOOP} onDeleteJob={NOOP}
            biz={{}} onShowToast={NOOP} onViewReceipt={NOOP} onActionRedirect={NOOP}
            onCallJob={NOOP} onRequestBook={NOOP}
          />
        </ul>
      );
    });

    expect(container.querySelector('.jt--paid-sheen')).toBeNull();
  });

  it('fires again on a second genuine transition (Paid → un-paid → Paid)', () => {
    const job = makeJob();
    const { container, rerender } = renderTile(job);
    const paidJob = { ...job, ...PAID_OVERRIDES };

    const rerenderWith = (j) => act(() => {
      rerender(
        <ul>
          <JobTile
            job={j}
            onSelect={NOOP} onSendInvoice={NOOP} onUpdateJob={NOOP} onNewJob={NOOP}
            onOpenJob={NOOP} onCopyJob={NOOP} onArchiveJob={NOOP} onDeleteJob={NOOP}
            biz={{}} onShowToast={NOOP} onViewReceipt={NOOP} onActionRedirect={NOOP}
            onCallJob={NOOP} onRequestBook={NOOP}
          />
        </ul>
      );
    });

    rerenderWith(paidJob);
    expect(container.querySelector('.jt--paid-sheen')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(700); });
    expect(container.querySelector('.jt--paid-sheen')).toBeNull();

    // Un-mark paid (e.g. accidental mark-paid undone), then mark paid again.
    rerenderWith({ ...job, status: 'active', paid: false, paymentStatus: 'unpaid' });
    expect(container.querySelector('.jt--paid-sheen')).toBeNull();

    rerenderWith(paidJob);
    expect(container.querySelector('.jt--paid-sheen')).not.toBeNull();
  });
});
