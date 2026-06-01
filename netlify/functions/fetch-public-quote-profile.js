/**
 * fetch-public-quote-profile — Netlify function
 *
 * Fetches the trader's business/profile data for a public quote token so
 * the customer-facing hosted quote page can render the full business header
 * (address, phone, email, VAT number, logo) matching the quote PDF.
 *
 * The job row itself is fetched client-side via the anon Supabase key (same
 * mechanism as PublicQuoteView → fetchPublicJob in store.js). This function
 * only resolves the trader's profile that is RLS-protected and therefore
 * cannot be read by the anon client.
 *
 * POST body: { token }   — the publicAccessToken UUID from the /q/<token> URL
 *
 * Response 200:
 *   {
 *     businessName, address, phone, email, logoUrl,
 *     vatRegistered, vatNumber,
 *     utrNumber,
 *     quoteValidityDays,
 *   }
 *
 * Response 400  { error } — missing token
 * Response 404  { error } — token not matched to any job
 * Response 500  { error } — env / server error
 * Response 502  { error } — Supabase failure
 *
 * Required env vars:
 *   VITE_SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (bypasses RLS)
 */

import { createClient } from '@supabase/supabase-js';

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

export const handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Validate env vars ──────────────────────────────────────────────────────
  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('fetch-public-quote-profile: missing env vars');
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 2. Parse and validate body ────────────────────────────────────────────────
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

  // ── 3. Resolve the job by publicAccessToken to get the trader's user_id ───────
  let job;
  try {
    const { data, error } = await adminClient
      .from('jobs')
      .select('id, user_id')
      .eq('meta->>publicAccessToken', token)
      .single();

    if (error || !data) {
      return json(404, { error: 'Quote not found. The link may be invalid or the quote has been removed.' });
    }
    job = data;
  } catch (err) {
    console.error('fetch-public-quote-profile: job lookup threw', err?.message);
    return json(502, { error: 'Could not load quote — please try again' });
  }

  // ── 4. Fetch the trader's profile ─────────────────────────────────────────────
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
        'vat_registered',
        'vat_number',
        'utr_number',
        'quote_validity_days',
        'terms_text',
      ].join(', '))
      .eq('id', job.user_id)
      .single();

    if (error || !data) {
      profile = {};
    } else {
      profile = data;
    }
  } catch (err) {
    console.error('fetch-public-quote-profile: profile lookup threw', err?.message);
    return json(502, { error: 'Could not load quote — please try again' });
  }

  // ── 5. Build the safe public response — only public-safe business fields ───────
  return json(200, {
    businessName:      profile.business_name        || '',
    address:           profile.address              || '',
    phone:             profile.phone                || '',
    email:             profile.email                || '',
    logoUrl:           profile.logo_url             || '',
    website:           profile.website              || '',
    vatRegistered:     profile.vat_registered       ?? false,
    vatNumber:         profile.vat_number           || '',
    utrNumber:         profile.utr_number           || '',
    quoteValidityDays: profile.quote_validity_days  ?? 30,
    termsText:         profile.terms_text           || '',
  });
};
