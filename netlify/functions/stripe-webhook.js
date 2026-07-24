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
 *   invoice.payment_succeeded      → subscription_status='active'; also grants the
 *                                     JP-LU7 Phase 2 referral reward on the
 *                                     referee's FIRST invoice with
 *                                     amount_paid > 0 (any billing_reason) — see
 *                                     ./_lib/referralReward.js. For a CAMPAIGN
 *                                     referral (JP-LU9), that same call forks
 *                                     internally to a creator bounty accrual
 *                                     instead — see ./_lib/campaignBounty.js.
 *   charge.refunded                → JP-LU9 clawback: voids a campaign referral's
 *                                     bounty (whatever state it's in) so a
 *                                     "pay, claim the bounty, refund" attempt
 *                                     never pays out — see ./_lib/campaignBounty.js
 *   charge.dispute.created         → same clawback as charge.refunded, for a
 *                                     card dispute instead of a direct refund
 *
 * All other events return 200 immediately (ignored, not an error).
 * The handler is idempotent — safe on duplicate Stripe deliveries.
 *
 * ── Card-free trial (create-checkout.js default path) ────────────────────────
 * checkout.session.completed fires as soon as Checkout finishes, whether or not
 * a card was collected — a trialing subscription (no card, trial_period_days:14)
 * completes the session just like a paid one. This handler sets plan='pro'
 * unconditionally here, so a trialing user is already treated as Pro from the
 * moment they tap "Start trial" — correct, since isPro() in src/lib/plan.js
 * gates on profiles.plan only, never on subscription_status.
 * subscription_status is set to 'active' here as an optimistic default (we don't
 * fetch the live Stripe status, which would really read 'trialing') — this is
 * harmless because nothing in the app reads subscription_status for entitlement,
 * only plan. If Stripe auto-cancels the subscription at day 14 because no
 * payment method was ever added (trial_settings.end_behavior.missing_payment_method:
 * 'cancel'), it fires customer.subscription.deleted like any other cancellation
 * — the case below already flips plan='free' and clears the subscription id, so
 * the user drops back to free with no separate handling needed.
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
 *   charge.refunded          (JP-LU9 — campaign bounty clawback)
 *   charge.dispute.created   (JP-LU9 — campaign bounty clawback)
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { grantReferralReward } from './_lib/referralReward.js';
import { voidCampaignBounty } from './_lib/campaignBounty.js';

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

        // ── Referral reward grant (JP-LU7 Phase 2) ────────────────────────────
        // Gated on amount_paid > 0, NOT billing_reason — the app's default
        // signup is a card-free 14-day trial, so the referee's real first
        // charge often lands later as a 'subscription_cycle' invoice, not
        // 'subscription_create'. Gating on billing_reason alone silently never
        // rewards that (the common) case. A £0 invoice (e.g. the trial's own
        // invoice) is not real money and is skipped. See
        // netlify/functions/_lib/referralReward.js for the full grant logic
        // (idempotent claim, free-tier vs paying delivery, and its own
        // defence-in-depth amount_paid check). grantReferralReward never
        // throws, but it is still awaited inside its own try/catch here — a
        // bug in reward-granting must never turn this already-successful
        // Stripe payment into a 500, which would make Stripe re-deliver the
        // whole webhook.
        if (invoice.amount_paid > 0) {
          try {
            await grantReferralReward({ stripe, adminClient, invoice });
          } catch (err) {
            console.error('stripe-webhook: referral reward grant threw unexpectedly', err?.message);
          }
        }

        break;
      }

      // ── Charge refunded → claw back a campaign bounty (JP-LU9) ──────────────
      // Charge events carry .customer directly (unlike Invoice events' shape),
      // so this maps straight to a Stripe customer id without an extra lookup.
      // voidCampaignBounty is a no-op for a non-campaign (personal-referral or
      // un-referred) customer — see ./_lib/campaignBounty.js.
      case 'charge.refunded': {
        const charge = stripeEvent.data.object;
        try {
          await voidCampaignBounty({ adminClient, stripeCustomerId: charge.customer, reason: 'charge.refunded' });
        } catch (err) {
          console.error('stripe-webhook: campaign bounty clawback (refund) threw unexpectedly', err?.message);
        }
        break;
      }

      // ── Charge disputed → same clawback as a refund (JP-LU9) ────────────────
      // Dispute objects only carry a charge ID, not the customer — retrieve the
      // charge to get .customer. Best-effort: if the charge lookup fails, the
      // clawback is skipped (logged) rather than failing the whole webhook.
      case 'charge.dispute.created': {
        const dispute = stripeEvent.data.object;
        let disputeCustomerId = null;
        try {
          if (dispute.charge) {
            const charge = await stripe.charges.retrieve(dispute.charge);
            disputeCustomerId = charge?.customer || null;
          }
        } catch (err) {
          console.warn('stripe-webhook: could not retrieve charge for dispute', dispute.id, err?.message);
        }
        try {
          await voidCampaignBounty({ adminClient, stripeCustomerId: disputeCustomerId, reason: 'charge.dispute.created' });
        } catch (err) {
          console.error('stripe-webhook: campaign bounty clawback (dispute) threw unexpectedly', err?.message);
        }
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
