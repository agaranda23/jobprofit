/**
 * fetch-books-summary — Netlify function (feat/accountant-books-link)
 *
 * Serves a READ-ONLY financial summary (income, expenses, VAT, tax estimate,
 * invoiced jobs, receipts, customer totals) for one trader, given their
 * revocable `books_share_token`. Powers the public "books link" page at
 * /books/<token> — the read-only view a Pro trader hands to their accountant.
 *
 * SECURITY MODEL — mirrors the CURRENT (post-H-1-fix) public-job pattern in
 * fetch-public-job.js: SERVICE ROLE ONLY, no anon RLS policy anywhere. The
 * trader is resolved EXCLUSIVELY by an exact-match token lookup server-side;
 * the request body's token is the only input that selects whose data comes
 * back — any other body field (user_id, trader_id, profile_id, ...) is never
 * read, so it cannot be used to redirect the query at another trader's row.
 *
 * WHITELIST-SHAPE RESPONSE — every object returned (top level, and every
 * nested job/receipt/customer item) is built by computeBooksSummary() /
 * pickAllowed() in ./_lib/booksSummaryCalc.js against a hardcoded allow-list.
 * This function's own Supabase .select() calls are ALSO explicit column
 * lists — never select('*') — so a future column added to `profiles` (e.g. a
 * new stripe_* or bank field) cannot leak here by accident; it would have to
 * be added to the select AND to the allow-list AND survive review of this
 * file's diff before it could ever reach the response.
 *
 * NEVER returned, by construction: sort_code, account_number, account_name,
 * any stripe_* field, user_id, or raw jobs.meta / profiles row.
 *
 * PRO RE-CHECK AT FETCH TIME — a valid response requires the token to match
 * AND the trader to be Pro *right now* (isProNow(profile)), not just at the
 * moment the link was minted. If a Pro trader lapses to free, their books
 * link auto-denies on the next load — no orphaned link leaking books after a
 * downgrade. This mirrors the white-label-returns-on-downgrade behaviour
 * elsewhere in the app.
 *
 * POST body: { token, period?, customStart?, customEnd? }
 *   period: 'this_tax_year' (default) | 'last_tax_year' | 'this_quarter' | 'custom'
 *   customStart/customEnd: 'YYYY-MM-DD', only used when period === 'custom'
 *
 * Response 200: see computeBooksSummary()'s TOP_LEVEL_ALLOWED_KEYS shape.
 * Response 400  { error } — missing/malformed token, or invalid period value
 * Response 404  { error } — token not found / revoked / trader not Pro
 * Response 500  { error } — env / server error
 * Response 502  { error } — Supabase failure
 *
 * Required env vars:
 *   VITE_SUPABASE_URL          — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role key (bypasses RLS)
 *
 * This file must never write to any table (no insert/update/delete/upsert
 * calls) — it is read-only by design (enforced by a static-source test).
 */

import { createClient } from '@supabase/supabase-js';
import { computeBooksSummary, isValidBooksPeriod, isProNow } from './_lib/booksSummaryCalc.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

/** UUID v4 shape — matches crypto.randomUUID() output (see publicBooksToken.js). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Generic 404 body — used for every "no valid link" case (unknown token,
// malformed-but-past-the-format-check token, revoked token, non-Pro trader).
// Deliberately identical across all of these so a caller probing the endpoint
// cannot distinguish "wrong token" from "right token, but revoked/downgraded".
const NOT_FOUND_BODY = { error: 'Not found. This link may be invalid or has been revoked.' };

// Explicit column whitelist for the profile lookup — never select('*').
// Excludes sort_code / account_number / account_name / stripe_* / utr_number
// deliberately: an accountant reviewing income/expenses/VAT has no need for
// the trader's own bank account, Stripe IDs, or personal tax reference.
const PROFILE_SELECT = [
  'id',
  'business_name',
  'address',
  'vat_number',
  'logo_url',
  'tax_set_aside_pct',
  'payment_terms_days',
  'plan',
  'trial_ends_at',
].join(', ');

// jobs.meta is selected because invoiceNumber/invoiceSentAt live there (see
// jobMeta.js) — computeBooksSummary() cherry-picks only those two keys back
// out; the raw meta object (which also carries signatures, notes, photos,
// etc.) is never included in the response.
const JOBS_SELECT = 'id, customer_name, summary, amount, paid, date, payment_date, meta';
const RECEIPTS_SELECT = 'id, merchant, amount, vat, date, created_at';

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

  // ── 1. Validate env vars ──────────────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('fetch-books-summary: missing env vars');
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 2. Parse and validate body ────────────────────────────────────────────
  // Only token/period/customStart/customEnd are ever read. Any other field
  // (user_id, trader_id, profile_id, ...) a caller includes is silently
  // ignored — the trader is resolved exclusively from the token match below.
  let token, period, customStart, customEnd;
  try {
    const body = JSON.parse(event.body || '{}');
    token = body.token;
    period = body.period || 'this_tax_year';
    customStart = body.customStart;
    customEnd = body.customEnd;
  } catch {
    return json(400, { error: 'Invalid request body' });
  }

  if (!token || typeof token !== 'string' || !UUID_RE.test(token)) {
    return json(400, { error: 'token is required and must be a valid UUID' });
  }

  if (!isValidBooksPeriod(period)) {
    return json(400, { error: 'Invalid period' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 3. Resolve the trader by exact-match token lookup ─────────────────────
  let profileRow;
  try {
    const { data, error } = await adminClient
      .from('profiles')
      .select(PROFILE_SELECT)
      .eq('books_share_token', token)
      .maybeSingle();

    if (error) {
      console.error('fetch-books-summary: profile lookup error', error?.message);
      return json(502, { error: 'Could not load — please try again' });
    }
    if (!data) {
      return json(404, NOT_FOUND_BODY);
    }
    profileRow = data;
  } catch (err) {
    console.error('fetch-books-summary: profile lookup threw', err?.message);
    return json(502, { error: 'Could not load — please try again' });
  }

  // ── 3b. Pro re-check AT FETCH TIME, not just at mint time ─────────────────
  // A lapsed-to-free trader's link must deny, even if it was minted while Pro.
  if (!isProNow(profileRow)) {
    return json(404, NOT_FOUND_BODY);
  }

  // ── 4. Fetch this trader's jobs + receipts (scoped by the resolved id ONLY,
  //       never by anything from the request body) ─────────────────────────
  let jobsData, receiptsData;
  try {
    const [jobsRes, receiptsRes] = await Promise.all([
      adminClient.from('jobs').select(JOBS_SELECT).eq('user_id', profileRow.id),
      adminClient.from('receipts').select(RECEIPTS_SELECT).eq('user_id', profileRow.id),
    ]);
    if (jobsRes.error || receiptsRes.error) {
      console.error(
        'fetch-books-summary: jobs/receipts query error',
        jobsRes.error?.message,
        receiptsRes.error?.message,
      );
      return json(502, { error: 'Could not load — please try again' });
    }
    jobsData = jobsRes.data || [];
    receiptsData = receiptsRes.data || [];
  } catch (err) {
    console.error('fetch-books-summary: jobs/receipts query threw', err?.message);
    return json(502, { error: 'Could not load — please try again' });
  }

  // ── 5. Compute + return the whitelist-shaped summary ──────────────────────
  const summary = computeBooksSummary({
    profile: profileRow,
    jobs: jobsData,
    receipts: receiptsData,
    period,
    customStart,
    customEnd,
  });

  return json(200, summary);
};
