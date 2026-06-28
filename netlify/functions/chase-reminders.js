/**
 * chase-reminders — Netlify Scheduled Function
 *
 * Fires daily at 08:00 UTC.
 *
 * UTC/BST CAVEAT: Netlify cron runs in UTC. 08:00 UTC = 09:00 BST (British
 * Summer Time, Mar–Oct) and 08:00 GMT (Nov–Feb). Reminders land ~1 hour
 * earlier in winter. Acceptable for a daily chase nudge.
 * Same caveat as weekly-digest.js — no easy fix without per-user TZ logic.
 *
 * Schedule: `0 8 * * *` — daily 08:00 UTC.
 *
 * What it does:
 *   1. Finds pro/trial users who have at least one push subscription and
 *      auto_chase_enabled IS NULL OR = true.
 *   2. For each user, queries their invoiced-but-unpaid, overdue jobs
 *      (daysPastDue >= 1 — grace window is silent).
 *   3. Applies cadence rules (shouldSendChaseReminder) to decide which jobs
 *      need a push right now. Tracks state in jobs.meta:
 *        chaseRemindedTier  — numeric tier last reminded at
 *        chaseRemindedAt    — ISO timestamp of last reminder
 *   4. Sends one push per qualifying job via sendPushToUser. The push deep-links
 *      to /?job=<jobId>#/work so the app opens straight to the Work tab with
 *      the drawer open on that job.
 *   5. Writes chaseRemindedTier + chaseRemindedAt back to jobs.meta.
 *
 * Per-user and per-job try/catch: one failure must not abort the run.
 * Safe no-op while VAPID keys are absent (sendPushToUser handles it).
 *
 * Required env vars:
 *   VAPID_PUBLIC_KEY          — generate once with web-push
 *   VAPID_PRIVATE_KEY
 *   VAPID_SUBJECT             — mailto: or https: URI
 *   VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY — bypasses RLS, server only
 */

import { createClient } from '@supabase/supabase-js';
import { sendPushToUser } from './_lib/sendPushToUser.js';
import { sendChaseEmail } from './_lib/sendChaseEmail.js';
import { daysPastDueShared, computeTierShared, shouldSendChaseReminder } from './_lib/chaseTierHelpers.js';

// Netlify Scheduled Function config — wires the cron without netlify.toml edits.
export const config = {
  schedule: '0 8 * * *', // daily 08:00 UTC (≈09:00 BST, 08:00 GMT)
};

// ── helpers ───────────────────────────────────────────────────────────────────

function isPaidJob(job) {
  if (!job) return false;
  if (job.paid === true) return true;
  const meta = job.meta || {};
  if (meta.paymentStatus === 'paid') return true;
  if (meta.status === 'paid') return true;
  return false;
}

function hasInvoiceSent(job) {
  if (!job) return false;
  // Check top-level columns first, then meta (the canonical store for these fields)
  if (job.invoice_sent_at || job.invoiceSentAt) return true;
  const meta = job.meta || {};
  if (meta.invoiceSentAt) return true;
  return false;
}

/**
 * Resolves the invoiceSentAt and invoiceDueDate for a job, preferring the meta
 * object (client-written) over the DB columns (server-written) since meta is
 * where the app writes these fields via writeJobMeta.
 */
function resolveInvoiceDates(job) {
  const meta = job.meta || {};
  return {
    invoiceSentAt: meta.invoiceSentAt || job.invoice_sent_at || null,
    invoiceDueDate: meta.invoiceDueDate || job.invoice_due_date || null,
  };
}

/**
 * Builds the display amount string for the push notification.
 */
