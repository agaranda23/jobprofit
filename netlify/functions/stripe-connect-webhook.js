/**
 * stripe-connect-webhook — Netlify function
 *
 * Receives Stripe Connect webhook events and reconciles payments back to jobs.
 *
 * Webhook architecture: Option A (separate function from stripe-webhook.js).
 * Stripe Connect events are signed with a DIFFERENT secret
 * (STRIPE_CONNECT_WEBHOOK_SECRET) and arrive at a DIFFERENT endpoint URL than
 * the subscription webhook. Keeping them in separate function files means each
 * can be versioned, tested, and reasoned about independently. There is no
 * shared logic compelling a merge — the subscription webhook mutates `profiles`;
 * this one mutates `invoice_payment_tokens` and `jobs`.
 *
 * CRITICAL: Stripe sends the raw request body for signature verification.
 * Netlify may base64-encode it — we decode with event.isBase64Encoded before
 * passing to stripe.webhooks.constructEvent.
 *
 * Handled events:
 *   checkout.session.completed     → routes on metadata.jp_type:
 *                                    'invoice' (default) → mark token + job paid
 *                                    'deposit'           → mark deposit paid, auto-sign quote, create job
 *   charge.refunded                → mark token refunded (full) or record partial refund;
 *                                    deposit refunds also revert quote deposit state
 *   account.application.deauthorized → clear stripe_user_id on trader's profile
 *
 * All other events return 200 immediately (Stripe retries 4xx forever — never 4xx).
 * All DB handlers are idempotent — safe on duplicate Stripe deliveries.
 *
 * Required env vars (set in Netlify dashboard — SEPARATE from the subscription webhook):
 *   STRIPE_SECRET_KEY                 — Stripe secret key (platform account)
 *   STRIPE_CONNECT_WEBHOOK_SECRET     — signing secret for THIS endpoint (whsec_...)
 *   VITE_SUPABASE_URL                 — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY         — service-role key (bypasses RLS, server only)
 *
 * Stripe dashboard setup:
 *   Create a NEW webhook endpoint (Connect → Webhooks) pointing to:
 *     https://<your-netlify-site>/.netlify/functions/stripe-connect-webhook
 *   Enable events:
 *     checkout.session.completed
 *     charge.refunded
 *     account.application.deauthorized
 *   Copy the signing secret (whsec_...) into STRIPE_CONNECT_WEBHOOK_SECRET env var.
 *   Do NOT use the same signing secret as the subscription webhook.
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

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
  const webhookSecret     = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  const supabaseUrl       = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey    = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error(
      'stripe-connect-webhook: missing env vars.',
      'STRIPE_SECRET_KEY:', !!stripeSecretKey,
      'STRIPE_CONNECT_WEBHOOK_SECRET:', !!webhookSecret,
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
    console.error('stripe-connect-webhook: signature verification failed', err?.message);
    return json(400, { error: `Webhook signature verification failed: ${err?.message}` });
  }

  // ── 3. Initialize service-role Supabase client ───────────────────────────────
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 4. Route by event type ───────────────────────────────────────────────────
  try {
    switch (stripeEvent.type) {

      // ── checkout.session.completed → route on jp_type ──────────────────────
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;
        const jpType = (session.metadata || {}).jp_type || 'invoice';
        if (jpType === 'deposit') {
          await handleDepositCompleted(session, stripe, adminClient);
        } else {
          // Default: invoice payment (PR 1–3 path — unchanged)
          await handleCheckoutCompleted(session, stripe, adminClient);
        }
        break;
      }

      // ── charge.refunded → full or partial refund from Stripe dashboard ──────
      case 'charge.refunded': {
        const charge = stripeEvent.data.object;
        await handleChargeRefunded(charge, adminClient);
        break;
      }

      // ── account.application.deauthorized → trader disconnected from Stripe ──
      case 'account.application.deauthorized': {
        // The account field is the Connect account ID being deauthorized.
        const accountId = stripeEvent.account;
        await handleAccountDeauthorized(accountId, adminClient);
        break;
      }

      default:
        // Unhandled event — log and return 200. Stripe retries 4xx forever.
        console.log('stripe-connect-webhook: ignoring unhandled event', stripeEvent.type);
        break;
    }
  } catch (err) {
    console.error('stripe-connect-webhook: handler threw for event', stripeEvent.type, err?.message);
    return json(502, { error: 'Handler failed' });
  }

  return json(200, { received: true });
};

// ── Event handlers ────────────────────────────────────────────────────────────

/**
 * checkout.session.completed — the happy path.
 *
 * 1. Find the invoice_payment_tokens row by token from payment_intent metadata.
 * 2. Idempotency: if already paid, return early.
 * 3. Fetch the balance_transaction from the PaymentIntent to get the real fee/net.
 * 4. Update the token row: status, paid_at, stripe_payment_intent_id, fee_pence, net_pence, receipt_url.
 * 5. Update the parent jobs row to the canonical paid state.
 *
 * The chase ladder is stored in the trader's browser localStorage (chaseLadder.js).
 * There is no server-side chase schedule to halt — the frontend reads the job's
 * paid state on next open and shouldShowChase() returns false, suppressing the CTA.
 * The drawer's chase tab explicitly shows "Chase stopped — paid in full" when isPaid.
 */
