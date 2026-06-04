/**
 * save-marketing-consent — Netlify function
 *
 * Writes marketing_consent to the jobs row identified by the public quote token.
 * Called from the post-acceptance optional opt-in checkbox in PublicQuoteView.
 *
 * This endpoint is intentionally SEPARATE from accept-quote.js. The transactional
 * sign flow (accept-quote) must never be coupled to marketing consent capture —
 * they are different legal bases and different UX moments.
 *
 * POST body (JSON):
 *   { token: string, granted: boolean }
 *
 *   token   — the publicAccessToken UUID from the quote URL
 *   granted — true if the customer ticked the opt-in; false if explicitly declined
 *             (we store false so we know we asked and they said no, vs null = never asked)
 *
 * Response shapes:
 *   200  { saved: true }
 *   400  { error }  — missing/invalid fields
 *   404  { error }  — token not found
 *   500  { error }  — server config error
 *   502  { error }  — database error
 *
 * Required env vars:
 *   VITE_SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS, server-only)
 *
 * HARD SEPARATION NOTE:
 *   This function writes ONLY to jobs.marketing_consent. It does NOT write to
 *   jobs.meta. The chase-reminders function reads only meta fields. There is
 *   therefore no path by which a customer declining marketing consent could
 *   suppress a payment chase notification.
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

  // ── Parse body ────────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { token, granted } = body;

  if (typeof token !== 'string' || !UUID_RE.test(token)) {
    return json(400, { error: 'Invalid token format' });
  }

  if (typeof granted !== 'boolean') {
    return json(400, { error: 'granted must be a boolean' });
  }

  // ── Env vars ──────────────────────────────────────────────────────────────────
  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('save-marketing-consent: missing env vars');
    return json(500, { error: 'Server configuration error — contact support' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── Find the job by token ─────────────────────────────────────────────────────
  let jobRow;
  try {
    const { data, error } = await adminClient
      .from('jobs')
      .select('id, user_id')
      .eq('meta->>publicAccessToken', token)
      .single();

    if (error || !data) {
      return json(404, { error: 'Quote not found' });
    }
    jobRow = data;
  } catch (err) {
    console.error('save-marketing-consent: DB select failed', err?.message);
    return json(502, { error: 'Database error — please try again' });
  }

  // ── Write marketing_consent (top-level column, NOT into meta) ─────────────────
  // Stored separately from meta so the chase ladder can never read or be
  // influenced by this value. See migration comments for the hard-separation
  // guarantee.
  const consentRecord = {
    granted,
    source: 'public_accept',
    timestamp: new Date().toISOString(),
    controller_trader_id: jobRow.user_id,
  };

  try {
    const { error: updateError } = await adminClient
      .from('jobs')
      .update({ marketing_consent: consentRecord })
      .eq('id', jobRow.id);

    if (updateError) {
      console.error('save-marketing-consent: DB update failed', jobRow.id, updateError?.message);
      return json(502, { error: 'Could not save preference — please try again' });
    }
  } catch (err) {
    console.error('save-marketing-consent: DB update threw', jobRow.id, err?.message);
    return json(502, { error: 'Could not save preference — please try again' });
  }

  return json(200, { saved: true });
};
