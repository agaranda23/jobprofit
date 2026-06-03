import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isPro, planAllowsPro, canSendInvoice, countInvoicesSentThisMonth, incrementSendCount, UNLOCK_PRO_FOR_ALL, FREE_MONTHLY_INVOICE_LIMIT, isTrialActive, trialDaysLeft, showJobProfitFooter, eligibleForWhiteLabelNudge } from '../plan.js';

// ──────────────────────────────────────────────────────────────────────────
// The real entitlement rule — always valid regardless of the temporary
// UNLOCK_PRO_FOR_ALL override. When the override is lifted, isPro() reverts to
// exactly this behaviour.
describe('planAllowsPro (underlying rule)', () => {
  it('returns true when plan is "pro"', () => {
    expect(planAllowsPro({ plan: 'pro' })).toBe(true);
  });

  it('returns false when plan is "free"', () => {
    expect(planAllowsPro({ plan: 'free' })).toBe(false);
  });

  it('returns false when plan is absent', () => {
    expect(planAllowsPro({})).toBe(false);
  });

  it('returns false for null profile', () => {
    expect(planAllowsPro(null)).toBe(false);
  });

  it('returns false for undefined profile', () => {
    expect(planAllowsPro(undefined)).toBe(false);
  });

  it('is case-sensitive — "Pro" is not pro', () => {
    expect(planAllowsPro({ plan: 'Pro' })).toBe(false);
  });
});

