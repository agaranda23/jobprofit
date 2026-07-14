// @vitest-environment jsdom
/**
 * DocumentPreview — unit tests (Preview & Edit slice 1).
 *
 * Covers the founder-brief verification items that live at the DocumentPreview
 * level (not the full ReviewSheet — see reviewSheetDocumentPreview.test.jsx for
 * the send-path + in-sheet-refresh integration checks):
 *
 *   (a) Locked footer strip — shown for free, shown for a missing/undefined
 *       profile (fail-safe default per QAE review), absent for Pro/trial.
 *       Resolved ONLY via showJobProfitFooter()/isPro() — no second inline check.
 *   (b) Tapping "Remove →" opens ProUpgradeSheet with the WHITELABEL_FOOTER
 *       trigger and fires the existing upgrade-trigger telemetry
 *       (setLastUpgradeTrigger + upgrade_sheet_viewed, both fired by
 *       ProUpgradeSheet's own effect — DocumentPreview does not duplicate them).
 *   (d) Deposit line mirrors sendQuote.js's send-time clamp exactly
 *       (Math.min(pct × total, total)) so the preview number == the number sent.
 *   VAT parity — the VAT row reuses splitVatInclusive() (not a re-derived
 *       formula) so a non-round total (£137.50) matches invoicePDF.js to the penny.
 *
 * Test (c) "brand edit persists to the profile" and (e) "Send via WhatsApp
 * unchanged" live in reviewSheetDocumentPreview.test.jsx, mounted through the
 * real ReviewSheet — persistence must be proven at the point the founder
 * decision actually applies (via ReviewSheet's onProfileUpdate/localProfile
 * bridge), not against a bare DocumentPreview with no caller wired up.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { splitVatInclusive } from '../../lib/vatUtils.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

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

const supabaseUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
    from: vi.fn(() => ({ update: (...args) => supabaseUpdate(...args) })),
    storage: { from: vi.fn(() => ({ upload: vi.fn(), getPublicUrl: vi.fn() })) },
  },
}));

import * as telemetry from '../../lib/telemetry';
import DocumentPreview from '../DocumentPreview';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Sarah Jones',
    amount: 500,
    total: 500,
    summary: 'Kitchen taps',
    status: 'lead',
    lineItems: [{ desc: 'Labour', cost: 500 }],
    ...overrides,
  };
}

const BIZ = { name: 'Test Plumbing Ltd', email: 'test@example.com' };
const NOOP = () => {};

afterEach(() => vi.clearAllMocks());

// ── (a) Footer visibility matrix ──────────────────────────────────────────────

describe('DocumentPreview — locked footer visibility', () => {
  it('shows the locked footer + Remove chip for a free-plan profile', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} onEdit={NOOP} flash={NOOP} />
    );
    expect(screen.getByText(/sent with ohnar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('shows the locked footer when profile is undefined (fail-safe default — never hidden)', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={undefined} onEdit={NOOP} flash={NOOP} />
    );
    expect(screen.getByText(/sent with ohnar/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
  });

  it('shows the locked footer when profile is null (fail-safe default)', () => {
    render(
      <DocumentPreview mode="invoice" job={makeJob({ status: 'complete' })} biz={BIZ} profile={null} onEdit={NOOP} flash={NOOP} />
    );
    expect(screen.getByText(/sent with ohnar/i)).toBeInTheDocument();
  });

  it('hides the footer entirely for a Pro-plan profile', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'pro' }} onEdit={NOOP} flash={NOOP} />
    );
    expect(screen.queryByText(/sent with ohnar/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('hides the footer for an active-trial profile', () => {
    const trialProfile = { plan: 'trial', trial_ends_at: new Date(Date.now() + 86400000).toISOString() };
    render(
      <DocumentPreview mode="invoice" job={makeJob({ status: 'complete' })} biz={BIZ} profile={trialProfile} onEdit={NOOP} flash={NOOP} />
    );
    expect(screen.queryByText(/sent with ohnar/i)).not.toBeInTheDocument();
  });
});

// ── (b) Remove chip → ProUpgradeSheet + telemetry ─────────────────────────────

describe('DocumentPreview — "Remove →" chip opens the Pro upsell', () => {
  it('opens ProUpgradeSheet and fires the whitelabel_footer trigger telemetry on tap', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} onEdit={NOOP} flash={NOOP} />
    );

    // Not open yet — no upgrade dialog in the document.
    expect(screen.queryByRole('dialog', { name: /upgrade to ohnar pro/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    // ProUpgradeSheet is now open — its own effect fires setLastUpgradeTrigger +
    // upgrade_sheet_viewed with the trigger DocumentPreview passed it. We don't
    // re-implement that firing here; we just prove the trigger flows through.
    expect(screen.getByRole('dialog', { name: /upgrade to ohnar pro/i })).toBeInTheDocument();
    expect(telemetry.setLastUpgradeTrigger).toHaveBeenCalledWith('whitelabel_footer');
    expect(telemetry.logTelemetry).toHaveBeenCalledWith(
      'upgrade_sheet_viewed',
      expect.objectContaining({ trigger: 'whitelabel_footer' })
    );
  });

  it('firing checkout_started on the upgrade CTA also carries the whitelabel_footer trigger', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} onEdit={NOOP} flash={NOOP} />
    );
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    fireEvent.click(screen.getByRole('button', { name: /start 14-day free trial/i }));
    expect(telemetry.logTelemetry).toHaveBeenCalledWith(
      'checkout_started',
      expect.objectContaining({ trigger: 'whitelabel_footer' })
    );
  });
});

// ── (d) Deposit clamp mirrors sendQuote.js ────────────────────────────────────

describe('DocumentPreview — deposit total mirrors the sendQuote.js send-time clamp', () => {
  it('shows Math.min(pct × total, total) for a normal percent-based deposit', () => {
    const job = makeJob({ total: 500 });
    render(
      <DocumentPreview mode="quote" job={job} biz={BIZ} profile={{ plan: 'free' }} depositPercent={30} onEdit={NOOP} flash={NOOP} />
    );
    // sendQuote.js: lockedDepositPence = Math.min(round(500 * 0.30 * 100), round(500*100)) = 15000 → £150.00
    expect(screen.getByText(/deposit due now \(30%\)/i)).toBeInTheDocument();
    expect(screen.getByText('£150.00')).toBeInTheDocument();
  });

  it('clamps to the full total when depositPercent is 100 (never exceeds total payable)', () => {
    const job = makeJob({ total: 320 });
    render(
      <DocumentPreview mode="quote" job={job} biz={BIZ} profile={{ plan: 'free' }} depositPercent={100} onEdit={NOOP} flash={NOOP} />
    );
    const depositRow = screen.getByText(/deposit due now \(100%\)/i).closest('.dp-totals-row');
    const totalRow = screen.getByText(/total payable/i).closest('.dp-totals-row');
    expect(depositRow).toHaveTextContent('£320.00');
    expect(totalRow).toHaveTextContent('£320.00');
  });

  it('shows no deposit row in invoice mode even if depositPercent is passed', () => {
    render(
      <DocumentPreview mode="invoice" job={makeJob({ status: 'complete' })} biz={BIZ} profile={{ plan: 'free' }} depositPercent={50} onEdit={NOOP} flash={NOOP} />
    );
    expect(screen.queryByText(/deposit due now/i)).not.toBeInTheDocument();
  });
});

// ── VAT parity — reuses splitVatInclusive(), never re-derives the formula ────

describe('DocumentPreview — VAT row reuses splitVatInclusive (no re-implemented formula)', () => {
  it('matches splitVatInclusive to the penny for a non-round total (£137.50)', () => {
    const job = makeJob({ total: 137.50 });
    const profile = { plan: 'free', vat_registered: true };
    render(
      <DocumentPreview mode="quote" job={job} biz={BIZ} profile={profile} onEdit={NOOP} flash={NOOP} />
    );
    const { net, vat } = splitVatInclusive(137.50);
    const gbp = (n) => '£' + n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(screen.getByText('Subtotal').closest('.dp-totals-row')).toHaveTextContent(gbp(net));
    expect(screen.getByText('VAT (20%)').closest('.dp-totals-row')).toHaveTextContent(gbp(vat));
  });

  it('shows no VAT/subtotal rows when the profile is not VAT-registered', () => {
    const job = makeJob({ total: 137.50 });
    render(
      <DocumentPreview mode="quote" job={job} biz={BIZ} profile={{ plan: 'free', vat_registered: false }} onEdit={NOOP} flash={NOOP} />
    );
    expect(screen.queryByText('Subtotal')).not.toBeInTheDocument();
    expect(screen.queryByText('VAT (20%)')).not.toBeInTheDocument();
  });
});

// ── Line items — inline edit/add/delete, no more onEdit round-trip ───────────
// (Preview & Edit "full tap" slice, 2026-07: replaces the slice-1 onEdit bridge
// with a true inline editor that layers over the still-open sheet.)

describe('DocumentPreview — line items are inline-editable via onJobPatch', () => {
  it('tapping a line item opens the inline editor (not onEdit)', () => {
    const onJobPatch = vi.fn();
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} onJobPatch={onJobPatch} flash={NOOP} />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit labour/i }));
    expect(screen.getByRole('dialog', { name: /edit line item/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/line item description/i)).toHaveValue('Labour');
  });

  it('editing a line item recomputes and persists the total via onJobPatch', () => {
    const onJobPatch = vi.fn();
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} onJobPatch={onJobPatch} flash={NOOP} />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit labour/i }));
    fireEvent.change(screen.getByLabelText(/line item amount/i), { target: { value: '650' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onJobPatch).toHaveBeenCalledWith({
      lineItems: [{ desc: 'Labour', cost: 650 }],
      total: 650,
      amount: 650,
    });
  });

  it('"+ Add line" appends a new line item and recomputes the total', () => {
    const onJobPatch = vi.fn();
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} onJobPatch={onJobPatch} flash={NOOP} />
    );
    fireEvent.click(screen.getByRole('button', { name: /add a line item/i }));
    fireEvent.change(screen.getByLabelText(/line item description/i), { target: { value: 'Materials' } });
    fireEvent.change(screen.getByLabelText(/line item amount/i), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onJobPatch).toHaveBeenCalledWith({
      lineItems: [{ desc: 'Labour', cost: 500 }, { desc: 'Materials', cost: 120 }],
      total: 620,
      amount: 620,
    });
  });

  it('deleting a line item removes it and recomputes the total', () => {
    const onJobPatch = vi.fn();
    const job = makeJob({ lineItems: [{ desc: 'Labour', cost: 400 }, { desc: 'Materials', cost: 100 }], total: 500 });
    render(
      <DocumentPreview mode="quote" job={job} biz={BIZ} profile={{ plan: 'free' }} onJobPatch={onJobPatch} flash={NOOP} />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit materials/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(onJobPatch).toHaveBeenCalledWith({
      lineItems: [{ desc: 'Labour', cost: 400 }],
      total: 400,
      amount: 400,
    });
  });

  it('a single-line job can edit its amount directly by tapping "Total payable"', () => {
    const onJobPatch = vi.fn();
    const job = makeJob({ lineItems: [{ desc: 'Kitchen taps', cost: 500 }], total: 500 });
    render(
      <DocumentPreview mode="quote" job={job} biz={BIZ} profile={{ plan: 'free' }} onJobPatch={onJobPatch} flash={NOOP} />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit total/i }));
    fireEvent.change(screen.getByLabelText(/line item amount/i), { target: { value: '720' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onJobPatch).toHaveBeenCalledWith({
      lineItems: [{ desc: 'Kitchen taps', cost: 720 }],
      total: 720,
      amount: 720,
    });
  });

  it('renders line items read-only, with no "Add line" affordance, when onJobPatch is not provided', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} flash={NOOP} />
    );
    expect(screen.queryByRole('button', { name: /edit labour/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add a line item/i })).not.toBeInTheDocument();
    expect(screen.getByText('Labour')).toBeInTheDocument();
  });
});

// ── Bill-to / customer — never duplicates the job title ──────────────────────

describe('DocumentPreview — bill-to shows the real customer, never the job title', () => {
  it('shows "+ Add customer" when job.customer was defaulted to the job title (Quick Add data-model quirk)', () => {
    // Mirrors store.js addTodayJob: customer defaults to the job title when no
    // separate customer was captured — must never render as a duplicate line.
    const job = makeJob({ customer: 'Kitchen job lisa', summary: 'Kitchen job lisa' });
    render(
      <DocumentPreview mode="invoice" job={job} biz={BIZ} profile={{ plan: 'free' }} onJobPatch={vi.fn()} flash={NOOP} />
    );
    expect(screen.getByText('+ Add customer')).toBeInTheDocument();
    expect(screen.queryByText('Kitchen job lisa', { selector: '.dp-recipient-name' })).not.toBeInTheDocument();
  });

  it('shows the real customer name when it differs from the job title', () => {
    const job = makeJob({ customer: 'Sarah Jones', summary: 'Kitchen taps' });
    render(
      <DocumentPreview mode="invoice" job={job} biz={BIZ} profile={{ plan: 'free' }} onJobPatch={vi.fn()} flash={NOOP} />
    );
    expect(screen.getByText('Sarah Jones')).toBeInTheDocument();
  });

  it('never falls back to job.name (the legacy job-title alias)', () => {
    const job = makeJob({ customer: '', name: 'Kitchen job lisa', summary: 'Kitchen job lisa' });
    render(
      <DocumentPreview mode="invoice" job={job} biz={BIZ} profile={{ plan: 'free' }} onJobPatch={vi.fn()} flash={NOOP} />
    );
    expect(screen.getByText('+ Add customer')).toBeInTheDocument();
  });

  it('tapping "+ Add customer" and saving persists via onJobPatch', () => {
    const onJobPatch = vi.fn();
    const job = makeJob({ customer: 'Kitchen job lisa', summary: 'Kitchen job lisa' });
    render(
      <DocumentPreview mode="invoice" job={job} biz={BIZ} profile={{ plan: 'free' }} onJobPatch={onJobPatch} flash={NOOP} />
    );
    fireEvent.click(screen.getByRole('button', { name: /add customer/i }));
    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'Lisa Bloggs' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onJobPatch).toHaveBeenCalledWith(expect.objectContaining({ customer: 'Lisa Bloggs' }));
  });

  it('renders the recipient block read-only when onJobPatch is not provided', () => {
    const job = makeJob({ customer: 'Kitchen job lisa', summary: 'Kitchen job lisa' });
    render(
      <DocumentPreview mode="invoice" job={job} biz={BIZ} profile={{ plan: 'free' }} flash={NOOP} />
    );
    expect(screen.queryByRole('button', { name: /add customer/i })).not.toBeInTheDocument();
    expect(screen.getByText('No customer added')).toBeInTheDocument();
  });
});

// ── Invoice number / due date — tappable, persist via the ReviewSheet bridge ─

describe('DocumentPreview — invoice number and due date are inline-editable', () => {
  it('tapping the invoice number opens its editor and saves via onInvoiceNumberChange', () => {
    const onInvoiceNumberChange = vi.fn();
    const job = makeJob({ status: 'complete' });
    render(
      <DocumentPreview
        mode="invoice"
        job={job}
        biz={BIZ}
        profile={{ plan: 'free' }}
        invoiceNumber="INV-0007"
        dueDate="2026-07-20"
        onInvoiceNumberChange={onInvoiceNumberChange}
        flash={NOOP}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /change invoice no/i }));
    fireEvent.change(screen.getByLabelText('Invoice number'), { target: { value: 'INV-0099' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onInvoiceNumberChange).toHaveBeenCalledWith('INV-0099');
  });

  it('tapping the due date opens its editor and saves via onDueDateChange', () => {
    const onDueDateChange = vi.fn();
    const job = makeJob({ status: 'complete' });
    render(
      <DocumentPreview
        mode="invoice"
        job={job}
        biz={BIZ}
        profile={{ plan: 'free' }}
        invoiceNumber="INV-0007"
        dueDate="2026-07-20"
        onDueDateChange={onDueDateChange}
        flash={NOOP}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /change due/i }));
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-08-01' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onDueDateChange).toHaveBeenCalledWith('2026-08-01');
  });
});

// ── Hint text is state-aware — read-only callers don't over-promise ──────────
// Fix (2026-07): the hint "Tap anything to change it" was rendered ungated, so a
// read-only caller (DocumentsHub's view-first preview) advertised taps that do
// nothing. It now drops that sentence unless the job is editable (onJobPatch).
describe('DocumentPreview — the "tap anything" hint is gated on editability', () => {
  it('shows "Tap anything to change it" when the job is editable (onJobPatch present)', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} onJobPatch={vi.fn()} flash={NOOP} />
    );
    expect(screen.getByText(/tap anything to change it/i)).toBeInTheDocument();
  });

  it('drops "Tap anything to change it" when read-only (no onJobPatch), keeping only the "what your customer sees" line', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} flash={NOOP} />
    );
    expect(screen.queryByText(/tap anything to change it/i)).not.toBeInTheDocument();
    expect(screen.getByText(/this is what your customer sees\./i)).toBeInTheDocument();
  });
});

// ── Invoice meta taps require their OWN persist handler (no false save) ──────
// Fix (2026-07): "Invoice no"/"Due date" wired their onClick unconditionally, so
// a read-only caller opened an editor that toasted "…updated" while persisting
// nothing (the handler was undefined). Each tap now requires its persist handler,
// mirroring the "Valid until" gate. Existing tests above prove the tappable path
// when the handler IS supplied.
describe('DocumentPreview — invoice meta taps require their persist handler', () => {
  it('renders "Invoice no" and "Due date" as non-tappable when their change handlers are absent', () => {
    render(
      <DocumentPreview
        mode="invoice"
        job={makeJob({ status: 'complete' })}
        biz={BIZ}
        profile={{ plan: 'free' }}
        invoiceNumber="INV-0007"
        dueDate="2026-07-20"
        flash={NOOP}
      />
    );
    expect(screen.queryByRole('button', { name: /change invoice no/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /change due/i })).not.toBeInTheDocument();
  });
});

// ── Tap-anywhere never bubbles out of the card (P0 dismiss-jank fix) ─────────

describe('DocumentPreview — clicks never bubble past the card', () => {
  it('a click anywhere inside the card is stopped from reaching an ancestor listener', () => {
    const outerClick = vi.fn();
    render(
      <div onClick={outerClick}>
        <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} flash={NOOP} />
      </div>
    );
    // "Total payable" is read-only text here (no onJobPatch) — exactly the kind
    // of "non-editable region" tap the founder reported falling through.
    fireEvent.click(screen.getByText(/total payable/i));
    expect(outerClick).not.toHaveBeenCalled();
  });
});

// ── Empty-state placeholders — never block sending ───────────────────────────

describe('DocumentPreview — empty brand fields show placeholders, never block', () => {
  it('shows "Add your logo" when no logo_url is set', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={{}} profile={{ plan: 'free' }} flash={NOOP} />
    );
    expect(screen.getByText(/add your logo/i)).toBeInTheDocument();
  });

  it('shows "Add your business name" when no business name is set', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={{}} profile={{ plan: 'free' }} flash={NOOP} />
    );
    expect(screen.getByText(/add your business name/i)).toBeInTheDocument();
  });
});

// ── Logo mixed-content fix — http:// logo_url must render as https:// ───────
// A logo_url saved before LogoModal's https hardening can still be sitting
// in an existing profile. DocumentPreview's letterhead <img> must upgrade it
// on render (via secureImageUrl) so it never trips a browser "Not secure" /
// mixed-content warning.

describe('DocumentPreview — logo <img> upgrades an http:// logo_url to https://', () => {
  it('renders an https:// src when biz.logoUrl is stored as http://', () => {
    const biz = { ...BIZ, logoUrl: 'http://example.com/logo.png' };
    const { container } = render(
      <DocumentPreview mode="quote" job={makeJob()} biz={biz} profile={{ plan: 'free' }} flash={NOOP} />
    );
    expect(container.querySelector('.dp-logo-img')).toHaveAttribute('src', 'https://example.com/logo.png');
  });

  it('leaves an already-https:// logoUrl unchanged', () => {
    const biz = { ...BIZ, logoUrl: 'https://example.com/logo.png' };
    const { container } = render(
      <DocumentPreview mode="quote" job={makeJob()} biz={biz} profile={{ plan: 'free' }} flash={NOOP} />
    );
    expect(container.querySelector('.dp-logo-img')).toHaveAttribute('src', 'https://example.com/logo.png');
  });
});
