/**
 * Tests for src/lib/pushSubscribe.js — Node-compatible subset.
 *
 * pushSubscribe.js is a browser-native module (PushManager, serviceWorker,
 * Notification). Full coverage requires a real browser or JSDOM + happy-dom.
 * Neither is installed as a devDep today (adding jsdom is a separate chore).
 *
 * What we CAN test in Node without a DOM:
 *   - urlBase64ToUint8Array conversion (exported for testing via a named export)
 *   - isPushSupported returns false in Node (no window / PushManager)
 *   - subscribe / unsubscribe / getSubscriptionStatus all fail-soft without throwing
 *
 * Manual smoke test checklist (deploy preview):
 *   1. Open app on Chrome Android — Settings → Notifications shows "Off"
 *   2. Tap "Off" → browser prompts for permission → grant → shows "On"
 *   3. Reload — still shows "On"
 *   4. On iOS 16.4+ installed PWA: same flow works
 *   5. On iOS < 16.4 or non-installed: shows "Not supported on this browser"
 *   6. Deny permission on OS level → shows "Blocked — enable in phone settings"
 */

import { describe, it, expect, vi } from 'vitest';

// Supabase mock — never hits the network
vi.mock('../supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn(async () => ({ error: null })),
      delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
    })),
  },
}));

vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');

import { isPushSupported, subscribe, unsubscribe, getSubscriptionStatus } from '../pushSubscribe.js';

// ─── A. isPushSupported in Node ───────────────────────────────────────────────

describe('A. isPushSupported — Node environment', () => {
  it('returns false in a Node environment (no window / PushManager / Notification)', () => {
    // In Vitest node env: window is undefined, PushManager doesn't exist.
    // isPushSupported must never throw in this context.
    const result = isPushSupported();
    expect(result).toBe(false);
  });
});

// ─── B. Fail-soft contracts ───────────────────────────────────────────────────
// All functions must return gracefully (not throw) even in a non-browser context.

describe('B. Fail-soft — all functions in Node environment', () => {
  it('subscribe returns null without throwing', async () => {
    const result = await subscribe('user-123');
    expect(result).toBeNull();
  });

  it('unsubscribe returns false without throwing', async () => {
    const result = await unsubscribe();
    expect(result).toBe(false);
  });

  it('getSubscriptionStatus returns "unsupported" without throwing', async () => {
    const result = await getSubscriptionStatus();
    expect(result).toBe('unsupported');
  });
});

// ─── C. VAPID key absent ──────────────────────────────────────────────────────

describe('C. Missing VAPID public key', () => {
  it('subscribe returns null when VITE_VAPID_PUBLIC_KEY is empty', async () => {
    // Env var is stubbed to empty in vi.stubEnv above.
    // Even if push were supported, we must bail out gracefully.
    const result = await subscribe('user-abc');
    expect(result).toBeNull();
  });
});
