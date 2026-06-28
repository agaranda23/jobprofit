/**
 * create-invoice-payment-link — Netlify function
 *
 * Creates a Stripe Checkout Session on the trader's connected Stripe account
 * (Standard Connect — decision #2, locked 2026-05-31) and returns a short
 * Pay-now URL: https://app.ohnar.co.uk/p/<token>
 *
 * POST body: { invoiceId }   — the job UUID (jobs table doubles as invoices)
 *
 * Idempotency: if the same invoice already has a non-expired pending token,
 * returns the existing token without creating a duplicate Stripe session.
 *
 * Fee model: trader absorbs Stripe's fee (decision #1). No application_fee_amount.
 *
 * Stripe Checkout Session expiry: sessions expire after 24 hours maximum
 * (not 30 days — that applies to Payment Links, not Checkout Sessions).
 * We store expires_at in invoice_payment_tokens and the pay-redirect function
 * checks it before redirecting. When expired, pay-redirect shows a "link
 * expired" page rather than auto-regenerating (see pay-redirect.js for rationale).
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY          — Stripe secret key
 *   VITE_SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (bypasses RLS)
 *   APP_URL                    — optional; base URL for success/cancel and pay URLs
 *
 * Response shapes:
 *   200  { token, payUrl }              — success
 *   400  { error }                      — missing invoiceId or invalid invoice
 *   401  { error }                      — missing or invalid auth token
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

/**
 * Generates a URL-safe random token (16 bytes = 22 base64url chars).
 * Distinct from the UUID-based publicQuoteToken — Stripe redirect tokens
 * are shorter and opaque to avoid revealing the invoice UUID.
 */
function generatePayToken() {
  return randomBytes(16).toString('base64url');
}

/**
 * Sanitises a string for use as a Stripe statement descriptor suffix.
 * Stripe rules: max 22 chars, alphanumeric + spaces only (no special chars).
 * Strips anything outside [a-zA-Z0-9 ] and trims to 22.
 */
function sanitiseDescriptor(name) {
  return (name || '').replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 22);
}

