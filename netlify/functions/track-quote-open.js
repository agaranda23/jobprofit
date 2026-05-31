/**
 * track-quote-open — Netlify function (Phase G-1 open-tracking)
 *
 * Called by PublicQuoteView when a customer loads the public quote URL.
 * Records quoteLinkOpenedAt (first open only) and quoteLinkLastOpenedAt
 * (every open) in the job's meta jsonb column via the service-role client.
 *
 * POST body (JSON):
 *   { token: string }
 *
 * Required env vars (set in Netlify dashboard):
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VITE_SUPABASE_URL
 *
 * Response shapes:
 *   200  { ok: true }
 *   400  { error: 'validation error' }
 *   404  { error: 'token not found' }
 *   500  { error: 'server configuration error' }
 *   502  { error: 'database error' }
 *
 * Resilience: if the token is stale or the job no longer exists, returns 404
 * without crashing. The public view continues to render normally regardless.
 */

import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

/** UUID v4 — must match isValidToken in publicQuoteToken.js */
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

  // ── 1. Parse body ────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { token } = body;

  // ── 2. Validate token ────────────────────────────────────────────────────────
  if (typeof token !== 'string' || !UUID_RE.test(token)) {
    return json(400, { error: 'Invalid token format' });
  }

  // ── 3. Validate env vars ─────────────────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      'track-quote-open: missing env vars.',
      'VITE_SUPABASE_URL present:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY present:', !!serviceRoleKey
    );
    return json(500, { error: 'Server configuration error' });
  }

  // ── 4. Initialize service-role client ────────────────────────────────────────
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // ── 5. Find the job by token ─────────────────────────────────────────────────
  let jobRow;
  try {
    const { data, error } = await adminClient
      .from('jobs')
      .select('id, meta')
      .eq('meta->>publicAccessToken', token)
      .single();

    if (error || !data) {
      return json(404, { error: 'Token not found' });
    }
    jobRow = data;
  } catch (err) {
    console.error('track-quote-open: DB select failed', err?.message);
    return json(502, { error: 'Database error' });
  }

  // ── 6. Merge open timestamps into meta ───────────────────────────────────────
  const now = new Date().toISOString();
  const existingMeta = (jobRow.meta && typeof jobRow.meta === 'object') ? jobRow.meta : {};

  const updatedMeta = {
    ...existingMeta,
    // quoteLinkOpenedAt records the FIRST open and is never overwritten
    quoteLinkOpenedAt: existingMeta.quoteLinkOpenedAt ?? now,
    // quoteLinkLastOpenedAt records every open — overwrites on each call
    quoteLinkLastOpenedAt: now,
  };

  // ── 7. Write ─────────────────────────────────────────────────────────────────
  try {
    const { error: updateError } = await adminClient
      .from('jobs')
      .update({ meta: updatedMeta })
      .eq('id', jobRow.id);

    if (updateError) {
      console.error('track-quote-open: DB update failed', jobRow.id, updateError?.message);
      return json(502, { error: 'Database error' });
    }
  } catch (err) {
    console.error('track-quote-open: DB update threw', jobRow.id, err?.message);
    return json(502, { error: 'Database error' });
  }

  return json(200, { ok: true });
};