function fmtAmount(job) {
  const n = Number(job.amount ?? (job.meta?.total) ?? (job.meta?.amount) ?? 0);
  if (!n) return '';
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/**
 * Builds a friendly tier label for the push body.
 */
function tierLabel(tier) {
  if (tier === 1) return 'Tier 1 — light chase ready';
  if (tier === 2) return 'Tier 2 — firm chase ready';
  if (tier === 3) return 'Final chase — tap to send';
  return 'Chase ready';
}

// ── handler ───────────────────────────────────────────────────────────────────

export const handler = async function () {
  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('chase-reminders: missing Supabase env vars — aborting');
    return { statusCode: 500 };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const now = new Date();

  // ── 1. Find subscribed user IDs ───────────────────────────────────────────

  let subscribedUserIds;
  try {
    const { data, error } = await adminClient
      .from('push_subscriptions')
      .select('user_id');

    if (error) {
      console.error('chase-reminders: push_subscriptions query failed', error.message);
      return { statusCode: 502 };
    }

    subscribedUserIds = [...new Set((data || []).map(r => r.user_id))];
  } catch (err) {
    console.error('chase-reminders: push_subscriptions query threw', err?.message);
    return { statusCode: 502 };
  }

  if (!subscribedUserIds.length) {
    console.log('chase-reminders: no push subscribers — nothing to do');
    return { statusCode: 200 };
  }

  // ── 2. Filter to pro/trial users with auto_chase_enabled ──────────────────

  let profiles;
  try {
    const { data, error } = await adminClient
      .from('profiles')
      .select('id, plan, trial_ends_at, auto_chase_enabled')
      .in('id', subscribedUserIds)
      .in('plan', ['pro', 'trial'])
      // auto_chase_enabled defaults to true; treat NULL as opted-in
      .or('auto_chase_enabled.is.null,auto_chase_enabled.eq.true');

    if (error) {
      console.error('chase-reminders: profiles query failed', error.message);
      return { statusCode: 502 };
    }

    // Also filter out trial users whose trial has expired
    profiles = (data || []).filter(p => {
      if (p.plan === 'trial' && p.trial_ends_at) {
        return new Date(p.trial_ends_at) > now;
      }
      return true;
    });
  } catch (err) {
    console.error('chase-reminders: profiles query threw', err?.message);
    return { statusCode: 502 };
  }

  if (!profiles.length) {
    console.log('chase-reminders: no eligible pro/trial subscribers — nothing to do');
    return { statusCode: 200 };
  }

  console.log(`chase-reminders: eligible users=${profiles.length}`);

  // ── 3. Process each user ──────────────────────────────────────────────────

  let totalSent    = 0;
  let totalSkipped = 0;
  let totalErrors  = 0;

  for (const profile of profiles) {
    const userId = profile.id;
    try {
      // Query this user's invoiced-but-unpaid jobs.
      // We fetch all non-paid jobs and filter overdue in-process so we can read
      // meta fields. Supabase JSON path queries are supported but result in complex
      // SQL; simpler to fetch the candidate set and filter in JS.
      // invoice_sent_at and invoice_due_date are NOT top-level columns — they
      // live in the meta JSONB as invoiceSentAt / invoiceDueDate (camelCase).
      // Selecting them by their snake_case column names caused PostgREST 42703
      // errors that silently failed every user's chase check. The meta column
      // is already selected; resolveInvoiceDates() reads from meta correctly.
      const { data: jobs, error: jobsError } = await adminClient
        .from('jobs')
        .select('id, amount, paid, customer_name, summary, meta')
        .eq('user_id', userId)
        .eq('paid', false)
        .limit(200); // safety guard — protects against runaway reads at scale

      if (jobsError) {
        console.warn(`chase-reminders: jobs query failed for ${userId}`, jobsError.message);
        totalErrors++;
        continue;
      }

      const candidates = (jobs || []).filter(job => {
        if (isPaidJob(job)) return false;
        if (!hasInvoiceSent(job)) return false;
        // Build a normalised job shape that daysPastDueShared expects
        const { invoiceSentAt, invoiceDueDate } = resolveInvoiceDates(job);
        const dpd = daysPastDueShared({ invoiceSentAt, invoiceDueDate }, now);
        return dpd >= 1; // exclude pre-due and grace window
      });

      if (!candidates.length) {
        totalSkipped++;
        continue;
      }

      for (const job of candidates) {
        try {
          const { invoiceSentAt, invoiceDueDate } = resolveInvoiceDates(job);
          const jobShape    = { invoiceSentAt, invoiceDueDate };
          const currentTier = computeTierShared(jobShape, now);
          const meta        = job.meta || {};
          const lastTier    = meta.chaseRemindedTier ?? null;
          const lastAt      = meta.chaseRemindedAt   ?? null;

          if (!shouldSendChaseReminder({ currentTier, chaseRemindedTier: lastTier, chaseRemindedAt: lastAt }, now)) {
            continue;
          }

          const dpd         = daysPastDueShared(jobShape, now);
          const customerName = job.meta?.customer || job.customer_name || 'Customer';
          const amount      = fmtAmount(job);
          const jobId       = job.id;

          // Push title: "{Name} · {amount} unpaid · {N} days"
          // Push body: tier label — tap to open the job
          // Deep-link: /?job=<jobId>#/work — AppShell reads ?job= on auth-ready
          // and opens the Work tab with the drawer on that job.
          const title = [
            customerName,
            amount ? `${amount} unpaid` : 'unpaid',
            `${dpd} day${dpd === 1 ? '' : 's'}`,
          ].filter(Boolean).join(' · ');

          const body = tierLabel(currentTier);

          const pushResult = await sendPushToUser(userId, {
            title,
            body,
            url: `/?job=${encodeURIComponent(jobId)}#/work`,
            tag: `chase-${jobId}`,
          });

          // Email fallback for traders who haven't granted push permission or
          // whose VAPID keys are not yet configured. sendChaseEmail goes to the
          // TRADER (their own registered email), not the customer.
          if (pushResult.sent === 0) {
            await sendChaseEmail({
              userId,
              adminClient,
              job,
              dpd,
              currentTier,
            });
          }

          // Write cadence state back to jobs.meta (service-role bypasses RLS)
          const updatedMeta = {
            ...(job.meta || {}),
            chaseRemindedTier: currentTier,
            chaseRemindedAt:   now.toISOString(),
          };

          const { error: updateError } = await adminClient
            .from('jobs')
            .update({ meta: updatedMeta })
            .eq('id', jobId)
            .eq('user_id', userId); // belt-and-braces: confirm ownership

          if (updateError) {
            // Non-fatal: push was sent; we just can't track the cadence for this job.
            console.warn(`chase-reminders: meta update failed for job ${jobId}`, updateError.message);
          }

          totalSent++;
        } catch (jobErr) {
          console.warn(`chase-reminders: error processing job ${job.id} for user ${userId}`, jobErr?.message);
          totalErrors++;
        }
      }
    } catch (userErr) {
      // Per-user error must not abort the whole run
      console.warn(`chase-reminders: uncaught error for user ${userId}`, userErr?.message);
      totalErrors++;
    }
  }

  console.log(`chase-reminders: done — sent=${totalSent} skipped=${totalSkipped} errors=${totalErrors}`);
  return { statusCode: 200 };
};
