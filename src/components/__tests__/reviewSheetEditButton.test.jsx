// @vitest-environment jsdom
/**
 * reviewSheetEditButton — tests for the one-tap Edit affordance.
 *
 * Verifies:
 *   - "Edit quote" button renders in quote mode when onEdit is provided
 *   - "Edit invoice" button renders in invoice mode when onEdit is provided
 *   - Neither edit button renders when onEdit is omitted (prop is optional)
 *   - Tapping the Edit button calls onEdit and does NOT call onDismiss (no draft-save)
 *   - Save draft / Download PDF / Send buttons are still present (no regression)
 *
 * Uses jsdom + @testing-library/react — same convention as componentSmoke.test.jsx.
 * Network/browser-API modules are mocked identically.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Mock network / browser-API modules ───────────────────────────────────────

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
  },
}));

vi.mock('../../lib/store', () => ({
  persistPublicToken: vi.fn().mockResolvedValue({ ok: true }),
  getReceiptSignedUrl: vi.fn().mockResolvedValue('https://example.com/r.jpg'),
}));

vi.mock('../../lib/telemetry', () => ({
  logTelemetry: vi.fn(),
}));

vi.mock('../../lib/invoicePDF', () => ({
  downloadInvoicePDF: vi.fn().mockResolvedValue(null),
  getInvoicePDFBlob: vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' })),
  downloadQuotePDF: vi.fn().mockResolvedValue(null),
  getQuotePDFBlob: vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' })),
}));

vi.mock('../../lib/publicQuoteToken', () => ({
  generatePublicAccessToken: vi.fn().mockReturnValue('tok_test123'),
  buildPublicQuoteUrl: vi.fn().mockReturnValue('https://app.getjobprofit.com/q/tok_test123'),
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,abc') },
}));

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
    photos: [],
    jobNotes: [],
    payments: [],
    ...overrides,
  };
}

const BIZ = { name: 'Test Plumbing Ltd', email: 'test@example.com' };
const PROFILE_FREE = { plan: 'free' };
const NOOP = () => {};

import ReviewSheet from '../ReviewSheet';

// ── Edit button rendering ─────────────────────────────────────────────────────

describe('ReviewSheet — Edit button renders when onEdit is provided', () => {
  afterEach(() => vi.clearAllMocks());

  it('shows "Edit quote" in quote mode', () => {
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
        onEdit={NOOP}
        flash={NOOP}
      />
    );
    expect(screen.getByRole('button', { name: /edit quote/i })).toBeInTheDocument();
  });

  it('shows "Edit invoice" in invoice mode', () => {
    render(
      <ReviewSheet
        mode="invoice"
        job={makeJob({ status: 'complete' })}
        biz={BIZ}
        profile={PROFILE_FREE}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={NOOP}
        onEdit={NOOP}
        flash={NOOP}
      />
    );
    expect(screen.getByRole('button', { name: /edit invoice/i })).toBeInTheDocument();
  });
});

// ── Edit button hidden when onEdit is omitted ─────────────────────────────────

describe('ReviewSheet — Edit button absent when onEdit is not provided', () => {
  afterEach(() => vi.clearAllMocks());

  it('no edit button in quote mode without onEdit', () => {
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
    expect(screen.queryByRole('button', { name: /edit quote/i })).not.toBeInTheDocument();
  });

  it('no edit button in invoice mode without onEdit', () => {
    render(
      <ReviewSheet
        mode="invoice"
        job={makeJob({ status: 'complete' })}
        biz={BIZ}
        profile={PROFILE_FREE}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={NOOP}
        flash={NOOP}
      />
    );
    expect(screen.queryByRole('button', { name: /edit invoice/i })).not.toBeInTheDocument();
  });
});

// ── Tapping Edit calls onEdit, NOT onDismiss ──────────────────────────────────

describe('ReviewSheet — tapping Edit triggers onEdit without draft-saving', () => {
  afterEach(() => vi.clearAllMocks());

  it('calls onEdit when the Edit quote button is tapped', () => {
    const onEdit = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ReviewSheet
        mode="quote"
        job={makeJob()}
        biz={BIZ}
        profile={PROFILE_FREE}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={onDismiss}
        onUpdate={NOOP}
        onEdit={onEdit}
        flash={NOOP}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit quote/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('calls onEdit when the Edit invoice button is tapped', () => {
    const onEdit = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ReviewSheet
        mode="invoice"
        job={makeJob({ status: 'complete' })}
        biz={BIZ}
        profile={PROFILE_FREE}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={onDismiss}
        onUpdate={NOOP}
        onEdit={onEdit}
        flash={NOOP}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit invoice/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

// ── Existing peer buttons are not regressed ───────────────────────────────────

describe('ReviewSheet — existing peer buttons still present with onEdit wired', () => {
  afterEach(() => vi.clearAllMocks());

  it('Save draft and Download PDF buttons still render in quote mode', () => {
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
        onEdit={NOOP}
        flash={NOOP}
      />
    );
    expect(screen.getByRole('button', { name: /save draft/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send via whatsapp/i })).toBeInTheDocument();
  });

  it('Save draft and Download PDF buttons still render in invoice mode', () => {
    render(
      <ReviewSheet
        mode="invoice"
        job={makeJob({ status: 'complete' })}
        biz={BIZ}
        profile={PROFILE_FREE}
        jobs={[makeJob()]}
        onClose={NOOP}
        onDismiss={NOOP}
        onUpdate={NOOP}
        onEdit={NOOP}
        flash={NOOP}
      />
    );
    expect(screen.getByRole('button', { name: /save draft/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send invoice via whatsapp/i })).toBeInTheDocument();
  });
});
