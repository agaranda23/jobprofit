/**
 * fetch-public-invoice — Netlify function
 *
 * Fetches the trader's business/profile data for a public invoice token so
 * the customer-facing hosted invoice page can render bank details, VAT number,
 * logo URL, Stripe connection status, and the Pay-now capability.
 *
 * The job row itself is fetched client-side via the anon Supabase key (same
 * mechanism as the public quote page — fetchPublicJob in store.js). This
 * function's job is only to resolve the trader's profile that is RLS-protected
 * and therefore cannot be read by the anon client.
 *
 * POST body: { token }   — the publicAccessToken UUID from the /i/<token> URL
 *
 * Response 200:
 *   {
 *     businessName, address, phone, email, logoUrl,
 *     vatRegistered, vatNumber,
 *     accountName, sortCode, accountNumber, bankDetails,
 *     isConnected,          — true when stripe_connect_status === 'connected'
 *     stripePaymentLink,    — static payment link (legacy fallback)
 *     isCisSubcontractor,   — for CIS deduction rendering
 *     cisDefaultRate,
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
    console.error('fetch-public-invoice: missing env vars');
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
  // We look up via the JSONB path meta->>publicAccessToken (same query used by
  // the anon client in store.fetchPublicJob — service-role bypasses RLS here so
  // we can join straight to profiles without a second query).
  let job;
  try {
    const { data, error } = await adminClient
      .from('jobs')
      .select('id, user_id, meta')
      .eq('meta->>publicAccessToken', token)
      .single();

    if (error || !data) {
      return json(404, { error: 'Invoice not found. The link may be invalid or the invoice has been removed.' });
    }
    job = data;
  } catch (err) {
    console.error('fetch-public-invoice: job lookup threw', err?.message);
    return json(502, { error: 'Could not load invoice — please try again' });
  }

  // ── 3b. Revoke check ─────────────────────────────────────────────────────────
  const jobMeta = (job.meta && typeof job.meta === 'object') ? job.meta : {};
  if (jobMeta.publicTokenRevokedAt) {
    return json(404, { error: 'Invoice not found. The link may be invalid or the invoice has been removed.' });
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
        'account_name',
        'sort_code',
        'account_number',
        'bank_details',
        'stripe_connect_status',
        'stripe_user_id',
        'stripe_payment_link',
        'is_cis_subcontractor',
        'cis_default_rate',
        'utr_number',
        'itemise_documents',
        'payment_terms_days',
        'terms_text',
        'plan',
        'trial_ends_at',
      ].join(', '))
      .eq('id', job.user_id)
      .single();

    if (error || !data) {
      // Job found but profile missing — return safe empty profile rather than 404.
      // The page can still render with blank business details.
      profile = {};
    } else {
      profile = data;
    }
  } catch (err) {
    console.error('fetch-public-invoice: profile lookup threw', err?.message);
    return json(502, { error: 'Could not load invoice — please try again' });
  }

  // ── 5. Build the safe public response — never expose internal columns ─────────
  // isPro: used by the public page to hide the "Sent with JobProfit" footer (white-label perk).
  // Computed server-side so the public page never receives the raw plan/trial_ends_at fields.
  const isTraderPro = profile.plan === 'pro' ||
    (profile.plan === 'trial' && profile.trial_ends_at && new Date(profile.trial_ends_at) > new Date());

  return json(200, {
    businessName:       profile.business_name       || '',
    address:            profile.address              || '',
    phone:              profile.phone                || '',
    email:              profile.email                || '',
    logoUrl:            profile.logo_url             || '',
    website:            profile.website              || '',
    vatRegistered:      profile.vat_registered       ?? false,
    vatNumber:          profile.vat_number           || '',
    accountName:        profile.account_name         || '',
    sortCode:           profile.sort_code            || '',
    accountNumber:      profile.account_number       || '',
    bankDetails:        profile.bank_details         || '',
    // isConnected: true means create-invoice-payment-link will work.
    // We expose this flag — not the raw stripe_user_id — so the client can
    // decide whether to show the Pay-now button.
    isConnected:        profile.stripe_connect_status === 'connected' && !!profile.stripe_user_id,
    // Static payment link (legacy fallback for non-connected traders who pasted one manually).
    stripePaymentLink:  profile.stripe_payment_link  || '',
    isCisSubcontractor: profile.is_cis_subcontractor ?? false,
    cisDefaultRate:     profile.cis_default_rate     ?? 20,
    utrNumber:          profile.utr_number            || '',
    itemiseDocuments:   profile.itemise_documents     ?? false,
    paymentTermsDays:   profile.payment_terms_days    ?? 14,
    termsText:          profile.terms_text            || '',
    // isPro: true hides the "Sent with JobProfit" footer on the public invoice page.
    isPro:              isTraderPro,
  });
};
