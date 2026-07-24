/**
 * record-referral — Netlify function (JP-LU7 Phase 1 personal codes + JP-LU9 campaign codes)
 *
 * Called fire-and-forget from AppShell on a new SIGNED_IN event when
 * sessionStorage holds a `jp.referralCode` value.
 *
 * Two attribution paths, tried in order:
 *
 *   A. Personal referral code (profiles.referral_code, e.g. "ruvWbv")
 *      1. Looks up the referrer by profiles.referral_code.
 *      2. Guards against self-referral.
 *      3. Sets referee's profiles.referred_by.
 *      4. Inserts a referrals row { referrer_id, referee_id, status: 'pending' }.
 *      The eventual reward (a free Pro month for both sides) is granted later,
 *      on the referee's first paid Stripe invoice — see
 *      netlify/functions/_lib/referralReward.js.
 *
 *   B. Campaign code (campaigns table, e.g. "MITCH60") — JP-LU9
 *      Tried ONLY when the code doesn't match any personal referral_code.
 *      Campaign codes are NOT tied to a profiles row — there is no referrer
 *      to reward. Instead:
 *        1. Looks up an active, unexpired campaign by code (case-insensitive
 *           on input — campaigns.code is canonically UPPERCASE, enforced by
 *           the migration's CHECK constraint).
 *        2. Grants the AUDIENCE PERK immediately: profiles.trial_ends_at is
 *           extended to now() + campaign.comp_days, EXTEND-ONLY — never
 *           shortens an existing longer trial (see computeExtendedTrialEndsAt).
 *        3. If campaign.founding_lock and now is still before FOUNDER_CUTOFF,
 *           stamps profiles.founding_member = true immediately (see
 *           foundingLockShouldStamp) — this exists because comp_days can push
 *           the eventual checkout date PAST the cutoff, which would otherwise
 *           make the referee miss the price lock they were promised at signup.
 *        4. Inserts a referrals row { campaign_id, referee_id, status: 'pending' }
 *           (referrer_id omitted — the DB requires exactly one of
 *           referrer_id / campaign_id to be set on every row).
 *      Bounty accrual to the campaign (for the founder to pay the creator by
 *      hand — no in-app payout rail) happens later, on the referee's 2nd paid
 *      Stripe invoice OR 30 days retained — see
 *      netlify/functions/_lib/campaignBounty.js.
 *
 * Graceful degradation:
 *   If the referral_code / referred_by / campaigns / campaign_id columns or
 *   tables don't exist yet (42703 / 42P01), the function returns 200
 *   { skipped: 'table_missing' } so no sign-in ever fails because of a
 *   pending migration.
 *
 * Auth: POST with Authorization: Bearer <supabase-access-token>
 *
 * Required env vars:
 *   VITE_SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service-role key (bypasses RLS)
 *   FOUNDER_CUTOFF            — optional override of the 2026-09-30 Founding
 *                                Member cutoff; must match src/lib/plan.js and
 *                                stripe-webhook.js exactly.
 *
 * Response shapes:
 *   200 { recorded: true }              — referral row inserted (personal or campaign)
 *   200 { skipped: 'no_code' }          — body missing referral_code
 *   200 { skipped: 'unknown_code' }     — code matches neither a profile nor a campaign
 *   200 { skipped: 'self_referral' }    — referee === referrer (personal codes only)
 *   200 { skipped: 'already_referred' } — referee already has a referred_by, or
 *                                         already has a referrals row (campaign path)
 *   200 { skipped: 'campaign_inactive' }— campaign.active is false
 *   200 { skipped: 'campaign_expired' } — campaign.expires_at is in the past
 *   200 { skipped: 'table_missing' }    — migration not applied yet
 *   401 { error }                       — missing / invalid JWT
 *   405 { error }                       — wrong HTTP method
 *   500 { error }                       — Supabase config error
 *   502 { error }                       — unexpected DB error
 */

import { createClient } from '@supabase/supabase-js';

// Founding Member cutoff — must match src/lib/plan.js FOUNDER_CUTOFF and
// stripe-webhook.js exactly. Duplicated here (not imported) per this repo's
// existing convention of keeping Netlify function constants independent of
// the src/ browser bundle — see the identical comment in stripe-webhook.js.
const FOUNDER_CUTOFF = process.env.FOUNDER_CUTOFF ?? '2026-09-30T23:59:59Z';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

