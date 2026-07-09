// @vitest-environment jsdom
/**
 * ReviewSheet — "Invoice sent" moment (feat/premium-feel-moments).
 *
 * A successful invoice send used to go straight from "Sending…" to a plain
 * 'Invoice sent' toast + immediate onClose. It now shows a small branded
 * InvoiceSentMoment overlay ("On its way to {FirstName}! ✈️") before closing
 * — see ReviewSheet.jsx's handleInvoiceWhatsApp + InvoiceSentMoment.jsx.
 *
 * Covered:
 *   - A successful invoice send shows the moment with the customer's first name
 *   - onClose is NOT called immediately on send success (it waits for the moment)
 *   - onClose IS called once the moment's dwell timer finishes
 *   - Falls back to a generic label when the job has no customer name
 *   - Quote-mode sends are unaffected (no InvoiceSentMoment rendered)
 *
 * Uses the same mock convention as reviewSheetInlineEdits.test.jsx /
 * reviewSheetEditButton.test.jsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
    from: vi.fn(() => ({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) })),
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

// Invoice send takes the "no Web Share Level 2" fallback branch (wa.me + PDF
// download) so the test doesn't depend on navigator.share being implemented.
vi.mock('../../lib/webShare', () => ({
  canShareFile: vi.fn().mockReturnValue(false),
}));

const sendQuoteMock = vi.fn().mockResolvedValue({ ok: true });
vi.mock('../../lib/sendQuote', () => ({
  sendQuote: (...args) => sendQuoteMock(...args),
  needsBankGate: vi.fn().mockReturnValue(false),
}));

import ReviewSheet from '../ReviewSheet';

function makeJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Sarah Jones',
    amount: 500,
    total: 500,
    summary: 'Kitchen taps',
    status: 'complete',
    quoteStatus: 'accepted',
    lineItems: [{ desc: 'Labour', cost: 500 }],
    payments: [],
    ...overrides,
  };
}

const BIZ = { name: 'Test Plumbing Ltd', email: 'test@example.com' };
const PROFILE_FREE = { plan: 'free' };
const NOOP = () => {};

beforeEach(() => {
  vi.spyOn(window, 'open').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ReviewSheet — Invoice sent moment', () => {
  it('shows "On its way to {FirstName}!" after a successful invoice send', async () => {
    render(
      <ReviewSheet
        mode="invoice"
        job={makeJob()}
        biz={BIZ}
        profile={PROFILE_FREE}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={NOOP}
        flash={NOOP}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /send invoice via whatsapp/i }));

    expect(await screen.findByText(/on its way to sarah!/i)).toBeInTheDocument();
  });

  it('does NOT call onClose immediately on send success — it waits for the moment to finish', async () => {
    const onClose = vi.fn();
    render(
      <ReviewSheet
        mode="invoice"
        job={makeJob()}
        biz={BIZ}
        profile={PROFILE_FREE}
        jobs={[makeJob()]}
        onClose={onClose}
        onDismiss={NOOP}
        onUpdate={NOOP}
        flash={NOOP}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /send invoice via whatsapp/i }));
    await screen.findByText(/on its way to sarah!/i);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose once the moment\'s dwell timer finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    render(
      <ReviewSheet
        mode="invoice"
        job={makeJob()}
        biz={BIZ}
        profile={PROFILE_FREE}
        jobs={[makeJob()]}
        onClose={onClose}
        onDismiss={NOOP}
        onUpdate={NOOP}
        flash={NOOP}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /send invoice via whatsapp/i }));
    await vi.waitFor(() => expect(screen.getByLabelText('Invoice sent')).toBeInTheDocument());

    await act(async () => { vi.advanceTimersByTime(900); });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('falls back to a generic label when the job has no customer name', async () => {
    render(
      <ReviewSheet
        mode="invoice"
        job={makeJob({ customer: '', customerName: '' })}
        biz={BIZ}
        profile={PROFILE_FREE}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={NOOP}
        flash={NOOP}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /send invoice via whatsapp/i }));

    expect(await screen.findByText(/on its way to your customer/i)).toBeInTheDocument();
  });

  it('does NOT render the moment for a quote-mode send', async () => {
    render(
      <ReviewSheet
        mode="quote"
        job={makeJob()}
        biz={BIZ}
        profile={PROFILE_FREE}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={NOOP}
        flash={NOOP}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /send via whatsapp/i }));
    await vi.waitFor(() => expect(sendQuoteMock).toHaveBeenCalled());

    expect(screen.queryByLabelText('Invoice sent')).not.toBeInTheDocument();
  });
});
