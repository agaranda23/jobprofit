/**
 * fetch-public-receipt — Netlify function
 *
 * Fetches the trader's business/profile data for a public receipt token so
 * the customer-facing hosted receipt page (/r/<token>) can render the branded
 * receipt with logo, business name, and payment confirmation.
 *
 * Mirrors fetch-public-invoice.js exactly — same token resolution mechanism,
 * same service-role profile lookup, same CORS headers. The only difference is
 * the response shape: receipts are simpler (no VAT, no bank details, no Stripe).
 *
 * POST body: { token }   — the publicAccessToken UUID from the /r/<token> URL
 *
 * Response 200:
 *   {
 *     businessName, address, phone, email, logoUrl,
 *   }
 *
 * Response 400  { error } — missing / malformed token
 * Response 404  { error } — token not matched to any job
 * Response 500  { error } — env / server error
 * Response 502  { error } — Supabase failure
 *
 * Required env vars (same as fetch-public-invoice):
 *   VITE_SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (bypasses RLS)
 */

import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('fetch-public-receipt: missing env vars');
    return json(500, { error: 'Server configuration error — contact support' });
  }

  let token;
  try {
    const body = JSON.parse(event.body || '{}');
    token = body.token;
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  if (!token || typeof token !== 'string' || !UUID_RE.test(token)) {
    return json(400, { error: 'token is required and must be a valid UUID' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Resolve the job by publicAccessToken to get the trader's user_id.
  let job;
  try {
    const { data, error } = await adminClient
      .from('jobs')
      .select('id, user_id, meta')
      .eq('meta->>publicAccessToken', token)
      .single();

    if (error || !data) {
      return json(404, { error: 'Receipt not found. The link may be invalid or the receipt has been removed.' });
    }
    job = data;
  } catch (err) {
    console.error('fetch-public-receipt: job lookup threw', err?.message);
    return json(502, { error: 'Could not load receipt — please try again' });
  }

  // Revoke check — 404 beats 500 when the trader killed the link.
  const jobMeta = (job.meta && typeof job.meta === 'object') ? job.meta : {};
  if (jobMeta.publicTokenRevokedAt) {
    return json(404, { error: 'Receipt not found. The link may be invalid or the receipt has been removed.' });
  }

  // Fetch the trader's profile.
  let profile;
  try {
    const { data, error } = await adminClient
      .from('profiles')
      .select([
        'business_name',
        'address',
        'phone',
        'email',
        'logo_url',
        'website',
        'vat_number',
        'utr_number',
        'plan',
        'trial_ends_at',
      ].join(', '))
      .eq('id', job.user_id)
      .single();

    if (error || !data) {
      profile = {};
    } else {
      profile = data;
    }
  } catch (err) {
    console.error('fetch-public-receipt: profile lookup threw', err?.message);
    return json(502, { error: 'Could not load receipt — please try again' });
  }

  // isPro: used by the public page to hide the "Sent with JobProfit" footer (white-label perk).
  const isTraderPro = profile.plan === 'pro' ||
    (profile.plan === 'trial' && profile.trial_ends_at && new Date(profile.trial_ends_at) > new Date());

  return json(200, {
    businessName:  profile.business_name  || '',
    address:       profile.address        || '',
    phone:         profile.phone          || '',
    email:         profile.email          || '',
    logoUrl:       profile.logo_url       || '',
    website:       profile.website        || '',
    vatRegistered: !!profile.vat_number,
    vatNumber:     profile.vat_number     || '',
    utrNumber:     profile.utr_number     || '',
    // isPro: true hides the "Sent with JobProfit" footer on the public receipt page.
    isPro:         isTraderPro,
  });
};
