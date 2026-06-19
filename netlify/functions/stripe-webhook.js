/**
 * stripe-webhook — Netlify function
 *
 * Receives Stripe webhook events and keeps profiles.plan in sync.
 *
 * CRITICAL: Stripe sends the raw request body for signature verification.
 * Netlify may base64-encode it — we decode with event.isBase64Encoded before
 * passing to stripe.webhooks.constructEvent.
 *
 * Handled events:
 *   checkout.session.completed     → plan='pro', save stripe ids, status='active'
 *   customer.subscription.updated  → sync subscription_status
 *   customer.subscription.deleted  → plan='free', status='canceled', clear ids
 *   invoice.payment_failed         → subscription_status='past_due'
 *   invoice.payment_succeeded      → subscription_status='active'
 *
 * All other events return 200 immediately (ignored, not an error).
 * The handler is idempotent — safe on duplicate Stripe deliveries.
 *
 * Required env vars (set in Netlify dashboard):
 *   STRIPE_SECRET_KEY        — Stripe secret key
 *   STRIPE_WEBHOOK_SECRET    — Stripe dashboard → Webhooks → endpoint → Signing secret (whsec_...)
 *   VITE_SUPABASE_URL        — already set for the browser build
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS, server only)
 *
 * Webhook URL to register in Stripe:
 *   https://<your-netlify-site>.netlify.app/.netlify/functions/stripe-webhook
 *
 * Events to enable in Stripe:
 *   checkout.session.completed
 *   customer.subscription.updated
 *   customer.subscription.deleted
 *   invoice.payment_failed
 *   invoice.payment_succeeded
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Founding Member cutoff — must match src/lib/plan.js FOUNDER_CUTOFF exactly.
// Env var FOUNDER_CUTOFF overrides this fallback without a code deploy.
// Stored here (server-side) so the client constant cannot be spoofed.
const FOUNDER_CUTOFF = process.env.FOUNDER_CUTOFF ?? '2026-09-30T23:59:59Z';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, stripe-signature',
  'Content-Type': 'application/json',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

export const handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Validate env vars ─────────────────────────────────────────────────────
  const stripeSecretKey   = process.env.STRIPE_SECRET_KEY;
  const webhookSecret     = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl       = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey    = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error(
      'stripe-webhook: missing env vars.',
      'STRIPE_SECRET_KEY:', !!stripeSecretKey,
      'STRIPE_WEBHOOK_SECRET:', !!webhookSecret,
      'VITE_SUPABASE_URL:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY:', !!serviceRoleKey,
    );
    return json(500, { error: 'Server configuration error' });
  }

  // ── 2. Verify Stripe signature ───────────────────────────────────────────────
  // Netlify may base64-encode the body — decode before passing to constructEvent
  // so the HMAC matches what Stripe signed.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  const sig = event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'] || '';

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('stripe-webhook: signature verification failed', err?.message);
    return json(400, { error: `Webhook signature verification failed: ${err?.message}` });
  }

  // ── 3. Initialize service-role Supabase client ───────────────────────────────
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 4. Route by event type ───────────────────────────────────────────────────
  try {
    switch (stripeEvent.type) {

      // ── Checkout completed → flip plan to pro, save Stripe ids ──────────────
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const userId = session.metadata?.user_id || session.client_reference_id;

        if (!userId) {
          console.error('stripe-webhook: checkout.session.completed missing user_id', session.id);
          return json(200, { received: true }); // 200 so Stripe doesn't retry — already logged
        }

        // ── Founding Member eligibility check (server-side) ──────────────────
        // Re-read the profile so the client cannot spoof eligibility.
        // Eligible = created_at before FOUNDER_CUTOFF AND not already a founder
        // AND window is still open (now < cutoff).
        let stampFoundingMember = false;
        try {
          const { data: existingProfile } = await adminClient
            .from('profiles')
            .select('created_at, founding_member, plan')
            .eq('id', userId)
            .single();

          const cutoffDate = new Date(FOUNDER_CUTOFF);
          const nowDate = new Date();
          if (
            existingProfile &&
            !existingProfile.founding_member &&
            existingProfile.plan !== 'pro' &&
            existingProfile.created_at &&
            new Date(existingProfile.created_at) < cutoffDate &&
            nowDate < cutoffDate
          ) {
            stampFoundingMember = true;
          }
        } catch (profileErr) {
          // Non-fatal: if we can't read the profile, skip the founding stamp.
          // The user still gets Pro — they just miss the cohort flag.
          console.warn('stripe-webhook: could not read profile for founding check', profileErr?.message);
        }

        await adminClient
          .from('profiles')
          .update({
            plan: 'pro',
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            subscription_status: 'active',
            ...(stampFoundingMember ? { founding_member: true } : {}),
          })
          .eq('id', userId);

        if (stampFoundingMember) {
          console.log('stripe-webhook: Founding Member stamped for user', userId);
        }

        break;
      }

      // ── Subscription updated → sync status (handles renewals, upgrades, etc.) ─
      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object;
        await adminClient
          .from('profiles')
          .update({
            subscription_status: sub.status,
          })
          .eq('stripe_customer_id', sub.customer);

        break;
      }

      // ── Subscription deleted → revoke Pro ───────────────────────────────────
      // IMPORTANT: this event fires on a confirmed deliberate cancellation only.
      // Transient failures (card bounced, dunning) produce invoice.payment_failed
      // and set subscription_status='past_due' — they do NOT fire this event.
      // Therefore it is correct to clear founding_member here: a canceled subscription
      // is a forfeited lock. A card that fails and recovers within Stripe's retry
      // window never reaches this event, so the lock survives payment hiccups.
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object;
        await adminClient
          .from('profiles')
          .update({
            plan: 'free',
            stripe_subscription_id: null,
            subscription_status: 'canceled',
            founding_member: false, // lock forfeited on deliberate cancellation
          })
          .eq('stripe_customer_id', sub.customer);

        break;
      }

      // ── Invoice payment failed → mark past_due ───────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object;
        await adminClient
          .from('profiles')
          .update({ subscription_status: 'past_due' })
          .eq('stripe_customer_id', invoice.customer);

        break;
      }

      // ── Invoice payment succeeded → mark active ──────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = stripeEvent.data.object;
        await adminClient
          .from('profiles')
          .update({ subscription_status: 'active' })
          .eq('stripe_customer_id', invoice.customer);

        break;
      }

      default:
        // Unhandled event — ignore, always return 200 so Stripe stops retrying
        break;
    }
  } catch (err) {
    console.error('stripe-webhook: DB update failed for event', stripeEvent.type, err?.message);
    return json(502, { error: 'Database update failed' });
  }

  return json(200, { received: true });
};
