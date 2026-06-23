/**
 * record-referral — Netlify function (JP-LU7 Phase 1)
 *
 * Called fire-and-forget from AppShell on a new SIGNED_IN event when
 * sessionStorage holds a `jp.referralCode` value.
 *
 * What it does:
 *   1. Verifies the caller's Supabase JWT → gets referee user ID.
 *   2. Looks up the referrer by profiles.referral_code.
 *   3. Guards against self-referral.
 *   4. Sets referee's profiles.referred_by.
 *   5. Inserts a referrals row with status='pending' (service-role; the unique
 *      constraint on referee_id makes this idempotent on duplicate calls).
 *
 * Graceful degradation:
 *   If the referral_code / referred_by columns or referrals table don't exist
 *   yet (42703 / 42P01), the function returns 200 { skipped: 'table_missing' }
 *   so no sign-in ever fails because of a pending migration.
 *
 * Auth: POST with Authorization: Bearer <supabase-access-token>
 *
 * Required env vars:
 *   VITE_SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS)
 *
 * Response shapes:
 *   200 { recorded: true }              — referral row inserted
 *   200 { skipped: 'no_code' }          — body missing referral_code
 *   200 { skipped: 'unknown_code' }     — no profile found for the code
 *   200 { skipped: 'self_referral' }    — referee === referrer
 *   200 { skipped: 'already_referred' } — referee already has a referred_by
 *   200 { skipped: 'table_missing' }    — migration not applied yet
 *   401 { error }                       — missing / invalid JWT
 *   405 { error }                       — wrong HTTP method
 *   500 { error }                       — Supabase config error
 *   502 { error }                       — unexpected DB error
 */

import { createClient } from '@supabase/supabase-js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

/** PostgREST / Postgres error codes we handle explicitly */
const PG_UNDEFINED_COLUMN = '42703';
const PG_UNDEFINED_TABLE  = '42P01';
const PG_UNIQUE_VIOLATION = '23505';

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

/**
 * Returns true if the PostgREST error indicates the column or table
 * doesn't exist yet (migration pending).
 */
function isSchemaMissing(error) {
  if (!error) return false;
  const code = error.code;
  const msg  = error.message || '';
  return (
    code === PG_UNDEFINED_COLUMN ||
    code === PG_UNDEFINED_TABLE  ||
    msg.includes('does not exist')
  );
}

export const handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  // ── 1. Validate Supabase env vars ─────────────────────────────────────────
  const supabaseUrl     = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('record-referral: missing Supabase env vars');
    return json(500, { error: 'Server configuration error' });
  }

  // ── 2. Parse request body ─────────────────────────────────────────────────
  let referralCode;
  try {
    const body = JSON.parse(event.body || '{}');
    referralCode = body.referral_code;
  } catch {
    referralCode = null;
  }

  if (!referralCode || typeof referralCode !== 'string' || !referralCode.trim()) {
    return json(200, { skipped: 'no_code' });
  }
  referralCode = referralCode.trim();

  // ── 3. Verify Supabase JWT → referee user ID ──────────────────────────────
  const authHeader  = event.headers?.authorization || event.headers?.Authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!bearerToken) {
    return json(401, { error: 'Unauthorized' });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let refereeId;
  try {
    const { data: userData, error: authError } = await adminClient.auth.getUser(bearerToken);
    if (authError || !userData?.user?.id) {
      return json(401, { error: 'Unauthorized' });
    }
    refereeId = userData.user.id;
  } catch {
    return json(401, { error: 'Unauthorized' });
  }

  // ── 4. Look up the referrer by referral_code ──────────────────────────────
  let referrerId;
  try {
    const { data: referrerProfile, error: lookupError } = await adminClient
      .from('profiles')
      .select('id, referred_by')
      .eq('referral_code', referralCode)
      .single();

    if (lookupError) {
      if (isSchemaMissing(lookupError)) {
        console.log('record-referral: schema not yet applied — skipping');
        return json(200, { skipped: 'table_missing' });
      }
      // PGRST116 = no rows found
      if (lookupError.code === 'PGRST116') {
        console.log(`record-referral: unknown referral code "${referralCode}"`);
        return json(200, { skipped: 'unknown_code' });
      }
      console.error('record-referral: referrer lookup error', lookupError.message);
      return json(502, { error: 'Database error' });
    }

    if (!referrerProfile) {
      return json(200, { skipped: 'unknown_code' });
    }

    referrerId = referrerProfile.id;
  } catch (err) {
    console.error('record-referral: referrer lookup threw', err?.message);
    return json(502, { error: 'Database error' });
  }

  // ── 5. Guard: self-referral ───────────────────────────────────────────────
  if (referrerId === refereeId) {
    console.log(`record-referral: self-referral attempt by ${refereeId}`);
    return json(200, { skipped: 'self_referral' });
  }

  // ── 6. Check whether the referee already has a referred_by ───────────────
  try {
    const { data: refereeProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('referred_by')
      .eq('id', refereeId)
      .single();

    if (profileError) {
      if (isSchemaMissing(profileError)) {
        return json(200, { skipped: 'table_missing' });
      }
      console.error('record-referral: referee profile fetch error', profileError.message);
      return json(502, { error: 'Database error' });
    }

    if (refereeProfile?.referred_by) {
      console.log(`record-referral: referee ${refereeId} already attributed`);
      return json(200, { skipped: 'already_referred' });
    }
  } catch (err) {
    console.error('record-referral: referee profile fetch threw', err?.message);
    return json(502, { error: 'Database error' });
  }

  // ── 7. Write referred_by onto the referee's profile ───────────────────────
  try {
    const { error: updateError } = await adminClient
      .from('profiles')
      .update({ referred_by: referrerId })
      .eq('id', refereeId)
      .is('referred_by', null);

    if (updateError) {
      if (isSchemaMissing(updateError)) {
        return json(200, { skipped: 'table_missing' });
      }
      console.error('record-referral: referred_by update error', updateError.message);
      return json(502, { error: 'Database error' });
    }
  } catch (err) {
    console.error('record-referral: referred_by update threw', err?.message);
    return json(502, { error: 'Database error' });
  }

  // ── 8. Insert the referrals row ───────────────────────────────────────────
  try {
    const { error: insertError } = await adminClient
      .from('referrals')
      .insert({ referrer_id: referrerId, referee_id: refereeId, status: 'pending' });

    if (insertError) {
      if (isSchemaMissing(insertError)) {
        // The referrals table doesn't exist yet — referred_by was still set,
        // which is fine. The row will be created when Phase 2 lands.
        return json(200, { skipped: 'table_missing' });
      }
      if (insertError.code === PG_UNIQUE_VIOLATION) {
        // Duplicate call — idempotent, treat as success
        console.log(`record-referral: duplicate referral row for referee ${refereeId} — already exists`);
        return json(200, { recorded: true });
      }
      console.error('record-referral: referrals insert error', insertError.message);
      return json(502, { error: 'Database error' });
    }
  } catch (err) {
    console.error('record-referral: referrals insert threw', err?.message);
    return json(502, { error: 'Database error' });
  }

  console.log(`record-referral: recorded referrer=${referrerId} referee=${refereeId}`);
  return json(200, { recorded: true });
};
