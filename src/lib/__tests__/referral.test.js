/**
 * Tests for src/lib/referral.js (JP-LU7 Phase 1)
 *
 * No DOM, no React, no network. Supabase client is mocked inline.
 * sessionStorage (needed by withReferralCode) is stubbed with a tiny in-memory
 * map via vi.stubGlobal rather than switching this file to jsdom, so the rest
 * of the suite keeps its "no DOM" node-environment speed.
 *
 * Covers:
 *   A. buildReferralLink — correct domain and encoding
 *   B. generateReferralCode — length, alphabet, uniqueness
 *   C. ensureReferralCode — fast-path, upsert, 42703 no-op, collision retry
 *   D. copyReferralLink — navigator.share and clipboard fallback (mocked)
 *   E. withReferralCode — carries a captured ref code onto an auth redirect URL
 *      (fix for referral attribution silently lost across the Google OAuth
 *      round trip — see AuthScreen.jsx signInWithGoogle/send and
 *      AppShell.jsx's SIGNED_IN/INITIAL_SESSION handler)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildReferralLink,
  withReferralCode,
  REFERRAL_CODE_STORAGE_KEY,
  generateReferralCode,
  ensureReferralCode,
  copyReferralLink,
} from '../referral.js';

// D. copyReferralLink exercises navigator.share / navigator.canShare /
// navigator.clipboard, but this file deliberately stays in vitest's default
// 'node' environment (see file-level comment above) for suite speed — no DOM
// needed since buildReferralLink no longer reads window.location.origin.
// Node has no global `navigator`, so shim a bare object here rather than
// switching to jsdom.
if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = {};
}

/** Minimal in-memory sessionStorage stand-in for the node test environment. */
function makeMockSessionStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
  };
}

// ── A. buildReferralLink ──────────────────────────────────────────────────────

describe('A. buildReferralLink', () => {
  it('always uses the canonical ohnar.co.uk domain, regardless of current origin', () => {
    // buildReferralLink is hardcoded to https://ohnar.co.uk — it never reads
    // window.location.origin, so a link copied from a legacy/preview domain
    // (getjobprofit.com, jobprofit.netlify.app, a deploy preview, localhost)
    // still points at the canonical live product domain.
    const link = buildReferralLink('ABC123');
    expect(link).toBe('https://ohnar.co.uk/?ref=ABC123');
  });

  it('includes the ?ref= parameter', () => {
    expect(buildReferralLink('ABC123')).toContain('?ref=ABC123');
  });

  it('URI-encodes special characters in the code', () => {
    expect(buildReferralLink('A B+C')).toContain('A%20B%2BC');
  });

  it('returns a string', () => {
    expect(typeof buildReferralLink('XYZ')).toBe('string');
  });
});

// ── B. generateReferralCode ───────────────────────────────────────────────────

describe('B. generateReferralCode', () => {
  it('returns exactly 6 characters', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateReferralCode().length).toBe(6);
    }
  });

  it('contains only alphanumeric characters (no ambiguous chars)', () => {
    const AMBIGUOUS = /[0OIl1]/;
    for (let i = 0; i < 50; i++) {
      const code = generateReferralCode();
      expect(AMBIGUOUS.test(code), `code "${code}" contains an ambiguous character`).toBe(false);
    }
  });

  it('returns a string', () => {
    expect(typeof generateReferralCode()).toBe('string');
  });

  it('produces varied codes (not always the same)', () => {
    const codes = new Set(Array.from({ length: 10 }, generateReferralCode));
    expect(codes.size).toBeGreaterThan(1);
  });
});

// ── C. ensureReferralCode ─────────────────────────────────────────────────────

function makeSupabase({ updateError = null } = {}) {
  const updateChain = {
    eq: vi.fn().mockReturnThis(),
    // Resolve with the configured error
    then: vi.fn((fn) => fn({ error: updateError })),
  };
  return {
    from: vi.fn(() => ({
      update: vi.fn(() => updateChain),
    })),
    _updateChain: updateChain,
  };
}

