/**
 * create-invoice-payment-link-public — Netlify function
 *
 * Customer-facing variant of create-invoice-payment-link.js.
 * Called from the hosted invoice page (/i/<token>) by the customer to initiate
 * card payment. Instead of a user JWT it authenticates via the publicInvoiceToken
 * (the same UUID stored in meta.publicAccessToken and surfaced in the /i/<token> URL).
 *
 * Because this is a public endpoint (no user session), we use the service-role
 * key to resolve the token → job → trader profile chain, then create a Stripe
 * Checkout Session on the trader's connected account exactly as the trader-side
 * function does.
 *
 * Idempotency, expiry, and webhook reconciliation are identical to the trader-side
 * function — we write to the same invoice_payment_tokens table and the same
 * stripe-connect-webhook fires on completion.
 *
 * POST body: { publicInvoiceToken }   — the UUID from the /i/<token> URL
 *
 * Response shapes:
 *   200  { token, payUrl }              — success
 *   400  { error }                      — missing/invalid token or £0 invoice
 *   404  { error }                      — token not matched to any job
 *   409  { error, code: 'NOT_CONNECTED' } — trader not connected to Stripe
 *   500  { error }                      — server configuration error
 *   502  { error }                      — Stripe or Supabase call failed
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY          — Stripe secret key
 *   VITE_SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (bypasses RLS)
 *   APP_URL                    — optional; base URL for success/cancel and pay URLs
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

/** UUID v4 shape — must match isValidToken in publicQuoteToken.js */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  // ── 1. Validate env vars ──────────────────────────────────────────────────────
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl     = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
    console.error('create-invoice-payment-link-public: missing env vars');
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 2. Parse and validate body ────────────────────────────────────────────────
  let publicInvoiceToken;
  try {
    const body = JSON.parse(event.body || '{}');
    publicInvoiceToken = body.publicInvoiceToken;
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  if (!publicInvoiceToken || typeof publicInvoiceToken !== 'string' || !UUID_RE.test(publicInvoiceToken)) {
    return json(400, { error: 'publicInvoiceToken is required and must be a valid UUID' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 3. Resolve the job by publicAccessToken (same as fetchPublicJob) ──────────
  let job;
  try {
    const { data, error } = await adminClient
      .from('jobs')
      .select('id, user_id, amount, summary, meta')
      .eq('meta->>publicAccessToken', publicInvoiceToken)
      .single();

    if (error || !data) {
      return json(404, { error: 'Invoice not found — the link may be invalid or the invoice has been removed' });
    }
    job = data;
  } catch (err) {
    console.error('create-invoice-payment-link-public: job lookup threw', err?.message);
    return json(502, { error: 'Could not retrieve invoice — please try again' });
  }

  const invoiceId = job.id;
  const userId    = job.user_id;

  // ── 4. Fetch the trader's profile (needs stripe_user_id) ─────────────────────
  let profile;
  try {
    const { data, error } = await adminClient
      .from('profiles')
      .select('stripe_user_id, stripe_connect_status, business_name, first_name, last_name')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return json(502, { error: 'Could not retrieve trader profile' });
    }
    profile = data;
  } catch (err) {
    console.error('create-invoice-payment-link-public: profile fetch threw', err?.message);
    return json(502, { error: 'Could not retrieve trader profile' });
  }

  // ── 5. Verify trader is connected to Stripe ───────────────────────────────────
  if (profile.stripe_connect_status !== 'connected' || !profile.stripe_user_id) {
    return json(409, {
      error: 'Card payment is not available for this invoice. Please pay by bank transfer.',
      code: 'NOT_CONNECTED',
    });
  }

  const stripeUserId = profile.stripe_user_id;

  // ── 6. Idempotency — return existing non-expired token if one exists ──────────
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
      const appBase = (process.env.APP_URL || '').replace(/\/$/, '') || 'https://app.jobprofit.co.uk';
      return json(200, {
        token: existing.token,
        payUrl: `${appBase}/p/${existing.token}`,
        idempotent: true,
      });
    }
  } catch {
    // No existing token — continue to create one.
  }

  // ── 7. Build Stripe Checkout Session params ───────────────────────────────────
  // Amount: prefer meta.total (edited lineItems total) over the column value.
  const amountRaw = Number(job.meta?.total ?? job.amount ?? 0);
  if (!amountRaw || amountRaw <= 0) {
    return json(400, { error: 'Invoice has no amount set — contact the trader' });
  }

  const amountPence = Math.round(amountRaw * 100);

  const invoiceNumber = job.meta?.invoiceNumber || `INV-${invoiceId.slice(0, 8).toUpperCase()}`;
  const jobDescription = truncate(job.summary || 'Work completed', 60);
  const businessName =
    profile.business_name ||
    [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
    'Your trader';

  const appBase = (process.env.APP_URL || '').replace(/\/$/, '') || 'https://app.jobprofit.co.uk';
  const successUrl = `${appBase}/p/success?ref=${invoiceNumber}`;
  const cancelUrl  = `${appBase}/p/cancelled?ref=${invoiceNumber}`;

  const expiresAt = new Date(Date.now() + 23.5 * 60 * 60 * 1000);

  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

  let session;
  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'gbp',
              product_data: { name: jobDescription },
              unit_amount: amountPence,
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          metadata: {
            jobprofit_invoice_id:     invoiceId,
            jobprofit_job_id:         invoiceId,
            jobprofit_trader_user_id: userId,
          },
          statement_descriptor_suffix: sanitiseDescriptor(businessName),
        },
        success_url: successUrl,
        cancel_url:  cancelUrl,
      },
      { stripeAccount: stripeUserId },
    );
  } catch (err) {
    console.error('create-invoice-payment-link-public: Stripe session create failed', err?.message);
    return json(502, { error: 'Could not create payment session — please try again' });
  }

  // ── 8. Generate token and persist ────────────────────────────────────────────
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
      console.error('create-invoice-payment-link-public: DB insert failed', insertError?.message);
      return json(502, { error: 'Could not store payment link — please try again' });
    }
  } catch (err) {
    console.error('create-invoice-payment-link-public: DB insert threw', err?.message);
    return json(502, { error: 'Could not store payment link — please try again' });
  }

  return json(200, {
    token,
    payUrl: `${appBase}/p/${token}`,
  });
};
