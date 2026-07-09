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
 * Cross-device magic-link gap: stashTosAcceptance() writes to localStorage
 * on the device where the link was REQUESTED, but "email a link, tap it,
 * you're in" (the app's own hint text) normalises opening it somewhere
 * else — a different browser, or Safari vs an installed home-screen PWA on
 * iOS. That device's localStorage never had the stash, so the flush would
 * silently no-op forever. buildTosRedirectUrl()/captureTosAcceptanceFromUrl()
 * close that gap by carrying the acceptance in the redirect URL's query
 * string instead of relying solely on localStorage — see each function's
 * doc comment below.
 *
 * Public API
 * ──────────
 * TOS_VERSION                              → current ToS version string
 * stashTosAcceptance()                     → localStorage write, call on sign-in click/submit; returns the record
 * buildTosRedirectUrl(record, baseUrl?)    → emailRedirectTo URL with tos_v/tos_at appended
 * captureTosAcceptanceFromUrl()            → call once, synchronously, at the very top of main.jsx
 * flushTosAcceptance(supabaseClient, user) → Promise<void>, call on first authenticated load
 */

import { logTelemetry } from './telemetry';

const STASH_KEY = 'jp.tosAcceptance';

export const TOS_VERSION = '2026-07-07';

/**
 * Records that the visitor has just actioned a sign-in control (Google
 * button or magic-link submit) directly below the clickwrap line. Written
 * to localStorage rather than state because the Google path immediately
 * redirects away from the app. Returns the record so callers (e.g. the
 * magic-link path) can also embed it in the redirect URL — see
 * buildTosRedirectUrl().
 */
export function stashTosAcceptance() {
  const record = { version: TOS_VERSION, acceptedAt: new Date().toISOString() };
  try {
    localStorage.setItem(STASH_KEY, JSON.stringify(record));
  } catch {
    // Private browsing may block localStorage writes — not fatal for the
    // magic-link path, since buildTosRedirectUrl() still carries `record`
    // via the emailRedirectTo query params. It IS fatal for the Google
    // path (no redirect URL round-trip through us to carry it on), which
    // is an accepted gap — private browsing already blocks persistSession.
  }
  return record;
}

/**
 * Builds the magic-link emailRedirectTo URL with tos_v/tos_at appended, so
 * the acceptance travels WITH the emailed link rather than relying only on
 * localStorage on the device that requested it. Supabase uses this string
 * as the base for the link it emails, appending its own auth params (code
 * or token_hash) — our tos_v/tos_at ride along in the query string either
 * way and are recovered by captureTosAcceptanceFromUrl() on landing.
 *
 * @param {{version?: string, acceptedAt?: string}} record — from stashTosAcceptance()
 * @param {string} [baseUrl] — defaults to the current origin
 */
export function buildTosRedirectUrl(record, baseUrl = window.location.origin) {
  try {
    const url = new URL(baseUrl);
    if (record?.version && record?.acceptedAt) {
      url.searchParams.set('tos_v', record.version);
      url.searchParams.set('tos_at', record.acceptedAt);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Cross-device fallback for the magic-link flow: reads tos_v/tos_at query
 * params off the landing URL (put there by buildTosRedirectUrl() above) and
 * stashes them exactly like stashTosAcceptance() would — so flushTosAcceptance()
 * has something to flush even when the link is opened on a different
 * device/browser context than the one that requested it.
 *
 * Must run synchronously, at the very top of main.jsx, BEFORE Supabase's own
 * detectSessionInUrl handling processes (and may clear) the redirect URL —
 * same ordering requirement, and same pattern, as captureReferralCode() in
 * main.jsx for `?ref=`.
 *
 * Leaves an existing stash alone (first request wins — e.g. the link was
 * opened in the same browser that requested it, which already has a fresher
 * stash) and always strips tos_v/tos_at from the URL bar once read, so they
 * never linger in a shared or bookmarked URL.
 */
export function captureTosAcceptanceFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const version = params.get('tos_v');
    const acceptedAt = params.get('tos_at');
    if (!version || !acceptedAt) return;

    if (!localStorage.getItem(STASH_KEY)) {
      localStorage.setItem(STASH_KEY, JSON.stringify({ version, acceptedAt }));
    }

    params.delete('tos_v');
    params.delete('tos_at');
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
  } catch {
    // localStorage/history unavailable — flushTosAcceptance's no-stash
    // telemetry (below) surfaces this as a real-world flush miss.
  }
}

/**
 * Flushes a stashed acceptance to Supabase user_metadata, once. No-ops
 * (does NOT fabricate an acceptance record) if nothing was stashed — e.g.
 * a returning user's session restoring on load never touched the clickwrap
 * this visit. Safe to call on every sign-in: skips the network call once
 * the stashed version is already recorded.
 *
 * By the time this runs, captureTosAcceptanceFromUrl() (called synchronously
 * in main.jsx, before this) has already recovered a cross-device magic-link
 * acceptance into the same localStorage stash if one was present in the URL.
 * If there is STILL nothing stashed here for a brand-new sign-up with no
 * acceptance recorded yet, that's a residual real-world consent-capture
 * miss (e.g. an email client stripping/rewriting the link's query string,
 * or private browsing blocking both localStorage AND the URL fallback) —
 * log it so its frequency is measurable instead of failing silently
 * forever. Gated on isNewSignUp (mirrors AppShell's SIGNED_IN heuristic) so
 * this doesn't fire on every token refresh for a pre-existing account that
 * simply predates this whole clickwrap mechanism — that's expected, not a
 * flush failure.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseClient
 * @param {{ id?: string, created_at?: string, user_metadata?: Record<string, unknown> } | null | undefined} user
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
  if (!stashed?.version || !stashed?.acceptedAt) {
    const createdAt = user.created_at ? new Date(user.created_at).getTime() : null;
    const isNewSignUp = createdAt != null && Date.now() - createdAt < 60_000;
    if (isNewSignUp && !user.user_metadata?.tos_version) {
      logTelemetry('tos_acceptance_flush_missing');
    }
    return;
  }

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
