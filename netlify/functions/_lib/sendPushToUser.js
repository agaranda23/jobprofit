/**
 * sendPushToUser — server-side helper for sending Web Push to a trader.
 *
 * Called from accept-quote.js after a successful signature write.
 * Uses the `web-push` library (VAPID signing + payload encryption).
 *
 * Required env vars (set in Netlify dashboard — never in the repo):
 *   VAPID_PUBLIC_KEY   — base64url-encoded ECDH public key
 *   VAPID_PRIVATE_KEY  — base64url-encoded ECDH private key
 *   VAPID_SUBJECT      — mailto: or https: URI identifying the sender
 *   VITE_SUPABASE_URL  — reused from the existing env setup
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS, server only)
 *
 * Generate keys once with:
 *   node -e "const w=require('web-push');console.log(w.generateVAPIDKeys())"
 * Then add both keys to Netlify env vars and also set
 * VITE_VAPID_PUBLIC_KEY to the same value as VAPID_PUBLIC_KEY.
 *
 * Fail-soft contract: any error is caught and logged; the caller is never
 * blocked by a push failure. Push is an enhancement, not a blocker.
 */

import webPush from 'web-push';
import { createClient } from '@supabase/supabase-js';

/**
 * Send a push notification to all active subscriptions for a given userId.
 *
 * @param {string} userId  - Supabase auth.users.id of the trader
 * @param {{ title: string, body: string, url?: string, tag?: string }} payload
 * @returns {Promise<{ sent: number, failed: number }>}
 */
export async function sendPushToUser(userId, payload) {
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:hello@jobprofit.co.uk';
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn('sendPushToUser: VAPID keys not configured — skipping push');
    return { sent: 0, failed: 0 };
  }

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('sendPushToUser: Supabase env vars missing — skipping push');
    return { sent: 0, failed: 0 };
  }

  webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Fetch all push subscriptions for this trader
  const { data: subs, error } = await adminClient
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_secret')
    .eq('user_id', userId);

  if (error || !subs?.length) {
    // No subscriptions is normal — not an error worth logging at warn level
    return { sent: 0, failed: 0 };
  }

  const notification = JSON.stringify({
    title: payload.title || 'JobProfit',
    body: payload.body || '',
    url: payload.url || '/',
    tag: payload.tag || 'jobprofit',
  });

  let sent = 0;
  let failed = 0;
  const staleEndpoints = [];

  await Promise.allSettled(
    subs.map(async (sub) => {
      const pushSub = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth_secret,
        },
      };

      try {
        await webPush.sendNotification(pushSub, notification);
        sent++;
      } catch (err) {
        failed++;
        // 410 Gone or 404 Not Found means the subscription is dead — remove it
        if (err.statusCode === 410 || err.statusCode === 404) {
          staleEndpoints.push(sub.endpoint);
        } else {
          console.warn('sendPushToUser: push failed for endpoint', sub.endpoint, err?.message);
        }
      }
    })
  );

  // Clean up expired subscriptions (fire-and-forget, don't await the cleanup)
  if (staleEndpoints.length) {
    adminClient
      .from('push_subscriptions')
      .delete()
      .in('endpoint', staleEndpoints)
      .then(() => {})
      .catch((err) => console.warn('sendPushToUser: stale cleanup failed', err?.message));
  }

  return { sent, failed };
}
