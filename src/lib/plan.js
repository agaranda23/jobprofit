// Paywall helpers — plan gating for invoice sends.
// No Stripe wiring in this file. Pro state comes from profiles.plan (Supabase).
// Supabase migration (run in Studio before deploying this PR):
//
//   ALTER TABLE profiles ADD COLUMN plan text DEFAULT 'free';
//   ALTER TABLE profiles ADD COLUMN invoices_sent_count int DEFAULT 0;
//   UPDATE profiles SET invoices_sent_count = 0;

// ⚠️ TEMPORARY OVERRIDE — Pro unlocked for EVERYONE while we finish building the
// paid features so they can be reviewed end-to-end. Because canSendInvoice()
// short-circuits through isPro(), this ALSO lifts the free invoice-send limit.
// TO RE-ENABLE the free/Pro split when editing is done: set this back to false.
// The underlying plan rule is preserved in planAllowsPro() and stays tested.
// NOTE: while this is true, trial banners are also suppressed (see TrialBanner).
export const UNLOCK_PRO_FOR_ALL = true;

/**
 * The real entitlement rule (kept intact for when the override is lifted).
 * @param {object|null|undefined} profile  - Supabase profiles row
 * @returns {boolean}
 */
export function planAllowsPro(profile) {
  return profile?.plan === 'pro';
}

/**
 * Returns true when the user is on an active 14-day trial.
 * Null-safe: returns false if any required field is missing.
 *
 * @param {object|null|undefined} profile  - Supabase profiles row
 * @param {Date} [now]                     - injectable for testing (defaults to new Date())
 * @returns {boolean}
 */
export function isTrialActive(profile, now = new Date()) {
  if (profile?.plan !== 'trial') return false;
  if (!profile?.trial_ends_at) return false;
  return new Date(profile.trial_ends_at) > now;
}

/**
 * Returns whole days remaining in the trial (ceiling), or 0 if not on an
 * active trial or trial has expired.
 *
 * @param {object|null|undefined} profile  - Supabase profiles row
 * @param {Date} [now]                     - injectable for testing (defaults to new Date())
 * @returns {number}
 */
export function trialDaysLeft(profile, now = new Date()) {
  if (!isTrialActive(profile, now)) return 0;
  const msLeft = new Date(profile.trial_ends_at) - now;
  return Math.ceil(msLeft / 86400000);
}

/**
 * Returns true when the user should see Pro features.
 * While UNLOCK_PRO_FOR_ALL is true, everyone is treated as Pro.
 * An active trial also grants Pro access (falls through to free on expiry).
 * Accepts null/undefined safely — unloaded profiles default to free.
 *
 * @param {object|null|undefined} profile  - Supabase profiles row
 * @param {Date} [now]                     - injectable for testing (defaults to new Date())
 * @returns {boolean}
 */
export function isPro(profile, now = new Date()) {
  if (UNLOCK_PRO_FOR_ALL) return true;
  if (planAllowsPro(profile)) return true;
  return isTrialActive(profile, now);
}

/**
 * Returns true when the user is allowed to perform a first-time invoice send.
 * Pro users always return true.
 * Free users get exactly 1 free send (invoices_sent_count === 0).
 *
 * Re-sends on the same already-sent invoice do NOT call this — the caller
 * must guard on job.status !== 'invoice_sent' before calling canSendInvoice.
 *
 * @param {object|null|undefined} profile  - Supabase profiles row
 * @returns {boolean}
 */
export function canSendInvoice(profile) {
  if (isPro(profile)) return true;
  // Free tier: 0 means first send available; 1+ means quota used
  return (profile?.invoices_sent_count ?? 0) === 0;
}

/**
 * Increments invoices_sent_count on the profiles row in Supabase.
 * Optimistic — the caller should update its local profile copy immediately
 * (increment count locally) without waiting for this to settle.
 *
 * Silently swallows network errors: the worst case is 1 extra free send
 * when the user is offline (accepted per spec).
 *
 * @param {object} supabase  - Supabase client
 * @param {string} userId    - auth user id
 * @returns {Promise<void>}
 */
export async function incrementSendCount(supabase, userId) {
  if (!supabase || !userId) return;
  try {
    await supabase.rpc('increment_invoices_sent_count', { user_id: userId });
  } catch {
    // Offline or RPC not found — silently accept 1-extra-free-send drift.
    // Fallback: direct update if the RPC hasn't been created yet.
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('invoices_sent_count')
        .eq('id', userId)
        .single();
      const current = profile?.invoices_sent_count ?? 0;
      await supabase
        .from('profiles')
        .update({ invoices_sent_count: current + 1 })
        .eq('id', userId);
    } catch {
      // Truly offline — accept drift.
    }
  }
}

/**
 * If the user is on plan='trial' but trial_ends_at has passed, persist
 * plan='free' to Supabase so the DB stays clean.
 *
 * Fire-and-forget. Never throws. Does not block render.
 * Mirrors the optimistic pattern in incrementSendCount.
 *
 * @param {object} supabaseClient  - Supabase client
 * @param {string} userId          - auth user id
 * @param {object|null} profile    - current profiles row
 * @returns {Promise<void>}
 */
export async function flipExpiredTrialToFree(supabaseClient, userId, profile) {
  if (!supabaseClient || !userId) return;
  if (profile?.plan !== 'trial') return;
  if (!profile?.trial_ends_at) return;
  if (new Date(profile.trial_ends_at) > new Date()) return; // still active
  try {
    await supabaseClient
      .from('profiles')
      .update({ plan: 'free' })
      .eq('id', userId);
  } catch {
    // Offline — next app load will retry.
  }
}
