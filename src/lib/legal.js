/**
 * legal.js — Terms of Service acceptance tracking.
 *
 * TOS_VERSION should be bumped whenever public/terms.html changes in a way
 * that needs re-acceptance. AuthScreen's clickwrap line ("By continuing,
 * you agree to our Terms of Service...") governs both the Google and
 * email sign-in paths; stashTosAcceptance() records that moment locally
 * (there is no session yet to write to). flushTosAcceptance() persists it
 * to the user's Supabase auth record once a session exists — user_metadata,
 * not a new profiles column, so this ships with no DB migration.
 *
 * Public API
 * ──────────
 * TOS_VERSION                            → current ToS version string
 * stashTosAcceptance()                   → localStorage write, call on sign-in click/submit
 * flushTosAcceptance(supabaseClient, user) → Promise<void>, call on first authenticated load
 */

const STASH_KEY = 'jp.tosAcceptance';

export const TOS_VERSION = '2026-07-07';

/**
 * Records that the visitor has just actioned a sign-in control (Google
 * button or magic-link submit) directly below the clickwrap line. Written
 * to localStorage rather than state because the Google path immediately
 * redirects away from the app.
 */
export function stashTosAcceptance() {
  try {
    localStorage.setItem(
      STASH_KEY,
      JSON.stringify({ version: TOS_VERSION, acceptedAt: new Date().toISOString() })
    );
  } catch {
    // Private browsing may block localStorage writes — not fatal, just
    // means the flush below finds nothing to send.
  }
}

/**
 * Flushes a stashed acceptance to Supabase user_metadata, once. No-ops
 * (does NOT fabricate an acceptance record) if nothing was stashed — e.g.
 * a returning user's session restoring on load never touched the clickwrap
 * this visit. Safe to call on every sign-in: skips the network call once
 * the stashed version is already recorded.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 * @param {{ user_metadata?: Record<string, unknown> } | null | undefined} user
 */
export async function flushTosAcceptance(supabaseClient, user) {
  if (!user) return;

  let stashed = null;
  try {
    const raw = localStorage.getItem(STASH_KEY);
    if (raw) stashed = JSON.parse(raw);
  } catch {
    // Corrupt or blocked localStorage — nothing to flush.
  }
  if (!stashed?.version || !stashed?.acceptedAt) return;

  if (user.user_metadata?.tos_version === stashed.version) {
    // Already recorded at this version — just clear the stash.
    try { localStorage.removeItem(STASH_KEY); } catch { /* ignore */ }
    return;
  }

  try {
    const { error } = await supabaseClient.auth.updateUser({
      data: { tos_version: stashed.version, tos_accepted_at: stashed.acceptedAt },
    });
    if (!error) {
      try { localStorage.removeItem(STASH_KEY); } catch { /* ignore */ }
    }
  } catch {
    // Network/auth hiccup — leave the stash in place so the next load retries.
  }
}
