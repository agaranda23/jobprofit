/**
 * create-checkout — Netlify function
 *
 * Creates a Stripe Checkout Session for the JobProfit Pro subscription (£12/mo).
 * The caller must be authenticated — the Supabase access token is read from the
 * Authorization header and verified server-side. The user id is NEVER trusted
 * from the request body.
 *
 * POST body: { coupon_mode?: 'trial_extension' | 'none' } — see coupon_mode below.
 *
 * Three checkout shapes, selected by body.coupon_mode:
 *   (absent)           — DEFAULT: genuinely card-free 14-day trial
 *                         (payment_method_collection: 'if_required' +
 *                         subscription_data.trial_period_days: 14 +
 *                         trial_settings.end_behavior.missing_payment_method:
 *                         'cancel'). No card asked; if none is added by day 14,
 *                         Stripe cancels the subscription and the webhook drops
 *                         the user back to plan='free' — never a surprise charge.
 *   'trial_extension'  — Moment-1 "add a card, keep Pro free another month":
 *                         deliberately collects a card + applies the
 *                         STRIPE_TRIAL_EXTENSION_COUPON_ID coupon.
 *   'none'             — Moment-2 "charge me now": deliberately collects a card,
 *                         no trial, billed immediately.
 *
 * Required env vars (set in Netlify dashboard):
 *   STRIPE_SECRET_KEY       — Stripe dashboard → Developers → API keys → Secret key
 *   STRIPE_PRICE_ID         — Stripe dashboard → Products → JobProfit Pro → Price ID (price_...)
 *   VITE_SUPABASE_URL       — already set for the browser build; reused here
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase → Project Settings → API → service_role
 *   APP_URL                 — optional; base URL for success/cancel redirects
 *                             (falls back to the request Origin header)
 *
 * Response shapes:
 *   200  { url }           — Stripe Checkout session URL; redirect the browser here
 *   400  { error }         — bad request
 *   401  { error }         — missing or invalid auth token
 *   500  { error }         — server configuration error
 *   502  { error }         — Stripe or Supabase call failed
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

export const handler = async function (event) {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Validate env vars ─────────────────────────────────────────────────────
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripePriceId   = process.env.STRIPE_PRICE_ID;
  const supabaseUrl     = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !stripePriceId || !supabaseUrl || !serviceRoleKey) {
    console.error(
      'create-checkout: missing env vars.',
      'STRIPE_SECRET_KEY:', !!stripeSecretKey,
      'STRIPE_PRICE_ID:', !!stripePriceId,
      'VITE_SUPABASE_URL:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY:', !!serviceRoleKey,
    );
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 2. Authenticate the caller via Supabase ──────────────────────────────────
  // Read the Bearer token from the Authorization header — never trust body params.
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return json(401, { error: 'Missing authorization token' });
  }

  // Use the anon/service client just to verify the JWT — we don't need RLS bypass here
  // for the auth check itself, but we use the service client to fetch the profile after.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let userId, userEmail;
  try {
    const { data: { user }, error } = await adminClient.auth.getUser(token);
    if (error || !user) {
      return json(401, { error: 'Invalid or expired token' });
    }
    userId    = user.id;
    userEmail = user.email;
  } catch (err) {
    console.error('create-checkout: auth.getUser threw', err?.message);
    return json(401, { error: 'Could not verify token' });
  }

  // ── 3. Fetch existing profile for stripe_customer_id ────────────────────────
  let existingCustomerId = null;
  try {
    const { data: profile } = await adminClient
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();
    existingCustomerId = profile?.stripe_customer_id || null;
  } catch {
    // Non-fatal — proceed without a customer id; Stripe will create a new one
  }

  // ── 4. Build success / cancel URLs ──────────────────────────────────────────
  // APP_URL env var is preferred so the redirects always land on the production
  // domain, not whatever Origin the function received (which may be a preview URL).
  const appBase = (process.env.APP_URL || event.headers?.origin || '').replace(/\/$/, '');
  const successUrl = `${appBase}/#/settings?upgraded=1`;
  const cancelUrl  = `${appBase}/#/money`;

  // ── 4b. Parse coupon_mode from body ─────────────────────────────────────────
  // coupon_mode:
  //   'trial_extension' — Moment-1: apply the +1-free-month Stripe coupon
  //                        (STRIPE_TRIAL_EXTENSION_COUPON_ID env var must be set)
  //   'none'           — Moment-2: no coupon, charge immediately
  //   (absent)         — default checkout (14-day trial, standard flow)
  let couponMode = null;
  try {
    const bodyObj = event.body ? JSON.parse(event.body) : {};
    if (bodyObj.coupon_mode === 'trial_extension' || bodyObj.coupon_mode === 'none') {
      couponMode = bodyObj.coupon_mode;
    }
  } catch {
    // Malformed body — treat as default checkout
  }

  // ── 5. Create Stripe Checkout Session ───────────────────────────────────────
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

  let session;
  try {
    const sessionParams = {
      mode: 'subscription',
      line_items: [{ price: stripePriceId, quantity: 1 }],
      client_reference_id: userId,
      metadata: { user_id: userId, coupon_mode: couponMode ?? 'default' },
      success_url: successUrl,
      cancel_url: cancelUrl,
    };

    if (existingCustomerId) {
      // Returning customer — reuse their Stripe customer record
      sessionParams.customer = existingCustomerId;
    } else {
      // New customer — pre-fill email so they don't have to type it
      sessionParams.customer_email = userEmail;
    }

    // ── Default path only: genuinely card-free 14-day trial ────────────────
    // The upgrade sheet promises "14-day free trial · no card needed" — that
    // promise is only true if we tell Stripe not to insist on a payment method.
    // `payment_method_collection: 'if_required'` skips the card form when
    // nothing is due today; `trial_settings.end_behavior.missing_payment_method:
    // 'cancel'` is what makes the trial SAFE with no card on file — if the
    // trial reaches day 14 with no payment method attached, Stripe cancels the
    // subscription itself (webhook: customer.subscription.deleted → plan=free)
    // instead of trying to charge a card that was never collected.
    //
    // 'trial_extension' and 'none' are DELIBERATE card-collecting paths
    // (Moment-1 "add a card, keep Pro free another month" and Moment-2
    // "charge me now") — do NOT relax card collection on those.
    //
    // Trial length is defined ONCE, here, at the subscription level. If the
    // Stripe Price (STRIPE_PRICE_ID) is ever edited to carry its own
    // trial_period_days, this subscription_data value wins (Stripe uses the
    // most specific setting) — but check the Stripe dashboard doesn't also
    // set one, so nobody is confused about where the "14" lives.
    if (couponMode === null) {
      sessionParams.payment_method_collection = 'if_required';
      sessionParams.subscription_data = {
        trial_period_days: 14,
        trial_settings: {
          end_behavior: { missing_payment_method: 'cancel' },
        },
      };
    }

    // Apply the trial-extension coupon for Moment-1 ("Add card, free month").
    // STUB: requires STRIPE_TRIAL_EXTENSION_COUPON_ID to be set in Netlify env.
    // If not set, the session is created without the coupon (degrades gracefully —
    // user still subscribes, just doesn't get the extra free month until founder
    // creates the coupon and sets the env var).
    if (couponMode === 'trial_extension') {
      const couponId = process.env.STRIPE_TRIAL_EXTENSION_COUPON_ID;
      if (couponId) {
        sessionParams.discounts = [{ coupon: couponId }];
      } else {
        console.warn(
          'create-checkout: STRIPE_TRIAL_EXTENSION_COUPON_ID not set — ' +
          'trial_extension checkout created without coupon. ' +
          'Set this env var in Netlify to enable the +1-free-month offer.'
        );
      }
    }

    session = await stripe.checkout.sessions.create(sessionParams);
  } catch (err) {
    console.error('create-checkout: Stripe session create failed', err?.message);
    return json(502, { error: 'Could not create checkout session — please try again' });
  }

  return json(200, { url: session.url });
};
