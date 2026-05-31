/**
 * theme.test.js — unit tests for the theme controller's resolve logic.
 *
 * Runs in node environment (no DOM needed). The controller functions that
 * touch localStorage or matchMedia are tested via the logic paths that
 * the functions take when those APIs are unavailable — which is exactly
 * what happens in Node. We use vi.stubGlobal to inject minimal fakes
 * where we need to exercise specific branches.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  STORAGE_KEY,
  getStoredPref,
  setStoredPref,
  resolveTheme,
} from '../theme.js';

// ── resolveTheme — pure logic, no DOM required ───────────────────────────────

describe('resolveTheme', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('"light" pref always resolves to "light"', () => {
    expect(resolveTheme('light')).toBe('light');
  });

  it('"dark" pref always resolves to "dark"', () => {
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('"system" with OS dark preference resolves to "dark"', () => {
    vi.stubGlobal('window', {
      matchMedia: (query) => ({
        matches: query === '(prefers-color-scheme: dark)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    expect(resolveTheme('system')).toBe('dark');
  });

  it('"system" with OS light preference resolves to "light"', () => {
    vi.stubGlobal('window', {
      matchMedia: (query) => ({
        matches: query === '(prefers-color-scheme: light)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    expect(resolveTheme('system')).toBe('light');
  });

  it('"system" falls back to "dark" when matchMedia throws', () => {
    vi.stubGlobal('window', {
      matchMedia: () => { throw new Error('not supported'); },
    });
    expect(resolveTheme('system')).toBe('dark');
  });

  it('"system" falls back to "dark" when window is undefined (node/SSR)', () => {
    // In a pure Node environment window is not defined — the try/catch in
    // resolveTheme catches the ReferenceError and returns 'dark'.
    expect(resolveTheme('system')).toBe('dark');
  });
});

// ── getStoredPref — localStorage path ────────────────────────────────────────

describe('getStoredPref', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns "dark" when localStorage is unavailable (node)', () => {
    // In Node there is no global localStorage — the function catches the error.
    expect(getStoredPref()).toBe('dark');
  });

  it('returns "dark" when localStorage has no entry', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    expect(getStoredPref()).toBe('dark');
  });

  it('returns "light" when "light" is stored', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'light', setItem: vi.fn() });
    expect(getStoredPref()).toBe('light');
  });

  it('returns "system" when "system" is stored', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'system', setItem: vi.fn() });
    expect(getStoredPref()).toBe('system');
  });

  it('ignores an invalid stored value and falls back to "dark"', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'auto', setItem: vi.fn() });
    expect(getStoredPref()).toBe('dark');
  });
});

// ── setStoredPref ─────────────────────────────────────────────────────────────

describe('setStoredPref', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('writes the preference to localStorage', () => {
    const written = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: (key, val) => { written[key] = val; },
    });
    setStoredPref('light');
    expect(written[STORAGE_KEY]).toBe('light');
  });

  it('does not throw when localStorage is unavailable', () => {
    // No stub — localStorage absent in Node; should be silent.
    expect(() => setStoredPref('dark')).not.toThrow();
  });
});
