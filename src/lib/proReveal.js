/**
 * proReveal.js — gating for the "You've got Pro" reveal card.
 *
 * Fixes silent trial activation: every new profile defaults to a 14-day Pro
 * trial the instant it's created, with no screen shown. This reveal is a
 * one-time, gift-framed sheet ("You've got OHNAR Pro") shown right after
 * onboarding (or on first Today load for wizard-skippers — see AppShell.jsx)
 * so activation is informed instead of invisible.
 *
 * Gating is a per-user localStorage flag (jp.proRevealSeen.<uid>) — deliberately
 * NOT a Supabase profile column. Per the migration-drift rule (project memory:
 * migrations are hand-applied in prod and silently drift), we avoid adding a
 * migration for a reveal that's harmless to show again on a second device.
 * A cross-device `pro_reveal_seen` profile column is a noted future
 * enhancement, not required for this slice.
 */
import { isTrialActive } from './plan';

const KEY_PREFIX = 'jp.proRevealSeen.';

/**
 * Has this device already shown the reveal for this user?
 * Fails "seen" (true) when localStorage is unavailable or userId is missing —
 * i.e. we never spam the reveal if we can't reliably gate it.
 *
 * @param {string|null|undefined} userId
 * @returns {boolean}
 */
export function hasSeenProReveal(userId) {
  if (!userId) return true;
  try {
    return !!localStorage.getItem(KEY_PREFIX + userId);
  } catch {
    return true;
  }
}

/**
 * Record that this device has now shown the reveal for this user.
 * Best-effort — silently no-ops in private browsing / storage-denied contexts.
 *
 * @param {string|null|undefined} userId
 */
export function markProRevealSeen(userId) {
  if (!userId) return;
  try {
    localStorage.setItem(KEY_PREFIX + userId, '1');
  } catch {
    /* private browsing or storage denied — best effort only */
  }
}

/**
 * Should the reveal fire right now for this profile/user?
 * True only when the user is on an active trial AND hasn't seen the reveal
 * on this device yet. Forward-safe: expired/free/paid profiles never match
 * isTrialActive, so they never see it.
 *
 * @param {object|null|undefined} profile — Supabase profiles row
 * @param {string|null|undefined} userId
 * @returns {boolean}
 */
export function shouldShowProReveal(profile, userId) {
  return isTrialActive(profile) && !hasSeenProReveal(userId);
}
