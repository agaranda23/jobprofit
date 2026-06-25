/**
 * referral.js — personal referral link helpers (JP-LU7 Phase 1)
 *
 * Public API
 * ──────────
 * buildReferralLink(code)              → full URL string
 * generateReferralCode()               → 6-char alphanumeric string
 * ensureReferralCode(supabase, userId, profile) → Promise<string|null>
 * copyReferralLink(code)               → Promise<void>
 *
 * Design invariants
 * ─────────────────
 * - NEVER throws to callers. Every async function catches and either returns
 *   null or no-ops so that missing-column (42703) errors don't crash the UI.
 * - buildReferralLink uses jobprofit.co.uk — the live production domain.
 * - generateReferralCode uses crypto.getRandomValues for unguessable codes.
 */

const BASE_URL = 'https://jobprofit.co.uk';

/** Supabase/PostgREST error code for "column does not exist" */
const PG_UNDEFINED_COLUMN = '42703';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/**
 * Build the shareable referral link for a given code.
 * @param {string} code
 * @returns {string}
 */
export function buildReferralLink(code) {
  return `${BASE_URL}/?ref=${encodeURIComponent(code)}`;
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
