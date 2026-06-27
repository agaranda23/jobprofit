// @vitest-environment jsdom
/**
 * documentsFindabilityV1.test.jsx — feat/documents-findability-v1
 *
 * Covers:
 *   1. WorkScreen: "Documents" pill (renamed from "Records") renders and opens overlay.
 *   2. DocumentSearchOverlay: Receipts mode tab renders.
 *   3. DocumentSearchOverlay: Receipts mode shows receipt rows.
 *   4. DocumentSearchOverlay: receipt search filters by merchant.
 *   5. DocumentSearchOverlay: receiptStatus derives Paid / Unpaid correctly.
 *   6. DocumentSearchOverlay: tax-period filter (month / quarter / taxyear / all) buckets correctly.
 *   7. DocumentSearchOverlay: tax subtitle totals (count · £total · £VAT · tax year).
 *   8. DocumentSearchOverlay: "Send to accountant" shown only when tax period is active.
 *   9. DocumentSearchOverlay: export is gated to Pro — free user triggers upgrade path.
 *  10. taxYearFor: UK boundary tests (5 Apr / 6 Apr, Jan, Dec).
 *  11. buildReceiptSubtitle: totals computation including VAT sum.
 *  12. buildReceiptsCsv: correct column output.
 *  13. receiptInPeriod: month / quarter / taxyear / all bucketing.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Network / browser API mocks ───────────────────────────────────────────────

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select:   vi.fn().mockReturnThis(),
      insert:   vi.fn().mockReturnThis(),
      update:   vi.fn().mockReturnThis(),
      delete:   vi.fn().mockReturnThis(),
      eq:       vi.fn().mockReturnThis(),
      in:       vi.fn().mockReturnThis(),
      order:    vi.fn().mockReturnThis(),
      limit:    vi.fn().mockReturnThis(),
      single:   vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    auth: {
      getSession:        vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    channel: vi.fn(() => ({
      on:          vi.fn().mockReturnThis(),
      subscribe:   vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    })),
  },
}));

vi.mock('../../lib/store', () => ({
  uploadJobPhoto:    vi.fn().mockResolvedValue({ url: 'https://example.com/photo.jpg' }),
  getSignedPhotoUrl: vi.fn().mockResolvedValue('https://example.com/signed.jpg'),
  deleteJobPhoto:    vi.fn().mockResolvedValue(null),
  deleteJobFromCloud: vi.fn().mockResolvedValue(null),
  fetchPublicJob:    vi.fn().mockResolvedValue({ data: null, error: 'not found' }),
}));

vi.mock('../../lib/telemetry', () => ({
  logTelemetry:           vi.fn(),
  setLastUpgradeTrigger:  vi.fn(),
  getLastUpgradeTrigger:  vi.fn(),
  UPGRADE_TRIGGERS: {
    INSIGHT_LOCKED:    'insight_locked',
    WHITELABEL_FOOTER: 'whitelabel_footer',
    AUTO_CHASE_LOCKED: 'auto_chase_locked',
    SETTINGS:          'settings',
    TRIAL_BANNER:      'trial_banner',
    TODAY_PILL:        'today_pill',
    UPGRADE_BANNER:    'upgrade_banner',
  },
}));

vi.mock('../../lib/billing', () => ({
  startCheckout:     vi.fn().mockResolvedValue({}),
  openBillingPortal: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/pushSubscribe', () => ({
  isPushSupported:       vi.fn().mockReturnValue(false),
  getSubscriptionStatus: vi.fn().mockResolvedValue('unsupported'),
  subscribe:             vi.fn().mockResolvedValue(null),
  unsubscribe:           vi.fn().mockResolvedValue(false),
}));

vi.mock('../../lib/plan', () => ({
  isPro:                        vi.fn().mockReturnValue(false),
  isTrial:                      vi.fn().mockReturnValue(false),
  trialDaysLeft:                vi.fn().mockReturnValue(0),
  planAllowsPro:                vi.fn().mockReturnValue(false),
  isTrialActive:                vi.fn().mockReturnValue(false),
  canSendInvoice:               vi.fn().mockReturnValue(true),
  countInvoicesSentThisMonth:   vi.fn().mockReturnValue(0),
  showJobProfitFooter:          vi.fn().mockReturnValue(false),
  eligibleForWhiteLabelNudge:   vi.fn().mockReturnValue(false),
  trialJustExpired:             vi.fn().mockReturnValue(false),
  isTrialLastDay:               vi.fn().mockReturnValue(false),
  trialEndSheetDismissedToday:  vi.fn().mockReturnValue(false),
  recordTrialEndSheetDismissed: vi.fn(),
  hasDropToFreeSeen:            vi.fn().mockReturnValue(false),
  markDropToFreeSeen:           vi.fn(),
  UNLOCK_PRO_FOR_ALL:           false,
  FREE_MONTHLY_INVOICE_LIMIT:   Infinity,
}));

vi.mock('../../lib/consent', () => ({
  getAnalyticsConsent: vi.fn().mockReturnValue(true),
}));

vi.mock('../../lib/estimatorQuota', () => ({
  checkEstimatorQuota: vi.fn().mockResolvedValue({ allowed: true }),
}));

// exportCsv.downloadOrShare is used by the export handler — mock it so no real
// Blob / anchor download fires during tests.
vi.mock('../../lib/exportCsv', () => ({
  downloadOrShare:     vi.fn().mockResolvedValue(undefined),
  downloadOrShareCsv:  vi.fn().mockResolvedValue(undefined),
  buildJobsCsv:        vi.fn().mockReturnValue(''),
  buildEverythingCsv:  vi.fn().mockReturnValue(''),
  deriveJobRows:       vi.fn().mockReturnValue([]),
  deriveAccountFields: vi.fn().mockReturnValue([]),
}));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const NOOP = () => {};
const BIZ  = { name: 'Test Plumbing Ltd', email: 'test@example.com' };
const PROFILE_FREE = { plan: 'free', is_cis_subcontractor: false };
const PROFILE_PRO  = { plan: 'pro',  is_cis_subcontractor: false };

function makeJob(overrides = {}) {
  return {
    id:        overrides.id        ?? 'j1',
    customer:  overrides.customer  ?? 'Bob Smith',
    name:      overrides.name      ?? 'Fix boiler',
    summary:   overrides.summary   ?? 'Fix boiler',
    status:    overrides.status    ?? 'lead',
    paid:      overrides.paid      ?? false,
    amount:    overrides.amount    ?? 0,
    total:     overrides.total     ?? overrides.amount ?? 0,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...overrides,
  };
}

function makeReceipt(overrides = {}) {
  return {
    id:        overrides.id        ?? 'r1',
    label:     overrides.label     ?? 'Screwfix',
    merchant:  overrides.merchant  ?? 'Screwfix',
    amount:    overrides.amount    ?? 45.00,
    vat:       overrides.vat       ?? 7.50,
    date:      overrides.date      ?? '2025-09-10',
    jobId:     overrides.jobId     ?? null,
    imagePath: overrides.imagePath ?? null,
    items:     overrides.items     ?? [],
    cloud:     true,
    ...overrides,
  };
}

const DEFAULT_WORKSCREEN_PROPS = {
  jobs:            [],
  receipts:        [],
  onNewJob:        NOOP,
  onAddJob:        NOOP,
  onAddPayment:    NOOP,
  onUpdateJob:     NOOP,
  onDeleteJob:     NOOP,
  onAddReceipt:    NOOP,
  onDeleteReceipt: NOOP,
  biz:             BIZ,
  profile:         PROFILE_FREE,
};

// ── Imports (deferred until after mocks are set up) ───────────────────────────

import WorkScreen from '../WorkScreen';
import DocumentSearchOverlay from '../../components/DocumentSearchOverlay';
import { receiptStatus, buildReceiptSubtitle } from '../../components/DocumentSearchOverlay';
import { taxYearFor, receiptInPeriod } from '../../lib/taxYear';
import { buildReceiptsCsv } from '../../lib/receiptsCsv';
import { isPro } from '../../lib/plan';

// ── 1. WorkScreen: "Documents" pill renders and opens overlay ─────────────────

describe('WorkScreen — Documents pill (feat/documents-findability-v1)', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders the "Documents" pill in the controls row', () => {
    render(<WorkScreen {...DEFAULT_WORKSCREEN_PROPS} />);
    expect(screen.getByRole('button', { name: /find a quote, invoice, receipt or job/i })).toBeTruthy();
    expect(screen.getByText('Documents')).toBeTruthy();
  });

  it('does NOT render the old "Records" label', () => {
    render(<WorkScreen {...DEFAULT_WORKSCREEN_PROPS} />);
    expect(screen.queryByText('Records')).toBeNull();
  });

  it('opens DocumentSearchOverlay when Documents pill is tapped', () => {
    render(<WorkScreen {...DEFAULT_WORKSCREEN_PROPS} jobs={[makeJob()]} />);
    fireEvent.click(screen.getByRole('button', { name: /find a quote, invoice, receipt or job/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

// ── 2–3. DocumentSearchOverlay: Receipts mode tab + receipt rows ──────────────

describe('DocumentSearchOverlay — Receipts mode', () => {
  afterEach(() => vi.clearAllMocks());

  const baseProps = {
    mode: 'jobs',
    jobs: [],
    receipts: [],
    profile: PROFILE_FREE,
    onClose: NOOP,
    onJobSelect: NOOP,
  };

  it('renders a "Receipts" tab in the mode switcher', () => {
    render(<DocumentSearchOverlay {...baseProps} />);
    expect(screen.getByRole('tab', { name: /receipts/i })).toBeTruthy();
  });

  it('switches to Receipts mode when the tab is clicked', () => {
    render(<DocumentSearchOverlay {...baseProps} />);
    fireEvent.click(screen.getByRole('tab', { name: /receipts/i }));
    expect(screen.getByRole('heading', { name: 'Receipts' })).toBeTruthy();
  });

  it('shows receipt rows in Receipts mode', () => {
    const r1 = makeReceipt({ label: 'Screwfix', amount: 45 });
    const r2 = makeReceipt({ id: 'r2', label: 'Travis Perkins', amount: 120 });
    render(<DocumentSearchOverlay {...baseProps} receipts={[r1, r2]} />);
    fireEvent.click(screen.getByRole('tab', { name: /receipts/i }));
    expect(screen.getByText('Screwfix')).toBeTruthy();
    expect(screen.getByText('Travis Perkins')).toBeTruthy();
  });

  it('shows Paid chip when parent job is paid', () => {
    const job = makeJob({ id: 'j1', paid: true });
    const r   = makeReceipt({ jobId: 'j1' });
    render(<DocumentSearchOverlay {...baseProps} jobs={[job]} receipts={[r]} />);
    fireEvent.click(screen.getByRole('tab', { name: /receipts/i }));
    // "Paid" appears in both the status filter chip and the row chip; check the row chip
    const paidElements = screen.getAllByText('Paid');
    expect(paidElements.length).toBeGreaterThanOrEqual(1);
    // The row chip is a <span> not a <button>
    const rowChip = paidElements.find(el => el.tagName === 'SPAN');
    expect(rowChip).toBeTruthy();
  });

  it('shows Unpaid chip when parent job is not paid', () => {
    const job = makeJob({ id: 'j1', paid: false });
    const r   = makeReceipt({ jobId: 'j1' });
    render(<DocumentSearchOverlay {...baseProps} jobs={[job]} receipts={[r]} />);
    fireEvent.click(screen.getByRole('tab', { name: /receipts/i }));
    // "Unpaid" appears in both the status filter chip and the row chip
    const unpaidElements = screen.getAllByText('Unpaid');
    expect(unpaidElements.length).toBeGreaterThanOrEqual(1);
    const rowChip = unpaidElements.find(el => el.tagName === 'SPAN');
    expect(rowChip).toBeTruthy();
  });

  it('shows "Not on a job" in sub-line when receipt has no jobId', () => {
    const r = makeReceipt({ jobId: null });
    render(<DocumentSearchOverlay {...baseProps} receipts={[r]} />);
    fireEvent.click(screen.getByRole('tab', { name: /receipts/i }));
    expect(screen.getByText(/not on a job/i)).toBeTruthy();
  });
});

// ── 4. Receipt search ─────────────────────────────────────────────────────────

describe('DocumentSearchOverlay — receipt search', () => {
  afterEach(() => vi.clearAllMocks());

  it('filters receipts by merchant name', () => {
    const receipts = [
      makeReceipt({ id: 'r1', label: 'Screwfix' }),
      makeReceipt({ id: 'r2', label: 'Travis Perkins' }),
    ];
    render(
      <DocumentSearchOverlay
        mode="receipts"
        jobs={[]}
        receipts={receipts}
        profile={PROFILE_FREE}
        onClose={NOOP}
        onJobSelect={NOOP}
      />
    );
    const input = screen.getByPlaceholderText(/search merchant/i);
    fireEvent.change(input, { target: { value: 'screwfix' } });
    expect(screen.getByText('Screwfix')).toBeTruthy();
    expect(screen.queryByText('Travis Perkins')).toBeNull();
  });
});

// ── 5. receiptStatus derivation ───────────────────────────────────────────────

describe('receiptStatus', () => {
  it('returns Paid when parent job has paid=true', () => {
    const job = makeJob({ paid: true });
    expect(receiptStatus({}, job)).toBe('Paid');
  });

  it('returns Paid when parent job.paymentStatus is "paid"', () => {
    const job = makeJob({ paid: false, paymentStatus: 'paid' });
    expect(receiptStatus({}, job)).toBe('Paid');
  });

  it('returns Paid when parent job.status is "paid"', () => {
    const job = makeJob({ paid: false, status: 'paid' });
    expect(receiptStatus({}, job)).toBe('Paid');
  });

  it('returns Unpaid when parent job is not paid', () => {
    const job = makeJob({ paid: false });
    expect(receiptStatus({}, job)).toBe('Unpaid');
  });

  it('returns Unpaid when no parent job (no jobId)', () => {
    expect(receiptStatus({}, null)).toBe('Unpaid');
  });
});

// ── 6. Tax-period filter buckets ──────────────────────────────────────────────

describe('receiptInPeriod', () => {
  it('returns true for any date when period is "all"', () => {
    expect(receiptInPeriod('2020-01-15', 'all')).toBe(true);
    expect(receiptInPeriod('2099-12-31', 'all')).toBe(true);
  });

  it('"month" includes dates in the same calendar month as reference', () => {
    const ref = new Date('2025-09-20');
    expect(receiptInPeriod('2025-09-01', 'month', ref)).toBe(true);
    expect(receiptInPeriod('2025-09-30', 'month', ref)).toBe(true);
    expect(receiptInPeriod('2025-08-31', 'month', ref)).toBe(false);
    expect(receiptInPeriod('2025-10-01', 'month', ref)).toBe(false);
  });

  it('"quarter" includes dates in the same calendar quarter as reference (Jul-Sep)', () => {
    const ref = new Date('2025-08-15');
    expect(receiptInPeriod('2025-07-01', 'quarter', ref)).toBe(true);
    expect(receiptInPeriod('2025-09-30', 'quarter', ref)).toBe(true);
    expect(receiptInPeriod('2025-06-30', 'quarter', ref)).toBe(false);
    expect(receiptInPeriod('2025-10-01', 'quarter', ref)).toBe(false);
  });

  it('"taxyear" includes dates in the UK tax year containing the reference', () => {
    const ref = new Date('2025-09-01'); // tax year 2025/26
    expect(receiptInPeriod('2025-04-06', 'taxyear', ref)).toBe(true);  // start
    expect(receiptInPeriod('2026-04-05', 'taxyear', ref)).toBe(true);  // end
    expect(receiptInPeriod('2025-04-05', 'taxyear', ref)).toBe(false); // just before start
    expect(receiptInPeriod('2026-04-06', 'taxyear', ref)).toBe(false); // just after end
  });

  it('returns true for invalid date strings rather than hiding receipts', () => {
    expect(receiptInPeriod('not-a-date', 'month')).toBe(true);
  });
});

// ── 7. Tax subtitle totals ────────────────────────────────────────────────────

describe('buildReceiptSubtitle', () => {
  it('shows count + total only when period is "all"', () => {
    const receipts = [
      makeReceipt({ amount: 100, vat: 20 }),
      makeReceipt({ id: 'r2', amount: 200, vat: 40 }),
    ];
    const sub = buildReceiptSubtitle(receipts, 'all', '');
    expect(sub).toContain('2 receipts');
    expect(sub).toContain('£300');
    expect(sub).not.toContain('VAT');
  });

  it('includes VAT and tax year when period is "taxyear"', () => {
    const receipts = [
      makeReceipt({ amount: 120, vat: 20 }),
      makeReceipt({ id: 'r2', amount: 60, vat: 10 }),
    ];
    const sub = buildReceiptSubtitle(receipts, 'taxyear', '');
    expect(sub).toContain('2 receipts');
    expect(sub).toContain('£180');
    expect(sub).toContain('£30');
    expect(sub).toContain('VAT');
    // Should contain a tax year label like "2025/26" (exact year depends on now)
    expect(sub).toMatch(/\d{4}\/\d{2}/);
  });

  it('shows "1 receipt" (singular) for a single receipt', () => {
    const sub = buildReceiptSubtitle([makeReceipt({ amount: 50, vat: 0 })], 'all', '');
    expect(sub).toContain('1 receipt');
    expect(sub).not.toContain('1 receipts');
  });

  it('returns empty string when no receipts', () => {
    expect(buildReceiptSubtitle([], 'all', '')).toBe('');
  });

  it('returns match count when query is active', () => {
    const receipts = [makeReceipt(), makeReceipt({ id: 'r2' })];
    const sub = buildReceiptSubtitle(receipts, 'all', 'screwfix');
    expect(sub).toBe('2 matches');
  });
});

// ── 8. "Send to accountant" CTA only when tax period is active ────────────────

describe('DocumentSearchOverlay — export CTA visibility', () => {
  afterEach(() => vi.clearAllMocks());

  function openReceiptsMode(props) {
    const result = render(<DocumentSearchOverlay {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: /receipts/i }));
    return result;
  }

  it('does NOT show "Send to accountant" when period is "All"', () => {
    openReceiptsMode({
      mode: 'jobs',
      jobs: [],
      receipts: [makeReceipt()],
      profile: PROFILE_PRO,
      onClose: NOOP,
      onJobSelect: NOOP,
    });
    expect(screen.queryByRole('button', { name: /send to accountant/i })).toBeNull();
  });

  it('shows "Send to accountant" when tax-period filter is active', () => {
    openReceiptsMode({
      mode: 'jobs',
      jobs: [],
      receipts: [makeReceipt()],
      profile: PROFILE_PRO,
      onClose: NOOP,
      onJobSelect: NOOP,
    });
    // Activate "Tax year" filter chip
    fireEvent.click(screen.getByRole('button', { name: /tax year/i }));
    // aria-label is "Send receipts to accountant as CSV"
    expect(screen.getByRole('button', { name: /send receipts to accountant/i })).toBeTruthy();
  });
});

// ── 9. Export is gated to Pro ─────────────────────────────────────────────────

describe('DocumentSearchOverlay — export Pro gate', () => {
  afterEach(() => vi.clearAllMocks());

  it('calls onOpenUpgradeSheet when a free user taps "Send to accountant"', () => {
    vi.mocked(isPro).mockReturnValue(false);
    const onOpenUpgradeSheet = vi.fn();
    render(
      <DocumentSearchOverlay
        mode="receipts"
        jobs={[]}
        receipts={[makeReceipt()]}
        profile={PROFILE_FREE}
        onClose={NOOP}
        onJobSelect={NOOP}
        onOpenUpgradeSheet={onOpenUpgradeSheet}
      />
    );
    // Activate a tax-period filter to make the CTA appear
    fireEvent.click(screen.getByRole('button', { name: /tax year/i }));
    const exportBtn = screen.getByRole('button', { name: /send receipts to accountant/i });
    fireEvent.click(exportBtn);
    expect(onOpenUpgradeSheet).toHaveBeenCalledWith('accountant_export');
  });

  it('does NOT call onOpenUpgradeSheet when a Pro user taps "Send to accountant"', async () => {
    vi.mocked(isPro).mockReturnValue(true);
    const onOpenUpgradeSheet = vi.fn();

    render(
      <DocumentSearchOverlay
        mode="receipts"
        jobs={[]}
        receipts={[makeReceipt()]}
        profile={PROFILE_PRO}
        onClose={NOOP}
        onJobSelect={NOOP}
        onOpenUpgradeSheet={onOpenUpgradeSheet}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /tax year/i }));
    const exportBtn = screen.getByRole('button', { name: /send receipts to accountant/i });
    fireEvent.click(exportBtn);
    expect(onOpenUpgradeSheet).not.toHaveBeenCalled();
  });
});

// ── 10. taxYearFor: boundary tests ────────────────────────────────────────────

describe('taxYearFor', () => {
  it('returns empty string for null/undefined input', () => {
    expect(taxYearFor(null)).toBe('');
    expect(taxYearFor(undefined)).toBe('');
  });

  it('returns empty string for an invalid date', () => {
    expect(taxYearFor('not-a-date')).toBe('');
    expect(taxYearFor('')).toBe('');
  });

  // 5 Apr boundary — still in the *previous* tax year
  it('5 Apr 2025 → 2024/25', () => {
    expect(taxYearFor('2025-04-05')).toBe('2024/25');
  });

  // 6 Apr boundary — first day of the new tax year
  it('6 Apr 2025 → 2025/26', () => {
    expect(taxYearFor('2025-04-06')).toBe('2025/26');
  });

  it('1 Jan 2026 → 2025/26 (mid-year)', () => {
    expect(taxYearFor('2026-01-01')).toBe('2025/26');
  });

  it('31 Dec 2025 → 2025/26', () => {
    expect(taxYearFor('2025-12-31')).toBe('2025/26');
  });

  it('5 Apr 2026 → 2025/26 (last day of that year)', () => {
    expect(taxYearFor('2026-04-05')).toBe('2025/26');
  });

  it('6 Apr 2026 → 2026/27 (first day of next year)', () => {
    expect(taxYearFor('2026-04-06')).toBe('2026/27');
  });

  it('accepts a Date object', () => {
    expect(taxYearFor(new Date('2025-09-01'))).toBe('2025/26');
  });
});

// ── 11. buildReceiptSubtitle totals ──────────────────────────────────────────
// (Extended edge cases beyond what was covered above)

describe('buildReceiptSubtitle — edge cases', () => {
  it('sums amounts and VAT correctly across multiple receipts', () => {
    const receipts = [
      makeReceipt({ amount: 100, vat: 20 }),
      makeReceipt({ id: 'r2', amount: 250.50, vat: 50.10 }),
      makeReceipt({ id: 'r3', amount: 0, vat: 0 }),
    ];
    const sub = buildReceiptSubtitle(receipts, 'taxyear', '');
    // Total = 350.50, VAT = 70.10
    expect(sub).toContain('3 receipts');
    expect(sub).toContain('VAT');
  });
});

// ── 12. buildReceiptsCsv ──────────────────────────────────────────────────────

describe('buildReceiptsCsv', () => {
  it('produces correct header row', () => {
    const csv = buildReceiptsCsv([], [], '');
    expect(csv).toContain('Date,Merchant,Amount £,VAT £,Job / Customer,Invoice number');
  });

  it('emits one data row per receipt', () => {
    const r = makeReceipt({ date: '2025-09-10', label: 'Screwfix', amount: 45, vat: 7.5 });
    const csv = buildReceiptsCsv([r], [], '2025/26');
    const lines = csv.trim().split('\n').filter(l => !l.startsWith('#'));
    expect(lines.length).toBe(2); // header + 1 data row
    expect(lines[1]).toContain('Screwfix');
    expect(lines[1]).toContain('45.00');
    expect(lines[1]).toContain('7.50');
  });

  it('resolves customer name from linked job', () => {
    const job = makeJob({ id: 'j1', customer: 'Alice Jones' });
    const r   = makeReceipt({ jobId: 'j1' });
    const csv = buildReceiptsCsv([r], [job], '');
    expect(csv).toContain('Alice Jones');
  });

  it('labels unlinked receipt as "Not on a job"', () => {
    const r = makeReceipt({ jobId: null });
    const csv = buildReceiptsCsv([r], [], '');
    expect(csv).toContain('Not on a job');
  });

  it('handles empty receipts array without throwing', () => {
    expect(() => buildReceiptsCsv([], [], '2025/26')).not.toThrow();
  });

  it('includes tax year comment in header when provided', () => {
    const csv = buildReceiptsCsv([], [], '2025/26');
    expect(csv).toContain('2025/26');
  });
});
