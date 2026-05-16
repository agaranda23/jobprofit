import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isPro, canSendInvoice, incrementSendCount } from '../plan.js';

// ──────────────────────────────────────────────────────────────────────────
describe('isPro', () => {
  it('returns true when plan is "pro"', () => {
    expect(isPro({ plan: 'pro' })).toBe(true);
  });

  it('returns false when plan is "free"', () => {
    expect(isPro({ plan: 'free' })).toBe(false);
  });

  it('returns false when plan is absent', () => {
    expect(isPro({})).toBe(false);
  });

  it('returns false for null profile', () => {
    expect(isPro(null)).toBe(false);
  });

  it('returns false for undefined profile', () => {
    expect(isPro(undefined)).toBe(false);
  });

  it('is case-sensitive — "Pro" is not pro', () => {
    expect(isPro({ plan: 'Pro' })).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────
describe('canSendInvoice', () => {
  it('allows send when invoices_sent_count is 0 (first free send)', () => {
    expect(canSendInvoice({ plan: 'free', invoices_sent_count: 0 })).toBe(true);
  });

  it('blocks send when invoices_sent_count is 1 (quota used)', () => {
    expect(canSendInvoice({ plan: 'free', invoices_sent_count: 1 })).toBe(false);
  });

  it('blocks send when invoices_sent_count is > 1', () => {
    expect(canSendInvoice({ plan: 'free', invoices_sent_count: 5 })).toBe(false);
  });

  it('allows send for pro regardless of invoices_sent_count', () => {
    expect(canSendInvoice({ plan: 'pro', invoices_sent_count: 99 })).toBe(true);
  });

  it('allows send for pro with count = 0', () => {
    expect(canSendInvoice({ plan: 'pro', invoices_sent_count: 0 })).toBe(true);
  });

  it('defaults to free (count=0 → allowed) when profile is null', () => {
    // Null profile means unloaded — we give benefit of the doubt for first send.
    expect(canSendInvoice(null)).toBe(true);
  });

  it('defaults to allowed when profile is undefined', () => {
    expect(canSendInvoice(undefined)).toBe(true);
  });

  it('defaults invoices_sent_count to 0 when field is missing (free profile, first send)', () => {
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