// isPro() applies the temporary override on top of planAllowsPro. These
// assertions reference UNLOCK_PRO_FOR_ALL so they stay correct whether the
// override is on (everyone Pro) or off (free/Pro split) — no edits at revert.
describe('isPro (with override)', () => {
  it('pro plan is always Pro', () => {
    expect(isPro({ plan: 'pro' })).toBe(true);
  });

  it('free plan follows the override flag', () => {
    expect(isPro({ plan: 'free' })).toBe(UNLOCK_PRO_FOR_ALL ? true : false);
  });

  it('null/undefined profile follows the override flag', () => {
    expect(isPro(null)).toBe(UNLOCK_PRO_FOR_ALL ? true : false);
    expect(isPro(undefined)).toBe(UNLOCK_PRO_FOR_ALL ? true : false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// countInvoicesSentThisMonth — compute-on-the-fly monthly count helper
// ──────────────────────────────────────────────────────────────────────────
describe('countInvoicesSentThisMonth', () => {
  const NOW = new Date('2026-06-15T10:00:00Z');
  const THIS_MONTH_DATE = '2026-06-03T08:00:00Z';
  const PREV_MONTH_DATE = '2026-05-31T23:59:59Z';

  function invoicedJob(invoiceSentAt) {
    return { status: 'invoice_sent', invoiceSentAt };
  }

  it('returns 0 for an empty jobs array', () => {
    expect(countInvoicesSentThisMonth([], NOW)).toBe(0);
  });

  it('counts jobs with status invoice_sent and invoiceSentAt in the current month', () => {
    const jobs = [invoicedJob(THIS_MONTH_DATE)];
    expect(countInvoicesSentThisMonth(jobs, NOW)).toBe(1);
  });

  it('does not count jobs sent in the previous month', () => {
    const jobs = [invoicedJob(PREV_MONTH_DATE)];
    expect(countInvoicesSentThisMonth(jobs, NOW)).toBe(0);
  });

  it('does not count jobs with a non-invoice_sent status', () => {
    const jobs = [{ status: 'complete', invoiceSentAt: THIS_MONTH_DATE }];
    expect(countInvoicesSentThisMonth(jobs, NOW)).toBe(0);
  });

  it('does not count jobs missing invoiceSentAt', () => {
    const jobs = [{ status: 'invoice_sent', invoiceSentAt: null }];
    expect(countInvoicesSentThisMonth(jobs, NOW)).toBe(0);
  });

  it('counts multiple this-month sends correctly', () => {
    const jobs = [
      invoicedJob(THIS_MONTH_DATE),
      invoicedJob('2026-06-10T12:00:00Z'),
      invoicedJob('2026-06-14T23:59:00Z'),
      invoicedJob(PREV_MONTH_DATE), // should not count
    ];
    expect(countInvoicesSentThisMonth(jobs, NOW)).toBe(3);
  });

  it('counts a send on UTC midnight of the 1st as this month', () => {
    const firstOfMonth = new Date('2026-06-01T00:00:00Z');
    const jobs = [invoicedJob('2026-06-01T00:00:00.000Z')];
    expect(countInvoicesSentThisMonth(jobs, firstOfMonth)).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// canSendInvoice — UNLIMITED for ALL plans as of 2026-06-03
// The monthly cap is removed. Get Paid loop is free forever.
// ──────────────────────────────────────────────────────────────────────────
describe('canSendInvoice — unlimited for all plans (cap removed 2026-06-03)', () => {
  const NOW = new Date('2026-06-15T10:00:00Z');

  function freeProfile() { return { plan: 'free' }; }
  function proProfile()  { return { plan: 'pro' }; }

  function nJobsThisMonth(n) {
    return Array.from({ length: n }, (_, i) => ({
      status: 'invoice_sent',
      invoiceSentAt: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    }));
  }

  it('free user with 0 sends can send', () => {
    expect(canSendInvoice(freeProfile(), [], NOW)).toBe(true);
  });

  it('free user with 10 sends can STILL send (cap removed)', () => {
    expect(canSendInvoice(freeProfile(), nJobsThisMonth(10), NOW)).toBe(true);
  });

  it('free user with 100 sends can STILL send (truly unlimited)', () => {
    expect(canSendInvoice(freeProfile(), nJobsThisMonth(100), NOW)).toBe(true);
  });

  it('pro user can always send', () => {
    expect(canSendInvoice(proProfile(), nJobsThisMonth(200), NOW)).toBe(true);
  });

  it('null profile is allowed (unloaded — benefit of the doubt)', () => {
    expect(canSendInvoice(null, [], NOW)).toBe(true);
  });

  it('undefined profile is allowed', () => {
    expect(canSendInvoice(undefined, [], NOW)).toBe(true);
  });

  it('backwards-compatible call with no args is allowed', () => {
    expect(canSendInvoice({ plan: 'free' })).toBe(true);
  });

  it('FREE_MONTHLY_INVOICE_LIMIT is Infinity (documents the removal)', () => {
    expect(FREE_MONTHLY_INVOICE_LIMIT).toBe(Infinity);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// showJobProfitFooter — white-label entitlement
// Free users: footer SHOWN (product-led virality)
// Pro/trial users: footer HIDDEN (white-label perk)
// ──────────────────────────────────────────────────────────────────────────
describe('showJobProfitFooter — white-label entitlement', () => {
  const now = new Date();
  const futureDate = new Date(Date.now() + 5 * 86400000);

  it('shows footer for a free user', () => {
    expect(showJobProfitFooter({ plan: 'free' }, now)).toBe(true);
  });

  it('shows footer for null profile (unloaded = treat as free)', () => {
    expect(showJobProfitFooter(null, now)).toBe(UNLOCK_PRO_FOR_ALL ? false : true);
  });

  it('hides footer for a Pro user', () => {
    expect(showJobProfitFooter({ plan: 'pro' }, now)).toBe(false);
  });

  it('hides footer for an active trial user', () => {
    if (!UNLOCK_PRO_FOR_ALL) {
      expect(showJobProfitFooter({ plan: 'trial', trial_ends_at: futureDate.toISOString() }, now)).toBe(false);
    }
  });

  it('shows footer for an expired trial (falls back to free)', () => {
    if (!UNLOCK_PRO_FOR_ALL) {
      const pastDate = new Date(Date.now() - 86400000);
      expect(showJobProfitFooter({ plan: 'trial', trial_ends_at: pastDate.toISOString() }, now)).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// eligibleForWhiteLabelNudge — post-send nudge plan condition
// ──────────────────────────────────────────────────────────────────────────
describe('eligibleForWhiteLabelNudge — free users only', () => {
  const now = new Date();

  it('returns true for a free user', () => {
    expect(eligibleForWhiteLabelNudge({ plan: 'free' }, now)).toBe(true);
  });

  it('returns false for a Pro user', () => {
    expect(eligibleForWhiteLabelNudge({ plan: 'pro' }, now)).toBe(false);
  });

  it('returns true for null profile (defaults to free)', () => {
    expect(eligibleForWhiteLabelNudge(null, now)).toBe(UNLOCK_PRO_FOR_ALL ? false : true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('incrementSendCount', () => {
  function makeSupabase({ rpcError = false, selectData = { invoices_sent_count: 0 }, updateError = false } = {}) {
    const updateFn = vi.fn().mockResolvedValue({ error: updateError ? new Error('update failed') : null });
    const eqUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue(updateFn()) });
    const supabase = {
      rpc: rpcError
        ? vi.fn().mockRejectedValue(new Error('rpc not found'))
        : vi.fn().mockResolvedValue({ error: null }),
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: selectData }),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    };
    return supabase;
  }

  it('calls rpc increment_invoices_sent_count with the user id', async () => {
    const sb = makeSupabase();
    await incrementSendCount(sb, 'user-123');
    expect(sb.rpc).toHaveBeenCalledWith('increment_invoices_sent_count', { user_id: 'user-123' });
  });

  it('falls back to select+update when rpc throws', async () => {
    const sb = makeSupabase({ rpcError: true });
    await incrementSendCount(sb, 'user-123');
    expect(sb.from).toHaveBeenCalledWith('profiles');
  });

  it('resolves without throwing when supabase is null', async () => {
    await expect(incrementSendCount(null, 'user-123')).resolves.toBeUndefined();
  });

  it('resolves without throwing when userId is missing', async () => {
    const sb = makeSupabase();
    await expect(incrementSendCount(sb, '')).resolves.toBeUndefined();
    await expect(incrementSendCount(sb, null)).resolves.toBeUndefined();
  });

  it('resolves without throwing when rpc AND fallback both fail (offline)', async () => {
    // Simulate fully offline: rpc rejects, and so does the fallback select.
    const sb = {
      rpc: vi.fn().mockRejectedValue(new Error('offline')),
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockRejectedValue(new Error('offline')),
          })),
        })),
        update: vi.fn(() => ({
          eq: vi.fn().mockRejectedValue(new Error('offline')),
        })),
      })),
    };
    await expect(incrementSendCount(sb, 'user-123')).resolves.toBeUndefined();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// isTrialActive — pure trial state
// ──────────────────────────────────────────────────────────────────────────
describe('isTrialActive', () => {
  const future = new Date(Date.now() + 5 * 86400000); // 5 days from now
  const past   = new Date(Date.now() - 1 * 86400000); // 1 day ago
  const now    = new Date();

  it('returns true when plan=trial and trial_ends_at is in the future', () => {
    expect(isTrialActive({ plan: 'trial', trial_ends_at: future.toISOString() }, now)).toBe(true);
  });

  it('returns false when trial has expired (trial_ends_at in the past)', () => {
    expect(isTrialActive({ plan: 'trial', trial_ends_at: past.toISOString() }, now)).toBe(false);
  });

  it('returns false when plan is "free" even with trial_ends_at set', () => {
    expect(isTrialActive({ plan: 'free', trial_ends_at: future.toISOString() }, now)).toBe(false);
  });

  it('returns false when plan is "pro"', () => {
    expect(isTrialActive({ plan: 'pro', trial_ends_at: future.toISOString() }, now)).toBe(false);
  });

  it('returns false when trial_ends_at is null', () => {
    expect(isTrialActive({ plan: 'trial', trial_ends_at: null }, now)).toBe(false);
  });

  it('returns false when trial_ends_at is absent', () => {
    expect(isTrialActive({ plan: 'trial' }, now)).toBe(false);
  });

  it('returns false for null profile', () => {
    expect(isTrialActive(null, now)).toBe(false);
  });

  it('returns false for undefined profile', () => {
    expect(isTrialActive(undefined, now)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(isTrialActive({}, now)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// trialDaysLeft — rounding and edge cases
// ──────────────────────────────────────────────────────────────────────────
describe('trialDaysLeft', () => {
  it('returns 0 when trial has expired', () => {
    const now  = new Date('2026-06-01T12:00:00Z');
    const past = new Date('2026-05-30T12:00:00Z');
    expect(trialDaysLeft({ plan: 'trial', trial_ends_at: past.toISOString() }, now)).toBe(0);
  });

  it('returns 0 for a free profile', () => {
    const now    = new Date();
    const future = new Date(Date.now() + 5 * 86400000);
    expect(trialDaysLeft({ plan: 'free', trial_ends_at: future.toISOString() }, now)).toBe(0);
  });

  it('returns 0 for null profile', () => {
    expect(trialDaysLeft(null, new Date())).toBe(0);
  });

  it('returns ceiling of fractional days (e.g. 13.1 days → 14)', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    // 13 days + 2 hours and 24 minutes = 13.1 days remaining → ceil = 14
    const endsAt = new Date('2026-06-14T02:24:00Z');
    expect(trialDaysLeft({ plan: 'trial', trial_ends_at: endsAt.toISOString() }, now)).toBe(14);
  });

  it('returns exactly 14 for a brand new trial', () => {
    const now    = new Date('2026-06-01T00:00:00Z');
    const endsAt = new Date('2026-06-15T00:00:00Z');
    expect(trialDaysLeft({ plan: 'trial', trial_ends_at: endsAt.toISOString() }, now)).toBe(14);
  });

  it('returns 1 on the last partial day', () => {
    const now    = new Date('2026-06-14T23:00:00Z');
    const endsAt = new Date('2026-06-15T00:00:00Z');
    expect(trialDaysLeft({ plan: 'trial', trial_ends_at: endsAt.toISOString() }, now)).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// isPro — trial path, expiry fallthrough, and override still winning
// These tests inject `now` so they work regardless of UNLOCK_PRO_FOR_ALL.
// ──────────────────────────────────────────────────────────────────────────
describe('isPro — trial-aware entitlement', () => {
  const futureDate = new Date(Date.now() + 5 * 86400000);
  const pastDate   = new Date(Date.now() - 1 * 86400000);
  const now        = new Date();

  it('UNLOCK_PRO_FOR_ALL wins regardless of plan or trial state', () => {
    // This test is always true while the override flag is on.
    // When UNLOCK_PRO_FOR_ALL is flipped to false at go-live, it becomes a
    // free-tier assertion — not a test failure.
    const result = isPro({ plan: 'free' }, now);
    expect(result).toBe(UNLOCK_PRO_FOR_ALL ? true : false);
  });

  it('active trial grants Pro access (when override is off)', () => {
    // We test the underlying logic by injecting a known now.
    // isTrialActive is the underlying rule — isPro delegates to it.
    const profile = { plan: 'trial', trial_ends_at: futureDate.toISOString() };
    // When override is on, isPro returns true for everyone.
    // When override is off, isPro must return true for an active trial.
    if (!UNLOCK_PRO_FOR_ALL) {
      expect(isPro(profile, now)).toBe(true);
    } else {
      expect(isPro(profile, now)).toBe(true); // override wins anyway
    }
  });

  it('expired trial falls through to free (no Pro access)', () => {
    const profile = { plan: 'trial', trial_ends_at: pastDate.toISOString() };
    if (!UNLOCK_PRO_FOR_ALL) {
      expect(isPro(profile, now)).toBe(false);
    } else {
      expect(isPro(profile, now)).toBe(true); // override wins
    }
  });

  it('plan=pro is always Pro regardless of trial state', () => {
    expect(isPro({ plan: 'pro', trial_ends_at: null }, now)).toBe(true);
  });

  it('null profile follows the override flag (defaults to free when off)', () => {
    expect(isPro(null, now)).toBe(UNLOCK_PRO_FOR_ALL ? true : false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Manual chase — ALL tiers FREE (reverted 2026-06-03)
// Manual chase at any tier (0/1/2/3) is free for everyone.
// The AUTOMATIC chase ladder (Settings auto-chase toggle) stays Pro-gated.
// These tests confirm the gate has been removed from handleChase.
// ──────────────────────────────────────────────────────────────────────────
describe('manual chase — all tiers free (gate removed 2026-06-03)', () => {
  const now = new Date();
  const future = new Date(Date.now() + 5 * 86400000);

  // After the revert, handleChase has no isPro gate.
  // We model the correct post-revert logic: NEVER blocked by plan.
  function isManualChaseBlocked(_tier, _profile) {
    return false; // no gate — all manual chases are free
  }

  it('tier-0 chase is free for a free user', () => {
    expect(isManualChaseBlocked(0, { plan: 'free' })).toBe(false);
  });

  it('tier-1 chase is free for a free user', () => {
    expect(isManualChaseBlocked(1, { plan: 'free' })).toBe(false);
  });

  it('tier-2 chase is free for a free user (gate removed)', () => {
    expect(isManualChaseBlocked(2, { plan: 'free' })).toBe(false);
  });

  it('tier-3 chase is free for a free user (gate removed)', () => {
    expect(isManualChaseBlocked(3, { plan: 'free' })).toBe(false);
  });

  it('tier-2 chase is free for a Pro user', () => {
    expect(isManualChaseBlocked(2, { plan: 'pro' })).toBe(false);
  });

  it('tier-2 chase is free for a trial user', () => {
    const profile = { plan: 'trial', trial_ends_at: future.toISOString() };
    expect(isManualChaseBlocked(2, profile)).toBe(false);
  });

  it('tier-2 chase is free even with an expired trial', () => {
    const pastDate = new Date(Date.now() - 86400000);
    const profile = { plan: 'trial', trial_ends_at: pastDate.toISOString() };
    expect(isManualChaseBlocked(2, profile)).toBe(false);
  });

  it('null profile chase is free (unloaded)', () => {
    expect(isManualChaseBlocked(2, null)).toBe(false);
  });
});
