/**
 * connect-oauth-start — Netlify function
 *
 * Generates a Stripe Connect OAuth URL so a trader can link their own Stripe
 * account (Standard mode — decision #2, locked 2026-05-31). The browser is
 * redirected to the returned URL by the frontend; it never leaves the app.
 *
 * Standard Connect means the trader creates or links their own Stripe account.
 * JobProfit never holds funds. Money goes straight to the trader's bank.
 *
 * POST (no body required — auth token carries the identity)
 *
 * Required env vars (set in Netlify dashboard):
 *   STRIPE_SECRET_KEY          — Stripe secret key
 *   STRIPE_CONNECT_CLIENT_ID   — Stripe dashboard → Connect → Settings → Client ID (ca_...)
 *   VITE_SUPABASE_URL          — already set for the browser build
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (bypasses RLS, server only)
 *   APP_URL                    — optional; base URL for the OAuth redirect
 *
 * Response shapes:
 *   200  { url }   — Stripe Connect OAuth URL; redirect the browser here
 *   401  { error } — missing or invalid auth token
 *   500  { error } — server configuration error
 *   502  { error } — could not generate the URL
 *
 * CSRF safety: a signed state token is generated per request using a HMAC-SHA256
 * over (userId + nonce + expiry) using STRIPE_CONNECT_CLIENT_ID as the key.
 * The callback validates this state before exchanging the code.
 */

import { createClient } from '@supabase/supabase-js';
import { createHmac, randomBytes } from 'crypto';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

/**
 * Builds a signed state token: base64url(userId + '.' + nonce + '.' + expiry + '.' + sig)
 * The sig is HMAC-SHA256(userId + '|' + nonce + '|' + expiry, secret).
 * 10-minute expiry window — enough for the OAuth round-trip.
 */
function buildStateToken(userId, secret) {
  const nonce  = randomBytes(16).toString('hex');
  const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  const payload = `${userId}|${nonce}|${expiry}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  const raw = `${payload}|${sig}`;
  return Buffer.from(raw).toString('base64url');
}

export const handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Validate env vars ─────────────────────────────────────────────────────
  const stripeSecretKey  = process.env.STRIPE_SECRET_KEY;
  const connectClientId  = process.env.STRIPE_CONNECT_CLIENT_ID;
  const supabaseUrl      = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey   = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !connectClientId || !supabaseUrl || !serviceRoleKey) {
    console.error(
      'connect-oauth-start: missing env vars.',
      'STRIPE_SECRET_KEY:', !!stripeSecretKey,
      'STRIPE_CONNECT_CLIENT_ID:', !!connectClientId,
      'VITE_SUPABASE_URL:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY:', !!serviceRoleKey,
    );
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 2. Authenticate the caller via Supabase ──────────────────────────────────
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!token) {
    return json(401, { error: 'Missing authorization token' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let userId;
  try {
    const { data: { user }, error } = await adminClient.auth.getUser(token);
    if (error || !user) {
      return json(401, { error: 'Invalid or expired token' });
    }
    userId = user.id;
  } catch (err) {
    console.error('connect-oauth-start: auth.getUser threw', err?.message);
    return json(401, { error: 'Could not verify token' });
  }

  // ── 3. Build the OAuth callback URL ─────────────────────────────────────────
  // The callback must match a URL registered in the Stripe Connect settings.
  // We use /.netlify/functions/connect-oauth-callback so Stripe can redirect
  // the trader's browser back to our function after they authorise.
  const appBase = (process.env.APP_URL || event.headers?.origin || '').replace(/\/$/, '');
  const redirectUri = `${appBase}/.netlify/functions/connect-oauth-callback`;

  // ── 4. Generate a CSRF state token ──────────────────────────────────────────
  // Uses STRIPE_CONNECT_CLIENT_ID as the HMAC secret so the key is already
  // available in Netlify env (no new secret needed for v1).
  const state = buildStateToken(userId, connectClientId);

  // ── 5. Build the Stripe Connect OAuth URL ───────────────────────────────────
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: connectClientId,
    scope: 'read_write',
    redirect_uri: redirectUri,
    state,
    // Pre-fill the trader's intended account type
    'stripe_user[business_type]': 'sole_prop',
    // Country hint — UK-first ICP
    'stripe_user[country]': 'GB',
  });

  const oauthUrl = `https://connect.stripe.com/oauth/authorize?${params.toString()}`;

  return json(200, { url: oauthUrl });
};
