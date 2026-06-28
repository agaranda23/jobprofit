/**
 * accept-quote — Netlify function (Phase G-2 redesign)
 *
 * Receives a customer acceptance decision from the public quote page and writes
 * it to the jobs row via the service-role client (bypasses RLS, safe only
 * server-side).
 *
 * Signature capture removed (Phase G-2, 2026-06-23): data-minimisation under
 * UK GDPR. An audited timestamped tap with consent flag and optional name fully
 * serves the legal purpose. The signature PNG (~200 KB) was the largest PII
 * collected with no added legal weight. Backfill of historic signatures is a
 * fast-follow (LGL sign-off advisable, not blocking).
 *
 * POST body (JSON):
 *   { token: string, acceptedName?: string, consentGiven: true }
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
import { sendTraderAcceptEmail } from './_lib/sendTraderAcceptEmail.js';

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

  const { token, acceptedName, consentGiven } = body;

  // ── 2. Validate token ────────────────────────────────────────────────────────
  if (typeof token !== 'string' || !UUID_RE.test(token)) {
    return json(400, { error: 'Invalid token format' });
  }

  // acceptedName is optional; strip to plain string if present
  const cleanName = acceptedName && typeof acceptedName === 'string'
    ? acceptedName.trim().slice(0, 200)
    : null;

  // ── 4. Validate env vars ─────────────────────────────────────────────────────
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      'accept-quote: missing env vars.',
      'VITE_SUPABASE_URL present:', !!supabaseUrl,
      'SUPABASE_SERVICE_ROLE_KEY present:', !!serviceRoleKey
    );
    return json(500, { error: 'Server configuration error — contact support' });
  }

  // ── 5. Initialize service-role Supabase client ───────────────────────────────
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
  // Idempotency checks both quoteStatus:'accepted' (button-path, G-2) and
  // acceptedSignature (legacy signature-path, pre G-2). Both mean accepted.
  const existingMeta = (jobRow.meta && typeof jobRow.meta === 'object') ? jobRow.meta : {};
  if (existingMeta.quoteStatus === 'accepted' || existingMeta.acceptedSignature) {
    return json(200, {
      acceptedAt: existingMeta.acceptedAt,
      alreadyAccepted: true,
    });
  }

  // ── 8. Validate consent (new acceptances only) ───────────────────────────────
  // Checked after idempotency so a network-retry of an already-accepted token
  // never fails on a missing consentGiven field — the 200 alreadyAccepted path
  // above short-circuits first. Consent is conveyed by the inline copy on the
  // Accept button (not a checkbox). The frontend always sends consentGiven:true.
  if (consentGiven !== true) {
    return json(400, { error: 'Consent is required to accept this quote' });
  }

  // ── 9. Write acceptance ──────────────────────────────────────────────────────
  const acceptedAt = new Date().toISOString();

  // Only advance to On (active) when the job is currently Quoted — never
  // time-travel backwards if the trader has already moved it to On/Invoiced/Paid.
  const currentStatus = existingMeta.status;
  const isCurrentlyQuoted = currentStatus === 'quoted' || !currentStatus;

  const updatedMeta = {
    ...existingMeta,
    // No signature stored — data minimisation (UK GDPR, 2026-06-23).
    acceptedAt,
    acceptedName: cleanName,
    acceptedSource: 'remote',
    quoteStatus: 'accepted',
    ...(isCurrentlyQuoted ? { status: 'active', jobStatus: 'active' } : {}),
    // Consent markers kept for compliance audit trail (negligible size).
    // consentPolicyVersion changelog:
    //   v1 (2026-06-23) — inline copy on Accept button; no checkbox; optional name.
    //   Increment to v2 when LGL approves an updated wording and note date + change.
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
      return json(502, { error: 'Could not save your decision — please try again' });
    }
  } catch (err) {
    console.error('accept-quote: DB update threw', jobRow.id, err?.message);
    return json(502, { error: 'Could not save your decision — please try again' });
  }

  // ── 10. Notify the trader via push (fire-and-forget) ────────────────────────
  // The trader also gets a real-time in-app toast via Supabase Realtime when
  // the app is open. Push covers the closed/backgrounded case.
  if (jobRow.user_id) {
    const customerName = jobRow.customer_name || cleanName || 'A customer';
    sendPushToUser(jobRow.user_id, {
      title: 'Quote accepted',
      body: `${customerName} accepted your quote`,
      url: '/',
      tag: `quote-accepted-${jobRow.id}`,
    }).catch((err) => {
      console.warn('accept-quote: push failed (non-blocking)', err?.message);
    });
  }

  // ── 11. Notify the trader via email (fire-and-forget) ───────────────────────
  // Looks up trader email via auth.admin and business name via profiles.
  // Both lookups are quick reads against indexed PKs. If either fails, log and
  // continue — email is advisory and must never block the 200 response.
  // Requires RESEND_API_KEY env var; gracefully skips if absent.
  if (jobRow.user_id) {
    (async () => {
      try {
        const [userResult, profileResult] = await Promise.all([
          adminClient.auth.admin.getUserById(jobRow.user_id),
          adminClient
            .from('profiles')
            .select('business_name')
            .eq('id', jobRow.user_id)
            .maybeSingle(),
        ]);

        const traderEmail = userResult?.data?.user?.email;
        const traderBusinessName = profileResult?.data?.business_name ?? null;

        if (!traderEmail) {
          console.warn('[email] Could not resolve trader email for user_id:', jobRow.user_id);
          return;
        }

        const jobDescription = updatedMeta.jobTitle || updatedMeta.description || updatedMeta.title || null;
        const amount = updatedMeta.totalAmount ?? updatedMeta.quoteAmount ?? updatedMeta.total ?? null;

        await sendTraderAcceptEmail({
          traderEmail,
          traderBusinessName,
          customerName: cleanName,
          jobDescription,
          amount,
          acceptedAt,
        });
      } catch (err) {
        console.error('[email] Notification lookup/send threw unexpectedly:', err?.message);
      }
    })();
  }

  return json(200, { acceptedAt });
};
