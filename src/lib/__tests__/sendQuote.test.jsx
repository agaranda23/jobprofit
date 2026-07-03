// @vitest-environment jsdom
/**
 * sendQuote — unit + parity tests for the shared "send a quote via WhatsApp"
 * helper extracted from ReviewSheet.jsx (src/lib/sendQuote.js).
 *
 * These tests IMPORT and CALL the real exported sendQuote() / needsBankGate()
 * — nothing here re-implements the send logic. That matters because a naive
 * extraction test could re-derive the same branching inline and pass even if
 * the real extraction were broken; every assertion below drives the actual
 * function.
 *
 * Covers:
 *   - token persist call args (jobId + meta)
 *   - offline abort (no onUpdate/onClose, correct flash message)
 *   - bank-gate trigger (and non-trigger when bank details / online deposit present)
 *   - deposit_amount_pence clamping to the current job total
 *   - PARITY: sendQuote() called directly vs. driven through ReviewSheet's
 *     quote-send button, on the SAME fixture, produce identical
 *     persistPublicToken call args and an identical WhatsApp message string —
 *     this is the test that actually catches a bad extraction.
 *   - OFFLINE DOUBLE-TOKEN GUARD: two sequential offline-failed sends then one
 *     online send mint/persist exactly ONE token across all three attempts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { sendQuote, needsBankGate } from '../sendQuote.js';

// ── Mock network / browser-API modules ───────────────────────────────────────
// Same convention as reviewSheetEditButton.test.jsx — network/browser-API
// modules are mocked; pure logic (quoteMessage, invoiceMessage, jobMeta,
// cashflow, plan, jobStatus, bankDetails) is left REAL so the parity test can
// compare genuine output.

vi.mock('../supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
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

// store.js is mocked at the boundary sendQuote.js actually calls — this is a
// dependency stub (network/offline-queue plumbing), not the logic under test.
// reissuePublicToken is re-implemented here matching the REAL store.js
// semantics exactly (mint a token when none is set or the link was revoked;
// otherwise reuse the existing one) so the offline-retry guard inside
// sendQuote.js is exercised faithfully.
const persistPublicToken = vi.fn();
vi.mock('../store.js', () => ({
  persistPublicToken: (...args) => persistPublicToken(...args),
  reissuePublicToken: (job) => {
    const wasRevoked = !!job?.publicTokenRevokedAt;
    if (wasRevoked || !job?.publicAccessToken) {
      return { token: crypto.randomUUID(), wasRevoked };
    }
    return { token: job.publicAccessToken, wasRevoked: false };
  },
}));

vi.mock('../telemetry.js', () => ({
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

// DocumentPreview (rendered inside ReviewSheet, used by the parity test below)
// mounts ProUpgradeSheet for the footer's "Remove →" chip — mock billing so
// that mount is inert (ProUpgradeSheet imports startCheckout/startCheckoutWithCoupon).
vi.mock('../billing.js', () => ({
  startCheckout: vi.fn().mockResolvedValue({ error: null }),
  startCheckoutWithCoupon: vi.fn().mockResolvedValue({ error: null }),
  openBillingPortal: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock('../invoicePDF.js', () => ({
  downloadInvoicePDF: vi.fn().mockResolvedValue(null),
  getInvoicePDFBlob: vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' })),
  downloadQuotePDF: vi.fn().mockResolvedValue(null),
  getQuotePDFBlob: vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' })),
}));

vi.mock('../webShare.js', () => ({
  // Forces the web_share_files branch deterministically for every test in
  // this file — the point is to compare the resulting share `text`, not to
  // re-test the canShareFile gate itself (that's reviewSheetSendPaths.test.js).
  canShareFile: () => true,
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,abc') },
}));

// ReviewSheet is only needed for the parity test, imported after the mocks
// above so it picks up the same mocked modules (module identity, not import
// specifier, is what vi.mock intercepts).
import ReviewSheet from '../../components/ReviewSheet.jsx';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return {
    id: 'job-1',
    customer: 'Sarah Jones',
    phone: '07700 900123',
    amount: 500,
    total: 500,
    summary: 'Kitchen taps',
    status: 'lead',
    quoteStatus: 'draft',
    lineItems: [{ desc: 'Labour', cost: 500 }],
    ...overrides,
  };
}

const BIZ = { name: 'Test Plumbing Ltd' };
const PROFILE_FREE = { plan: 'free' };

let shareSpy;

beforeEach(() => {
  localStorage.clear();
  persistPublicToken.mockReset();
  shareSpy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'share', { value: shareSpy, configurable: true, writable: true });
  Object.defineProperty(navigator, 'canShare', { value: vi.fn().mockReturnValue(true), configurable: true, writable: true });
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ── needsBankGate ──────────────────────────────────────────────────────────────

describe('needsBankGate', () => {
  it('is false when no deposit is requested', () => {
    expect(needsBankGate({ profile: PROFILE_FREE, depositPercent: 0 })).toBe(false);
  });

  it('is true when a deposit is requested and no bank details / Pro+Stripe are on file', () => {
    expect(needsBankGate({ profile: PROFILE_FREE, depositPercent: 25 })).toBe(true);
  });

  it('is false when bank details are on file', () => {
    const profile = { plan: 'free', sort_code: '12-34-56', account_number: '12345678' };
    expect(needsBankGate({ profile, depositPercent: 25 })).toBe(false);
  });

  it('is false when Pro + Stripe-connected (online deposit available)', () => {
    const profile = { plan: 'pro', stripe_connect_status: 'connected', stripe_user_id: 'acct_123' };
    expect(needsBankGate({ profile, depositPercent: 25 })).toBe(false);
  });
});

// ── sendQuote — token persist ────────────────────────────────────────────────

describe('sendQuote — token persist', () => {
  it('persists via persistPublicToken with the job id and the token in the meta payload', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: true });
    const onUpdate = vi.fn();
    const job = makeJob({ id: 'job-persist-1', publicAccessToken: 'tok-persist-1' });

    const result = await sendQuote(job, { biz: BIZ, profile: PROFILE_FREE, depositPercent: 0, onUpdate, flash: vi.fn() });

    expect(result.ok).toBe(true);
    expect(persistPublicToken).toHaveBeenCalledTimes(1);
    const [calledJobId, calledMeta] = persistPublicToken.mock.calls[0];
    expect(calledJobId).toBe('job-persist-1');
    expect(calledMeta.publicAccessToken).toBe('tok-persist-1');
    expect(calledMeta.quoteStatus).toBe('sent');
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      publicAccessToken: 'tok-persist-1',
      quoteStatus: 'sent',
    }));
  });
});

// ── sendQuote — offline abort ────────────────────────────────────────────────

describe('sendQuote — offline abort', () => {
  it('aborts without closing or updating, and flashes an offline message', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: false, offline: true });
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    const flash = vi.fn();
    const job = makeJob({ id: 'job-offline-abort-1' });

    const result = await sendQuote(job, { biz: BIZ, profile: PROFILE_FREE, onUpdate, onClose, flash });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('offline');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('No connection'));
    expect(shareSpy).not.toHaveBeenCalled();
  });

  it('aborts with a generic error message on a non-offline persist failure', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: false });
    const flash = vi.fn();
    const job = makeJob({ id: 'job-persist-fail-1' });

    const result = await sendQuote(job, { biz: BIZ, profile: PROFILE_FREE, flash });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('persist-failed');
    expect(flash).toHaveBeenCalledWith(expect.stringContaining('Could not save quote link'));
  });
});

// ── sendQuote — bank-gate trigger ────────────────────────────────────────────

describe('sendQuote — bank-gate trigger', () => {
  it('returns a bank-gate result and never calls persistPublicToken', async () => {
    const job = makeJob({ id: 'job-bank-gate-1' });
    const result = await sendQuote(job, { biz: BIZ, profile: PROFILE_FREE, depositPercent: 25 });

    expect(result).toEqual({ ok: false, reason: 'bank-gate' });
    expect(persistPublicToken).not.toHaveBeenCalled();
  });

  it('proceeds normally once bank details are on file', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: true });
    const job = makeJob({ id: 'job-bank-ok-1' });
    const profile = { plan: 'free', sort_code: '12-34-56', account_number: '12345678' };

    const result = await sendQuote(job, { biz: BIZ, profile, depositPercent: 25 });
    expect(result.ok).toBe(true);
  });
});

// ── sendQuote — deposit clamp ────────────────────────────────────────────────

describe('sendQuote — deposit_amount_pence clamp', () => {
  // Bank details on file so these tests exercise the clamp math rather than
  // tripping the bank-gate (covered separately above).
  const PROFILE_WITH_BANK = { plan: 'free', sort_code: '12-34-56', account_number: '12345678' };

  it('computes deposit_amount_pence from the CURRENT total, ignoring a stale prior value', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: true });
    const onUpdate = vi.fn();
    const job = makeJob({ id: 'job-clamp-1', total: 100, amount: 100, deposit_amount_pence: 999999 });

    await sendQuote(job, { biz: BIZ, profile: PROFILE_WITH_BANK, depositPercent: 50, onUpdate });

    const updatedJob = onUpdate.mock.calls[0][0];
    expect(updatedJob.deposit_amount_pence).toBe(5000); // 50% of £100 = £50 = 5000p
  });

  it('never exceeds the job total in pence even at a 100% deposit', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: true });
    const onUpdate = vi.fn();
    const job = makeJob({ id: 'job-clamp-2', total: 100, amount: 100 });

    await sendQuote(job, { biz: BIZ, profile: PROFILE_WITH_BANK, depositPercent: 100, onUpdate });

    const updatedJob = onUpdate.mock.calls[0][0];
    expect(updatedJob.deposit_amount_pence).toBe(10000);
  });

  it('sets deposit_amount_pence to null when depositPercent is 0', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: true });
    const onUpdate = vi.fn();
    const job = makeJob({ id: 'job-clamp-3', total: 100, amount: 100, deposit_percent: 25, deposit_amount_pence: 2500 });

    await sendQuote(job, { biz: BIZ, profile: PROFILE_FREE, depositPercent: 0, onUpdate });

    const updatedJob = onUpdate.mock.calls[0][0];
    expect(updatedJob.deposit_percent).toBe(0);
    expect(updatedJob.deposit_amount_pence).toBeNull();
  });
});

// ── sendQuote — depositDue → job.deposit_due_date ────────────────────────────
// The voice-quote confirm card (AddJobModal) threads depositDue through as an
// opt, not part of the job payload — sendQuote must be the one to land it on
// updatedJob so extractJobMeta/writeJobMeta (jobMeta.js META_FIELDS) can
// persist it.

describe('sendQuote — depositDue threads onto updatedJob.deposit_due_date', () => {
  const PROFILE_WITH_BANK = { plan: 'free', sort_code: '12-34-56', account_number: '12345678' };

  it('sets deposit_due_date on updatedJob when depositDue is provided', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: true });
    const onUpdate = vi.fn();
    const job = makeJob({ id: 'job-due-1' });

    await sendQuote(job, {
      biz: BIZ, profile: PROFILE_WITH_BANK, depositPercent: 25, depositDue: '2026-07-11', onUpdate,
    });

    const updatedJob = onUpdate.mock.calls[0][0];
    expect(updatedJob.deposit_due_date).toBe('2026-07-11');
  });

  it('omits deposit_due_date when depositDue is not provided', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: true });
    const onUpdate = vi.fn();
    const job = makeJob({ id: 'job-due-2' });

    await sendQuote(job, { biz: BIZ, profile: PROFILE_FREE, depositPercent: 0, onUpdate });

    const updatedJob = onUpdate.mock.calls[0][0];
    expect('deposit_due_date' in updatedJob).toBe(false);
  });

  it('the persisted meta payload carries deposit_due_date (survives extractJobMeta)', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: true });
    const job = makeJob({ id: 'job-due-3' });

    await sendQuote(job, {
      biz: BIZ, profile: PROFILE_WITH_BANK, depositPercent: 25, depositDue: '2026-07-11',
    });

    const [, calledMeta] = persistPublicToken.mock.calls[0];
    expect(calledMeta.deposit_due_date).toBe('2026-07-11');
  });
});

// ── sendQuote — biz.vatRegistered fallback to profile.vat_registered ────────
// AddJobModal's voice-confirm send passes a minimal biz ({ name }) and relies
// on `profile` for VAT status — the WhatsApp message builder only sees `biz`,
// so sendQuote must merge profile.vat_registered into bizWithBank or the
// quote message's VAT line can never fire on that path.

describe('sendQuote — VAT registration reaches the WhatsApp message via profile fallback', () => {
  it('shows "(inc VAT)" in the shared WhatsApp text when profile.vat_registered is true and biz omits it', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: true });
    const job = makeJob({ id: 'job-vat-1', total: 500, amount: 500 });
    const minimalBiz = { name: 'Voice Confirm Trader' }; // no vatRegistered field at all
    const profile = { plan: 'free', vat_registered: true };

    await sendQuote(job, { biz: minimalBiz, profile, depositPercent: 0 });

    const shareText = shareSpy.mock.calls.at(-1)?.[0]?.text;
    expect(shareText).toContain('(inc VAT)');
  });

  it('omits "(inc VAT)" when profile.vat_registered is false', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: true });
    const job = makeJob({ id: 'job-vat-2', total: 500, amount: 500 });
    const minimalBiz = { name: 'Voice Confirm Trader' };
    const profile = { plan: 'free', vat_registered: false };

    await sendQuote(job, { biz: minimalBiz, profile, depositPercent: 0 });

    const shareText = shareSpy.mock.calls.at(-1)?.[0]?.text;
    expect(shareText).not.toContain('VAT');
  });
});

// ── PARITY CONTRACT ───────────────────────────────────────────────────────────
// Drives sendQuote() directly AND drives ReviewSheet's quote-send button on
// the SAME fixture, then asserts both produce identical persistPublicToken
// call args and an identical WhatsApp message string. This is the test that
// actually catches a bad extraction — reviewSheetSendPaths.test.js does NOT
// call the real handler, so it would pass even if the extraction diverged.

describe('PARITY — sendQuote() direct call vs. ReviewSheet quote-send button', () => {
  it('produce identical persistPublicToken args and identical WhatsApp message text', async () => {
    // Only fake Date (for byte-identical quoteSentAt timestamps across both
    // paths) — leaving setTimeout/setInterval real so @testing-library's
    // waitFor (which polls on a real timer) doesn't hang waiting for fake
    // time to advance.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-01T12:00:00.000Z'));

    try {
      const job = makeJob({ id: 'job-parity-shared', publicAccessToken: 'tok-parity-shared' });
      const biz = { name: 'Parity Plumbing' };
      const profile = { plan: 'free' };

      // ── Path A: sendQuote() called directly ──────────────────────────────
      persistPublicToken.mockResolvedValueOnce({ ok: true });
      const directOnUpdate = vi.fn();
      const directResult = await sendQuote(job, {
        biz, profile, depositPercent: 0, receipts: [], onUpdate: directOnUpdate, flash: vi.fn(),
      });
      expect(directResult.ok).toBe(true);

      const directPersistArgs = persistPublicToken.mock.calls.at(-1);
      const directShareText = shareSpy.mock.calls.at(-1)?.[0]?.text;
      expect(directShareText).toBeTruthy();

      // ── Path B: ReviewSheet's quote-send button (Jobs-tab / non-voice path) ──
      persistPublicToken.mockResolvedValueOnce({ ok: true });
      const reviewOnUpdate = vi.fn();
      render(
        <ReviewSheet
          mode="quote"
          job={job}
          biz={biz}
          profile={profile}
          jobs={[job]}
          receipts={[]}
          onClose={() => {}}
          onDismiss={() => {}}
          onUpdate={reviewOnUpdate}
          flash={() => {}}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /send via whatsapp/i }));

      await waitFor(() => expect(persistPublicToken).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(reviewOnUpdate).toHaveBeenCalled());

      const reviewPersistArgs = persistPublicToken.mock.calls.at(-1);
      const reviewShareText = shareSpy.mock.calls.at(-1)?.[0]?.text;

      // Same job id, byte-identical meta payload (token, quoteStatus,
      // quoteSentAt (time frozen), deposit fields, etc.)
      expect(reviewPersistArgs[0]).toBe(directPersistArgs[0]);
      expect(reviewPersistArgs[1]).toEqual(directPersistArgs[1]);

      // Byte-identical WhatsApp message text
      expect(reviewShareText).toBe(directShareText);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── OFFLINE DOUBLE-TOKEN GUARD ────────────────────────────────────────────────
// Guards against: a failed offline send minting a NEW token on retry (because
// onUpdate never fires on a failed attempt, so the in-memory job still looks
// tokenless) — which would leave two different token writes racing in the
// offline queue and can 404 a link the trader already shared after reconnect.

describe('OFFLINE DOUBLE-TOKEN GUARD', () => {
  it('two sequential offline-failed sends then one online send mint/persist exactly ONE token', async () => {
    const job = makeJob({ id: 'job-offline-guard-1', publicAccessToken: undefined });

    persistPublicToken
      .mockResolvedValueOnce({ ok: false, offline: true })
      .mockResolvedValueOnce({ ok: false, offline: true })
      .mockResolvedValueOnce({ ok: true });

    const flash = vi.fn();
    const onUpdate = vi.fn();

    const r1 = await sendQuote(job, { biz: BIZ, profile: PROFILE_FREE, onUpdate, flash });
    expect(r1.ok).toBe(false);
    expect(r1.reason).toBe('offline');

    const r2 = await sendQuote(job, { biz: BIZ, profile: PROFILE_FREE, onUpdate, flash });
    expect(r2.ok).toBe(false);
    expect(r2.reason).toBe('offline');

    const r3 = await sendQuote(job, { biz: BIZ, profile: PROFILE_FREE, onUpdate, flash });
    expect(r3.ok).toBe(true);

    expect(persistPublicToken).toHaveBeenCalledTimes(3);
    const tokenAttempt1 = persistPublicToken.mock.calls[0][1].publicAccessToken;
    const tokenAttempt2 = persistPublicToken.mock.calls[1][1].publicAccessToken;
    const tokenAttempt3 = persistPublicToken.mock.calls[2][1].publicAccessToken;

    expect(tokenAttempt1).toBeTruthy();
    // Every retry carries the SAME token — no second mint on the offline retries.
    expect(tokenAttempt2).toBe(tokenAttempt1);
    expect(tokenAttempt3).toBe(tokenAttempt1);

    // The link the trader would already have on-screen resolves to the token
    // that actually landed in the cloud on the successful attempt.
    expect(r3.updatedJob.publicAccessToken).toBe(tokenAttempt1);
  });

  it('a fresh job (never attempted) still mints a token normally on first send', async () => {
    persistPublicToken.mockResolvedValueOnce({ ok: true });
    const job = makeJob({ id: 'job-offline-guard-fresh', publicAccessToken: undefined });
    const onUpdate = vi.fn();

    const result = await sendQuote(job, { biz: BIZ, profile: PROFILE_FREE, onUpdate });

    expect(result.ok).toBe(true);
    expect(result.updatedJob.publicAccessToken).toBeTruthy();
  });
});
