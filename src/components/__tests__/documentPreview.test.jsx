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

// ── Line items route to the existing onEdit bridge — no new price editor ─────

describe('DocumentPreview — line items tap the EXISTING onEdit bridge', () => {
  it('tapping a line item calls onEdit (not a new inline editor)', () => {
    const onEdit = vi.fn();
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} onEdit={onEdit} flash={NOOP} />
    );
    fireEvent.click(screen.getByRole('button', { name: /edit labour/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('renders line items as non-interactive when onEdit is not provided', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={BIZ} profile={{ plan: 'free' }} flash={NOOP} />
    );
    expect(screen.queryByRole('button', { name: /edit labour/i })).not.toBeInTheDocument();
    expect(screen.getByText('Labour')).toBeInTheDocument();
  });
});

// ── Empty-state placeholders — never block sending ───────────────────────────

describe('DocumentPreview — empty brand fields show placeholders, never block', () => {
  it('shows "Add your logo" when no logo_url is set', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={{}} profile={{ plan: 'free' }} onEdit={NOOP} flash={NOOP} />
    );
    expect(screen.getByText(/add your logo/i)).toBeInTheDocument();
  });

  it('shows "Add your business name" when no business name is set', () => {
    render(
      <DocumentPreview mode="quote" job={makeJob()} biz={{}} profile={{ plan: 'free' }} onEdit={NOOP} flash={NOOP} />
    );
    expect(screen.getByText(/add your business name/i)).toBeInTheDocument();
  });
});
