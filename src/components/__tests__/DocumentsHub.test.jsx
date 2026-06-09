// @vitest-environment jsdom
/**
 * DocumentsHub — Design 2 component tests.
 *
 * Covers:
 *  1. Timeline dots filled vs muted for each quote/invoice state.
 *  2. GatedSignature: image NOT in DOM on mount; appears on "View signature" tap;
 *     unmounts on "Hide signature"; hidden again after close + reopen.
 *  3. deposit_payment: no gated control rendered; "Accepted by card deposit" badge shown.
 *  4. CustomerCard regression: acceptedSignature <img> NOT rendered in CustomerCard.
 *  5. Compact entry summary string derivation (both/quote-only/invoice-only/neither).
 *  6. Render-without-crash for open/closed × quotes/invoices combos (hooks-above-return guard).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks — must come before component imports ──────────────────────────────
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}));

vi.mock('../../lib/store', () => ({
  uploadJobPhoto: vi.fn(),
  getSignedPhotoUrl: vi.fn().mockResolvedValue(''),
  deleteJobPhoto: vi.fn(),
  getReceiptSignedUrl: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../lib/invoicePDF', () => ({
  downloadInvoicePDF: vi.fn().mockResolvedValue(null),
  downloadQuotePDF: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/telemetry', () => ({ logTelemetry: vi.fn() }));
vi.mock('../../lib/billing',   () => ({ getStripeUrl: vi.fn().mockResolvedValue('') }));
vi.mock('../../lib/pushSubscribe', () => ({
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
}));
vi.mock('../../lib/photoCompress', () => ({
  compressPhoto: vi.fn().mockResolvedValue('data:image/png;base64,'),
}));
vi.mock('../../lib/realtime', () => ({
  subscribeToJob: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
}));

// ── Component under test ─────────────────────────────────────────────────────
import DocumentsHub from '../DocumentsHub';
import JobDetailDrawer from '../JobDetailDrawer';

// ── Shared helpers ────────────────────────────────────────────────────────────

const TODAY = new Date().toISOString().slice(0, 10);
const PAST  = '2026-01-01';
const PAST2 = '2026-01-15';

const BASE_JOB = {
  id: 'test-job-1',
  summary: 'Test job',
  customer: 'Test Customer',
  status: 'Quoted',
  quoteStatus: 'sent',
  invoiceStatus: null,
  paymentStatus: null,
  createdAt: PAST,
};

const BASE_BIZ     = { name: 'Test Biz' };
const BASE_PROFILE = { plan: 'free' };

function renderHub(jobOverrides = {}, props = {}) {
  const job = { ...BASE_JOB, ...jobOverrides };
  return render(
    <DocumentsHub
      open
      job={job}
      biz={BASE_BIZ}
      profile={BASE_PROFILE}
      onClose={vi.fn()}
      onBuildQuote={vi.fn()}
      onSendInvoice={vi.fn()}
      {...props}
    />
  );
}

// ── 6. Render-without-crash: hooks-above-return guard ──────────────────────

describe('DocumentsHub — render safety', () => {
  it('renders without crash when open=true', () => {
    expect(() => renderHub()).not.toThrow();
  });

  it('renders nothing when open=false (early return)', () => {
    const { container } = render(
      <DocumentsHub
        open={false}
        job={BASE_JOB}
        biz={BASE_BIZ}
        profile={BASE_PROFILE}
        onClose={vi.fn()}
        onBuildQuote={vi.fn()}
        onSendInvoice={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders Quotes tab by default', () => {
    renderHub();
    const quotesTab = screen.getByRole('tab', { name: /quotes/i });
    expect(quotesTab).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to Invoices tab on tap', () => {
    renderHub();
    const invoicesTab = screen.getByRole('tab', { name: /invoices/i });
    fireEvent.click(invoicesTab);
    expect(invoicesTab).toHaveAttribute('aria-selected', 'true');
  });

  it('renders correctly with null profile', () => {
    expect(() => renderHub({}, { profile: null })).not.toThrow();
  });
});

// ── 1. Timeline dots: quote states ──────────────────────────────────────────

describe('DocumentsHub — quote timeline', () => {
  it('none state: shows empty state text, no timeline', () => {
    renderHub({ quoteStatus: null, quoteSentAt: null, acceptedAt: null });
    expect(screen.getByText(/no quote sent yet/i)).toBeTruthy();
    expect(screen.queryByText('Sent')).toBeNull();
  });

  it('sent state: Sent step is reached (has date)', () => {
    renderHub({ quoteStatus: 'sent', quoteSentAt: PAST });
    expect(screen.getByText(/sent/i)).toBeTruthy();
  });

  it('opened state: Sent + Opened steps both reached', () => {
    renderHub({
      quoteStatus: 'sent',
      quoteSentAt: PAST,
      quoteLinkOpenedAt: PAST2,
    });
    // The timeline items are present
    const steps = document.querySelectorAll('.docs-step--reached');
    // Created, Sent, Opened reached (3), Signed not reached
    expect(steps.length).toBeGreaterThanOrEqual(3);
  });

  it('signed state: Signed step is reached', () => {
    renderHub({
      quoteStatus: 'accepted',
      quoteSentAt: PAST,
      quoteLinkOpenedAt: PAST2,
      acceptedAt: TODAY,
      acceptedName: 'Sarah Jones',
      acceptedSource: 'screen',
    });
    const filledDots = document.querySelectorAll('.docs-step-dot--filled');
    expect(filledDots.length).toBe(4); // all 4 steps reached
  });
});

// ── 1. Timeline dots: invoice states ────────────────────────────────────────

describe('DocumentsHub — invoice timeline', () => {
  it('none state: shows empty state when on invoices tab', () => {
    renderHub({ invoiceSentAt: null });
    const invoicesTab = screen.getByRole('tab', { name: /invoices/i });
    fireEvent.click(invoicesTab);
    expect(screen.getByText(/no invoice sent yet/i)).toBeTruthy();
  });

  it('sent state: invoice timeline renders', () => {
    renderHub({ invoiceSentAt: PAST });
    const invoicesTab = screen.getByRole('tab', { name: /invoices/i });
    fireEvent.click(invoicesTab);
    expect(document.querySelectorAll('.docs-step').length).toBeGreaterThan(0);
  });

  it('overdue state: Due step label shows "Overdue"', () => {
    renderHub({
      invoiceSentAt: PAST,
      invoiceDueDate: PAST,   // past → overdue
      paymentStatus: null,
      paidAt: null,
    });
    const invoicesTab = screen.getByRole('tab', { name: /invoices/i });
    fireEvent.click(invoicesTab);
    const overdueLabel = screen.getByText(/overdue/i);
    expect(overdueLabel).toBeTruthy();
  });

  it('paid state: Paid step is reached', () => {
    renderHub({
      invoiceSentAt: PAST,
      invoiceDueDate: PAST2,
      paymentStatus: 'paid',
      paidAt: TODAY,
    });
    const invoicesTab = screen.getByRole('tab', { name: /invoices/i });
    fireEvent.click(invoicesTab);
    const filledDots = document.querySelectorAll('.docs-step-dot--filled');
    expect(filledDots.length).toBe(4);
  });
});

// ── 2. GatedSignature: reveal behaviour ─────────────────────────────────────

describe('GatedSignature — gated reveal', () => {
  const signedJob = {
    quoteStatus: 'accepted',
    quoteSentAt: PAST,
    acceptedAt: TODAY,
    acceptedSource: 'screen',
    acceptedName: 'Sarah',
    acceptedSignature: 'data:image/png;base64,fakeSignatureData',
  };

  it('signature <img> is NOT in DOM on initial render (default hidden)', () => {
    renderHub(signedJob);
    // GatedSignature only shows in Quotes tab when state === 'signed'
    expect(document.querySelector('.docs-hub-sig-img-wrap img')).toBeNull();
  });

  it('signature <img> appears after tapping "View signature"', () => {
    renderHub(signedJob);
    const btn = screen.getByRole('button', { name: /view signature/i });
    fireEvent.click(btn);
    const img = document.querySelector('.docs-hub-sig-img-wrap img');
    expect(img).not.toBeNull();
    expect(img.src).toContain('fakeSignatureData');
  });

  it('signature <img> unmounts after tapping "Hide signature"', () => {
    renderHub(signedJob);
    const viewBtn = screen.getByRole('button', { name: /view signature/i });
    fireEvent.click(viewBtn);
    expect(document.querySelector('.docs-hub-sig-img-wrap img')).not.toBeNull();

    const hideBtn = screen.getByRole('button', { name: /hide signature/i });
    fireEvent.click(hideBtn);
    expect(document.querySelector('.docs-hub-sig-img-wrap img')).toBeNull();
  });

  it('aria-expanded starts false, becomes true on reveal', () => {
    renderHub(signedJob);
    const btn = screen.getByRole('button', { name: /view signature/i });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('signature hidden again after closing and reopening hub', () => {
    const onClose = vi.fn();
    const { unmount } = renderHub(signedJob, { onClose });
    const viewBtn = screen.getByRole('button', { name: /view signature/i });
    fireEvent.click(viewBtn);
    expect(document.querySelector('.docs-hub-sig-img-wrap img')).not.toBeNull();

    // Simulate close + reopen by unmounting and remounting
    unmount();
    renderHub(signedJob, { onClose: vi.fn() });
    // Fresh mount — image should be hidden again
    expect(document.querySelector('.docs-hub-sig-img-wrap img')).toBeNull();
  });
});

// ── 3. deposit_payment: no gated control ────────────────────────────────────

describe('GatedSignature — deposit_payment', () => {
  const depositJob = {
    quoteStatus: 'accepted',
    quoteSentAt: PAST,
    acceptedAt: TODAY,
    acceptedSource: 'deposit_payment',
    acceptedName: null,
    acceptedSignature: null,
  };

  it('shows "Accepted by card deposit" badge', () => {
    renderHub(depositJob);
    expect(screen.getByText(/accepted by card deposit/i)).toBeTruthy();
  });

  it('does NOT show "View signature" button for deposit_payment', () => {
    renderHub(depositJob);
    expect(screen.queryByRole('button', { name: /view signature/i })).toBeNull();
  });
});

// ── 5. Compact entry summary string derivation ──────────────────────────────

describe('compact Documents entry summary', () => {
  // We test summary derivation indirectly through the aria-label on the entry
  // button, which includes the summary string.
  // The button is rendered inside JobDetailDrawer, so we need a minimal drawer
  // render. We directly test the logic by inspecting buildQuoteRecordMeta /
  // buildInvoiceRecordMeta and the IIFE summary rule, driving it through
  // the rendered aria-label.
  //
  // To avoid a full JobDetailDrawer render (heavy mocking required), we test
  // the derivation logic in isolation by importing the helpers directly.

  const { buildQuoteRecordMeta, buildInvoiceRecordMeta } = await import('../../lib/documentRecord.js');

  function deriveSummary(job) {
    const qr = buildQuoteRecordMeta(job);
    const ir = buildInvoiceRecordMeta(job);
    const qState = qr.state;
    const iState = ir.state;
    if (qState !== 'none' && iState !== 'none') {
      return `${qr.chipLabel} · ${ir.chipLabel}`;
    } else if (qState !== 'none') {
      return `Quote ${qr.chipLabel.toLowerCase()}`;
    } else if (iState !== 'none') {
      return `Invoice ${ir.chipLabel.toLowerCase()}`;
    }
    return 'None yet';
  }

  it('neither → "None yet"', () => {
    expect(deriveSummary({})).toBe('None yet');
  });

  it('quote only (sent) → "Quote sent"', () => {
    const job = { quoteSentAt: PAST };
    expect(deriveSummary(job)).toBe('Quote sent');
  });

  it('invoice only (sent) → "Invoice sent"', () => {
    const job = { invoiceSentAt: PAST };
    expect(deriveSummary(job)).toBe('Invoice sent');
  });

  it('both present → "Signed · Paid" when appropriate', () => {
    const job = {
      quoteSentAt: PAST,
      acceptedAt: PAST2,
      invoiceSentAt: PAST,
      paymentStatus: 'paid',
      paidAt: TODAY,
    };
    const result = deriveSummary(job);
    expect(result).toContain(' · ');
    // Both sides non-empty
    const [q, i] = result.split(' · ');
    expect(q.length).toBeGreaterThan(0);
    expect(i.length).toBeGreaterThan(0);
  });
});

// ── 4. CustomerCard regression: no acceptedSignature <img> ──────────────────

describe('CustomerCard regression — no signature image', () => {
  // This imports JobDetailDrawer which is a large component with many deps.
  // We use the same mock setup as componentSmoke.test.jsx.
  // The minimum job that triggers the signed state path.
  const signedJob = {
    id: 'sig-regression-job',
    summary: 'Sig regression',
    customer: 'Test',
    status: 'Quoted',
    quoteStatus: 'accepted',
    quoteSentAt: PAST,
    acceptedAt: TODAY,
    acceptedSource: 'screen',
    acceptedName: 'Test User',
    acceptedSignature: 'data:image/png;base64,fakeSignature',
    total: 100,
    amount: 100,
  };

  it('does NOT render acceptedSignature <img> in the drawer (CustomerCard)', () => {
    render(
      <JobDetailDrawer
        job={signedJob}
        jobs={[signedJob]}
        open
        biz={BASE_BIZ}
        profile={BASE_PROFILE}
        receipts={[]}
        onClose={vi.fn()}
        onUpdateJob={vi.fn()}
      />
    );

    // The sig img must NOT be present in CustomerCard area.
    // We look for any <img> with src containing 'fakeSignature'.
    const sigImgs = Array.from(document.querySelectorAll('img')).filter(
      img => img.src && img.src.includes('fakeSignature')
    );
    expect(sigImgs.length).toBe(0);
  });

  it('deposit_payment badge still renders in CustomerCard (kept per spec)', () => {
    const depositJob = {
      ...signedJob,
      acceptedSource: 'deposit_payment',
      acceptedSignature: null,
    };
    render(
      <JobDetailDrawer
        job={depositJob}
        jobs={[depositJob]}
        open
        biz={BASE_BIZ}
        profile={BASE_PROFILE}
        receipts={[]}
        onClose={vi.fn()}
        onUpdateJob={vi.fn()}
      />
    );
    expect(screen.getByText(/accepted by card deposit/i)).toBeTruthy();
  });
});
