import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isPro, planAllowsPro, canSendInvoice, countInvoicesSentThisMonth, incrementSendCount, UNLOCK_PRO_FOR_ALL, FREE_MONTHLY_INVOICE_LIMIT, isTrialActive, trialDaysLeft } from '../plan.js';

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
// canSendInvoice — 10/month free limit, compute-on-the-fly
// ──────────────────────────────────────────────────────────────────────────
describe('canSendInvoice', () => {
  const NOW = new Date('2026-06-15T10:00:00Z');
  const THIS_MONTH = '2026-06-03T08:00:00Z';
  const PREV_MONTH = '2026-05-31T23:59:59Z';

  function freeProfile() { return { plan: 'free' }; }
  function proProfile()  { return { plan: 'pro' }; }

  function nJobsThisMonth(n) {
    return Array.from({ length: n }, (_, i) => ({
      status: 'invoice_sent',
      invoiceSentAt: `2026-06-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    }));
  }

  it(`allows send when free user has sent 0 invoices this month`, () => {
    expect(canSendInvoice(freeProfile(), [], NOW)).toBe(true);
  });

  it(`allows send when free user has sent ${FREE_MONTHLY_INVOICE_LIMIT - 1} invoices this month`, () => {
    const jobs = nJobsThisMonth(FREE_MONTHLY_INVOICE_LIMIT - 1);
    expect(canSendInvoice(freeProfile(), jobs, NOW)).toBe(true);
  });

  it(`blocks send when free user has sent ${FREE_MONTHLY_INVOICE_LIMIT} invoices this month`, () => {
    const jobs = nJobsThisMonth(FREE_MONTHLY_INVOICE_LIMIT);
    expect(canSendInvoice(freeProfile(), jobs, NOW)).toBe(UNLOCK_PRO_FOR_ALL ? true : false);
  });

  it('does not count previous-month sends against the free quota', () => {
    // 10 sends last month + 0 this month = should still be allowed
    const prevMonthJobs = Array.from({ length: FREE_MONTHLY_INVOICE_LIMIT }, () => ({
      status: 'invoice_sent',
      invoiceSentAt: PREV_MONTH,
    }));
    expect(canSendInvoice(freeProfile(), prevMonthJobs, NOW)).toBe(true);
  });

  it('allows send for Pro user regardless of this-month count', () => {
    const jobs = nJobsThisMonth(FREE_MONTHLY_INVOICE_LIMIT);
    expect(canSendInvoice(proProfile(), jobs, NOW)).toBe(true);
  });

  it('allows send for Pro user with no jobs', () => {
    expect(canSendInvoice(proProfile(), [], NOW)).toBe(true);
  });

  it('defaults to allowed when profile is null (unloaded — benefit of the doubt)', () => {
    expect(canSendInvoice(null, [], NOW)).toBe(true);
  });

  it('defaults to allowed when profile is undefined', () => {
    expect(canSendInvoice(undefined, [], NOW)).toBe(true);
  });

  it('defaults jobs to [] when not provided (backwards-compatible call)', () => {
    expect(canSendInvoice({ plan: 'free' })).toBe(true);
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
// Chase escalation Pro-gating rule
// Rule: tier >= 2 is Pro-only; tier 0 and tier 1 are free.
// This rule is enforced in JobDetailDrawer's handleChase via isPro().
// These tests verify the isPro() predicate behaviour that drives the gate.
// ──────────────────────────────────────────────────────────────────────────
describe('chase escalation Pro-gating — isPro predicate', () => {
  const now = new Date();
  const future = new Date(Date.now() + 5 * 86400000);

  // Helper: given a tier and a profile, should the chase be blocked?
  // Mirrors the guard in handleChase: blocked when tier >= 2 AND !isPro(profile)
  function isChaseEscalationBlocked(tier, profile) {
    if (typeof tier !== 'number' || tier < 2) return false;
    return !isPro(profile, now);
  }

  it('tier-1 chase is NEVER blocked for a free user', () => {
    expect(isChaseEscalationBlocked(1, { plan: 'free' })).toBe(false);
  });

  it('tier-0 (pre-due) chase is NEVER blocked for a free user', () => {
    expect(isChaseEscalationBlocked(0, { plan: 'free' })).toBe(false);
  });

  it('"grace" tier is treated as non-escalation (guard short-circuits before tier check)', () => {
    // 'grace' is not a number, so tier >= 2 is false — never blocked
    expect(isChaseEscalationBlocked('grace', { plan: 'free' })).toBe(false);
  });

  it('tier-2 chase is blocked for a free user (when override is off)', () => {
    expect(isChaseEscalationBlocked(2, { plan: 'free' })).toBe(UNLOCK_PRO_FOR_ALL ? false : true);
  });

  it('tier-3 chase is blocked for a free user (when override is off)', () => {
    expect(isChaseEscalationBlocked(3, { plan: 'free' })).toBe(UNLOCK_PRO_FOR_ALL ? false : true);
  });

  it('tier-2 chase is NOT blocked for a Pro user', () => {
    expect(isChaseEscalationBlocked(2, { plan: 'pro' })).toBe(false);
  });

  it('tier-3 chase is NOT blocked for a Pro user', () => {
    expect(isChaseEscalationBlocked(3, { plan: 'pro' })).toBe(false);
  });

  it('tier-2 chase is NOT blocked for a user on an active trial', () => {
    const profile = { plan: 'trial', trial_ends_at: future.toISOString() };
    // isTrialActive → isPro returns true → not blocked
    if (!UNLOCK_PRO_FOR_ALL) {
      expect(isChaseEscalationBlocked(2, profile)).toBe(false);
    } else {
      expect(isChaseEscalationBlocked(2, profile)).toBe(false); // override also wins
    }
  });

  it('tier-2 chase is blocked for a user with an expired trial (falls back to free)', () => {
    const pastDate = new Date(Date.now() - 86400000);
    const profile = { plan: 'trial', trial_ends_at: pastDate.toISOString() };
    expect(isChaseEscalationBlocked(2, profile)).toBe(UNLOCK_PRO_FOR_ALL ? false : true);
  });
});
