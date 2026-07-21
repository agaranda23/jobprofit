// @vitest-environment jsdom
/**
 * todayAlive.test.jsx — "Today feel alive" (2026-07-05)
 *
 * Covers the 5 changes on TodayScreen:
 *   1. Pulse dopamine cards — real computed data only, hidden gracefully
 *      when there isn't enough data (see also src/lib/__tests__/todayPulse.test.js
 *      for the pure-function coverage of the underlying math).
 *   2. First-quote celebration — fires once, from the real "Save quote" flow,
 *      gated on localStorage (see also firstQuoteCelebration.test.js for the
 *      pure gating logic).
 *   3. (microcopy — covered by the empty-state / all-clear assertions here)
 *   4. Bigger voice/mic surface on the "Quote it" pivot button.
 *   5. GetProPill renders during an ACTIVE TRIAL (the bug this PR fixes) and
 *      is hidden for a truly-paid Pro user.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mocks required by TodayScreen and its imports ────────────────────────────

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

vi.mock('../../lib/billing', () => ({
  startCheckout: vi.fn().mockResolvedValue({}),
  startCheckoutImmediate: vi.fn().mockResolvedValue({}),
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

// Icon stubbed so we can assert on which semantic icon rendered (mirrors the
// convention in GetProPill.test.jsx) — real Icon renders opaque lucide SVGs
// with no way to query the semantic name from the DOM.
vi.mock('../../components/Icon', () => ({
  default: ({ name, className }) => <span data-testid={`icon-${name}`} className={className} />,
}));

// ── Component under test ──────────────────────────────────────────────────────

import TodayScreen from '../TodayScreen';

const NOOP = () => {};

// ── Profile fixtures ──────────────────────────────────────────────────────────

const PROFILE_FREE = { id: 'user-free', plan: 'free', is_cis_subcontractor: false };
const PROFILE_TRIAL = {
  id: 'user-trial',
  plan: 'trial',
  is_cis_subcontractor: false,
  trial_ends_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days left
};
const PROFILE_PRO = { id: 'user-pro', plan: 'pro', is_cis_subcontractor: false };

// ── Job fixtures ──────────────────────────────────────────────────────────────

function invoiceSentJob(id, amount) {
  return { id, amount, total: amount, status: 'invoice_sent', paid: false, invoiceSentAt: new Date().toISOString() };
}

function activeJob(id, amount) {
  return { id, amount, total: amount, status: 'active', date: new Date().toISOString() };
}

function paidJobDaysAgo(id, amount, daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return { id, amount, total: amount, status: 'paid', paid: true, date: d.toISOString(), createdAt: d.toISOString() };
}

// ── Render helper ─────────────────────────────────────────────────────────────

function renderToday(jobs = [], profile = PROFILE_FREE, extra = {}) {
  return render(
    <TodayScreen
      jobs={jobs}
      receipts={[]}
      onAddJob={NOOP}
      onUpdateJob={NOOP}
      onOpenDetailed={NOOP}
      onMarkPaid={NOOP}
      onJobTap={NOOP}
      onNavigateToMoney={NOOP}
      onSeeTheWeek={NOOP}
      profile={profile}
      onSnackbar={NOOP}
      onSnackbarDismiss={NOOP}
      {...extra}
    />
  );
}

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ── 1. Pulse dopamine cards ────────────────────────────────────────────────────

describe('TodayScreen — pulse dopamine cards (item 1)', () => {
  it('hides the pulse row entirely for a brand-new user with no jobs', () => {
    renderToday([], PROFILE_FREE);
    expect(document.querySelector('.today-pulse-row')).toBeNull();
  });

  it('shows "waiting to collect" only when there is a real unpaid invoiced job', () => {
    renderToday([invoiceSentJob('j1', 500)], PROFILE_FREE);
    const card = document.querySelector('.today-pulse-card--collect');
    expect(card).not.toBeNull();
    expect(card.textContent).toMatch(/waiting to collect/i);
  });

  it('does NOT show "waiting to collect" when nothing is invoiced yet', () => {
    renderToday([activeJob('j1', 500)], PROFILE_FREE);
    expect(document.querySelector('.today-pulse-card--collect')).toBeNull();
  });

  it('shows a named job strip (not a bare count) when there is exactly one real active job', () => {
    renderToday([activeJob('j1', 300)], PROFILE_FREE);
    const card = document.querySelector('.today-pulse-card--on');
    expect(card).not.toBeNull();
    // Stage chip — reuses the same .jt-stage-name--on chip as the Jobs tab,
    // so Today and the pipeline speak one "On" language.
    const chip = card.querySelector('.jt-stage-name--on');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toBe('On');
    // The fixture has no name/summary/customer — the strip must fall back to
    // the literal "Active job" rather than inventing one.
    expect(card.textContent).toMatch(/Active job/);
    // Real £ value pulled from the job, not a bare digit.
    expect(card.textContent).toMatch(/£300/);
    // date is "now" in the fixture — 0 days on.
    expect(card.textContent).toMatch(/just started/i);
  });

  it('tapping the named "on" strip deep-links straight to that job (onJobTap), not the Jobs list', () => {
    const onJobTap = vi.fn();
    const job = activeJob('j1', 300);
    renderToday([job], PROFILE_FREE, { onJobTap });
    fireEvent.click(document.querySelector('.today-pulse-card--on'));
    expect(onJobTap).toHaveBeenCalledTimes(1);
    expect(onJobTap).toHaveBeenCalledWith(job);
  });

  it('shows "ahead of last week" only with a genuine positive prior-week comparison', () => {
    const jobs = [paidJobDaysAgo('this1', 500, 1), paidJobDaysAgo('last1', 200, 9)];
    renderToday(jobs, PROFILE_FREE);
    const card = document.querySelector('.today-pulse-card--trend');
    expect(card).not.toBeNull();
    expect(card.textContent).toMatch(/ahead of last week/i);
  });

  it('hides "ahead of last week" when there is no prior week to compare (never fabricates a baseline)', () => {
    const jobs = [paidJobDaysAgo('this1', 500, 1)]; // no job in the prior week at all
    renderToday(jobs, PROFILE_FREE);
    expect(document.querySelector('.today-pulse-card--trend')).toBeNull();
  });

  it('hides "ahead of last week" when this week is behind last week (never shows a negative "win")', () => {
    const jobs = [paidJobDaysAgo('this1', 100, 1), paidJobDaysAgo('last1', 400, 9)];
    renderToday(jobs, PROFILE_FREE);
    expect(document.querySelector('.today-pulse-card--trend')).toBeNull();
  });

  it('tapping "waiting to collect" navigates to Jobs, Overdue stage (onSeeTheWeek)', () => {
    const onSeeTheWeek = vi.fn();
    renderToday([invoiceSentJob('j1', 500)], PROFILE_FREE, { onSeeTheWeek });
    fireEvent.click(document.querySelector('.today-pulse-card--collect'));
    expect(onSeeTheWeek).toHaveBeenCalledTimes(1);
    // Regression: this used to navigate to Jobs with NO stage, landing on
    // whatever stage was last persisted (e.g. Paid) instead of the money owed.
    // Routes to Overdue — the "who owes you" chase list — not Invoiced.
    expect(onSeeTheWeek).toHaveBeenCalledWith('Overdue');
  });

  it('tapping the "N jobs on" count card navigates to Jobs, On stage (onSeeTheWeek)', () => {
    const onSeeTheWeek = vi.fn();
    renderToday([activeJob('j1', 300), activeJob('j2', 200)], PROFILE_FREE, { onSeeTheWeek });
    fireEvent.click(document.querySelector('.today-pulse-card--on'));
    expect(onSeeTheWeek).toHaveBeenCalledTimes(1);
    expect(onSeeTheWeek).toHaveBeenCalledWith('On');
  });

  it('tapping "ahead of last week" navigates to Money (onNavigateToMoney)', () => {
    const onNavigateToMoney = vi.fn();
    const jobs = [paidJobDaysAgo('this1', 500, 1), paidJobDaysAgo('last1', 200, 9)];
    renderToday(jobs, PROFILE_FREE, { onNavigateToMoney });
    fireEvent.click(document.querySelector('.today-pulse-card--trend'));
    expect(onNavigateToMoney).toHaveBeenCalledTimes(1);
  });
});

// ── 1b. On-strip / hero de-dup (dedup-strip-hero) ───────────────────────────────
// Founder-flagged: a single On job needing invoicing used to show on THREE
// surfaces at once (strip, Get Pro pill, NBA hero) — the strip is now
// suppressed when it's literally the same job as the hero, and the hero's
// meta swaps its false "done Xd ago" (nbaMeta's Tier-2 copy, correct only for
// a genuinely-finished job) for a quiet "On · Nd" context chip instead.

describe('TodayScreen — on-strip / hero de-dup', () => {
  // status:'active', dated daysAgo ago — deriveDisplayStatus reads this as
  // "On" (so it's in onJobs) AND, once past the 48h grace, deriveStatus/
  // isUnbilledComplete reads it as the Tier-2 "needs invoicing" hero. Same
  // job, same fields drive both — this is deliberate, it's the exact overlap
  // the founder flagged.
  function heroOnJob(id, amount, daysAgo) {
    const d = new Date(Date.now() - daysAgo * 86400000);
    return { id, amount, total: amount, status: 'active', date: d.toISOString() };
  }

  it('suppresses the "on" strip and shows a quiet "On · Nd" chip (no false "done Xd ago") when the single On job IS the Tier-2 hero', () => {
    renderToday([heroOnJob('j1', 500, 3)], PROFILE_FREE);
    // The strip would be redundant — the hero below is the SAME job.
    expect(document.querySelector('.today-pulse-card--on')).toBeNull();

    const hero = document.querySelector('.foreman-prompt-card');
    expect(hero).not.toBeNull();
    expect(hero.textContent).toMatch(/invoice/i); // nbaLabel(2) === 'INVOICE'

    // Quiet context chip carries the real duration...
    const chip = hero.querySelector('.foreman-tier-onchip');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toMatch(/on/i);
    expect(chip.textContent).toMatch(/3d/);

    // ...and nbaMeta's Tier-2 "done Xd ago" suffix is gone (it's untrue —
    // the job is still On, not finished); the £ amount is kept.
    const meta = hero.querySelector('.foreman-meta');
    expect(meta).not.toBeNull();
    expect(meta.textContent).not.toMatch(/done/i);
    expect(meta.textContent).toMatch(/£500/);
  });

  it('still renders the named "on" strip when a DIFFERENT job outranks it for the hero slot (Tier-1 overdue beats Tier-2)', () => {
    const onJob = { id: 'on1', amount: 300, total: 300, status: 'active', date: new Date().toISOString() };
    // invoiceSentAt 10 days ago, net-7 default terms (see chaseLadder.js) →
    // genuinely overdue → Tier 1, which outranks the On job's Tier 2.
    const overdueJob = {
      id: 'ov1', amount: 900, total: 900, status: 'invoice_sent', paid: false,
      invoiceSentAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    };
    renderToday([onJob, overdueJob], PROFILE_FREE);
    // Hero is the overdue job, not the On job — the identity check
    // (promptJob.id === onJobs[0].id) must be false, so the strip survives.
    const card = document.querySelector('.today-pulse-card--on');
    expect(card).not.toBeNull();
    expect(card.textContent).toMatch(/Active job/);
  });

  it('still renders the strip for a fresh single On job with no actionable hero yet (Tier 5 / all-clear)', () => {
    // Dated "now" — inside the 48h grace, so it hasn't reached Tier 2 yet;
    // no other job qualifies for Tier 1/3 either, so promptJob is null.
    const freshOnJob = { id: 'fresh1', amount: 200, total: 200, status: 'active', date: new Date().toISOString() };
    renderToday([freshOnJob], PROFILE_FREE);
    expect(document.querySelector('.today-pulse-card--on')).not.toBeNull();
    // No Tier<5 hero card at all — the all-clear state renders instead.
    expect(document.querySelector('.foreman-prompt-card')).toBeNull();
  });
});

// ── 2. First-quote celebration ─────────────────────────────────────────────────

describe('TodayScreen — first-quote celebration (item 2)', () => {
  async function saveAQuote() {
    // Open Today's "Quote it" pivot — voice auto-starts, but jsdom has no
    // SpeechRecognition, so AddJobModal falls back to the manual typed form
    // synchronously (see AddJobModal.jsx startQuoteListening's `!SR` guard).
    fireEvent.click(screen.getByRole('button', { name: /quote it — speak your quote, or type it/i }));
    const descriptionInput = await screen.findByPlaceholderText(/bathroom tiling/i);
    fireEvent.change(descriptionInput, { target: { value: 'New guttering' } });
    fireEvent.click(screen.getByRole('button', { name: /^save quote$/i }));
  }

  it('fires once for a brand-new user\'s first-ever quote', async () => {
    const onSnackbar = vi.fn();
    renderToday([], PROFILE_FREE, { onSnackbar });
    await saveAQuote();

    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'first-quote-celebration',
          message: expect.stringMatching(/first quote's ready/i),
        })
      );
    });
  });

  it('does NOT fire when the trader already has a prior quote', async () => {
    const onSnackbar = vi.fn();
    const priorQuote = { id: 'existing', quoteStatus: 'sent', status: 'lead' };
    renderToday([priorQuote], PROFILE_FREE, { onSnackbar });
    await saveAQuote();

    // The normal "Quote saved as draft" toast still fires (proves the save
    // itself went through) — it's only the celebration that's suppressed.
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Quote saved as draft' })
      );
    });
    expect(onSnackbar).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'first-quote-celebration' })
    );
  });

  it('does NOT fire twice on this device (localStorage flag gate)', async () => {
    const onSnackbar = vi.fn();
    const { unmount } = renderToday([], PROFILE_FREE, { onSnackbar });
    await saveAQuote();
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'first-quote-celebration' })
      );
    });
    onSnackbar.mockClear();
    unmount();

    // Re-mount (simulates navigating away and back) — jobs still empty in
    // this render's props, but the device has already seen the celebration.
    renderToday([], PROFILE_FREE, { onSnackbar });
    await saveAQuote();
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Quote saved as draft' })
      );
    });
    expect(onSnackbar).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'first-quote-celebration' })
    );
  });
});

// ── 4. Bigger voice/mic surface on "Quote it" ─────────────────────────────────

describe('TodayScreen — mic prominence on the Quote it pivot (item 4)', () => {
  it('uses the mic icon (not a generic file icon)', () => {
    renderToday([], PROFILE_FREE);
    const quoteBtn = screen.getByRole('button', { name: /quote it — speak your quote, or type it/i });
    expect(quoteBtn.querySelector('[data-testid="icon-mic"]')).not.toBeNull();
    expect(quoteBtn.querySelector('[data-testid="icon-file"]')).toBeNull();
  });

  it('the primary label text stays short and clear ("Quote it")', () => {
    renderToday([], PROFILE_FREE);
    expect(screen.getByRole('button', { name: /quote it — speak your quote, or type it/i }).textContent).toContain('Quote it');
  });
});

// ── 5. GetProPill renders during an active trial ──────────────────────────────

describe('TodayScreen — GetProPill visibility (item 5)', () => {
  it('renders the pill during an ACTIVE TRIAL (the bug this PR fixes)', () => {
    renderToday([], PROFILE_TRIAL);
    expect(document.querySelector('.get-pro-pill')).not.toBeNull();
  });

  it('renders the pill for a free user', () => {
    renderToday([], PROFILE_FREE);
    expect(document.querySelector('.get-pro-pill')).not.toBeNull();
  });

  it('hides the pill for a truly-paid Pro user', () => {
    renderToday([], PROFILE_PRO);
    expect(document.querySelector('.get-pro-pill')).toBeNull();
  });

  it('settled-trial pill deep-links to Money, not the upgrade sheet', () => {
    const onNavigateToMoney = vi.fn();
    renderToday([], PROFILE_TRIAL, { onNavigateToMoney });
    fireEvent.click(screen.getByRole('button', { name: /Pro trial/i }));
    expect(onNavigateToMoney).toHaveBeenCalledTimes(1);
  });
});