/**
 * Truncates a string to maxLen characters, appending nothing (clean truncate).
 */
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
      'create-invoice-payment-link: missing env vars.',
      'STRIPE_SECRET_KEY:', !!stripeSecretKey,
      'VITE_SUPABASE_URL:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY:', !!serviceRoleKey,
    );
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 2. Parse and validate body ───────────────────────────────────────────────
  let invoiceId;
  try {
    const body = JSON.parse(event.body || '{}');
    invoiceId = body.invoiceId;
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  if (!invoiceId || typeof invoiceId !== 'string') {
    return json(400, { error: 'invoiceId is required' });
  }

  // ── 3. Authenticate the caller via Supabase ──────────────────────────────────
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const authToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!authToken) {
    return json(401, { error: 'Missing authorization token' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let userId;
  try {
    const { data: { user }, error } = await adminClient.auth.getUser(authToken);
    if (error || !user) {
      return json(401, { error: 'Invalid or expired token' });
    }
    userId = user.id;
  } catch (err) {
    console.error('create-invoice-payment-link: auth.getUser threw', err?.message);
    return json(401, { error: 'Could not verify token' });
  }

  // ── 4. Fetch the trader's profile (needs stripe_user_id + business_name) ─────
  let profile;
  try {
    const { data, error } = await adminClient
      .from('profiles')
      .select('stripe_user_id, stripe_connect_status, business_name, first_name, last_name')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return json(502, { error: 'Could not retrieve profile' });
    }
    profile = data;
  } catch (err) {
    console.error('create-invoice-payment-link: profile fetch threw', err?.message);
    return json(502, { error: 'Could not retrieve profile' });
  }

  // ── 5. Verify trader is connected to Stripe ───────────────────────────────────
  if (profile.stripe_connect_status !== 'connected' || !profile.stripe_user_id) {
    return json(409, {
      error: 'Stripe account not connected. Connect via Settings → Card payments.',
      code: 'NOT_CONNECTED',
    });
  }

  const stripeUserId = profile.stripe_user_id;

  // ── 6. Fetch the invoice (job record) — must belong to this trader ────────────
  let job;
  try {
    const { data, error } = await adminClient
      .from('jobs')
      .select('id, amount, summary, customer_name, meta')
      .eq('id', invoiceId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return json(400, { error: 'Invoice not found or does not belong to you' });
    }
    job = data;
  } catch (err) {
    console.error('create-invoice-payment-link: job fetch threw', err?.message);
    return json(502, { error: 'Could not retrieve invoice' });
  }

  // ── 7. Idempotency — return existing non-expired token if one exists ──────────
  try {
    const { data: existing } = await adminClient
      .from('invoice_payment_tokens')
      .select('token, expires_at')
      .eq('invoice_id', invoiceId)
      .eq('trader_user_id', userId)
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
    // No existing token — continue to create one. The .single() throws when
    // no row is found; that's the expected path.
  }

  // ── 8. Build Stripe Checkout Session params ───────────────────────────────────
  // total is not a DB column — derive from meta.total (set at invoice-send time) or fall back to amount.
  const amountRaw = Number(job.meta?.total ?? job.amount ?? 0);
  if (!amountRaw || amountRaw <= 0) {
    return json(400, { error: 'Invoice has no amount — add a price before sending a Pay-now link' });
  }

  const amountPence = Math.round(amountRaw * 100);

  // Invoice reference from meta (new-nav stores it in job.meta.invoiceNumber)
  // or fall back to a generic label.
  const invoiceNumber = job.meta?.invoiceNumber || `INV-${invoiceId.slice(0, 8).toUpperCase()}`;
  // name is not a DB column — customer_name is the correct column.
  const jobDescription = truncate(job.summary || job.customer_name || 'Work completed', 60);
  const businessName =
    profile.business_name ||
    [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
    'Your trader';

  const appBase = (process.env.APP_URL || '').replace(/\/$/, '') || 'https://app.ohnar.co.uk';
  const successUrl = `${appBase}/p/success?ref=${invoiceNumber}`;
  const cancelUrl  = `${appBase}/p/cancelled?ref=${invoiceNumber}`;

  // Stripe Checkout Sessions expire at most 24 hours from now.
  // We store this so pay-redirect can detect expiry without calling Stripe.
  const expiresAt = new Date(Date.now() + 23.5 * 60 * 60 * 1000); // 23.5h safety margin

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

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
                name: jobDescription,
              },
              unit_amount: amountPence,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          // These metadata fields are consumed by PR 3's webhook handler
          // (checkout.session.completed) to reconcile the payment back to
          // the job and mark it paid automatically.
          metadata: {
            jobprofit_invoice_id:   invoiceId,
            jobprofit_job_id:       invoiceId, // same thing in current schema
            jobprofit_trader_user_id: userId,
            // token is added after DB insert; we pre-generate it here
          },
          statement_descriptor_suffix: sanitiseDescriptor(businessName),
        },
        success_url: successUrl,
        cancel_url:  cancelUrl,
      },
      // Standard Connect: route the session through the connected account.
      // The Stripe-Account header tells Stripe which connected account creates
      // the payment (decision #2). Funds go directly to the trader's bank.
      { stripeAccount: stripeUserId },
    );
  } catch (err) {
    console.error('create-invoice-payment-link: Stripe session create failed', err?.message);
    return json(502, { error: 'Could not create payment session — please try again' });
  }

  // ── 9. Generate token and persist to invoice_payment_tokens ──────────────────
  const token = generatePayToken();

  try {
    const { error: insertError } = await adminClient
      .from('invoice_payment_tokens')
      .insert({
        token,
        invoice_id:                 invoiceId,
        trader_user_id:             userId,
        stripe_checkout_session_id: session.id,
        amount_pence:               amountPence,
        currency:                   'gbp',
        status:                     'pending',
        expires_at:                 expiresAt.toISOString(),
      });

    if (insertError) {
      console.error('create-invoice-payment-link: DB insert failed', insertError?.message);
      // Stripe session was created but we couldn't store the token. We cannot
      // expose the raw Stripe URL to the client (it bypasses our tracking).
      // Return a 502 so the caller can retry; the Stripe session will expire
      // naturally after 24h if unused.
      return json(502, { error: 'Could not store payment link — please try again' });
    }
  } catch (err) {
    console.error('create-invoice-payment-link: DB insert threw', err?.message);
    return json(502, { error: 'Could not store payment link — please try again' });
  }

  return json(200, {
    token,
    payUrl: `${appBase}/p/${token}`,
  });
};
