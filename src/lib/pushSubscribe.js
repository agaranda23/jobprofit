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
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

/**
 * Normalise a VAPID public key from any form to a plain base64url string
 * so two keys can be compared regardless of how they were encoded.
 *
 * PushSubscription.options.applicationServerKey is an ArrayBuffer.
 * VITE_VAPID_PUBLIC_KEY is a base64url string.
 * We convert both to base64url before comparing.
 */
function arrayBufferToBase64Url(buf) {
  // buf may be an ArrayBuffer or a Uint8Array
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Returns true when the existing PushSubscription was created with a
 * different applicationServerKey than the current VAPID public key.
 * When true the subscription must be discarded and a new one created.
 */
export function subscriptionKeyMismatch(existingSub, currentVapidKey) {
  if (!existingSub?.options?.applicationServerKey) return false;
  if (!currentVapidKey) return false;
  const existingBase64 = arrayBufferToBase64Url(existingSub.options.applicationServerKey);
  // Strip any padding from the current key before comparing
  const currentBase64 = currentVapidKey.replace(/=/g, '');
  return existingBase64 !== currentBase64;
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
 * Key-mismatch recovery: if an existing subscription was created with a
 * different VAPID key (e.g. the keys were rotated), this function detects
 * the mismatch, unsubscribes the stale entry, removes it from Supabase,
 * and creates a fresh subscription with the current key. Without this step
 * all pushes silently fail after a key rotation because the push service
 * rejects sends to a subscription bound to the old key.
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

    // Check whether an existing subscription is bound to a different key.
    // If so, tear it down first so the push service doesn't reject sends.
    const existing = await registration.pushManager.getSubscription();
    if (existing && subscriptionKeyMismatch(existing, VAPID_PUBLIC_KEY)) {
      const staleEndpoint = existing.endpoint;
      await existing.unsubscribe();
      // Best-effort: remove the stale row so the server doesn't keep sending
      // to a dead endpoint. Don't await — failure here is not fatal.
      supabase
        .from('push_subscriptions')
        .delete()
        .eq('endpoint', staleEndpoint)
        .then(() => {})
        .catch(() => {});
    }

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
