/**
 * create-deposit-payment-link — Netlify function
 *
 * Creates a Stripe Checkout Session on the trader's connected Stripe account
 * for a deposit payment (PR 4 — deposit on acceptance).
 *
 * Mirrors create-invoice-payment-link.js with these key differences:
 *   - Input: { quoteId } (authenticated, trader-initiated) OR
 *            { publicQuoteToken } (unauthenticated, customer-facing)
 *     publicQuoteToken is the UUID stored in job.meta.publicAccessToken —
 *     possession of the token is the authorisation (URL-as-capability).
 *     When quoteId is supplied, a Bearer token IS required (trader flow).
 *   - Validates: deposit_percent > 0 and deposit not already paid
 *   - Checkout Session metadata: jp_type = 'deposit'
 *   - Product name: "Deposit for: <description> (X% of £<total>)"
 *   - Inserts into invoice_payment_tokens with kind = 'deposit'
 *   - Idempotent: same quote → same token while pending
 *
 * The customer-facing quote page calls this when the customer taps
 * "Pay £X deposit & accept". The response payUrl is then used to redirect
 * the customer to Stripe Checkout.
 *
 * The actual quote acceptance (signature write, job state update) happens
 * in the stripe-connect-webhook.js handler when checkout.session.completed
 * fires with metadata.jp_type === 'deposit'.
 *
 * Fee model: trader absorbs (decision #1 from PR 1–3, applied here).
 * Connect mode: Standard (decision #2). No application_fee_amount.
 *
 * Required env vars (shared with PR 1–3, no new vars):
 *   STRIPE_SECRET_KEY          — Stripe secret key
 *   VITE_SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (bypasses RLS)
 *   APP_URL                    — optional; base URL for success/cancel and pay URLs
 *
 * Response shapes:
 *   200  { token, payUrl }              — success (or idempotent return)
 *   400  { error }                      — invalid input / no deposit set / already paid
 *   401  { error }                      — missing or invalid auth token
 *   404  { error }                      — quote not found
 *   409  { error, code: 'NOT_CONNECTED' } — trader not connected to Stripe
 *   500  { error }                      — server configuration error
 *   502  { error }                      — Stripe or Supabase call failed
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function generatePayToken() {
  return randomBytes(16).toString('base64url');
}

function sanitiseDescriptor(name) {
  return (name || '').replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 22);
}

function truncate(str, maxLen) {
  return (str || '').slice(0, maxLen);
}

export const handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Validate env vars ─────────────────────────────────────────────────────
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl     = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
    console.error(
      'create-deposit-payment-link: missing env vars.',
      'STRIPE_SECRET_KEY:', !!stripeSecretKey,
      'VITE_SUPABASE_URL:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY:', !!serviceRoleKey,
    );
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 2. Parse and validate body ───────────────────────────────────────────────
  let quoteId;
  let publicQuoteToken;
  let consentGiven;
  try {
    const body = JSON.parse(event.body || '{}');
    quoteId = body.quoteId;
    publicQuoteToken = body.publicQuoteToken;
    consentGiven = body.consentGiven;
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  if (!quoteId && !publicQuoteToken) {
    return json(400, { error: 'quoteId or publicQuoteToken is required' });
  }

  // Customer consent is required on the public (customer-facing) path.
  // The trader-initiated path (quoteId + Bearer) doesn't go through this consent
  // gate — the trader is not the party granting data consent here.
  if (publicQuoteToken && consentGiven !== true) {
    return json(400, { error: 'Consent is required to pay a deposit and accept this quote' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 3. Authorise — two paths ─────────────────────────────────────────────────
  // Path A: trader flow (Bearer token + quoteId) — existing pattern.
  // Path B: customer flow (publicQuoteToken only) — URL-as-capability, same model
  //         as pay-redirect.js and publicQuoteToken.js. No Bearer token needed.
  let userId; // the trader's user_id — resolved in both paths

  let job; // resolved early in Path B since we look up by token

  if (publicQuoteToken) {
    // Path B — public token path (customer-facing quote page)
    // Validate shape: must be a UUID v4
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(publicQuoteToken)) {
      return json(400, { error: 'Invalid publicQuoteToken format' });
    }

    try {
      const { data, error } = await adminClient
        .from('jobs')
        .select('id, user_id, amount, summary, customer_name, meta, deposit_percent, deposit_amount_pence, deposit_paid_at')
        .eq('meta->>publicAccessToken', publicQuoteToken)
        .single();

      if (error || !data) {
        return json(404, { error: 'Quote not found — the link may be invalid or expired' });
      }
      job = data;
      userId = data.user_id;
      quoteId = data.id;
    } catch (err) {
      console.error('create-deposit-payment-link: public token lookup threw', err?.message);
      return json(502, { error: 'Could not retrieve quote' });
    }
  } else {
    // Path A — authenticated trader flow (Bearer token)
    const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
    const authToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    if (!authToken) {
      return json(401, { error: 'Missing authorization token' });
    }

    try {
      const { data: { user }, error } = await adminClient.auth.getUser(authToken);
      if (error || !user) {
        return json(401, { error: 'Invalid or expired token' });
      }
      userId = user.id;
    } catch (err) {
      console.error('create-deposit-payment-link: auth.getUser threw', err?.message);
      return json(401, { error: 'Could not verify token' });
    }
  }

  // ── 4. Fetch the trader's profile ────────────────────────────────────────────
  let profile;
  try {
    const { data, error } = await adminClient
      .from('profiles')
      .select('stripe_user_id, stripe_connect_status, business_name, first_name, last_name, plan, trial_ends_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return json(502, { error: 'Could not retrieve profile' });
    }
    profile = data;
  } catch (err) {
    console.error('create-deposit-payment-link: profile fetch threw', err?.message);
    return json(502, { error: 'Could not retrieve profile' });
  }

  // ── 4a. Server-side Pro gate ──────────────────────────────────────────────────
  // Belt-and-braces with the client gate. Trial (plan='trial', trial_ends_at in
  // the future) counts as Pro. The customer paying the deposit is NEVER gated —
  // only the trader generating the link reaches this code.
  const isProPlan = profile.plan === 'pro';
  const isActiveTrial =
    profile.plan === 'trial' &&
    profile.trial_ends_at &&
    new Date(profile.trial_ends_at) > new Date();
  if (!isProPlan && !isActiveTrial) {
    return json(403, { error: 'Deposit on acceptance requires a Pro plan.', code: 'PRO_REQUIRED' });
  }

  // ── 5. Verify trader is connected to Stripe ───────────────────────────────────
  if (profile.stripe_connect_status !== 'connected' || !profile.stripe_user_id) {
    return json(409, {
      error: 'Stripe account not connected. Connect via Settings → Card payments.',
      code: 'NOT_CONNECTED',
    });
  }

  const stripeUserId = profile.stripe_user_id;

  // ── 6. Fetch the quote (job record) — only needed for Path A ─────────────────
  // In Path B, job was already fetched during token validation above.
  if (!job) {
    try {
      const { data, error } = await adminClient
        .from('jobs')
        .select('id, amount, summary, customer_name, meta, deposit_percent, deposit_amount_pence, deposit_paid_at')
        .eq('id', quoteId)
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        return json(404, { error: 'Quote not found or does not belong to you' });
      }
      job = data;
    } catch (err) {
      console.error('create-deposit-payment-link: job fetch threw', err?.message);
      return json(502, { error: 'Could not retrieve quote' });
    }
  }

  // ── 7. Validate the quote has a deposit configured ───────────────────────────
  const depositPercent = job.deposit_percent ?? 0;
  if (depositPercent <= 0) {
    return json(400, { error: 'This quote has no deposit set (deposit % is 0)' });
  }

  // ── 8. Reject if deposit is already paid ─────────────────────────────────────
  if (job.deposit_paid_at) {
    return json(400, { error: 'Deposit has already been paid for this quote', code: 'ALREADY_PAID' });
  }

  // ── 9. Idempotency — return existing non-expired deposit token if one exists ──
  try {
    const { data: existing } = await adminClient
      .from('invoice_payment_tokens')
      .select('token, expires_at')
      .eq('quote_id', quoteId)
      .eq('trader_user_id', userId)
      .eq('kind', 'deposit')
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existing?.token) {
      const appBase = (process.env.APP_URL || '').replace(/\/$/, '') || 'https://app.ohnar.co.uk';
      return json(200, {
        token: existing.token,
        payUrl: `${appBase}/p/${existing.token}`,
        idempotent: true,
      });
    }
  } catch {
    // No existing token — continue to create one.
  }

  // ── 10. Calculate deposit amount ─────────────────────────────────────────────
  // total is not a DB column — derive from meta.total (set at quote-send time) or fall back to amount.
  const totalRaw = Number(job.meta?.total ?? job.amount ?? 0);
  if (!totalRaw || totalRaw <= 0) {
    return json(400, { error: 'Quote has no amount — add a price before requesting a deposit' });
  }

  // Use stored deposit_amount_pence if set (locked at quote-send time);
  // otherwise calculate from current total and percent.
  const depositAmountPence = job.deposit_amount_pence
    ? job.deposit_amount_pence
    : Math.round(totalRaw * (depositPercent / 100) * 100);

  if (depositAmountPence <= 0) {
    return json(400, { error: 'Deposit amount is zero — check the quote total and deposit %' });
  }

  // ── 11. Build Stripe Checkout Session ────────────────────────────────────────
  // name is not a DB column — customer_name is the correct column.
  const jobDescription = truncate(job.summary || job.customer_name || 'Work', 50);
  const totalGbp = (totalRaw).toFixed(2);
  const productName = `Deposit for: ${jobDescription} (${depositPercent}% of £${totalGbp})`;

  const businessName =
    profile.business_name ||
    [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
    'Your trader';

  // Statement descriptor: trader name + "Dep" — sanitised, max 22 chars.
  // "Dep" suffix signals deposit vs full payment on the customer's bank statement.
  const rawDescriptor = sanitiseDescriptor(businessName + ' Dep');

  const appBase = (process.env.APP_URL || '').replace(/\/$/, '') || 'https://app.ohnar.co.uk';
  // Success URL: the public quote page with a query param so it can show a
  // confirmation state (the frontend reads ?deposit_success=true on load).
  const successUrl = `${appBase}/q/${job.meta?.publicAccessToken || quoteId}?deposit_success=true`;
  const cancelUrl  = `${appBase}/q/${job.meta?.publicAccessToken || quoteId}?deposit_cancelled=true`;

  const expiresAt = new Date(Date.now() + 23.5 * 60 * 60 * 1000); // 23.5h safety margin

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

  // Pre-generate the token now so we can embed it in the Stripe metadata.
  // This means the webhook can look it up by token without a PI-to-DB scan.
  const token = generatePayToken();

  // Capture the consent timestamp here so the webhook can read the exact moment
  // the customer ticked the box. On the public path consentGiven===true is
  // already validated above; on the trader path this will be undefined (fine —
  // the webhook guards with a fallback).
  const consentAt = publicQuoteToken ? new Date().toISOString() : undefined;

  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        automatic_payment_methods: { enabled: true },
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              product_data: {
                name: productName,
              },
              unit_amount: depositAmountPence,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          metadata: {
            jp_type:                    'deposit',
            jobprofit_quote_id:          quoteId,
            jobprofit_deposit_token:     token,
            jobprofit_trader_user_id:    userId,
            jobprofit_deposit_percent:   String(depositPercent),
            // Consent fields — present on the public customer path only.
            // The webhook reads these to write consentGiven/consentAt/consentPolicyVersion
            // into jobs.meta, mirroring what accept-quote.js writes on the sign path.
            ...(consentAt ? {
              consent_given:          'true',
              consent_at:             consentAt,
              consent_policy_version: 'v1',
            } : {}),
          },
          statement_descriptor_suffix: rawDescriptor,
        },
        success_url: successUrl,
        cancel_url:  cancelUrl,
      },
      { stripeAccount: stripeUserId },
    );
  } catch (err) {
    console.error('create-deposit-payment-link: Stripe session create failed', err?.message);
    return json(502, { error: 'Could not create payment session — please try again' });
  }

  // ── 12. Persist to invoice_payment_tokens ────────────────────────────────────
  try {
    const { error: insertError } = await adminClient
      .from('invoice_payment_tokens')
      .insert({
        token,
        invoice_id:                 quoteId, // kept as invoice_id for schema compat; quote IS the job
        quote_id:                   quoteId,
        trader_user_id:             userId,
        stripe_checkout_session_id: session.id,
        amount_pence:               depositAmountPence,
        currency:                   'gbp',
        status:                     'pending',
        kind:                       'deposit',
        deposit_percent:            depositPercent,
        expires_at:                 expiresAt.toISOString(),
      });

    if (insertError) {
      console.error('create-deposit-payment-link: DB insert failed', insertError?.message);
      return json(502, { error: 'Could not store payment link — please try again' });
    }
  } catch (err) {
    console.error('create-deposit-payment-link: DB insert threw', err?.message);
    return json(502, { error: 'Could not store payment link — please try again' });
  }

  return json(200, {
    token,
    payUrl: `${appBase}/p/${token}`,
  });
};