/** PostgREST / Postgres error codes we handle explicitly */
const PG_UNDEFINED_COLUMN = '42703';
const PG_UNDEFINED_TABLE  = '42P01';
const PG_UNIQUE_VIOLATION = '23505';
const PG_NO_ROWS          = 'PGRST116';

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

/**
 * Looks up an active, unexpired campaign by its typed code. Case-insensitive
 * on input — campaigns.code is always stored canonically UPPERCASE (enforced
 * by a DB CHECK constraint), so a creator can say "use code MITCH60" out loud
 * and a fan typing "mitch60" still resolves to the same row.
 *
 * @param {object} adminClient
 * @param {string} code
 * @returns {Promise<{ campaign: object } | { skipped: string }>}
 */
export async function lookupActiveCampaign(adminClient, code) {
  try {
    const { data, error } = await adminClient
      .from('campaigns')
      .select('id, code, comp_days, founding_lock, active, expires_at')
      .eq('code', code.trim().toUpperCase())
      .single();

    if (error) {
      if (isSchemaMissing(error)) return { skipped: 'table_missing' };
      if (error.code === PG_NO_ROWS) return { skipped: 'unknown_code' };
      console.error('record-referral: campaign lookup error', error.message);
      return { skipped: 'db_error' };
    }
    if (!data) return { skipped: 'unknown_code' };
    if (!data.active) return { skipped: 'campaign_inactive' };
    if (data.expires_at && new Date(data.expires_at) <= new Date()) {
      return { skipped: 'campaign_expired' };
    }
    return { campaign: data };
  } catch (err) {
    console.error('record-referral: campaign lookup threw', err?.message);
    return { skipped: 'db_error' };
  }
}

/**
 * Extend-only trial computation for the campaign audience perk. Per spec:
 * "OVERWRITE trial_ends_at = now() + comp_days ... EXTEND-ONLY guard — never
 * shorten an existing longer trial." Equivalent to
 * max(existing trial_ends_at, now + comp_days): a shorter, expired, or absent
 * existing trial is replaced; a longer existing one is left untouched.
 *
 * @param {string|null|undefined} currentTrialEndsAt
 * @param {number} compDays
 * @param {Date} [now]
 * @returns {string} ISO timestamp
 */
export function computeExtendedTrialEndsAt(currentTrialEndsAt, compDays, now = new Date()) {
  const candidate = new Date(now.getTime() + compDays * 86400000);
  const current = currentTrialEndsAt ? new Date(currentTrialEndsAt) : null;
  if (current && !isNaN(current.getTime()) && current > candidate) {
    return current.toISOString();
  }
  return candidate.toISOString();
}

/**
 * Returns true when a founding_lock campaign should stamp founding_member
 * immediately at SIGNUP rather than waiting for Stripe checkout (the normal
 * path — see stripe-webhook.js). Needed because the audience perk's comp_days
 * can push the eventual checkout date PAST FOUNDER_CUTOFF; without this, a
 * user who joined via a founding_lock campaign before the cutoff could still
 * miss the price lock purely because their comped trial ran past 2026-09-30.
 *
 * @param {object|null|undefined} profile - referee's current profiles row
 * @param {Date} [now]
 * @returns {boolean}
 */
