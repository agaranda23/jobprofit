// Paywall helpers — plan gating for Pro features.
// No Stripe wiring in this file. Pro state comes from profiles.plan (Supabase).
// Supabase migration (run in Studio before deploying this PR):
//
//   ALTER TABLE profiles ADD COLUMN plan text DEFAULT 'free';
//   ALTER TABLE profiles ADD COLUMN invoices_sent_count int DEFAULT 0;
//   UPDATE profiles SET invoices_sent_count = 0;

// ⚠️ TEMPORARY OVERRIDE — Pro unlocked for EVERYONE while we finish building the
// paid features so they can be reviewed end-to-end.
// TO RE-ENABLE the free/Pro split when editing is done: set this back to false.
// The underlying plan rule is preserved in planAllowsPro() and stays tested.
// NOTE: while this is true, trial banners are also suppressed (see TrialBanner).
export const UNLOCK_PRO_FOR_ALL = false;

/**
 * White-label is the anchor Pro perk: Pro/trial = "Sent with JobProfit" footer
 * HIDDEN on documents; free = footer SHOWN.
 * Driven entirely by isPro() — no separate flag needed.
 * This constant is a documentation anchor. Do not gate on it directly; use isPro().
 */
export const WHITE_LABEL_PRO_PERK = 'white_label';

/**
 * Free-tier monthly invoice limit — REMOVED 2026-06-03.
 * Invoices are now UNLIMITED for ALL plans. The Get Paid loop is free, forever.
 * Kept as a named export so callers that imported it don't break; value is Infinity.
 * @deprecated — canSendInvoice always returns true regardless of this value.
 */
export const FREE_MONTHLY_INVOICE_LIMIT = Infinity;

/**
 * The real entitlement rule (kept intact for when the override is lifted).
 * @param {object|null|undefined} profile  - Supabase profiles row
 * @returns {boolean}
 */
export function planAllowsPro(profile) {
  return profile?.plan === 'pro';
}

/**
 * Sets trial_ends_at = now() + 14 days the FIRST time a user loads the app
 * while their trial clock has not yet been started (trial_ends_at is NULL).
 *
 * IDEMPOTENT: does nothing if trial_ends_at is already set, or if the user
 * is not on plan='trial', or if they are already paid (plan='pro').
 *
 * RACE-CONDITION GUARD: a simple localStorage flag (jp.trialStarted.<uid>)
 * prevents two tabs / rapid reloads from issuing concurrent Supabase UPDATEs.
 * The Supabase UPDATE itself uses a WHERE trial_ends_at IS NULL clause as a
 * server-side guard so a duplicate write is a harmless no-op.
 *
 * Fire-and-forget: the caller does NOT await this. Errors are swallowed — the
 * worst case is the trial banner shows "not started" state for one more load.
 * The profile refresh in refreshProfile() will pick up the persisted value on
 * the next fetch.
 *
 * @param {object} supabaseClient - Supabase client
 * @param {string} userId         - auth user id
 * @param {object|null} profile   - current profiles row (may have trial_ends_at = null)
 * @param {function} [onStarted]  - optional callback fired after the DB write so the
 *                                  caller can optimistically update local profile state
 *                                  with the new trial_ends_at. Receives the ISO string.
 * @returns {Promise<void>}
 */
