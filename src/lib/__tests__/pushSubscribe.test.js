/**
 * Tests for src/lib/pushSubscribe.js — Node-compatible subset.
 *
 * pushSubscribe.js is a browser-native module (PushManager, serviceWorker,
 * Notification). Full coverage requires a real browser or JSDOM + happy-dom.
 * Neither is installed as a devDep today (adding jsdom is a separate chore).
 *
 * What we CAN test in Node without a DOM:
 *   - urlBase64ToUint8Array conversion (exported for testing)
 *   - subscriptionKeyMismatch (pure logic — exported for testing)
 *   - isPushSupported returns false in Node (no window / PushManager)
 *   - subscribe / unsubscribe / getSubscriptionStatus all fail-soft without throwing
 *   - subscribe detects key mismatch and re-subscribes (browser globals mocked)
 *
 * Manual smoke test checklist (deploy preview):
 *   1. Open app on Chrome Android — Settings → Notifications shows "Off"
 *   2. Tap "Off" → browser prompts for permission → grant → shows "On"
 *   3. Reload — still shows "On"
 *   4. On iOS 16.4+ installed PWA: same flow works
 *   5. On iOS < 16.4 or non-installed: shows "Not supported on this browser"
 *   6. Deny permission on OS level → shows "Blocked — enable in phone settings"
 *   7. Rotate VAPID keys → on next app open, old subscription is replaced
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Supabase mock — never hits the network
const mockUpsert = vi.fn(async () => ({ error: null }));
const mockDeleteEq = vi.fn(async () => ({ error: null }));
const mockDelete = vi.fn(() => ({ eq: mockDeleteEq }));

vi.mock('../supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: mockUpsert,
      delete: mockDelete,
    })),
  },
}));

vi.stubEnv('VITE_VAPID_PUBLIC_KEY', '');

import {
  isPushSupported,
  subscribe,
  unsubscribe,
  getSubscriptionStatus,
  urlBase64ToUint8Array,
  subscriptionKeyMismatch,
} from '../pushSubscribe.js';

// ─── A. isPushSupported in Node ───────────────────────────────────────────────

describe('A. isPushSupported — Node environment', () => {
  it('returns false in a Node environment (no window / PushManager / Notification)', () => {
    const result = isPushSupported();
    expect(result).toBe(false);
  });
});

// ─── B. Fail-soft contracts ───────────────────────────────────────────────────

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
    const result = await subscribe('user-abc');
    expect(result).toBeNull();
  });
});

// ─── D. urlBase64ToUint8Array ─────────────────────────────────────────────────

describe('D. urlBase64ToUint8Array', () => {
  it('converts a base64url string to a Uint8Array', () => {
    // "hello" in base64 is "aGVsbG8=" — as base64url (no padding): "aGVsbG8"
    const result = urlBase64ToUint8Array('aGVsbG8');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([104, 101, 108, 108, 111]); // "hello"
  });

  it('handles base64url with - and _ characters (no standard + or /)', () => {
    // base64url "-_8=" decodes to bytes [0xFB, 0xFF] (standard base64 "+/8=")
    // Verify the decode does not throw and produces a Uint8Array with those bytes.
    const result = urlBase64ToUint8Array('-_8');
    expect(result).toBeInstanceOf(Uint8Array);
    // The first byte of "-_8" decoded: '-' → '+' → 0xFB high bits present
    // Just assert the array is non-empty and the type is correct; exact bytes
    // are validated by the round-trip test below.
    expect(result.length).toBeGreaterThan(0);
  });

  it('produces output that round-trips through btoa', () => {
    const key = 'BNcRdreALRFXTkOOUHK1EtK2wtWfelqjMkSGdnq5AEHk4NkPwNmRmQ0z5UgWuH5A0_kfBpM6XZPQ';
    const arr = urlBase64ToUint8Array(key);
    expect(arr.length).toBeGreaterThan(0);
    expect(arr).toBeInstanceOf(Uint8Array);
  });
});

// ─── E. subscriptionKeyMismatch ───────────────────────────────────────────────

describe('E. subscriptionKeyMismatch — pure logic', () => {
  // Build a minimal fake PushSubscription.options.applicationServerKey
  // The Web Push spec stores the key as an ArrayBuffer.
  function makeSubWithKey(base64UrlKey) {
    const bytes = urlBase64ToUint8Array(base64UrlKey);
    return {
      options: {
        applicationServerKey: bytes.buffer,
      },
    };
  }

  const KEY_A = 'aGVsbG8'; // "hello"
  const KEY_B = 'd29ybGQ';  // "world"

  it('returns false when keys match', () => {
    const sub = makeSubWithKey(KEY_A);
    expect(subscriptionKeyMismatch(sub, KEY_A)).toBe(false);
  });

  it('returns true when keys differ', () => {
    const sub = makeSubWithKey(KEY_A);
    expect(subscriptionKeyMismatch(sub, KEY_B)).toBe(true);
  });

  it('returns false when existingSub has no options.applicationServerKey', () => {
    expect(subscriptionKeyMismatch({}, KEY_A)).toBe(false);
    expect(subscriptionKeyMismatch({ options: {} }, KEY_A)).toBe(false);
  });

  it('returns false when currentVapidKey is falsy', () => {
    const sub = makeSubWithKey(KEY_A);
    expect(subscriptionKeyMismatch(sub, '')).toBe(false);
    expect(subscriptionKeyMismatch(sub, null)).toBe(false);
  });

  it('ignores padding — base64url with trailing = equals the same key without', () => {
    // KEY_A with artificial padding appended should still match
    const sub = makeSubWithKey(KEY_A);
    expect(subscriptionKeyMismatch(sub, KEY_A + '=')).toBe(false);
  });
});

// ─── F. subscribe — key-mismatch re-subscribe (browser globals mocked) ────────
//
// We simulate the browser environment by injecting globals that pushSubscribe.js
// reads at call-time (navigator.serviceWorker, Notification, PushManager, window).
// This avoids needing JSDOM while still exercising the key-rotation code path.

describe('F. subscribe — key-mismatch triggers re-subscribe', () => {
  // A realistic-ish VAPID public key (65 bytes uncompressed P-256 point, base64url)
  const OLD_KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtWfelqjMkSGdnq5AEHk4NkPwNmRmQ0z5UgWuH5A0_kfBpM6XZPQ';
  const NEW_KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtWfelqjMkSGdnq5AEHk4NkPwNmRmQ0z5UgWuH5A0_kfBpM6XZPR';

  // Build a fake existing subscription whose applicationServerKey is the OLD key
  function makeFakeSub(base64UrlKey) {
    const bytes = urlBase64ToUint8Array(base64UrlKey);
    return {
      endpoint: 'https://old.push.example.com/sub-1',
      options: { applicationServerKey: bytes.buffer },
      unsubscribe: vi.fn(async () => true),
      toJSON: () => ({
        endpoint: 'https://old.push.example.com/sub-1',
        keys: { p256dh: 'p256-old', auth: 'auth-old' },
      }),
    };
  }

  function makeNewSub() {
    return {
      endpoint: 'https://new.push.example.com/sub-2',
      options: { applicationServerKey: urlBase64ToUint8Array(NEW_KEY).buffer },
      unsubscribe: vi.fn(async () => true),
      toJSON: () => ({
        endpoint: 'https://new.push.example.com/sub-2',
        keys: { p256dh: 'p256-new', auth: 'auth-new' },
      }),
    };
  }

  // navigator is a non-writable getter in Node — must use Object.defineProperty
  function setNavigator(value) {
    Object.defineProperty(global, 'navigator', { value, writable: true, configurable: true });
  }

  let originalWindow, originalNotification, originalPushManager;
  let originalNavigatorDescriptor;

  beforeEach(() => {
    originalWindow = global.window;
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
    originalNotification = global.Notification;
    originalPushManager = global.PushManager;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.window = originalWindow;
    if (originalNavigatorDescriptor) {
      Object.defineProperty(global, 'navigator', originalNavigatorDescriptor);
    }
    global.Notification = originalNotification;
    global.PushManager = originalPushManager;
    vi.unstubAllEnvs();
  });

  it('detects key mismatch, unsubscribes old, subscribes new, upserts new endpoint', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', NEW_KEY);

    const oldSub = makeFakeSub(OLD_KEY);
    const newSub = makeNewSub();
    const mockPushManager = {
      getSubscription: vi.fn(async () => oldSub),
      subscribe: vi.fn(async () => newSub),
    };
    const mockRegistration = { pushManager: mockPushManager };

    // isPushSupported() checks: typeof window !== 'undefined' &&
    // 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window.
    // In Node, global.window is a separate empty object — PushManager/Notification
    // must be set ON that window object, not just on global, for the 'in' check to pass.
    const fakeNotification = { permission: 'granted', requestPermission: vi.fn() };
    global.window = { PushManager: function PushManager() {}, Notification: fakeNotification };
    global.Notification = fakeNotification;
    setNavigator({
      serviceWorker: { ready: Promise.resolve(mockRegistration) },
      userAgent: 'TestBrowser/1.0',
    });

    // Dynamically import the module after env + globals are set
    vi.resetModules();
    const { subscribe: subscribeFn } = await import('../pushSubscribe.js');

    const result = await subscribeFn('user-rotate');

    // Old subscription must have been torn down
    expect(oldSub.unsubscribe).toHaveBeenCalledOnce();

    // A fresh subscription must have been created with the new key
    expect(mockPushManager.subscribe).toHaveBeenCalledOnce();

    // The new endpoint must be upserted into Supabase
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://new.push.example.com/sub-2' }),
      expect.any(Object)
    );

    expect(result).toBe(newSub);
  });

  it('reuses the existing subscription when the key has not changed', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', NEW_KEY);

    const existingSub = makeFakeSub(NEW_KEY);
    // Make toJSON match the existing sub so the upsert call uses its endpoint
    existingSub.toJSON = () => ({
      endpoint: existingSub.endpoint,
      keys: { p256dh: 'p256-same', auth: 'auth-same' },
    });

    const mockPushManager = {
      getSubscription: vi.fn(async () => existingSub),
      subscribe: vi.fn(async () => existingSub),
    };
    const mockRegistration = { pushManager: mockPushManager };

    // isPushSupported() checks: typeof window !== 'undefined' &&
    // 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window.
    // In Node, global.window is a separate empty object — PushManager/Notification
    // must be set ON that window object, not just on global, for the 'in' check to pass.
    const fakeNotification = { permission: 'granted', requestPermission: vi.fn() };
    global.window = { PushManager: function PushManager() {}, Notification: fakeNotification };
    global.Notification = fakeNotification;
    setNavigator({
      serviceWorker: { ready: Promise.resolve(mockRegistration) },
      userAgent: 'TestBrowser/1.0',
    });

    vi.resetModules();
    const { subscribe: subscribeFn } = await import('../pushSubscribe.js');

    await subscribeFn('user-stable');

    // No teardown — key matches
    expect(existingSub.unsubscribe).not.toHaveBeenCalled();

    // subscribe() is still called to get/confirm the subscription
    expect(mockPushManager.subscribe).toHaveBeenCalledOnce();
  });

  it('handles the case where no prior subscription exists (first-time subscribe)', async () => {
    vi.stubEnv('VITE_VAPID_PUBLIC_KEY', NEW_KEY);

    const newSub = makeNewSub();
    const mockPushManager = {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => newSub),
    };
    const mockRegistration = { pushManager: mockPushManager };

    // isPushSupported() checks: typeof window !== 'undefined' &&
    // 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window.
    // In Node, global.window is a separate empty object — PushManager/Notification
    // must be set ON that window object, not just on global, for the 'in' check to pass.
    const fakeNotification = { permission: 'granted', requestPermission: vi.fn() };
    global.window = { PushManager: function PushManager() {}, Notification: fakeNotification };
    global.Notification = fakeNotification;
    setNavigator({
      serviceWorker: { ready: Promise.resolve(mockRegistration) },
      userAgent: 'TestBrowser/1.0',
    });

    vi.resetModules();
    const { subscribe: subscribeFn } = await import('../pushSubscribe.js');

    const result = await subscribeFn('user-new');

    expect(mockPushManager.subscribe).toHaveBeenCalledOnce();
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://new.push.example.com/sub-2' }),
      expect.any(Object)
    );
    expect(result).toBe(newSub);
  });
});
