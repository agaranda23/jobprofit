/**
 * pushSubscribe.js — Web Push subscription helpers (frontend only).
 *
 * All functions are safe to call on browsers that don't support push;
 * they return early with sensible values rather than throwing.
 *
 * iOS note: Push requires the PWA to be installed to the Home Screen and
 * Safari 16.4+. On earlier iOS or plain browser tabs, isPushSupported()
 * returns false and all other functions are no-ops.
 *
 * The VAPID public key is read from import.meta.env.VITE_VAPID_PUBLIC_KEY,
 * which Vite inlines at build time. Alan must add this to Netlify env vars.
 */

import { supabase } from './supabase.js';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || '';

/** Convert a base64url string to a Uint8Array for PushManager.subscribe */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

/**
 * Returns true when the browser supports both ServiceWorker and PushManager.
 * On iOS this requires Safari 16.4+ AND installed to Home Screen.
 */
export function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Request notification permission. Returns the permission string:
 * 'granted' | 'denied' | 'default'
 *
 * Call only after a user gesture — browsers block permission prompts
 * that fire without a gesture.
 */
export async function requestPermission() {
  if (!isPushSupported()) return 'denied';
  return Notification.requestPermission();
}

/**
 * Subscribe the current device to push notifications and persist the
 * subscription in Supabase push_subscriptions (upsert on endpoint).
 *
 * Returns the PushSubscription object on success, null on any failure.
 * Fails silently — push is an enhancement, never a blocker.
 */
export async function subscribe(userId) {
  if (!isPushSupported()) return null;
  if (!VAPID_PUBLIC_KEY) {
    console.warn('pushSubscribe: VITE_VAPID_PUBLIC_KEY is not set — push disabled');
    return null;
  }
  if (!userId) return null;

  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const { endpoint, keys } = sub.toJSON();

    await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint,
        p256dh: keys.p256dh,
        auth_secret: keys.auth,
        user_agent: navigator.userAgent.slice(0, 255),
      },
      { onConflict: 'user_id,endpoint' }
    );

    return sub;
  } catch (err) {
    console.warn('pushSubscribe: subscribe failed', err?.message);
    return null;
  }
}

/**
 * Unsubscribe the current device and remove its record from Supabase.
 * Returns true on success, false if nothing was subscribed or on error.
 */
export async function unsubscribe() {
  if (!isPushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    if (!sub) return false;

    const endpoint = sub.endpoint;
    await sub.unsubscribe();

    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint);

    return true;
  } catch (err) {
    console.warn('pushSubscribe: unsubscribe failed', err?.message);
    return false;
  }
}

/**
 * Returns the current subscription state for this device:
 *   'unsupported'          — browser/OS doesn't support push
 *   'denied'               — user blocked notifications at OS/browser level
 *   'default'              — never asked (or prompt was dismissed without answering)
 *   'granted-subscribed'   — permission granted and a live subscription exists
 *   'granted-unsubscribed' — permission granted but no subscription (e.g. expired)
 */
export async function getSubscriptionStatus() {
  if (!isPushSupported()) return 'unsupported';

  const permission = Notification.permission;
  if (permission === 'denied') return 'denied';

  if (permission === 'default') return 'default';

  // permission === 'granted'
  try {
    const registration = await navigator.serviceWorker.ready;
    const sub = await registration.pushManager.getSubscription();
    return sub ? 'granted-subscribed' : 'granted-unsubscribed';
  } catch {
    return 'granted-unsubscribed';
  }
}
