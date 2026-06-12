/**
 * work-it-out-quota — Netlify function (Work it out estimator quota gate).
 *
 * Authenticated endpoint: requires a valid Supabase JWT in Authorization header.
 *
 * Mirrors the quota pattern from generate-quote.js exactly:
 *   - Free tier: FREE_QUOTA estimates per calendar month
 *   - Pro tier: unlimited
 *   - Period key: "YYYY-MM" (resets monthly)
 *
 * Actions:
 *   POST { action: 'check' }     → 200 { allowed: bool, used, quota, isPro }
 *   POST { action: 'increment' } → 200 { newCount }
 *
 * The client ALWAYS calls 'check' before running the estimator flow, and calls
 * 'increment' on successful result delivery (not on partial/cancelled flows).
 *
 * Profile columns used:
 *   estimator_builds_count  — integer, current period count
 *   estimator_builds_period — text "YYYY-MM"
 *   plan                    — 'pro' or null/other
 *
 * Required env vars:
 *   ANTHROPIC_API_KEY         — not used here but present for consistency
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service-role key (bypasses RLS)
 *   VITE_SUPABASE_URL         — Supabase project URL
 */

import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

/** Free tier: max Work it out builds per calendar month */
const FREE_QUOTA = 3;

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

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('work-it-out-quota: missing env vars');
    return json(500, { error: 'Server configuration error' });
  }

  // ── 2. Verify Supabase JWT ───────────────────────────────────────────────────
  const authHeader  = event.headers?.authorization || event.headers?.Authorization || '';
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
    console.error('work-it-out-quota: JWT verification failed', err?.message);
    return json(401, { error: 'Unauthorized' });
  }

  // ── 3. Parse body ────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const action = body.action || 'check';

  // ── 4. Fetch profile ─────────────────────────────────────────────────────────
  let profile;
  try {
    const { data, error } = await adminClient
      .from('profiles')
      .select('plan, estimator_builds_count, estimator_builds_period')
      .eq('id', userId)
      .single();

    if (error) {
      // Column may not exist yet on older schemas — use safe defaults
      console.warn('work-it-out-quota: profile fetch error (using defaults)', error?.message);
      profile = {};
    } else {
      profile = data || {};
    }
  } catch (err) {
    console.warn('work-it-out-quota: profile fetch threw (using defaults)', err?.message);
    profile = {};
  }

  const isPro         = profile.plan === 'pro';
  const currentPeriod = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const storedPeriod  = profile.estimator_builds_period || '';
  const currentCount  = storedPeriod === currentPeriod
    ? (profile.estimator_builds_count ?? 0)
    : 0;

  // ── 5. Handle action ─────────────────────────────────────────────────────────

  if (action === 'check') {
    const allowed = isPro || currentCount < FREE_QUOTA;
    return json(200, {
      allowed,
      used:  currentCount,
      quota: FREE_QUOTA,
      isPro,
    });
  }

  if (action === 'increment') {
    if (!isPro && currentCount >= FREE_QUOTA) {
      return json(402, {
        error: 'quota_exceeded',
        message: `You've used your ${FREE_QUOTA} free estimates this month. Go Pro for unlimited (£12/mo).`,
        quota: FREE_QUOTA,
        used:  currentCount,
      });
    }

    const newCount  = currentCount + 1;
    const newPeriod = currentPeriod;

    // Fire-and-forget — missed increment is acceptable (1 extra free use at worst)
    adminClient
      .from('profiles')
      .update({
        estimator_builds_count:  newCount,
        estimator_builds_period: newPeriod,
      })
      .eq('id', userId)
      .then(({ error }) => {
        if (error) console.warn('work-it-out-quota: increment failed (non-blocking)', error?.message);
      })
      .catch(err => {
        console.warn('work-it-out-quota: increment threw (non-blocking)', err?.message);
      });

    return json(200, { newCount });
  }

  return json(400, { error: `Unknown action: ${action}` });
};