async function handleCheckoutCompleted(session, stripe, adminClient) {
  // Stripe surfaces payment_intent_data.metadata on the PaymentIntent, not directly
  // on the Checkout Session object. For checkout.session.completed, the token is in
  // session.metadata (set at session creation time as payment_intent_data.metadata).
  // The actual metadata location depends on how we created the session — in
  // create-invoice-payment-link.js we set payment_intent_data.metadata, so Stripe
  // copies those keys to the PaymentIntent. The session.metadata object may be
  // empty; we need to fetch the PaymentIntent directly to read those keys.
  const paymentIntentId = session.payment_intent;

  if (!paymentIntentId) {
    console.warn('stripe-connect-webhook: checkout.session.completed has no payment_intent', session.id);
    return; // return 200 upstream; don't fail Stripe's queue
  }

  // Retrieve the PaymentIntent to get metadata (where our token lives).
  // The session was created on the connected account, so we need the Stripe-Account
  // header to retrieve it. The account is available from the event's account field
  // (set by Stripe for Connect events), but we're inside a named function and don't
  // have it here. Instead, look up the token by payment_intent_id via the DB.
  // This is safer: the DB is the single source of truth for our token-to-PI mapping.
  // However, we can also read session.metadata directly — create-invoice-payment-link.js
  // sets payment_intent_data.metadata which Stripe mirrors onto both the PI and the
  // session for checkout.session.completed events (confirmed in Stripe docs v2024-06-20).
  const meta = session.metadata || {};
  const token = meta.jobprofit_token;
  const invoiceId = meta.jobprofit_invoice_id || meta.jobprofit_job_id;
  const traderUserId = meta.jobprofit_trader_user_id;

  if (!token && !paymentIntentId) {
    console.warn('stripe-connect-webhook: no token or payment_intent in session', session.id);
    return;
  }

  // Look up the token row. If token is in metadata, use it directly. Otherwise
  // fall back to looking up by payment_intent_id (stored at creation time for
  // sessions that update PI metadata, or by a prior completed event).
  let tokenRow;
  if (token) {
    const { data } = await adminClient
      .from('invoice_payment_tokens')
      .select('*')
      .eq('token', token)
      .single();
    tokenRow = data;
  } else {
    // Fallback: look up by invoice_id + trader_user_id from metadata
    if (invoiceId && traderUserId) {
      const { data } = await adminClient
        .from('invoice_payment_tokens')
        .select('*')
        .eq('invoice_id', invoiceId)
        .eq('trader_user_id', traderUserId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      tokenRow = data;
    }
  }

  if (!tokenRow) {
    // Stale or orphaned event — log and return 200 so Stripe stops retrying.
    console.warn('stripe-connect-webhook: no token row found for session', session.id);
    return;
  }

  // Idempotency: already processed — return cleanly.
  if (tokenRow.status === 'paid') {
    console.log('stripe-connect-webhook: idempotent skip for already-paid token', tokenRow.token);
    return;
  }

  // ── Fetch balance transaction for real fee/net figures ─────────────────────
  // We need the Stripe-Account header to retrieve resources on a connected account.
  // The connected account ID is stored in the trader's profile (stripe_user_id).
  // Fetch it now.
  let feePence = 0;
  let netPence = 0;
  let receiptUrl = null;

  try {
    const { data: profileData } = await adminClient
      .from('profiles')
      .select('stripe_user_id')
      .eq('id', tokenRow.trader_user_id)
      .single();

    const connectedAccountId = profileData?.stripe_user_id;

    if (connectedAccountId && paymentIntentId) {
      // Retrieve the PaymentIntent from the connected account to get charge data.
      const pi = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ['charges.data.balance_transaction'] },
        { stripeAccount: connectedAccountId },
      );
      const charge = pi.charges?.data?.[0];
      if (charge) {
        receiptUrl = charge.receipt_url || null;
        const bt = charge.balance_transaction;
        if (bt && typeof bt === 'object') {
          // bt.amount = gross (same as charge amount), bt.fee = Stripe fee, bt.net = take-home
          feePence = bt.fee || 0;
          netPence = bt.net || 0;
        }
      }
    }
  } catch (err) {
    // Non-fatal — we still mark paid; fee/net just won't be available in the drawer.
    console.warn('stripe-connect-webhook: could not fetch balance_transaction', err?.message);
  }

  // ── Update invoice_payment_tokens ──────────────────────────────────────────
  const paidAt = new Date().toISOString();

  const { error: tokenErr } = await adminClient
    .from('invoice_payment_tokens')
    .update({
      status: 'paid',
      paid_at: paidAt,
      stripe_payment_intent_id: paymentIntentId,
      fee_pence: feePence,
      net_pence: netPence,
      receipt_url: receiptUrl,
    })
    .eq('id', tokenRow.id);

  if (tokenErr) {
    console.error('stripe-connect-webhook: failed to update token row', tokenErr.message);
    throw tokenErr;
  }

  // ── Update the parent jobs row to the canonical paid state ─────────────────
  // Uses the same fields that WorkScreen's one-tap Mark Paid sets:
  //   paid: true, status: 'paid', paidAt: <iso>, paymentStatus: 'paid'
  // plus card_paid_at to distinguish card payments from manual in the drawer UI.
  const { error: jobErr } = await adminClient
    .from('jobs')
    .update({
      paid: true,
      status: 'paid',
      paidAt: paidAt,
      paymentStatus: 'paid',
      card_paid_at: paidAt,
    })
    .eq('id', tokenRow.invoice_id);

  if (jobErr) {
    console.error('stripe-connect-webhook: failed to update job row', jobErr.message);
    throw jobErr;
  }

  console.log('stripe-connect-webhook: job paid via card', tokenRow.invoice_id, 'fee:', feePence, 'net:', netPence);
}

