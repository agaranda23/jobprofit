// @vitest-environment jsdom
/**
 * ReviewSheet + DocumentPreview — integration tests (Preview & Edit slice 1).
 *
 * These mount the REAL ReviewSheet (not a standalone DocumentPreview) because
 * two founder-brief requirements only make sense at that level:
 *
 *   (c) A brand edit (logo/name) persists to the PROFILE — via ReviewSheet's
 *       onProfileUpdate prop when wired, or a direct Supabase write fallback
 *       when it isn't (mirrors BankGateSheet.jsx). Either way the STILL-OPEN
 *       sheet's header refreshes immediately via the localProfile bridge
 *       (QAE review point 4 — no close/reopen required).
 *   (e) The "Send via WhatsApp" CTA still fires the same sendQuote() path,
 *       unchanged, after DocumentPreview replaced PreviewTable and localProfile
 *       started feeding the invoice/quote PDF handlers (was the raw `profile`
 *       prop before this slice).
 *
 * Uses the same mock convention as reviewSheetEditButton.test.jsx.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const supabaseUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
    from: vi.fn(() => ({ update: (...args) => supabaseUpdate(...args) })),
  },
}));

vi.mock('../../lib/store', () => ({
  persistPublicToken: vi.fn().mockResolvedValue({ ok: true }),
  getReceiptSignedUrl: vi.fn().mockResolvedValue('https://example.com/r.jpg'),
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
    TRIAL_END:         'trial_end',
    DROP_TO_FREE:      'drop_to_free',
  },
}));

vi.mock('../../lib/billing', () => ({
  startCheckout: vi.fn().mockResolvedValue({ error: null }),
  startCheckoutWithCoupon: vi.fn().mockResolvedValue({ error: null }),
  openBillingPortal: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock('../../lib/invoicePDF', () => ({
  downloadInvoicePDF: vi.fn().mockResolvedValue(null),
  getInvoicePDFBlob: vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' })),
  downloadQuotePDF: vi.fn().mockResolvedValue(null),
  getQuotePDFBlob: vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' })),
}));

vi.mock('../../lib/publicQuoteToken', () => ({
  generatePublicAccessToken: vi.fn().mockReturnValue('tok_test123'),
  buildPublicQuoteUrl: vi.fn().mockReturnValue('https://ohnar.co.uk/q/tok_test123'),
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,abc') },
}));

const sendQuoteMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../../lib/sendQuote', () => ({
  sendQuote: (...args) => sendQuoteMock(...args),
  needsBankGate: vi.fn().mockReturnValue(false),
}));

import ReviewSheet from '../ReviewSheet';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Sarah Jones',
    amount: 500,
    total: 500,
    summary: 'Kitchen taps',
    status: 'lead',
    quoteStatus: 'draft',
    lineItems: [{ desc: 'Labour', cost: 500 }],
    payments: [],
    ...overrides,
  };
}

const BIZ = { name: 'Test Plumbing Ltd', email: 'test@example.com' };
const NOOP = () => {};

afterEach(() => vi.clearAllMocks());

// ── Portal regression guard ────────────────────────────────────────────────────
// ReviewSheet is the next step of the reported Send-invoice journey; it must
// render via createPortal into document.body so it escapes the swipe-pager
// ancestor (.dp-viewport, position:fixed z-index:0) that otherwise traps its
// z-index:500 backdrop below the root .bottom-nav (fix 2026-07-13). A future
// un-portal would resurface the "sheet hidden behind the nav / fall-through" bug.
describe('ReviewSheet — portal', () => {
  it('portals its backdrop directly into document.body', () => {
    render(
      <ReviewSheet
        mode="quote"
        job={makeJob()}
        biz={{}}
        profile={{ plan: 'free', business_name: '', phone: '', email: '' }}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={NOOP}
        onProfileUpdate={vi.fn()}
        flash={vi.fn()}
      />
    );
    const backdrop = document.querySelector('.modal-backdrop--top');
    expect(backdrop).not.toBeNull();
    expect(backdrop.parentElement).toBe(document.body);
  });
});

// ── (c) Brand edit persists to the profile ────────────────────────────────────

describe('ReviewSheet — brand edit persists via onProfileUpdate (central pipeline)', () => {
  it('saving the business-name/contact edit calls onProfileUpdate and refreshes the STILL-OPEN header', async () => {
    const onProfileUpdate = vi.fn().mockResolvedValue(undefined);
    const flash = vi.fn();
    render(
      <ReviewSheet
        mode="quote"
        job={makeJob()}
        biz={{}}
        profile={{ plan: 'free', business_name: '', phone: '', email: '' }}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={NOOP}
        onProfileUpdate={onProfileUpdate}
        flash={flash}
      />
    );

    // Empty business name → placeholder tap target
    expect(screen.getByText(/add your business name/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /edit business details/i }));

    const nameInput = screen.getByLabelText('Business name');
    fireEvent.change(nameInput, { target: { value: 'Sarah\'s Plumbing' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await vi.waitFor(() => {
      expect(onProfileUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ business_name: "Sarah's Plumbing" })
      );
    });

    // Direct-write fallback must NOT fire when onProfileUpdate is wired.
    expect(supabaseUpdate).not.toHaveBeenCalled();

    // In-sheet refresh (QAE point 4): the STILL-OPEN sheet's header shows the
    // new name immediately — no close/reopen required.
    await vi.waitFor(() => {
      expect(screen.getByText("Sarah's Plumbing")).toBeInTheDocument();
    });

    expect(flash).toHaveBeenCalledWith(expect.stringMatching(/saved.*every document/i));
  });
});

describe('ReviewSheet — brand edit falls back to a direct Supabase write when onProfileUpdate is not wired', () => {
  it('saving without onProfileUpdate writes directly to profiles and still refreshes the header', async () => {
    const flash = vi.fn();
    render(
      <ReviewSheet
        mode="invoice"
        job={makeJob({ status: 'complete' })}
        biz={{}}
        profile={{ plan: 'free', business_name: '', phone: '', email: '' }}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={NOOP}
        flash={flash}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit business details/i }));
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Direct Write Ltd' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await vi.waitFor(() => {
      expect(supabaseUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ business_name: 'Direct Write Ltd' })
      );
    });

    await vi.waitFor(() => {
      expect(screen.getByText('Direct Write Ltd')).toBeInTheDocument();
    });
  });
});

// ── (e) Send via WhatsApp still fires the same sendQuote path, unchanged ─────

describe('ReviewSheet — "Send via WhatsApp" still fires sendQuote() unchanged', () => {
  it('calls sendQuote with job + the expected option bag on tap', async () => {
    const onUpdate = vi.fn();
    const flash = vi.fn();
    const job = makeJob();
    render(
      <ReviewSheet
        mode="quote"
        job={job}
        biz={BIZ}
        profile={{ plan: 'free' }}
        jobs={[job]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={onUpdate}
        flash={flash}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /send via whatsapp/i }));

    await vi.waitFor(() => {
      expect(sendQuoteMock).toHaveBeenCalledTimes(1);
    });
    const [calledJob, opts] = sendQuoteMock.mock.calls[0];
    expect(calledJob).toBe(job);
    expect(opts).toEqual(
      expect.objectContaining({
        biz: BIZ,
        depositPercent: 0,
        onUpdate,
        flash,
      })
    );
    expect(typeof opts.onClose).toBe('function');
    expect(typeof opts.setBusy).toBe('function');
  });
});