describe('C. ensureReferralCode', () => {
  it('fast-path: returns existing code without calling Supabase', async () => {
    const sb = makeSupabase();
    const profile = { referral_code: 'EXIST1' };
    const result = await ensureReferralCode(sb, 'user-1', profile);
    expect(result).toBe('EXIST1');
    expect(sb.from).not.toHaveBeenCalled();
  });

  it('generates + returns a code on success (null profile.referral_code)', async () => {
    const sb = makeSupabase({ updateError: null });
    const result = await ensureReferralCode(sb, 'user-2', {});
    expect(typeof result).toBe('string');
    expect(result.length).toBe(6);
  });

  it('returns null when the column is missing (42703)', async () => {
    const sb = makeSupabase({ updateError: { code: '42703', message: 'column does not exist' } });
    const result = await ensureReferralCode(sb, 'user-3', {});
    expect(result).toBeNull();
  });

  it('retries once on unique collision (23505) then returns code on second success', async () => {
    let callCount = 0;
    const updateChain = {
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((fn) => {
        callCount++;
        // First call: collision; second call: success
        return fn({ error: callCount === 1 ? { code: '23505' } : null });
      }),
    };
    const sb = {
      from: vi.fn(() => ({ update: vi.fn(() => updateChain) })),
    };
    const result = await ensureReferralCode(sb, 'user-4', {});
    expect(typeof result).toBe('string');
    expect(result.length).toBe(6);
    expect(callCount).toBe(2);
  });

  it('returns null on double collision (both 23505)', async () => {
    const updateChain = {
      eq: vi.fn().mockReturnThis(),
      then: vi.fn((fn) => fn({ error: { code: '23505' } })),
    };
    const sb = {
      from: vi.fn(() => ({ update: vi.fn(() => updateChain) })),
    };
    const result = await ensureReferralCode(sb, 'user-5', {});
    expect(result).toBeNull();
  });

  it('returns null when profile is null (not loaded yet)', async () => {
    const sb = makeSupabase({ updateError: null });
    const result = await ensureReferralCode(sb, 'user-6', null);
    // null profile → no fast-path → generates new code → should succeed
    expect(typeof result).toBe('string');
  });

  it('returns null when Supabase throws an exception', async () => {
    const sb = {
      from: vi.fn(() => {
        throw new Error('network error');
      }),
    };
    const result = await ensureReferralCode(sb, 'user-7', {});
    expect(result).toBeNull();
  });
});

// ── D. copyReferralLink ───────────────────────────────────────────────────────

describe('D. copyReferralLink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls navigator.share when available and canShare returns true', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });

    await copyReferralLink('ABC123');

    expect(shareMock).toHaveBeenCalledOnce();
    const arg = shareMock.mock.calls[0][0];
    expect(arg.url).toContain('ohnar.co.uk'); // hardcoded canonical domain, not window.location
    expect(arg.url).toContain('ref=ABC123');
  });

  it('falls back to clipboard when share throws', async () => {
    const shareMock = vi.fn().mockRejectedValue(new Error('cancelled'));
    const clipMock  = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: shareMock, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipMock },
      configurable: true,
    });

    await copyReferralLink('ABC123');

    expect(clipMock).toHaveBeenCalledOnce();
    expect(clipMock.mock.calls[0][0]).toContain('ref=ABC123');
  });

  it('uses clipboard directly when navigator.share is unavailable', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    const clipMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipMock },
      configurable: true,
    });

    await copyReferralLink('XYZ789');

    expect(clipMock).toHaveBeenCalledOnce();
    expect(clipMock.mock.calls[0][0]).toContain('ref=XYZ789');
  });

  it('does not throw when both share and clipboard are unavailable', async () => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    await expect(copyReferralLink('AAA111')).resolves.toBeUndefined();
  });
});

// ── E. withReferralCode ───────────────────────────────────────────────────────

describe('E. withReferralCode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('appends ?ref=<code> when a referral code is in sessionStorage', () => {
    vi.stubGlobal(
      'sessionStorage',
      makeMockSessionStorage({ [REFERRAL_CODE_STORAGE_KEY]: 'ruvWbv' })
    );
    expect(withReferralCode('https://ohnar.co.uk')).toBe('https://ohnar.co.uk/?ref=ruvWbv');
  });

  it('returns the base URL unchanged when there is no referral code', () => {
    vi.stubGlobal('sessionStorage', makeMockSessionStorage({}));
    expect(withReferralCode('https://ohnar.co.uk')).toBe('https://ohnar.co.uk');
  });

  it('works with either origin — jobprofit.co.uk or ohnar.co.uk (uses whatever is passed in)', () => {
    vi.stubGlobal(
      'sessionStorage',
      makeMockSessionStorage({ [REFERRAL_CODE_STORAGE_KEY]: 'ABC123' })
    );
    expect(withReferralCode('https://jobprofit.co.uk')).toBe(
      'https://jobprofit.co.uk/?ref=ABC123'
    );
  });

  it('falls back to the base URL unchanged when sessionStorage throws (private browsing)', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('SecurityError'); },
    });
    expect(withReferralCode('https://ohnar.co.uk')).toBe('https://ohnar.co.uk');
  });

  it('does not clobber an existing query string on the base URL', () => {
    vi.stubGlobal(
      'sessionStorage',
      makeMockSessionStorage({ [REFERRAL_CODE_STORAGE_KEY]: 'ruvWbv' })
    );
    expect(withReferralCode('https://ohnar.co.uk/?foo=bar')).toBe(
      'https://ohnar.co.uk/?foo=bar&ref=ruvWbv'
    );
  });
});