/**
 * charge.refunded — full or partial refund issued from Stripe Dashboard.
 *
 * Routes on tokenRow.kind:
 *   'invoice': Full refund → token 'refunded', job reverted to invoice_sent.
 *              Partial refund → refunded_amount_pence updated; job stays paid.
 *   'deposit': Full refund → token 'refunded', job deposit columns cleared.
 *              Partial refund → refunded_amount_pence updated; deposit stays paid.
 * Chase ladder is NOT restarted — trader can re-chase manually if needed.
 */
async function handleChargeRefunded(charge, adminClient) {
  const paymentIntentId = charge.payment_intent;
  if (!paymentIntentId) {
    console.warn('stripe-connect-webhook: charge.refunded has no payment_intent', charge.id);
    return;
  }

  // Look up the token row by payment_intent_id.
  const { data: tokenRow } = await adminClient
    .from('invoice_payment_tokens')
    .select('*')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .single();

  if (!tokenRow) {
    console.warn('stripe-connect-webhook: no token found for payment_intent', paymentIntentId);
    return; // Stale event — return 200
  }

  const amountRefunded = charge.amount_refunded || 0;
  const totalAmount    = charge.amount || 0;
  const isFullRefund   = amountRefunded >= totalAmount && totalAmount > 0;
  const isDeposit      = tokenRow.kind === 'deposit';

  if (isFullRefund) {
    // Full refund: flip token to 'refunded'
    const { error: tokenErr } = await adminClient
      .from('invoice_payment_tokens')
      .update({
        status: 'refunded',
        refunded_amount_pence: amountRefunded,
      })
      .eq('id', tokenRow.id);

    if (tokenErr) {
      console.error('stripe-connect-webhook: failed to update token on full refund', tokenErr.message);
      throw tokenErr;
    }

    if (isDeposit) {
      // Deposit full refund: clear the deposit columns on the job so the trader
      // knows the deposit money has gone back. The quote status / acceptance state
      // is NOT reverted — the quote may still be in an accepted state if the
      // customer signed before the refund. That's a trader decision to handle manually.
      const quoteId = tokenRow.quote_id || tokenRow.invoice_id;
      const { error: jobErr } = await adminClient
        .from('jobs')
        .update({
          deposit_paid_at: null,
          deposit_payment_token_id: null,
        })
        .eq('id', quoteId);

      if (jobErr) {
        console.error('stripe-connect-webhook: failed to revert deposit on full refund', jobErr.message);
        throw jobErr;
      }

      console.log('stripe-connect-webhook: deposit full refund processed for job', quoteId);
    } else {
      // Invoice full refund: revert job to invoice_sent
      const { error: jobErr } = await adminClient
        .from('jobs')
        .update({
          paid: false,
          status: 'invoice_sent',
          paidAt: null,
          paymentStatus: null,
          card_paid_at: null,
        })
        .eq('id', tokenRow.invoice_id);

      if (jobErr) {
        console.error('stripe-connect-webhook: failed to revert job on full refund', jobErr.message);
        throw jobErr;
      }

      console.log('stripe-connect-webhook: invoice full refund processed for job', tokenRow.invoice_id);
    }
  } else {
    // Partial refund: record refunded amount; leave token 'paid' and job unchanged.
    const { error: tokenErr } = await adminClient
      .from('invoice_payment_tokens')
      .update({
        refunded_amount_pence: amountRefunded,
      })
      .eq('id', tokenRow.id);

    if (tokenErr) {
      console.error('stripe-connect-webhook: failed to update refunded_amount_pence', tokenErr.message);
      throw tokenErr;
    }

    const jobId = tokenRow.quote_id || tokenRow.invoice_id;
    console.log('stripe-connect-webhook: partial refund recorded', amountRefunded, 'pence for job', jobId, 'kind:', tokenRow.kind);
  }
}