export async function initTrialOnFirstUse(supabaseClient, userId, profile, onStarted) {
  if (!supabaseClient || !userId) return;
  // Only applies to users on the 'trial' plan with no clock yet.
  if (profile?.plan !== 'trial') return;
  if (profile?.trial_ends_at) return; // clock already running — do nothing
  if (profile?.plan === 'pro') return;

  // Per-device guard: prevent two concurrent tabs from both writing.
  const storageKey = `jp.trialStarted.${userId}`;
  try {
    if (localStorage.getItem(storageKey)) return; // another tab already wrote it this session
    localStorage.setItem(storageKey, '1');
  } catch {
    // Private browsing / quota exceeded — skip the local guard but still attempt the write.
  }

  try {
    const endsAt = new Date(Date.now() + 14 * 86400000).toISOString();
    const { error } = await supabaseClient
      .from('profiles')
      .update({ trial_ends_at: endsAt })
      .eq('id', userId)
      .is('trial_ends_at', null); // server-side idempotency guard: only write when still NULL
    if (!error) {
      onStarted?.(endsAt);
    }
  } catch {
    // Offline or network error — the clock will be set on the next authenticated load.
    // Clear the local guard so the next load retries.
    try { localStorage.removeItem(`jp.trialStarted.${userId}`); } catch { /* private browsing */ }
  }
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
 * Counts invoice sends in the current UTC calendar month.
 * Kept for telemetry ("free user sent ≥4 docs in a month" event) — no longer
 * used for gating. Do not add a quota check here.
 *
 * @param {Array}  jobs  - full jobs array from app state
 * @param {Date}   [now] - injectable for testing (defaults to new Date())
 * @returns {number}
 */
export function countInvoicesSentThisMonth(jobs = [], now = new Date()) {
  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return jobs.filter(j => {
    if (j.status !== 'invoice_sent') return false;
    if (!j.invoiceSentAt) return false;
    return new Date(j.invoiceSentAt) >= startOfMonth;
  }).length;
}

/**
 * Returns true when the user is allowed to perform a first-time invoice send.
 * Invoices are UNLIMITED for ALL plans as of 2026-06-03.
 * The monthly cap shipped in PR #266 has been removed — the Get Paid loop is
 * free forever. White-label (removing the "Sent with JobProfit" footer) is the
 * anchor Pro perk instead.
 *
 * Function signature kept so callers need no changes.
 * The `jobs` and `now` parameters are accepted but ignored for backwards compat.
 *
 * @param {object|null|undefined} profile  - Supabase profiles row (unused for gating)
 * @param {Array}  [jobs]  - accepted but unused
 * @param {Date}   [now]   - accepted but unused
 * @returns {boolean} always true
 */
export function canSendInvoice(_profile, _jobs = [], _now = new Date()) {
  return true;
}

/**
 * Returns true when the "Sent with JobProfit" footer should be shown.
 * Footer is SHOWN for free users (product-led virality); HIDDEN for Pro/trial.
 * This is the canonical white-label entitlement check — use it in all doc paths.
 *
 * @param {object|null|undefined} profile  - Supabase profiles row
 * @param {Date} [now]                     - injectable for testing
 * @returns {boolean}
 */
export function showJobProfitFooter(profile, now = new Date()) {
  return !isPro(profile, now);
}

/**
 * Returns true when the post-send white-label upgrade nudge should fire.
 * Rule: free user, and (first send this session OR at most once per week).
 * The caller owns the session flag and the weekly localStorage gate.
 * This helper tests only the plan condition.
 *
 * @param {object|null|undefined} profile - Supabase profiles row
 * @param {Date} [now]                    - injectable for testing
 * @returns {boolean}
 */
export function eligibleForWhiteLabelNudge(profile, now = new Date()) {
  return !isPro(profile, now);
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
 * Returns true when the trial has just expired (plan='trial', trial_ends_at in
 * the past) but the user has NOT yet seen the Moment-2 drop-to-free screen.
 * Used by AppShell to gate the "honesty fix" — never flip silently; render
 * Moment 2 first, then flip as part of dismissal.
 *
 * @param {object|null|undefined} profile
 * @param {Date} [now]
 * @returns {boolean}
 */
export function trialJustExpired(profile, now = new Date()) {
  if (profile?.plan !== 'trial') return false;
  if (!profile?.trial_ends_at) return false;
  if (new Date(profile.trial_ends_at) > now) return false; // still active
  return true;
}

/**
 * Returns true when it is the final day of the trial (trialDaysLeft === 0
 * but trial has NOT yet expired). Used to trigger the Day-14 Moment-1 sheet.
 *
 * "Days left === 0 but trial still active" means trial_ends_at is today (within
 * the next 24 hours). trialDaysLeft uses Math.ceil so 0 means expired; we use
 * Math.floor < 1 to catch the last partial day differently.
 *
 * @param {object|null|undefined} profile
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isTrialLastDay(profile, now = new Date()) {
  if (!isTrialActive(profile, now)) return false;
  const msLeft = new Date(profile.trial_ends_at) - now;
  // Last day = less than 24 hours remaining but trial still active
  return msLeft > 0 && msLeft <= 86400000;
}

/**
 * localStorage key for the Moment-2 "drop to free" seen flag.
 * A per-device flag is set when the user dismisses Moment 2 so it never
 * re-fires. A server-side flag (profiles.drop_to_free_seen) also exists for
 * cross-device consistency — see AppShell for the write.
 */
export const DROP_TO_FREE_SEEN_KEY = 'jp.dropToFreeSeen';

/**
 * Returns true when the user has already seen and dismissed the Moment-2
 * drop-to-free screen on this device.
 *
 * @returns {boolean}
 */
export function hasDropToFreeSeen() {
  try {
    return !!localStorage.getItem(DROP_TO_FREE_SEEN_KEY);
  } catch {
    return false;
  }
}

/**
 * Mark the Moment-2 drop-to-free screen as seen on this device.
 * Also triggers the server-side write in AppShell (passed as a callback).
 */
export function markDropToFreeSeen() {
  try {
    localStorage.setItem(DROP_TO_FREE_SEEN_KEY, '1');
  } catch {
    // Private browsing — degraded gracefully.
  }
}

/**
 * localStorage key for the Day-14 Moment-1 sheet "not now / shown today" gate.
 * Stores the date string (YYYY-MM-DD) when the sheet was last dismissed so it
 * does not re-nag within the same day.
 */
export const TRIAL_END_SHEET_DISMISSED_KEY = 'jp.trialEndSheetDismissed';

/**
 * Returns true when the Moment-1 trial-end sheet has already been shown and
 * dismissed today (suppresses re-nag within the same calendar day).
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
export function trialEndSheetDismissedToday(now = new Date()) {
  try {
    const stored = localStorage.getItem(TRIAL_END_SHEET_DISMISSED_KEY);
    if (!stored) return false;
    const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
    return stored === today;
  } catch {
    return false;
  }
}

/**
 * Record a "Not now" dismissal of the Moment-1 trial-end sheet.
 * Stores today's date so the sheet does not re-appear on the same day.
 *
 * @param {Date} [now]
 */
export function recordTrialEndSheetDismissed(now = new Date()) {
  try {
    const today = now.toISOString().slice(0, 10);
    localStorage.setItem(TRIAL_END_SHEET_DISMISSED_KEY, today);
  } catch {
    // Private browsing — degraded gracefully.
  }
}

/**
 * If the user is on plan='trial' but trial_ends_at has passed, persist
 * plan='free' to Supabase so the DB stays clean.
 *
 * IMPORTANT: This function is NOT called automatically on expiry any more.
 * The AppShell honesty fix requires Moment 2 (drop-to-free screen) to be
 * seen FIRST before the plan is flipped. Call this only after marking
 * drop_to_free_seen on both the profile and localStorage.
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
      .update({ plan: 'free', drop_to_free_seen: true })
      .eq('id', userId);
  } catch {
    // Offline — next app load will retry.
  }
}
