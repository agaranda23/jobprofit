/**
 * ai — Netlify function (generic Anthropic API proxy)
 *
 * Authenticated endpoint: the caller must supply a valid Supabase JWT in the
 * Authorization header (Bearer <token>). Unauthenticated requests are rejected
 * with 401.
 *
 * Auth pattern mirrors generate-quote.js: verify the JWT server-side using a
 * Supabase admin client, reject if invalid or missing.
 *
 * POST body (JSON):
 *   Passed directly to the Anthropic API — caller builds the full request body.
 *
 * Request headers:
 *   Authorization: Bearer <supabase-access-token>
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY         — Anthropic API key (server-only, never browser)
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service-role key (for JWT verification)
 *   VITE_SUPABASE_URL         — Supabase project URL
 *
 * Response shapes:
 *   200  { ...anthropic response }
 *   401  { error: 'Unauthorized' }
 *   500  { error: string }
 */

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
  const supabaseUrl    = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey   = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
    console.error(
      'ai: missing env vars.',
      'VITE_SUPABASE_URL:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY:', !!serviceRoleKey,
      'ANTHROPIC_API_KEY:', !!anthropicKey
    );
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 2. Verify Supabase JWT ───────────────────────────────────────────────────
  // Bearer token is the Supabase access token from the browser's auth session.
  // Verified server-side using the service-role client; same pattern as generate-quote.js.
  const authHeader  = event.headers?.authorization || event.headers?.Authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!bearerToken) {
    return json(401, { error: 'Unauthorized' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    const { data: userData, error: authError } = await adminClient.auth.getUser(bearerToken);
    if (authError || !userData?.user?.id) {
      return json(401, { error: 'Unauthorized' });
    }
  } catch (err) {
    console.error('ai: JWT verification failed', err?.message);
    return json(401, { error: 'Unauthorized' });
  }

  // ── 3. Parse and forward request body to Anthropic ───────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return json(200, data);
  } catch (err) {
    return json(500, { error: err.message });
  }
};