export function foundingLockShouldStamp(profile, now = new Date()) {
  if (!profile) return false;
  if (profile.founding_member) return false;
  if (profile.plan === 'pro') return false;
  const cutoff = new Date(FOUNDER_CUTOFF);
  if (isNaN(cutoff.getTime())) return false;
  return now < cutoff;
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

  // ── 4. Look up the referrer by referral_code, falling back to a campaign ──
  let referrerId = null;
  let campaign = null;
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
      // PGRST116 = no rows found — not a personal code, try a campaign code.
      if (lookupError.code === PG_NO_ROWS) {
        const campaignResult = await lookupActiveCampaign(adminClient, referralCode);
        if (campaignResult.skipped) {
          console.log(`record-referral: no personal or campaign match for code "${referralCode}" (${campaignResult.skipped})`);
          return json(200, { skipped: campaignResult.skipped });
        }
        campaign = campaignResult.campaign;
      } else {
        console.error('record-referral: referrer lookup error', lookupError.message);
        return json(502, { error: 'Database error' });
      }
    } else if (!referrerProfile) {
      return json(200, { skipped: 'unknown_code' });
    } else {
      referrerId = referrerProfile.id;
    }
  } catch (err) {
    console.error('record-referral: referrer lookup threw', err?.message);
    return json(502, { error: 'Database error' });
  }

  // ── 5. Guard: self-referral (personal codes only — a campaign has no
  // referrer profile to self-match against) ─────────────────────────────────
  if (referrerId && referrerId === refereeId) {
    console.log(`record-referral: self-referral attempt by ${refereeId}`);
    return json(200, { skipped: 'self_referral' });
  }

  // ── 6. Dedupe ──────────────────────────────────────────────────────────────
  // Personal codes: profiles.referred_by can only ever be set once — a quick
  // pre-check avoids the write/insert below for a returning already-attributed
  // user. Campaign codes never set referred_by (there's no referrer profile),
  // so they're deduped instead by checking for an EXISTING referrals row —
  // this is also what actually stops a duplicate/retried call from
  // re-extending trial_ends_at every time it fires.
  if (referrerId) {
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
  } else if (campaign) {
    try {
      const { data: existingReferral, error: existingErr } = await adminClient
        .from('referrals')
        .select('id')
        .eq('referee_id', refereeId)
        .single();

      if (existingErr) {
        if (isSchemaMissing(existingErr)) {
          return json(200, { skipped: 'table_missing' });
        }
        if (existingErr.code !== PG_NO_ROWS) {
          console.error('record-referral: existing-referral check error', existingErr.message);
          return json(502, { error: 'Database error' });
        }
        // PG_NO_ROWS — no existing referral row for this referee, proceed.
      } else if (existingReferral) {
        console.log(`record-referral: referee ${refereeId} already has a referral row (campaign path)`);
        return json(200, { skipped: 'already_referred' });
      }
    } catch (err) {
      console.error('record-referral: existing-referral check threw', err?.message);
      return json(502, { error: 'Database error' });
    }
  }

  // ── 7. Write the attribution / grant the audience perk ────────────────────
  if (referrerId) {
    // Personal referral — link the referee to the referrer.
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
  } else if (campaign) {
    // Campaign referral — grant the audience perk (extended trial), plus the
    // Founding Member price lock if the campaign carries founding_lock.
    try {
      const { data: refereeProfile, error: fetchErr } = await adminClient
        .from('profiles')
        .select('trial_ends_at, founding_member, plan')
        .eq('id', refereeId)
        .single();

      if (fetchErr) {
        if (isSchemaMissing(fetchErr)) {
          return json(200, { skipped: 'table_missing' });
        }
        console.error('record-referral: referee profile fetch (campaign) error', fetchErr.message);
        return json(502, { error: 'Database error' });
      }

      const newTrialEndsAt = computeExtendedTrialEndsAt(refereeProfile?.trial_ends_at, campaign.comp_days);
      const updatePayload = { trial_ends_at: newTrialEndsAt };

      if (campaign.founding_lock && foundingLockShouldStamp(refereeProfile)) {
        updatePayload.founding_member = true;
      }

      const { error: perkUpdateError } = await adminClient
        .from('profiles')
        .update(updatePayload)
        .eq('id', refereeId);

      if (perkUpdateError) {
        if (isSchemaMissing(perkUpdateError)) {
          return json(200, { skipped: 'table_missing' });
        }
        console.error('record-referral: audience-perk update error', perkUpdateError.message);
        return json(502, { error: 'Database error' });
      }
    } catch (err) {
      console.error('record-referral: audience-perk grant threw', err?.message);
      return json(502, { error: 'Database error' });
    }
  }

  // ── 8. Insert the referrals row ───────────────────────────────────────────
  try {
    const insertPayload = campaign
      ? { campaign_id: campaign.id, referee_id: refereeId, status: 'pending' }
      : { referrer_id: referrerId, referee_id: refereeId, status: 'pending' };

    const { error: insertError } = await adminClient
      .from('referrals')
      .insert(insertPayload);

    if (insertError) {
      if (isSchemaMissing(insertError)) {
        // The referrals table doesn't exist yet — the perk/attribution was
        // still granted above, which is fine. The row is created once the
        // migration lands.
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

  console.log(campaign
    ? `record-referral: recorded campaign=${campaign.code} referee=${refereeId}`
    : `record-referral: recorded referrer=${referrerId} referee=${refereeId}`);
  return json(200, { recorded: true });
};
