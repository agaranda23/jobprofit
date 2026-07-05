/**
 * fetch-public-job — Netlify function  (Security H-1 fix)
 *
 * Serves job data for public quote / invoice / receipt pages via a server-side
 * service-role lookup. This replaces the previous anon Supabase client pattern
 * in fetchPublicJob() (store.js) which relied on an RLS policy that allowed any
 * anon client to enumerate every tokenised job row.
 *
 * The new pattern:
 *   - Anon RLS SELECT policy on jobs is DROPPED (see migration 20260606000001).
 *   - Public pages call this function instead of hitting Supabase directly.
 *   - This function uses the service role to do an exact-match token lookup and
 *     returns only the fields the public page needs — never raw meta, never
 *     customer contact details beyond what is embedded in the job document.
 *
 * POST body: { token }   — the publicAccessToken UUID from the /q/<t> /i/<t> /r/<t> URL
 *
 * Response 200 (fields public pages consume):
 *   {
 *     id, name, customer, summary, amount, total,
 *     date, createdAt, paid, paymentType,
 *     lineItems,       — from meta.lineItems or line_items column
 *     quoteStatus,     — from meta (accepted / active)
 *     quoteNumber,     — from meta
 *     invoiceNumber,   — from meta
 *     invoiceDueDate,  — from meta
 *     acceptedSignature, acceptedAt,  — from meta (quote acceptance)
 *     deposit_percent, deposit_amount_pence, deposit_paid_at,  — deposit flow
 *     deposit_due_date,  — from meta (fix/quote-public-vat-validity: already drawn
 *                          on the quote PDF/WhatsApp message via job.deposit_due_date,
 *                          but never reached the public "view & accept" page)
 *     vat,               — from meta (fix/quote-public-vat-validity: voice-quote
 *                          "plus/inc VAT" flag; the public page OR's this with the
 *                          trader's profile-level vatRegistered, mirroring
 *                          generateQuotePDF's showVat logic exactly)
 *     quoteValidUntil,   — from meta (fix/quote-public-vat-validity: per-quote
 *                          "Valid until" override, ISO date YYYY-MM-DD | undefined —
 *                          the public page falls back to issueDate +
 *                          profile.quote_validity_days when absent)
 *   }
 *
 * Fields deliberately EXCLUDED from the response:
 *   - meta (raw JSON — contains all stored state including signatures etc.)
 *   - address, phone, email (customer contact details — not needed on public pages;
 *     trader business contact comes from fetch-public-{quote-profile,invoice,receipt})
 *   - user_id (internal)
 *   - notes, expenses
 *
 * Response 400  { error } — missing / malformed token
 * Response 404  { error } — token not found
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
    console.error('fetch-public-job: missing env vars');
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

  // ── 3. Exact-match token lookup (service role bypasses RLS) ───────────────────
  // Selecting only the columns + meta fields the public pages actually need.
  // Raw meta is NOT returned — we cherry-pick fields from it below.
  let row;
  try {
    const { data, error } = await adminClient
      .from('jobs')
      .select('id, customer_name, summary, amount, paid, payment_type, line_items, meta, date, created_at, payment_date')
      .eq('meta->>publicAccessToken', token)
      .maybeSingle();

    if (error) {
      console.error('fetch-public-job: Supabase query error', error?.message);
      return json(502, { error: 'Could not load — please try again' });
    }
    if (!data) {
      return json(404, { error: 'Not found. The link may be invalid or the document has been removed.' });
    }
    row = data;
  } catch (err) {
    console.error('fetch-public-job: query threw', err?.message);
    return json(502, { error: 'Could not load — please try again' });
  }

  // ── 3b. Revoke check — return 404 (not 500) when the trader killed the link ──
  // The flag lives in meta.publicTokenRevokedAt (ISO timestamp). We return the
  // same 404 shape as "token not found" so customers see a generic "not found"
  // rather than a "revoked" message that could feel accusatory or confusing.
  const metaRaw = (row.meta && typeof row.meta === 'object') ? row.meta : {};
  if (metaRaw.publicTokenRevokedAt) {
    return json(404, { error: 'Not found. The link may be invalid or the document has been removed.' });
  }

  // ── 4. Build the safe public response — cherry-pick from meta, never dump it ──
  const m = (row.meta && typeof row.meta === 'object') ? row.meta : {};

  // lineItems: prefer meta version (post-insert edits), fall back to DB column.
  const lineItems = Array.isArray(m.lineItems) && m.lineItems.length > 0
    ? m.lineItems
    : (Array.isArray(row.line_items) ? row.line_items : []);

  return json(200, {
    // Core job identity
    id:          row.id,
    name:        row.customer_name || row.summary?.slice(0, 40) || 'Job',
    customer:    row.customer_name || '',
    summary:     row.summary || '',
    amount:      Number(row.amount || 0),
    total:       m.total ?? Number(row.amount || 0),
    paid:        row.paid === true,
    paymentType: row.payment_type || null,
    date:        row.payment_date || row.date || null,
    createdAt:   row.created_at,
    lineItems,

    // Quote-specific fields from meta
    quoteStatus:       m.quoteStatus    ?? 'active',
    quoteNumber:       m.quoteNumber    ?? null,
    acceptedSignature: m.acceptedSignature ?? null,
    acceptedAt:        m.acceptedAt     ?? null,
    // declinedAt exposed so RemoteDeclinedBlock can show "Declined on {date}" on revisit.
    // declinedName and declineReason are NOT returned — trader-only data.
    declinedAt:        m.declinedAt     ?? null,

    // Invoice-specific fields from meta
    invoiceNumber:  m.invoiceNumber  ?? null,
    invoiceDueDate: m.invoiceDueDate ?? null,

    // Deposit flow fields (stored as top-level DB columns or in meta)
    deposit_percent:       m.deposit_percent       ?? 0,
    deposit_amount_pence:  m.deposit_amount_pence  ?? null,
    deposit_paid_at:       m.deposit_paid_at        ?? null,
    deposit_due_date:      m.deposit_due_date       ?? null,

    // VAT flag (fix/quote-public-vat-validity) — voice-quote "plus/inc VAT" flag.
    // The public page OR's this with the trader's profile vatRegistered field
    // (from fetch-public-quote-profile) to decide showVat, same as generateQuotePDF.
    vat: m.vat === true,

    // Per-quote "Valid until" override (fix/quote-public-vat-validity). When
    // absent, public pages fall back to issueDate + profile.quote_validity_days —
    // never a change to the trader's global default (see jobMeta.js).
    quoteValidUntil: m.quoteValidUntil ?? null,

    // Payment records from meta (needed for receipt view paid-amount display)
    payments: Array.isArray(m.payments) ? m.payments : [],
  });
};
