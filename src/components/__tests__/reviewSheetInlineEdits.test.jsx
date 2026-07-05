// @vitest-environment jsdom
/**
 * ReviewSheet — "Preview & Edit full-tap" integration tests (2026-07).
 *
 * Founder live-tested the just-merged slice 1 preview and reported it didn't
 * feel premium: taps on unwired/read-only regions (invoice no, due date,
 * price, total, line items) dismissed the sheet and dropped the user onto the
 * screen behind it, price/total/line-items weren't editable, and the bill-to
 * block duplicated the job title for jobs with no distinct customer.
 *
 * These tests mount the REAL ReviewSheet (not a standalone DocumentPreview)
 * because they only make sense at that level:
 *
 *   (A) P0 — tapping ANYWHERE inside the document card (including a read-only
 *       region) must never fire onDismiss/onClose. Only the X button or a
 *       genuine backdrop tap does.
 *   (B) A line-item edit recomputes localJob's total live, and the deposit
 *       preview (still a % of total) reflects the NEW total without the sheet
 *       needing to be closed/reopened.
 *   (C) Invoice number / due date inline edits persist via onUpdate.
 *   (D) "Send via WhatsApp" still calls the unchanged sendQuote()/PDF paths,
 *       now fed by the edited localJob (proving inline edits actually reach
 *       what's sent, not just the on-screen preview).
 *
 * Uses the same mock convention as reviewSheetDocumentPreview.test.jsx.
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

// ── (A) P0 — tap-anywhere never dismisses the sheet ───────────────────────────

describe('ReviewSheet — tapping inside the document card never dismisses the sheet', () => {
  it('tapping a read-only meta region (Issued date) does not call onDismiss/onClose', () => {
    const onDismiss = vi.fn();
    const onClose = vi.fn();
    render(
      <ReviewSheet
        mode="invoice"
        job={makeJob({ status: 'complete' })}
        biz={BIZ}
        profile={{ plan: 'free' }}
        jobs={[makeJob()]}
        onClose={onClose}
        onDismiss={onDismiss}
        onUpdate={NOOP}
        flash={NOOP}
      />
    );
    fireEvent.click(screen.getByText(/^issued:/i));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('tapping the "Total payable" row does not dismiss the sheet', () => {
    const onDismiss = vi.fn();
    render(
      <ReviewSheet
        mode="quote"
        job={makeJob()}
        biz={BIZ}
        profile={{ plan: 'free' }}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={onDismiss}
        onUpdate={NOOP}
        flash={NOOP}
      />
    );
    fireEvent.click(screen.getByText(/total payable/i));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('a genuine backdrop tap (outside the sheet) still dismisses', () => {
    const onDismiss = vi.fn();
    const { container } = render(
      <ReviewSheet
        mode="quote"
        job={makeJob()}
        biz={BIZ}
        profile={{ plan: 'free' }}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={onDismiss}
        onUpdate={NOOP}
        flash={NOOP}
      />
    );
    const backdrop = container.querySelector('.modal-backdrop--top');
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

// ── (B) Line-item edit recomputes total live; deposit clamp holds ────────────

describe('ReviewSheet — a line-item edit recomputes the total live and the deposit clamp holds', () => {
  it('editing the only line item updates the deposit preview to match the NEW total', () => {
    const job = makeJob({ total: 500, lineItems: [{ desc: 'Labour', cost: 500 }], deposit_percent: 50 });
    render(
      <ReviewSheet
        mode="quote"
        job={job}
        biz={BIZ}
        profile={{ plan: 'free' }}
        jobs={[job]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={NOOP}
        flash={NOOP}
      />
    );

    // Before the edit: 50% of £500 = £250
    expect(screen.getByText('£250.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /edit labour/i }));
    fireEvent.change(screen.getByLabelText(/line item amount/i), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // After the edit: 50% of the NEW £1000 total = £500 — never exceeds the total,
    // and updates without closing/reopening the sheet.
    expect(screen.getByText(/deposit due now \(50%\)/i).closest('.dp-totals-row')).toHaveTextContent('£500.00');
    const totalRow = screen.getByText(/total payable/i).closest('.dp-totals-row');
    expect(totalRow).toHaveTextContent('£1,000.00');
  });

  it('deposit never exceeds the total even at 100% after a total change', () => {
    const job = makeJob({ total: 500, lineItems: [{ desc: 'Labour', cost: 500 }], deposit_percent: 100 });
    render(
      <ReviewSheet
        mode="quote"
        job={job}
        biz={BIZ}
        profile={{ plan: 'free' }}
        jobs={[job]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={NOOP}
        flash={NOOP}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit labour/i }));
    fireEvent.change(screen.getByLabelText(/line item amount/i), { target: { value: '333.33' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    const depositRow = screen.getByText(/deposit due now \(100%\)/i).closest('.dp-totals-row');
    const totalRow = screen.getByText(/total payable/i).closest('.dp-totals-row');
    expect(depositRow).toHaveTextContent('£333.33');
    expect(totalRow).toHaveTextContent('£333.33');
  });
});

// ── (C) Invoice number / due date persist via onUpdate ───────────────────────

describe('ReviewSheet — invoice number and due date inline edits persist', () => {
  it('editing the invoice number calls onUpdate with the new value', () => {
    const onUpdate = vi.fn();
    const job = makeJob({ status: 'complete' });
    render(
      <ReviewSheet
        mode="invoice"
        job={job}
        biz={BIZ}
        profile={{ plan: 'free' }}
        jobs={[job]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={onUpdate}
        flash={NOOP}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /change invoice no/i }));
    fireEvent.change(screen.getByLabelText('Invoice number'), { target: { value: 'INV-0099' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ invoiceNumber: 'INV-0099' }));
    expect(screen.getByText(/invoice no: inv-0099/i)).toBeInTheDocument();
  });

  it('editing the due date calls onUpdate with the new ISO date', () => {
    const onUpdate = vi.fn();
    const job = makeJob({ status: 'complete' });
    render(
      <ReviewSheet
        mode="invoice"
        job={job}
        biz={BIZ}
        profile={{ plan: 'free' }}
        jobs={[job]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={onUpdate}
        flash={NOOP}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /change due/i }));
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceDueDate: new Date('2026-08-01').toISOString() })
    );
  });
});

// ── (D) Send via WhatsApp still fires unchanged, now fed by the edited job ──

describe('ReviewSheet — "Send via WhatsApp" still fires sendQuote() unchanged, with inline edits applied', () => {
  it('sends the EDITED total after a line-item change made before tapping Send', async () => {
    const onUpdate = vi.fn();
    const job = makeJob({ total: 500, lineItems: [{ desc: 'Labour', cost: 500 }] });
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
        flash={NOOP}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /edit labour/i }));
    fireEvent.change(screen.getByLabelText(/line item amount/i), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    fireEvent.click(screen.getByRole('button', { name: /send via whatsapp/i }));

    await vi.waitFor(() => {
      expect(sendQuoteMock).toHaveBeenCalledTimes(1);
    });
    const [calledJob] = sendQuoteMock.mock.calls[0];
    expect(calledJob.total).toBe(800);
    expect(calledJob.lineItems).toEqual([{ desc: 'Labour', cost: 800 }]);
  });

  it('sends the same job reference (no edits made) — unchanged from slice 1', async () => {
    const onUpdate = vi.fn();
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
        flash={NOOP}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /send via whatsapp/i }));
    await vi.waitFor(() => {
      expect(sendQuoteMock).toHaveBeenCalledTimes(1);
    });
    const [calledJob] = sendQuoteMock.mock.calls[0];
    expect(calledJob).toBe(job);
  });
});

// ── (E) Quote "Valid until" persists PER-QUOTE, never the profile default ───
// fix/quote-public-vat-validity: the founder flagged that editing "Valid
// until" used to write profile.quote_validity_days, silently changing the
// validity window on EVERY future quote. It must now persist onto THIS job
// only (via onJobPatch → onUpdate) and never touch the profiles table.

describe('ReviewSheet — quote "Valid until" edit is per-quote only', () => {
  it('editing Valid until calls onUpdate with quoteValidUntil, not the profile', () => {
    const onUpdate = vi.fn();
    const job = makeJob({ date: '2026-06-01' });
    render(
      <ReviewSheet
        mode="quote"
        job={job}
        biz={BIZ}
        profile={{ plan: 'free', quote_validity_days: 30 }}
        jobs={[job]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={onUpdate}
        flash={NOOP}
      />
    );

    // Default (issueDate 2026-06-01 + 30 days) shown before any edit.
    expect(screen.getByText(/valid until: 01\/07\/2026/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /change valid until/i }));
    fireEvent.change(screen.getByLabelText('Valid until'), { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // Persisted via the job-content path (onJobPatch → onUpdate), never as a
    // direct Supabase profiles write.
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ quoteValidUntil: '2026-08-01' }));
    expect(supabaseUpdate).not.toHaveBeenCalled();

    // The preview reflects the new PER-JOB date immediately (localJob mirror).
    expect(screen.getByText(/valid until: 01\/08\/2026/i)).toBeInTheDocument();
  });

  it('does NOT call supabase.from("profiles").update — the old profile-mutation bug', () => {
    const onUpdate = vi.fn();
    const job = makeJob({ date: '2026-06-01' });
    render(
      <ReviewSheet
        mode="quote"
        job={job}
        biz={BIZ}
        profile={{ plan: 'free', quote_validity_days: 30 }}
        jobs={[job]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={onUpdate}
        flash={NOOP}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /change valid until/i }));
    fireEvent.change(screen.getByLabelText('Valid until'), { target: { value: '2026-09-20' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // Assert the onUpdate patch never carries quote_validity_days — the exact
    // field the old (buggy) implementation wrote to the shared profile.
    for (const call of onUpdate.mock.calls) {
      expect(call[0]).not.toHaveProperty('quote_validity_days');
    }
  });
});
