/**
 * referral.js — personal referral link helpers (JP-LU7 Phase 1)
 *
 * Public API
 * ──────────
 * REFERRAL_CODE_STORAGE_KEY            → shared sessionStorage key
 * buildReferralLink(code)              → full URL string
 * withReferralCode(baseUrl)            → baseUrl + ?ref= (or unchanged)
 * generateReferralCode()               → 6-char alphanumeric string
 * ensureReferralCode(supabase, userId, profile) → Promise<string|null>
 * copyReferralLink(code)               → Promise<void>
 *
 * Design invariants
 * ─────────────────
 * - NEVER throws to callers. Every async function catches and either returns
 *   null or no-ops so that missing-column (42703) errors don't crash the UI.
 * - buildReferralLink uses window.location.origin so the shared link uses
 *   whichever domain the user is currently on (ohnar.co.uk once it is primary).
 * - generateReferralCode uses crypto.getRandomValues for unguessable codes.
 */

/** Supabase/PostgREST error code for "column does not exist" */
const PG_UNDEFINED_COLUMN = '42703';

/**
 * sessionStorage key that carries a captured `?ref=` code across the sign-in
 * flow. Single source of truth — main.jsx (writer), AppShell.jsx (reader on
 * SIGNED_IN/INITIAL_SESSION) and AuthScreen.jsx (invite banner + redirectTo
 * builder below) all import this instead of repeating the string literal.
 */
export const REFERRAL_CODE_STORAGE_KEY = 'jp.referralCode';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/**
 * Build the shareable referral link for a given code.
 * @param {string} code
 * @returns {string}
 */
export function buildReferralLink(code) {
  const base =
    typeof window !== 'undefined' ? window.location.origin : 'https://ohnar.co.uk';
  return `${base}/?ref=${encodeURIComponent(code)}`;
}

/**
 * Appends the in-flight referral code (if any) as a `ref` query param onto
 * an auth redirect URL — `signInWithOAuth`'s `redirectTo` or
 * `signInWithOtp`'s `emailRedirectTo`.
 *
 * Why: a plain sessionStorage value set on first page load isn't reliable
 * across a full-page OAuth round trip (Google, then Supabase's callback,
 * then back). Putting the code IN the returning URL instead means
 * main.jsx's existing captureReferralCode() re-reads it from `?ref=` and
 * re-persists it to sessionStorage on whatever page/origin the flow lands
 * back on — so the code can't be dropped by the bounce.
 *
 * Never throws — falls back to `baseUrl` unchanged if there's no code to
 * carry, sessionStorage is unavailable (private browsing), or baseUrl isn't
 * a parseable absolute URL.
 *
 * @param {string} baseUrl — e.g. window.location.origin
 * @returns {string}
 */
export function withReferralCode(baseUrl) {
  try {
    const code = sessionStorage.getItem(REFERRAL_CODE_STORAGE_KEY);
    if (!code) return baseUrl;
    const url = new URL(baseUrl);
    url.searchParams.set('ref', code);
    return url.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Generate a 6-character alphanumeric referral code using the CSPRNG.
 * Excludes visually ambiguous characters (0, O, I, l, 1).
 * @returns {string}
 */
export function generateReferralCode() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < bytes.length && code.length < 6; i++) {
    const idx = bytes[i] % ALPHABET.length;
    code += ALPHABET[idx];
  }
  // Pad in the astronomically unlikely case we ran out of bytes
  while (code.length < 6) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

/**
 * Ensure the user has a referral_code in their profile.
 *
 * If profile.referral_code is already set, returns it immediately (no DB call).
 * Otherwise generates a new code and upserts it to profiles.
 *
 * Failure modes:
 *   - 42703 (column missing — migration not applied): returns null, caller
 *     falls back to the generic share so nothing breaks.
 *   - 23505 unique collision: retries once with a fresh code.
 *   - Any other error: returns null (silent degradation).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {object} profile  — the current profile object from the app state
 * @returns {Promise<string|null>}
 */
export async function ensureReferralCode(supabase, userId, profile) {
  // Fast path — code already exists, no round-trip needed
  if (profile?.referral_code) {
    return profile.referral_code;
  }

  const attemptUpsert = async (code) => {
    const { error } = await supabase
      .from('profiles')
      .update({ referral_code: code })
      .eq('id', userId);
    return error;
  };

  try {
    const code = generateReferralCode();
    const error = await attemptUpsert(code);

    if (!error) return code;

    // Column missing — migration hasn't been applied yet
    if (error.code === PG_UNDEFINED_COLUMN) {
      return null;
    }

    // Unique collision (23505) — retry once
    if (error.code === '23505') {
      const retry = generateReferralCode();
      const retryError = await attemptUpsert(retry);
      if (!retryError) return retry;
      if (retryError.code === PG_UNDEFINED_COLUMN) return null;
      // Second collision or other error — give up silently
      return null;
    }

    // Any other DB error — degrade silently
    return null;
  } catch {
    return null;
  }
}

/**
 * Copy the referral link to the clipboard.
 * Falls back to navigator.share when clipboard API is unavailable.
 * Never throws — callers can fire-and-forget.
 *
 * @param {string} code
 * @returns {Promise<void>}
 */
export async function copyReferralLink(code) {
  const url = buildReferralLink(code);
  const shareData = {
    title: 'OHNAR',
    text: "I use OHNAR to quote, invoice and get paid from my phone — give it a go.",
    url,
  };

  // Try navigator.share first (native share sheet on mobile)
  if (
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare(shareData)
  ) {
    try {
      await navigator.share(shareData);
      return;
    } catch {
      // User cancelled or share failed — fall through to clipboard
    }
  }

  // Clipboard fallback
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Clipboard unavailable — nothing we can do
  }
}
