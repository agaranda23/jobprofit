/**
 * ai — Netlify function (general Anthropic proxy for voice-parse and receipt-OCR).
 *
 * Authenticated endpoint: the caller must supply a valid Supabase JWT in the
 * Authorization header (Bearer <token>). Unauthenticated requests are rejected
 * with 401.
 *
 * Pattern mirrors generate-quote.js: verify JWT via Supabase service-role client
 * (getUser), then forward the cleaned payload to the Anthropic API.
 *
 * Callers: src/lib/voiceParse.js, src/lib/receiptOCR.js, src/lib/estimatorParse.js
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY         — Anthropic API key (server-only, never browser)
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service-role key (bypasses RLS)
 *   VITE_SUPABASE_URL         — Supabase project URL
 *
 * Abuse guards (all applied AFTER JWT verification):
 *   - Body size cap: 500,000 chars max (rejects oversized payloads before parsing)
 *   - Model allowlist: only the two approved Claude model IDs are forwarded;
 *     anything else is coerced to the default haiku model (never rejected outright
 *     so existing callers continue to work after a model id typo).
 *   - max_tokens cap: clamped to 1,500 regardless of what the caller requests.
 *   - Per-user rate limit: 60 requests / 60 s tracked in-memory. Resets per
 *     Lambda cold-start — best-effort, not a hard security control. A future
 *     Redis/Supabase-backed counter can replace this if abuse becomes a problem.
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

// ── Abuse guard constants ────────────────────────────────────────────────────

const BODY_SIZE_LIMIT = 500_000; // chars — rejects before JSON.parse

/**
 * Approved model IDs. voiceParse + estimatorParse use haiku; receiptOCR uses
 * sonnet (vision). Any other model string is coerced to DEFAULT_MODEL.
 * Keep in sync with the callers — do NOT change without updating them too.
 */
const ALLOWED_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-6',
  // receiptOCR.js historically used claude-sonnet-4-5-20250929 before the
  // model was updated; keep it here so in-flight requests from old clients
  // (cached service-worker versions) are not broken.
  'claude-sonnet-4-5-20250929',
]);
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const MAX_TOKENS_CAP = 1500;

// ── Per-user in-memory rate limiter ─────────────────────────────────────────
// Simple sliding-window counter: Map<userId, { count, windowStart }>
// IMPORTANT: this counter is per Lambda instance. Netlify may spin up multiple
// instances under load, so the effective limit is (60 * N) across N instances.
// Acceptable as a best-effort guard — a real counter would require an external
// store (Redis / Supabase). Document this limitation here so it's not forgotten.
const RATE_WINDOW_MS  = 60_000; // 60 seconds
const RATE_MAX_CALLS  = 60;     // per window per instance
const rateLimitMap    = new Map();

/**
 * Returns true when the user has exceeded the per-window rate limit.
 * Mutates rateLimitMap to track state.
 */
function isRateLimited(userId) {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    rateLimitMap.set(userId, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX_CALLS;
}

export const handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Validate env vars ─────────────────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
    console.error(
      'ai: missing env vars.',
      'VITE_SUPABASE_URL:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY:', !!serviceRoleKey,
      'ANTHROPIC_API_KEY:', !!anthropicKey
    );
    return json(500, { error: 'Server configuration error' });
  }

  // ── 2. Body size guard ────────────────────────────────────────────────────────
  // Check before JSON.parse so an oversized body is never deserialised.
  if ((event.body || '').length > BODY_SIZE_LIMIT) {
    return json(413, { error: 'Request body too large' });
  }

  // ── 3. Verify Supabase JWT ───────────────────────────────────────────────────
  // The Bearer token is the Supabase access token from the browser's auth session.
  // We verify it server-side using the service-role client which can call getUser.
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!bearerToken) {
    return json(401, { error: 'Unauthorized' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let userId;
  try {
    const { data: userData, error: authError } = await adminClient.auth.getUser(bearerToken);
    if (authError || !userData?.user?.id) {
      return json(401, { error: 'Unauthorized' });
    }
    userId = userData.user.id;
  } catch (err) {
    console.error('ai: JWT verification failed', err?.message);
    return json(401, { error: 'Unauthorized' });
  }

  // ── 4. Per-user rate limit ────────────────────────────────────────────────────
  if (isRateLimited(userId)) {
    return json(429, { error: 'Too many requests — please wait a moment and try again' });
  }

  // ── 5. Parse and sanitise request body ───────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  // Model allowlist: coerce any unknown model to the default rather than rejecting.
  // This means callers continue working even when a model id drifts; we just log it.
  if (!ALLOWED_MODELS.has(body.model)) {
    console.warn('ai: unknown model coerced to default', { requested: body.model });
    body.model = DEFAULT_MODEL;
  }

  // max_tokens cap: never forward a request that could run up a huge bill.
  if (typeof body.max_tokens !== 'number' || body.max_tokens > MAX_TOKENS_CAP) {
    body.max_tokens = MAX_TOKENS_CAP;
  }

  // ── 6. Forward to Anthropic ──────────────────────────────────────────────────
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
