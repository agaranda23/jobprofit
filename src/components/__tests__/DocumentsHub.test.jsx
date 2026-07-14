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
 *  7. View-first preview (2026-07): "View … PDF" opens DocumentPreview instantly
 *     (no PDF call until Save/Share); Back returns to the timeline; Save persists
 *     a public token and generates a REAL PDF (non-empty quoteUrl — "blocker B");
 *     Copy link copies the hosted URL and flashes.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
  // reissuePublicToken is called unconditionally on every DocumentsHub render
  // (needed for Save/Share/Copy-link) — mirrors ReceiptModal/SendInvoiceModal's
  // real reissuePublicToken: hands back the job's existing token unchanged, or
  // mints a stable test token when the job has none yet.
  reissuePublicToken: vi.fn((job) => ({
    token: job?.publicAccessToken || 'mock-token-123',
    wasRevoked: false,
  })),
}));

vi.mock('../../lib/invoicePDF', () => ({
  downloadInvoicePDF: vi.fn().mockResolvedValue(null),
  downloadQuotePDF: vi.fn().mockResolvedValue(null),
  getInvoicePDFBlob: vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' })),
  getQuotePDFBlob: vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' })),
}));

vi.mock('../../lib/publicQuoteToken', () => ({
  buildPublicQuoteUrl: vi.fn((token) => `https://ohnar.co.uk/q/${token}`),
}));
vi.mock('../../lib/publicInvoiceToken', () => ({
  buildPublicInvoiceUrl: vi.fn((token) => `https://ohnar.co.uk/i/${token}`),
}));
vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,abc') },
}));
// canShareFile defaults false so Save/Share tests exercise the plain-download
// fallback path deterministically (no navigator.share mock needed).
vi.mock('../../lib/webShare', () => ({ canShareFile: vi.fn(() => false) }));

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
    TRIAL_END:         'trial_end',
    DROP_TO_FREE:      'drop_to_free',
  },
}));
vi.mock('../../lib/billing', () => ({
  getStripeUrl: vi.fn().mockResolvedValue(''),
  startCheckout: vi.fn().mockResolvedValue({ error: null }),
  startCheckoutWithCoupon: vi.fn().mockResolvedValue({ error: null }),
  startCheckoutImmediate: vi.fn().mockResolvedValue({ error: null }),
  openBillingPortal: vi.fn().mockResolvedValue({ error: null }),
}));
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
import { downloadInvoicePDF, downloadQuotePDF } from '../../lib/invoicePDF';

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

  // Regression guard: the sheet must render via createPortal into document.body so
  // it escapes the swipe-pager ancestor (.dp-viewport, position:fixed z-index:0)
  // that otherwise traps its z-index:500 backdrop below the root .bottom-nav
  // (fix 2026-07-13). A future un-portal would resurface the "Send invoice hidden
  // behind the nav / click-through" bug with an otherwise-green suite.
  it('portals its backdrop directly into document.body', () => {
    renderHub();
    const backdrop = document.querySelector('.modal-backdrop--top');
    expect(backdrop).not.toBeNull();
    expect(backdrop.parentElement).toBe(document.body);
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
    expect(screen.getAllByText(/sent/i).length).toBeGreaterThan(0);
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
    expect(screen.getAllByText(/overdue/i).length).toBeGreaterThan(0);
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

  // `await import` must live inside an async function — moved here from describe scope.
  let buildQuoteRecordMeta;
  let buildInvoiceRecordMeta;
  beforeAll(async () => {
    ({ buildQuoteRecordMeta, buildInvoiceRecordMeta } = await import('../../lib/documentRecord.js'));
  });

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

// ── 7. View-first document preview ──────────────────────────────────────────

describe('DocumentsHub — view-first preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom has no real Clipboard API — stub it so handleCopyLink's success
    // path is deterministic (jsdom doesn't crash on the call either way,
    // since it's wrapped in try/catch, but we want to assert the SUCCESS toast).
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  const PRICED_QUOTE_JOB = {
    ...BASE_JOB,
    quoteStatus: 'sent',
    quoteSentAt: PAST,
    total: 250,
    amount: 250,
  };

  it('tapping "View quote PDF" opens the preview instantly — no PDF generated before the tap', () => {
    renderHub(PRICED_QUOTE_JOB);
    expect(downloadQuotePDF).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /view quote pdf/i }));

    // The read-only DocumentPreview facsimile is now showing.
    expect(document.querySelector('.dp-paper')).not.toBeNull();
    // Still no PDF call — preview render must not trigger PDF generation.
    expect(downloadQuotePDF).not.toHaveBeenCalled();
  });

  it('Back returns to the timeline and hides the preview', () => {
    renderHub(PRICED_QUOTE_JOB);
    fireEvent.click(screen.getByRole('button', { name: /view quote pdf/i }));
    expect(document.querySelector('.dp-paper')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /back to documents/i }));

    expect(document.querySelector('.dp-paper')).toBeNull();
    expect(screen.getByRole('button', { name: /view quote pdf/i })).toBeTruthy();
  });

  it('Save PDF persists a public token (job had none) and generates a REAL PDF (non-empty quoteUrl)', async () => {
    const onUpdateJob = vi.fn();
    const jobNoToken = { ...PRICED_QUOTE_JOB, publicAccessToken: null };
    renderHub(jobNoToken, { onUpdateJob });

    fireEvent.click(screen.getByRole('button', { name: /view quote pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: /save pdf/i }));

    await waitFor(() => expect(downloadQuotePDF).toHaveBeenCalledTimes(1));

    // Token persisted via onUpdateJob BEFORE the PDF call (blocker A).
    expect(onUpdateJob).toHaveBeenCalledWith(
      expect.objectContaining({ publicAccessToken: 'mock-token-123' })
    );

    // Blocker B: quoteUrl/qrDataUrl must be REAL, not the old '' / '' link-less call.
    const callArgs = downloadQuotePDF.mock.calls[0][0];
    expect(callArgs.quoteUrl).toBe('https://ohnar.co.uk/q/mock-token-123');
    expect(callArgs.qrDataUrl).toBe('data:image/png;base64,abc');
  });

  it('Save PDF does NOT persist a token when one already exists on the job', async () => {
    const onUpdateJob = vi.fn();
    const jobWithToken = { ...PRICED_QUOTE_JOB, publicAccessToken: 'existing-token' };
    renderHub(jobWithToken, { onUpdateJob });

    fireEvent.click(screen.getByRole('button', { name: /view quote pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: /save pdf/i }));

    await waitFor(() => expect(downloadQuotePDF).toHaveBeenCalledTimes(1));
    expect(onUpdateJob).not.toHaveBeenCalled();
    expect(downloadQuotePDF.mock.calls[0][0].quoteUrl).toBe('https://ohnar.co.uk/q/existing-token');
  });

  it('Save PDF on the Invoices tab calls downloadInvoicePDF with the job\'s invoice number/due date', async () => {
    const invoiceJob = {
      ...BASE_JOB,
      invoiceSentAt: PAST,
      invoiceNumber: 'INV-42',
      invoiceDueDate: '2026-02-01',
      total: 500,
      amount: 500,
    };
    renderHub(invoiceJob, { onUpdateJob: vi.fn() });

    fireEvent.click(screen.getByRole('tab', { name: /invoices/i }));
    fireEvent.click(screen.getByRole('button', { name: /view invoice pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: /save pdf/i }));

    await waitFor(() => expect(downloadInvoicePDF).toHaveBeenCalledTimes(1));
    const callArgs = downloadInvoicePDF.mock.calls[0][0];
    expect(callArgs.invoiceNumber).toBe('INV-42');
    expect(callArgs.dueDate).toBe('2026-02-01');
  });

  it('Copy link copies the hosted URL and flashes "Link copied"', async () => {
    const flash = vi.fn();
    const jobWithToken = { ...PRICED_QUOTE_JOB, publicAccessToken: 'existing-token' };
    renderHub(jobWithToken, { flash, onUpdateJob: vi.fn() });

    fireEvent.click(screen.getByRole('button', { name: /view quote pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://ohnar.co.uk/q/existing-token'
    ));
    await waitFor(() => expect(flash).toHaveBeenCalledWith('Link copied'));
  });

  it('renders the preview without crashing when onUpdateJob/flash are omitted (optional props)', () => {
    expect(() => {
      renderHub(PRICED_QUOTE_JOB);
      fireEvent.click(screen.getByRole('button', { name: /view quote pdf/i }));
    }).not.toThrow();
  });
});
