/**
 * create-portal — Netlify function
 *
 * Creates a Stripe Billing Portal session so a Pro subscriber can manage their
 * subscription (update card, cancel, view invoices) without leaving the app.
 *
 * POST (no body required — auth token carries the identity)
 *
 * Required env vars (set in Netlify dashboard):
 *   STRIPE_SECRET_KEY        — Stripe secret key
 *   VITE_SUPABASE_URL        — already set for the browser build
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS, server only)
 *   APP_URL                  — optional; base URL for the return_url redirect
 *
 * Response shapes:
 *   200  { url }   — Stripe Billing Portal URL; redirect the browser here
 *   400  { error } — user has no Stripe customer record yet (hasn't paid)
 *   401  { error } — missing or invalid auth token
 *   500  { error } — server configuration error
 *   502  { error } — Stripe or Supabase call failed
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
  const supabaseUrl     = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !supabaseUrl || !serviceRoleKey) {
    console.error(
      'create-portal: missing env vars.',
      'STRIPE_SECRET_KEY:', !!stripeSecretKey,
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
    console.error('create-portal: auth.getUser threw', err?.message);
    return json(401, { error: 'Could not verify token' });
  }

  // ── 3. Fetch stripe_customer_id from profiles ────────────────────────────────
  let stripeCustomerId;
  try {
    const { data: profile, error } = await adminClient
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    if (error || !profile?.stripe_customer_id) {
      return json(400, { error: 'No billing record found — you have not subscribed yet' });
    }
    stripeCustomerId = profile.stripe_customer_id;
  } catch (err) {
    console.error('create-portal: profile fetch failed', err?.message);
    return json(502, { error: 'Could not retrieve billing record' });
  }

  // ── 4. Build return URL ──────────────────────────────────────────────────────
  const appBase  = (process.env.APP_URL || event.headers?.origin || '').replace(/\/$/, '');
  const returnUrl = `${appBase}/#/settings`;

  // ── 5. Create Stripe Billing Portal session ──────────────────────────────────
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

  let portalSession;
  try {
    portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    });
  } catch (err) {
    console.error('create-portal: Stripe billing portal create failed', err?.message);
    return json(502, { error: 'Could not open billing portal — please try again' });
  }

  return json(200, { url: portalSession.url });
};
