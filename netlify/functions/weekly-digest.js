/**
 * weekly-digest — Netlify Scheduled Function
 *
 * Fires every Monday at 08:00 UTC.
 *
 * UTC/BST CAVEAT: Netlify cron runs in UTC. 08:00 UTC = 09:00 BST (British
 * Summer Time, Mar–Oct) and 08:00 GMT (Nov–Feb). The digest will land ~1 hour
 * earlier in winter. This is acceptable for a low-urgency weekly nudge.
 * If precise 09:00 local is ever required, shift to `0 9 * * 1` and accept
 * that in BST it fires at 10:00 local. No easy fix without per-user TZ logic.
 *
 * Schedule: `0 8 * * 1` — Monday 08:00 UTC.
 *
 * What it does:
 *   1. Finds all users who have at least one active push subscription AND have
 *      weekly_digest_enabled = true on their profile (default true for new users).
 *   2. For each opted-in, subscribed user, queries their jobs and receipts for
 *      the prior calendar week (Mon 00:00 → Sun 23:59 UTC).
 *   3. Skips users with no paid activity last week (no "You made £0" pushes).
 *   4. Builds a friendly message via buildDigestMessage() and calls
 *      sendPushToUser() — the existing push util, used identically to accept-quote.js.
 *
 * Safe while dormant: if VAPID keys are not set in Netlify env, sendPushToUser
 * is a silent no-op. The function can be deployed now; it starts firing once the
 * founder sets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in Netlify.
 *
 * Idempotency: no digest-sent log is written in v1. Re-running (e.g. Netlify
 * function retry) will resend the push. This is acceptable — scheduled functions
 * retry rarely and the push deduplicates by tag on devices that support it.
 *
 * Required env vars (all shared with the existing push infrastructure):
 *   VAPID_PUBLIC_KEY          — generate once with web-push
 *   VAPID_PRIVATE_KEY         — generate once with web-push
 *   VAPID_SUBJECT             — mailto: or https: URI
 *   VITE_SUPABASE_URL         — already set for the browser build
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS, server only)
 */

import { createClient } from '@supabase/supabase-js';
import { sendPushToUser } from './_lib/sendPushToUser.js';
import { priorWeekRange, computeWeekSummary, buildDigestMessage } from './_lib/weeklyDigestCalc.js';

// Netlify Scheduled Function config — wires the cron without netlify.toml edits.
// Netlify picks this up at build time.
export const config = {
  schedule: '0 8 * * 1', // Monday 08:00 UTC (≈09:00 BST, 08:00 GMT)
};

export const handler = async function () {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('weekly-digest: missing Supabase env vars — aborting');
    return { statusCode: 500 };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 1. Find opted-in users who have at least one push subscription ───────────
  //
  // Strategy: join push_subscriptions with profiles to get both in one go.
  // We select distinct user_ids from push_subscriptions, then filter profiles
  // for weekly_digest_enabled = true (NULL treated as true since column default
  // is true, but we explicitly check both to be safe with older rows).
  //
  // Using two queries (subscribed user IDs → matching profiles) because Supabase
  // PostgREST doesn't expose DISTINCT across joined tables cleanly in the JS client.

  let subscribedUserIds;
  try {
    const { data, error } = await adminClient
      .from('push_subscriptions')
      .select('user_id');

    if (error) {
      console.error('weekly-digest: failed to fetch push_subscriptions', error.message);
      return { statusCode: 502 };
    }

    // Deduplicate — one user may have multiple devices
    subscribedUserIds = [...new Set((data || []).map(r => r.user_id))];
  } catch (err) {
    console.error('weekly-digest: push_subscriptions query threw', err?.message);
    return { statusCode: 502 };
  }

  if (!subscribedUserIds.length) {
    console.log('weekly-digest: no push subscribers — nothing to do');
    return { statusCode: 200 };
  }

  // ── 2. Filter to users with digest enabled ────────────────────────────────────
  let profiles;
  try {
    const { data, error } = await adminClient
      .from('profiles')
      .select('id, overheads, weekly_digest_enabled')
      .in('id', subscribedUserIds)
      // weekly_digest_enabled defaults to true; treat NULL as opted-in too
      .or('weekly_digest_enabled.is.null,weekly_digest_enabled.eq.true');

    if (error) {
      console.error('weekly-digest: profiles query failed', error.message);
      return { statusCode: 502 };
    }
    profiles = data || [];
  } catch (err) {
    console.error('weekly-digest: profiles query threw', err?.message);
    return { statusCode: 502 };
  }

  if (!profiles.length) {
    console.log('weekly-digest: no opted-in subscribers — nothing to do');
    return { statusCode: 200 };
  }

  // ── 3. Compute range once for all users (same Monday morning run) ─────────────
  const range = priorWeekRange(new Date());
  console.log(
    `weekly-digest: prior week ${range.start.toISOString()} → ${range.end.toISOString()}`,
    `| opted-in subscribers: ${profiles.length}`
  );

  // ── 4. Process each user independently ───────────────────────────────────────
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const profile of profiles) {
    const userId = profile.id;
    try {
      // Fetch jobs paid in the prior week for this user
      const { data: jobs, error: jobsError } = await adminClient
        .from('jobs')
        .select('amount, paid, payment_date, date')
        .eq('user_id', userId)
        .eq('paid', true)
        .gte('payment_date', range.start.toISOString().slice(0, 10))
        .lte('payment_date', range.end.toISOString().slice(0, 10));

      if (jobsError) {
        console.warn(`weekly-digest: jobs query failed for ${userId}`, jobsError.message);
        errors++;
        continue;
      }

      // Fetch receipts dated in the prior week for this user
      const { data: receipts, error: receiptsError } = await adminClient
        .from('receipts')
        .select('amount, date, created_at')
        .eq('user_id', userId)
        .gte('date', range.start.toISOString().slice(0, 10))
        .lte('date', range.end.toISOString().slice(0, 10));

      if (receiptsError) {
        // Non-fatal — costs just won't appear in the digest
        console.warn(`weekly-digest: receipts query failed for ${userId}`, receiptsError.message);
      }

      const overheads = Array.isArray(profile.overheads) ? profile.overheads : [];
      const summary = computeWeekSummary(jobs || [], receipts || [], overheads, range);

      // Skip users with no paid activity — don't send a "You made £0" push
      if (summary.jobCount === 0) {
        skipped++;
        continue;
      }

      const { title, body } = buildDigestMessage(summary);

      await sendPushToUser(userId, {
        title,
        body,
        url: '/',
        tag: 'weekly-digest',
      });

      sent++;
    } catch (err) {
      // Per-user error must not abort the whole run
      console.warn(`weekly-digest: uncaught error for user ${userId}`, err?.message);
      errors++;
    }
  }

  console.log(`weekly-digest: done — sent=${sent} skipped=${skipped} errors=${errors}`);
  return { statusCode: 200 };
};
