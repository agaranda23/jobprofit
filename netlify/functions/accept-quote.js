/**
 * accept-quote — Netlify function (Phase G-2)
 *
 * Receives a customer signature from the public quote page and writes it to
 * the jobs row via the service-role client (bypasses RLS, safe only server-side).
 *
 * POST body (JSON):
 *   { token: string, signature: string, acceptedName?: string }
 *
 * Required env vars (set in Netlify dashboard — NEVER commit to the repo):
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase dashboard → Project Settings → API → service_role
 *   VITE_SUPABASE_URL          — already set for the browser build; reused here
 *
 * Response shapes:
 *   200  { acceptedAt, alreadyAccepted? }
 *   400  { error: 'validation error message' }
 *   404  { error: 'token not found' }
 *   500  { error: 'server configuration error' }
 *   502  { error: 'database error' }
 */

import { createClient } from '@supabase/supabase-js';
import { sendPushToUser } from './_lib/sendPushToUser.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

/** UUID v4 shape — must match isValidToken in publicQuoteToken.js */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** data:image/png;base64,... prefix */
const DATA_URL_PREFIX = 'data:image/png;base64,';

/** Maximum signature payload: 200 KB expressed as base64 character count */
const MAX_SIG_CHARS = Math.ceil((200 * 1024 * 4) / 3);

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

export const handler = async function (event) {
  // Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Parse body ────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { token, signature, acceptedName, consentGiven } = body;

  // ── 2. Validate token ────────────────────────────────────────────────────────
  if (typeof token !== 'string' || !UUID_RE.test(token)) {
    return json(400, { error: 'Invalid token format' });
  }

  // ── 3. Validate signature ────────────────────────────────────────────────────
  if (typeof signature !== 'string') {
    return json(400, { error: 'Signature is required' });
  }
  if (!signature.startsWith(DATA_URL_PREFIX)) {
    return json(400, { error: 'Signature must be a PNG dataURL' });
  }
  if (signature.length > MAX_SIG_CHARS + DATA_URL_PREFIX.length) {
    return json(400, { error: 'Signature exceeds maximum size (200 KB)' });
  }

  // acceptedName is optional; strip to plain string if present
  const cleanName = acceptedName && typeof acceptedName === 'string'
    ? acceptedName.trim().slice(0, 200)
    : null;

  // ── 4. Validate env vars ─────────────────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    // Log clearly so Netlify function logs surface the misconfiguration
    console.error(
      'accept-quote: missing env vars.',
      'VITE_SUPABASE_URL present:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY present:', !!serviceRoleKey
    );
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 5. Initialize service-role Supabase client ───────────────────────────────
  // Service role bypasses RLS — only used server-side, never exposed to the browser.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 6. Find the job by token ─────────────────────────────────────────────────
  let jobRow;
  try {
    const { data, error } = await adminClient
      .from('jobs')
      .select('id, user_id, customer_name, meta')
      .eq('meta->>publicAccessToken', token)
      .single();

    if (error || !data) {
      return json(404, { error: 'Quote not found. The link may be invalid or the job has been removed.' });
    }
    jobRow = data;
  } catch (err) {
    console.error('accept-quote: DB select failed', err?.message);
    return json(502, { error: 'Database error — please try again' });
  }

  // ── 7. Idempotency — return existing state if already accepted ───────────────
  // NOTE: the already-accepted path does NOT re-check consent. The consent was
  // given at the time of first acceptance; re-requiring it on a reload would be
  // confusing and serves no legal purpose.
  const existingMeta = (jobRow.meta && typeof jobRow.meta === 'object') ? jobRow.meta : {};
  if (existingMeta.acceptedSignature) {
    return json(200, {
      acceptedAt: existingMeta.acceptedAt,
      alreadyAccepted: true,
    });
  }

  // ── 7a. Validate consent (new acceptances only) ──────────────────────────────
  // The customer must tick the T&Cs + Privacy checkbox on the public quote page
  // before the Confirm button becomes active. This is a belt-and-braces server
  // check. consentGiven must be exactly boolean true.
  if (consentGiven !== true) {
    return json(400, { error: 'Consent is required to accept this quote' });
  }

  // ── 8. Write acceptance ──────────────────────────────────────────────────────
  const acceptedAt = new Date().toISOString();

  // Only advance to On (active) when the job is currently Quoted — never
  // time-travel backwards if the trader has already moved it to On/Invoiced/Paid.
  const currentStatus = existingMeta.status;
  const isCurrentlyQuoted = currentStatus === 'quoted' || !currentStatus;

  const updatedMeta = {
    ...existingMeta,
    acceptedSignature: signature,
    acceptedAt,
    acceptedName: cleanName,
    acceptedSource: 'remote',
    quoteStatus: 'accepted',
    // Set canonical status field (read by mapCloudJobToToday as cloudMeta.status).
    // Old code only set jobStatus:'active' (legacy field), so the job never
    // moved from Quoted → On in the trader's app after remote signing.
    ...(isCurrentlyQuoted ? { status: 'active', jobStatus: 'active' } : {}),
    consentGiven: true,
    consentAt: acceptedAt,
    consentPolicyVersion: 'v1',
  };

  try {
    const { error: updateError } = await adminClient
      .from('jobs')
      .update({ meta: updatedMeta })
      .eq('id', jobRow.id);

    if (updateError) {
      console.error('accept-quote: DB update failed', jobRow.id, updateError?.message);
      return json(502, { error: 'Could not save signature — please try again' });
    }
  } catch (err) {
    console.error('accept-quote: DB update threw', jobRow.id, err?.message);
    return json(502, { error: 'Could not save signature — please try again' });
  }

  // ── 9. Notify the trader via push (fire-and-forget) ─────────────────────────
  // The trader also gets a real-time in-app toast via Supabase Realtime when
  // the app is open. Push covers the closed/backgrounded case.
  // If VAPID keys aren't configured yet, sendPushToUser is a silent no-op.
  if (jobRow.user_id) {
    const customerName = jobRow.customer_name || cleanName || 'A customer';
    sendPushToUser(jobRow.user_id, {
      title: 'Quote accepted',
      body: `${customerName} signed your quote`,
      url: '/',
      tag: `quote-accepted-${jobRow.id}`,
    }).catch((err) => {
      console.warn('accept-quote: push failed (non-blocking)', err?.message);
    });
  }

  // Return only what the public page needs — no internal IDs or other tokens
  return json(200, { acceptedAt });
};
