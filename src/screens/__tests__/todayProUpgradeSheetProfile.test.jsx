// @vitest-environment jsdom
/**
 * todayProUpgradeSheetProfile.test.jsx (fix/today-pill-honest-cta)
 *
 * The <ProUpgradeSheet> rendered by TodayScreen (opened by the Today Get Pro
 * pill) was missing the `profile` prop. ProUpgradeSheet's default-variant CTA
 * honesty logic is `cardFreeEligible = profile == null || isTrialActive(profile)`
 * (see src/components/ProUpgradeSheet.jsx) — a missing/null profile falls back
 * to `true`, so an expired-trial or free-plan trader tapping the Today pill
 * saw the card-free "Start 14-day free trial — no card" promise instead of
 * the honest, card-required "Get Pro — £12/mo" CTA. This is the same bug
 * class fixed for other surfaces in feat/pro-billing-tidy (PR #600) — this
 * call site was simply missed.
 *
 * Covers:
 *   - free plan + expired-trial plan: sheet opened from the Today pill shows
 *     the honest "Get Pro — £12/mo" CTA, not the no-card trial promise
 *   - active trial (urgency window): sheet opened from the Today pill KEEPS
 *     the accurate card-free "Start 14-day free trial — no card" CTA
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

// ── Mocks required by TodayScreen (mirrors todayRetentionBeats.test.jsx) ────

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
    INSIGHT_LOCKED:    'insight_locked',
    WHITELABEL_FOOTER: 'whitelabel_footer',
    AUTO_CHASE_LOCKED: 'auto_chase_locked',
    SETTINGS:          'settings',
    TRIAL_BANNER:      'trial_banner',
    TODAY_PILL:        'today_pill',
    UPGRADE_BANNER:    'upgrade_banner',
  },
}));

// ProUpgradeSheet (rendered for real by this test) imports startCheckout,
// startCheckoutWithCoupon and startCheckoutImmediate — mock all three so the
// component never touches the network, even though these tests only assert
// on rendered copy and don't click the sheet's own CTA.
vi.mock('../../lib/billing', () => ({
  startCheckout: vi.fn().mockResolvedValue({ error: null }),
  startCheckoutWithCoupon: vi.fn().mockResolvedValue({ error: null }),
  startCheckoutImmediate: vi.fn().mockResolvedValue({ error: null }),
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
  parseJobFromSpeech: vi.fn().mockResolvedValue({ customer: 'Test', amount: 100 }),
}));

vi.mock('../../lib/receiptOCR', () => ({
  extractReceipt: vi.fn().mockResolvedValue({ merchant: 'Screwfix', total: 20 }),
}));

vi.mock('../../lib/exportCsv', () => ({
  buildJobsCsv: vi.fn().mockReturnValue('csv,data'),
  downloadOrShareCsv: vi.fn(),
}));

vi.mock('../../lib/realtime', () => ({
  subscribeToJobs: vi.fn().mockReturnValue(() => {}),
}));

// ── Component under test ────────────────────────────────────────────────────

import TodayScreen from '../TodayScreen';

const NOOP = () => {};

// ── Profile fixtures ─────────────────────────────────────────────────────────

const PROFILE_FREE = { plan: 'free' };
const PROFILE_EXPIRED_TRIAL = {
  plan: 'trial',
  trial_ends_at: new Date(Date.now() - 86400000).toISOString(), // expired yesterday
};
// Urgency window (daysLeft <= 3) — both 'settled' and 'urgency' pill states tap
// through to onOpen() when onNavigateToMoney isn't wired for 'settled', but
// 'urgency' always calls onOpen() regardless, so it's the simplest active-trial
// state to drive straight to the sheet without depending on that fallback.
const PROFILE_ACTIVE_TRIAL_URGENCY = {
  plan: 'trial',
  trial_ends_at: new Date(Date.now() + 2 * 86400000).toISOString(), // 2 days left
};

function renderToday(profile) {
  return render(
    <TodayScreen
      jobs={[]}
      receipts={[]}
      onAddJob={NOOP}
      onUpdateJob={NOOP}
      onOpenDetailed={NOOP}
      onMarkPaid={NOOP}
      onJobTap={NOOP}
      onSeeTheWeek={NOOP}
      profile={profile}
      onSnackbar={NOOP}
      onSnackbarDismiss={NOOP}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Today Get Pro pill → ProUpgradeSheet honesty (profile threaded through)', () => {
  it.each([
    ['free plan', PROFILE_FREE],
    ['expired trial', PROFILE_EXPIRED_TRIAL],
  ])('%s: opening the sheet from the Today pill shows the honest "Get Pro — £12/mo" CTA, not the no-card trial promise', (_label, profile) => {
    renderToday(profile);
    // Free-state pill copy starts with "Get Pro — auto-chase late payers...".
    fireEvent.click(screen.getByRole('button', { name: /Get Pro — auto-chase late payers/i }));
    expect(screen.getByRole('button', { name: /Get Pro.*£12\/mo/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Start 14-day free trial/i })).toBeNull();
    expect(screen.queryByText(/no card needed/i)).toBeNull();
  });

  it('active trial (urgency window): opening the sheet from the Today pill keeps the accurate card-free "Start 14-day free trial — no card" CTA', () => {
    renderToday(PROFILE_ACTIVE_TRIAL_URGENCY);
    // Urgency-state pill copy: "{N} days of Pro left — after that, chasing's back on you".
    fireEvent.click(screen.getByRole('button', { name: /days of Pro left/i }));
    expect(screen.getByRole('button', { name: /Start 14-day free trial.*no card/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Get Pro.*£12\/mo/i })).toBeNull();
  });
});