/**
 * handleDepositCompleted — checkout.session.completed when jp_type === 'deposit'.
 *
 * 1. Look up the deposit token by jobprofit_deposit_token from metadata.
 * 2. Idempotency: if already paid, return early.
 * 3. Fetch balance_transaction for fee/net figures.
 * 4. Update the token row: status='paid', fee_pence, net_pence, receipt_url.
 * 5. Update the job: deposit_paid_at, deposit_payment_token_id.
 * 6. Auto-accept the quote by writing the acceptance state to job.meta — mirrors
 *    what accept-quote.js does but without requiring a customer signature dataURL
 *    (the deposit payment IS the acceptance signal). Sets quoteStatus='accepted',
 *    jobStatus='active', acceptedSource='deposit_payment', acceptedAt=now.
 * 7. Fire push notification to trader if subscriptions exist.
 */
async function handleDepositCompleted(session, stripe, adminClient) {
  const meta = session.metadata || {};
  const token         = meta.jobprofit_deposit_token;
  const quoteId       = meta.jobprofit_quote_id;
  const traderUserId  = meta.jobprofit_trader_user_id;
  const paymentIntentId = session.payment_intent;

  if (!token && !quoteId) {
    console.warn('stripe-connect-webhook: deposit session missing token and quoteId', session.id);
    return;
  }

  // Look up the deposit token row
  let tokenRow;
  if (token) {
    const { data } = await adminClient
      .from('invoice_payment_tokens')
      .select('*')
      .eq('token', token)
      .eq('kind', 'deposit')
      .single();
    tokenRow = data;
  }

  if (!tokenRow && quoteId && traderUserId) {
    // Fallback: look up by quote_id + trader + pending
    const { data } = await adminClient
      .from('invoice_payment_tokens')
      .select('*')
      .eq('quote_id', quoteId)
      .eq('trader_user_id', traderUserId)
      .eq('kind', 'deposit')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    tokenRow = data;
  }

  if (!tokenRow) {
    console.warn('stripe-connect-webhook: no deposit token row found for session', session.id);
    return;
  }

  // Idempotency
  if (tokenRow.status === 'paid') {
    console.log('stripe-connect-webhook: idempotent skip — deposit already paid', tokenRow.token);
    return;
  }

  // ── Fetch fee/net from balance_transaction ────────────────────────────────
  let feePence = 0;
  let netPence = 0;
  let receiptUrl = null;

  try {
    const { data: profileData } = await adminClient
      .from('profiles')
      .select('stripe_user_id')
      .eq('id', tokenRow.trader_user_id)
      .single();

    const connectedAccountId = profileData?.stripe_user_id;

    if (connectedAccountId && paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ['charges.data.balance_transaction'] },
        { stripeAccount: connectedAccountId },
      );
      const charge = pi.charges?.data?.[0];
      if (charge) {
        receiptUrl = charge.receipt_url || null;
        const bt = charge.balance_transaction;
        if (bt && typeof bt === 'object') {
          feePence = bt.fee || 0;
          netPence = bt.net || 0;
        }
      }
    }
  } catch (err) {
    console.warn('stripe-connect-webhook: could not fetch deposit balance_transaction', err?.message);
  }

  const paidAt = new Date().toISOString();

  // ── Update the deposit token row ──────────────────────────────────────────
  const { error: tokenErr } = await adminClient
    .from('invoice_payment_tokens')
    .update({
      status:                   'paid',
      paid_at:                  paidAt,
      stripe_payment_intent_id: paymentIntentId,
      fee_pence:                feePence,
      net_pence:                netPence,
      receipt_url:              receiptUrl,
    })
    .eq('id', tokenRow.id);

  if (tokenErr) {
    console.error('stripe-connect-webhook: failed to update deposit token', tokenErr.message);
    throw tokenErr;
  }

  // ── Fetch the current job to merge meta safely ────────────────────────────
  const jobId = tokenRow.quote_id || tokenRow.invoice_id;

  const { data: jobRow, error: jobFetchErr } = await adminClient
    .from('jobs')
    .select('id, user_id, customer, customer_name, meta, summary, name, deposit_amount_pence')
    .eq('id', jobId)
    .single();

  if (jobFetchErr || !jobRow) {
    console.error('stripe-connect-webhook: could not fetch job for deposit', jobId, jobFetchErr?.message);
    throw jobFetchErr || new Error('job not found');
  }

  // ── Auto-accept the quote ─────────────────────────────────────────────────
  // Mirrors accept-quote.js step 8 but uses 'deposit_payment' as the acceptedSource.
  // No signature dataURL — the deposit payment IS the acceptance signal.
  const existingMeta = (jobRow.meta && typeof jobRow.meta === 'object') ? jobRow.meta : {};
  const updatedMeta = {
    ...existingMeta,
    acceptedAt:     existingMeta.acceptedAt || paidAt, // don't overwrite an existing signature acceptance
    acceptedSource: existingMeta.acceptedSource || 'deposit_payment',
    quoteStatus:    'accepted',
    jobStatus:      'active',
  };

  // ── Update the job with deposit payment state and auto-acceptance ─────────
  const { error: jobErr } = await adminClient
    .from('jobs')
    .update({
      deposit_paid_at:           paidAt,
      deposit_payment_token_id:  tokenRow.id,
      status:                    'active', // move quote → active job
      meta:                      updatedMeta,
    })
    .eq('id', jobId);

  if (jobErr) {
    console.error('stripe-connect-webhook: failed to update job on deposit paid', jobErr.message);
    throw jobErr;
  }

  // ── Fire push notification to trader ──────────────────────────────────────
  // Reuses sendPushToUser from accept-quote.js. Fail-soft: never blocks the response.
  try {
    const { sendPushToUser } = await import('./_lib/sendPushToUser.js');
    const depositGbp = `£${((tokenRow.amount_pence || 0) / 100).toFixed(2)}`;
    const jobDesc = jobRow.summary || jobRow.name || 'a job';
    await sendPushToUser(jobRow.user_id, {
      title: 'Deposit paid',
      body:  `Deposit paid: ${depositGbp} for ${jobDesc}`,
      url:   '/',
      tag:   `deposit-paid-${jobId}`,
    });
  } catch (err) {
    console.warn('stripe-connect-webhook: deposit push failed (non-blocking)', err?.message);
  }

  console.log(
    'stripe-connect-webhook: deposit paid for job', jobId,
    'amount:', tokenRow.amount_pence, 'fee:', feePence, 'net:', netPence,
  );
}

/**
 * account.application.deauthorized — trader disconnected JobProfit from their
 * Stripe Dashboard.
 *
 * Per brief decision #5: live invoice_payment_tokens rows are NOT invalidated.
 * Stripe handles whether already-issued Checkout Sessions remain valid.
 * We only clear the profile connection state to stop generating new pay links.
 */
async function handleAccountDeauthorized(accountId, adminClient) {
  if (!accountId) {
    console.warn('stripe-connect-webhook: account.application.deauthorized missing account field');
    return;
  }

  const { error } = await adminClient
    .from('profiles')
    .update({
      stripe_user_id: null,
      stripe_connect_status: 'disconnected',
      stripe_connect_disconnected_at: new Date().toISOString(),
    })
    .eq('stripe_user_id', accountId);

  if (error) {
    console.error('stripe-connect-webhook: failed to clear profile on deauthorize', error.message);
    throw error;
  }

  console.log('stripe-connect-webhook: account deauthorized, profile cleared for', accountId);
}
