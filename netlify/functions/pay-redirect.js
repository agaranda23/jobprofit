/**
 * pay-redirect — Netlify function
 *
 * Handles GET /p/<token> — redirects to the Stripe Checkout Session URL
 * for the Pay-now link on an invoice.
 *
 * This is a public endpoint (no auth required). The token acts as a
 * URL-as-capability: knowing it is sufficient proof the customer received it.
 *
 * Redirect behaviour:
 *   - Token found and session active → 302 to Stripe Checkout URL
 *   - Token found but session expired → 200 HTML "link expired" page
 *     (deliberate: we do NOT auto-regenerate because the trader may have
 *     disconnected or the invoice may now be paid. Auto-regenerating a new
 *     Stripe session without the trader's knowledge would silently extend
 *     a payment window they may have chosen to close. The "contact trader"
 *     copy gives the customer a clear next step without creating confusion.)
 *   - Token not found → 404 HTML page
 *
 * Wired via netlify.toml redirect: /p/* → /.netlify/functions/pay-redirect 200
 * The token is extracted from the path in the event object.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY         — Stripe secret key
 *   VITE_SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS)
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
};

function htmlPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} — JobProfit</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f8f8f8; margin: 0; padding: 40px 20px; text-align: center; }
    .card { background: #fff; border-radius: 12px; padding: 32px 24px;
            max-width: 420px; margin: 0 auto; box-shadow: 0 2px 12px rgba(0,0,0,.08); }
    h1 { font-size: 1.25rem; margin: 0 0 12px; color: #141414; }
    p  { color: #505050; font-size: 0.95rem; line-height: 1.5; margin: 0 0 8px; }
    .badge { font-size: 2rem; margin-bottom: 16px; }
  </style>
</head>
<body>
  <div class="card">
    ${body}
  </div>
</body>
</html>`;
}

export const handler = async function (event) {
  // Only GET is valid for a redirect endpoint.
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
    return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed' };
  }

  // ── 1. Extract token from path ────────────────────────────────────────────────
  // Path is /p/<token> when routed via netlify.toml.
  const rawPath = event.path || '';
  const match = /\/p\/([^/?#]+)/.exec(rawPath);
  const token = match ? match[1] : null;

  if (!token) {
    return {
      statusCode: 404,
      headers: HTML_HEADERS,
      body: htmlPage('Link not found', `
        <div class="badge">❓</div>
        <h1>Link not found</h1>
        <p>This payment link doesn't exist. Please check the link or contact the trader who sent it.</p>
      `),
    };
  }

  // ── 2. Validate env vars ─────────────────────────────────────────────────────
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl     = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
    console.error('pay-redirect: missing env vars');
    return {
      statusCode: 503,
      headers: HTML_HEADERS,
      body: htmlPage('Temporarily unavailable', `
        <div class="badge">⚙️</div>
        <h1>Temporarily unavailable</h1>
        <p>Please try again in a moment or contact the trader directly.</p>
      `),
    };
  }

  // ── 3. Look up the token in Supabase ─────────────────────────────────────────
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let tokenRow;
  try {
    const { data, error } = await adminClient
      .from('invoice_payment_tokens')
      .select('stripe_checkout_session_id, status, expires_at, trader_user_id')
      .eq('token', token)
      .single();

    if (error || !data) {
      return {
        statusCode: 404,
        headers: HTML_HEADERS,
        body: htmlPage('Link not found', `
          <div class="badge">❓</div>
          <h1>Link not found</h1>
          <p>This payment link doesn't exist or may have been removed. Contact the trader who sent you the invoice.</p>
        `),
      };
    }
    tokenRow = data;
  } catch (err) {
    console.error('pay-redirect: token lookup threw', err?.message);
    return {
      statusCode: 503,
      headers: HTML_HEADERS,
      body: htmlPage('Temporarily unavailable', `
        <div class="badge">⚙️</div>
        <h1>Temporarily unavailable</h1>
        <p>Please try again shortly or contact the trader directly.</p>
      `),
    };
  }

  // ── 4. Check for already-paid or cancelled status ────────────────────────────
  if (tokenRow.status === 'paid') {
    return {
      statusCode: 200,
      headers: HTML_HEADERS,
      body: htmlPage('Payment received', `
        <div class="badge">✅</div>
        <h1>Payment already received</h1>
        <p>This invoice has been paid. Thank you — the trader has been notified.</p>
      `),
    };
  }

  if (tokenRow.status === 'refunded') {
    return {
      statusCode: 200,
      headers: HTML_HEADERS,
      body: htmlPage('Payment refunded', `
        <div class="badge">↩️</div>
        <h1>Payment refunded</h1>
        <p>A refund has been issued for this invoice. Contact the trader if you have questions.</p>
      `),
    };
  }

  // ── 5. Check our stored expiry before hitting Stripe ────────────────────────
  // If our DB expiry has passed, the Stripe session is definitely gone.
  // We show a "link expired" page rather than auto-regenerating — see rationale
  // in the module docblock above.
  const expiresAt = new Date(tokenRow.expires_at);
  if (expiresAt <= new Date()) {
    // Mark as expired in our DB (fire-and-forget — don't block the response)
    adminClient
      .from('invoice_payment_tokens')
      .update({ status: 'expired' })
      .eq('token', token)
      .then(() => {})
      .catch(() => {});

    return {
      statusCode: 200,
      headers: HTML_HEADERS,
      body: htmlPage('Link expired', `
        <div class="badge">⏱</div>
        <h1>Payment link expired</h1>
        <p>This link was only valid for 24 hours and has now expired.</p>
        <p>Contact the trader and ask them to send a new invoice with a fresh Pay-now link.</p>
      `),
    };
  }

  // ── 6. Fetch the live Checkout Session URL from Stripe ───────────────────────
  // We need the connected account's stripe_user_id to fetch the session.
  let stripeUserId;
  try {
    const { data: profileData } = await adminClient
      .from('profiles')
      .select('stripe_user_id')
      .eq('id', tokenRow.trader_user_id)
      .single();
    stripeUserId = profileData?.stripe_user_id;
  } catch {
    // If we can't get the account, fall back gracefully.
  }

  if (!stripeUserId) {
    return {
      statusCode: 200,
      headers: HTML_HEADERS,
      body: htmlPage('Link unavailable', `
        <div class="badge">⚙️</div>
        <h1>Payment link unavailable</h1>
        <p>The trader's payment account is no longer connected. Contact them directly to arrange payment.</p>
      `),
    };
  }

  let checkoutUrl;
  try {
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });
    const session = await stripe.checkout.sessions.retrieve(
      tokenRow.stripe_checkout_session_id,
      {},
      { stripeAccount: stripeUserId },
    );

    // If Stripe itself reports the session as expired or complete, respect that.
    if (session.status === 'expired') {
      adminClient
        .from('invoice_payment_tokens')
        .update({ status: 'expired' })
        .eq('token', token)
        .then(() => {})
        .catch(() => {});

      return {
        statusCode: 200,
        headers: HTML_HEADERS,
        body: htmlPage('Link expired', `
          <div class="badge">⏱</div>
          <h1>Payment link expired</h1>
          <p>This link has expired. Contact the trader and ask them to send a new Pay-now link.</p>
        `),
      };
    }

    if (session.status === 'complete') {
      return {
        statusCode: 200,
        headers: HTML_HEADERS,
        body: htmlPage('Payment received', `
          <div class="badge">✅</div>
          <h1>Payment already received</h1>
          <p>This invoice has been paid. Thank you.</p>
        `),
      };
    }

    checkoutUrl = session.url;
  } catch (err) {
    console.error('pay-redirect: Stripe session retrieve failed', err?.message);
    return {
      statusCode: 503,
      headers: HTML_HEADERS,
      body: htmlPage('Temporarily unavailable', `
        <div class="badge">⚙️</div>
        <h1>Temporarily unavailable</h1>
        <p>Please try again in a moment or contact the trader directly.</p>
      `),
    };
  }

  if (!checkoutUrl) {
    return {
      statusCode: 503,
      headers: HTML_HEADERS,
      body: htmlPage('Temporarily unavailable', `
        <div class="badge">⚙️</div>
        <h1>Temporarily unavailable</h1>
        <p>Please try again in a moment or contact the trader directly.</p>
      `),
    };
  }

  // ── 7. Redirect to Stripe Checkout ────────────────────────────────────────────
  return {
    statusCode: 302,
    headers: {
      Location: checkoutUrl,
      'Cache-Control': 'no-store',
    },
    body: '',
  };
};
