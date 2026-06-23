/**
 * decline-quote — Netlify function (Phase G-2)
 *
 * Records a customer decline on the public quote page and notifies the trader.
 * Uses the service-role client (bypasses RLS, safe only server-side).
 *
 * POST body (JSON):
 *   { token: string, declinedName?: string, declineReason?: string }
 *
 * Required env vars:
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VITE_SUPABASE_URL
 *
 * Response shapes:
 *   200  { declinedAt, alreadyDeclined? }
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

  const { token, declinedName, declineReason } = body;

  // ── 2. Validate token ────────────────────────────────────────────────────────
  if (typeof token !== 'string' || !UUID_RE.test(token)) {
    return json(400, { error: 'Invalid token format' });
  }

  // declinedName and declineReason are optional; sanitise if present
  const cleanName = declinedName && typeof declinedName === 'string'
    ? declinedName.trim().slice(0, 200)
    : null;

  const cleanReason = declineReason && typeof declineReason === 'string'
    ? declineReason.trim().slice(0, 500)
    : null;

  // ── 3. Validate env vars ─────────────────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      'decline-quote: missing env vars.',
      'VITE_SUPABASE_URL present:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY present:', !!serviceRoleKey
    );
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 4. Initialize service-role Supabase client ───────────────────────────────
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 5. Find the job by token ─────────────────────────────────────────────────
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
    console.error('decline-quote: DB select failed', err?.message);
    return json(502, { error: 'Database error — please try again' });
  }

  // ── 6. Idempotency — return existing state if already decided ────────────────
  const existingMeta = (jobRow.meta && typeof jobRow.meta === 'object') ? jobRow.meta : {};

  // Do not allow a decline after an acceptance — the acceptance wins.
  if (existingMeta.quoteStatus === 'accepted' || existingMeta.acceptedSignature) {
    return json(200, {
      acceptedAt: existingMeta.acceptedAt,
      alreadyAccepted: true,
    });
  }

  if (existingMeta.quoteStatus === 'declined') {
    return json(200, {
      declinedAt: existingMeta.declinedAt,
      alreadyDeclined: true,
    });
  }

  // ── 7. Write decline ─────────────────────────────────────────────────────────
  const declinedAt = new Date().toISOString();

  const updatedMeta = {
    ...existingMeta,
    quoteStatus: 'declined',
    declinedAt,
    // Omit declinedName and declineReason when absent — avoid writing explicit nulls
    // into the JSONB meta column so presence-checks in analytics queries are clean.
    ...(cleanName   ? { declinedName:   cleanName   } : {}),
    ...(cleanReason ? { declineReason:  cleanReason } : {}),
    // Do NOT advance the canonical status field — a declined quote stays Quoted
    // (or wherever it is) so the trader can reopen it from their app.
  };

  try {
    const { error: updateError } = await adminClient
      .from('jobs')
      .update({ meta: updatedMeta })
      .eq('id', jobRow.id);

    if (updateError) {
      console.error('decline-quote: DB update failed', jobRow.id, updateError?.message);
      return json(502, { error: 'Could not save your decision — please try again' });
    }
  } catch (err) {
    console.error('decline-quote: DB update threw', jobRow.id, err?.message);
    return json(502, { error: 'Could not save your decision — please try again' });
  }

  // ── 8. Notify the trader via push (fire-and-forget) ─────────────────────────
  if (jobRow.user_id) {
    const customerName = jobRow.customer_name || cleanName || 'A customer';
    const reasonSuffix = cleanReason ? ` — "${cleanReason}"` : '';
    sendPushToUser(jobRow.user_id, {
      title: 'Quote declined',
      body: `${customerName} declined your quote${reasonSuffix}`,
      url: '/',
      tag: `quote-declined-${jobRow.id}`,
    }).catch((err) => {
      console.warn('decline-quote: push failed (non-blocking)', err?.message);
    });
  }

  return json(200, { declinedAt });
};
