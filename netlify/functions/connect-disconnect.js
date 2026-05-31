/**
 * connect-disconnect — Netlify function
 *
 * Deauthorises the trader's connected Stripe account and clears the connect
 * fields on their profiles row.
 *
 * POST (no body required — auth token carries the identity)
 *
 * Required env vars (set in Netlify dashboard):
 *   STRIPE_SECRET_KEY          — Stripe secret key
 *   STRIPE_CONNECT_CLIENT_ID   — Connect platform client ID (ca_...)
 *   VITE_SUPABASE_URL          — already set for the browser build
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (bypasses RLS, server only)
 *
 * Response shapes:
 *   200  { disconnected: true, activeLinkCount: 0 }
 *   401  { error } — missing or invalid auth token
 *   404  { error } — trader not connected (no stripe_user_id on their profile)
 *   500  { error } — server configuration error
 *   502  { error } — Stripe or Supabase call failed
 *
 * Note on activeLinkCount: always 0 in PR 1. PR 2 wires this up to the real
 * invoice_payment_tokens table (see TODO below).
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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Validate env vars ─────────────────────────────────────────────────────
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const connectClientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  const supabaseUrl     = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !connectClientId || !supabaseUrl || !serviceRoleKey) {
    console.error(
      'connect-disconnect: missing env vars.',
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
    console.error('connect-disconnect: auth.getUser threw', err?.message);
    return json(401, { error: 'Could not verify token' });
  }

  // ── 3. Fetch the trader's stripe_user_id ────────────────────────────────────
  let stripeUserId;
  try {
    const { data: profile, error } = await adminClient
      .from('profiles')
      .select('stripe_user_id')
      .eq('id', userId)
      .single();

    if (error || !profile?.stripe_user_id) {
      return json(404, { error: 'No connected Stripe account found' });
    }
    stripeUserId = profile.stripe_user_id;
  } catch (err) {
    console.error('connect-disconnect: profile fetch failed', err?.message);
    return json(502, { error: 'Could not retrieve profile' });
  }

  // ── 4. Count active Pay-now links (PR 2: real query against invoice_payment_tokens) ──
  // Returns the number of invoice payment tokens that are still pending (not paid,
  // not expired, not cancelled) and haven't passed their stored expiry. The frontend
  // uses this count to show the warning copy in the disconnect confirm sheet when
  // count > 0: "X invoice[s] still have an active Pay-now link..."
  let activeLinkCount = 0;
  try {
    const { count, error: countError } = await adminClient
      .from('invoice_payment_tokens')
      .select('id', { count: 'exact', head: true })
      .eq('trader_user_id', userId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString());

    if (!countError && typeof count === 'number') {
      activeLinkCount = count;
    }
  } catch {
    // Non-fatal — if the count fails, we show 0 (base copy). Better to
    // allow the disconnect than to block it on a non-critical query.
  }

  // ── 5. Deauthorise via Stripe OAuth ─────────────────────────────────────────
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

  try {
    await stripe.oauth.deauthorize({
      client_id: connectClientId,
      stripe_user_id: stripeUserId,
    });
  } catch (err) {
    // Stripe returns an error if the account was already deauthorised manually from
    // the Stripe dashboard. We treat this as a no-op — still clear our DB state.
    console.warn('connect-disconnect: Stripe deauthorize failed (may already be disconnected)', err?.message);
  }

  // ── 6. Clear the profile fields ──────────────────────────────────────────────
  try {
    const { error: updateError } = await adminClient
      .from('profiles')
      .update({
        stripe_user_id: null,
        stripe_connect_status: 'disconnected',
        stripe_connect_disconnected_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateError) {
      console.error('connect-disconnect: DB update failed', userId, updateError?.message);
      return json(502, { error: 'Could not update account record — please try again' });
    }
  } catch (err) {
    console.error('connect-disconnect: DB update threw', err?.message);
    return json(502, { error: 'Could not update account record — please try again' });
  }

  return json(200, { disconnected: true, activeLinkCount });
};
