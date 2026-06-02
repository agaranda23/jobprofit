/**
 * activationGuard — unit tests for the user_activated once-per-user guard.
 *
 * The guard lives inside handleAddJob in AppShell.jsx. We extract the logic
 * here so we can verify it without mounting React or touching Supabase.
 *
 * Convention: pure-logic, no DOM, no React — matches project test style.
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Inline the guard logic so the test is not coupled to AppShell internals.
// If the implementation moves, update this mirror and the comment below.
// Mirror of: AppShell.jsx handleAddJob activation block.
// ---------------------------------------------------------------------------

const ACTIVATION_KEY = 'jp.telemetry.activated';

/**
 * Simulate firing user_activated.
 * Returns the event name if it fires, null if guarded.
 *
 * @param {object} storage — injectable localStorage-like store (key/value map)
 * @param {object} session — minimal Supabase session shape
 * @returns {{ event: string, props: object }|null}
 */
function maybeFireActivation(storage, session) {
  if (storage[ACTIVATION_KEY]) return null;
  storage[ACTIVATION_KEY] = '1';
  const createdAt = session?.user?.created_at
    ? new Date(session.user.created_at).getTime()
    : null;
  const secsSinceSignup = createdAt
    ? Math.round((Date.now() - createdAt) / 1000)
    : null;
  return { event: 'user_activated', props: { secs_since_signup: secsSinceSignup } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('user_activated once-per-user guard', () => {
  let store;

  beforeEach(() => {
    // Fresh in-memory store for every test — no real localStorage side-effects.
    store = {};
  });

  it('fires on the first job save when the flag is absent', () => {
    const session = { user: { id: 'uuid-1', created_at: new Date(Date.now() - 120_000).toISOString() } };
    const result = maybeFireActivation(store, session);
    expect(result).not.toBeNull();
    expect(result.event).toBe('user_activated');
  });

  it('sets the guard flag after firing so a second call returns null', () => {
    const session = { user: { id: 'uuid-1', created_at: new Date(Date.now() - 120_000).toISOString() } };
    maybeFireActivation(store, session);
    const second = maybeFireActivation(store, session);
    expect(second).toBeNull();
  });

  it('does NOT fire when the guard flag is already set (re-login or second job)', () => {
    store[ACTIVATION_KEY] = '1';
    const session = { user: { id: 'uuid-1', created_at: new Date().toISOString() } };
    const result = maybeFireActivation(store, session);
    expect(result).toBeNull();
  });

  it('includes secs_since_signup when session.user.created_at is available', () => {
    const createdAt = new Date(Date.now() - 300_000); // 5 minutes ago
    const session = { user: { id: 'uuid-1', created_at: createdAt.toISOString() } };
    const result = maybeFireActivation(store, session);
    // Should be roughly 300 s — allow ±5 s for test execution time.
    expect(result.props.secs_since_signup).toBeGreaterThanOrEqual(295);
    expect(result.props.secs_since_signup).toBeLessThanOrEqual(305);
  });

  it('sets secs_since_signup to null when session has no created_at', () => {
    const session = { user: { id: 'uuid-1' } };
    const result = maybeFireActivation(store, session);
    expect(result.props.secs_since_signup).toBeNull();
  });

  it('sets secs_since_signup to null when session is null (offline-queue path)', () => {
    const result = maybeFireActivation(store, null);
    expect(result).not.toBeNull();
    expect(result.props.secs_since_signup).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// is_new_user threshold (mirrors AppShell onAuthStateChange logic)
// ---------------------------------------------------------------------------

describe('is_new_user threshold (60-second window)', () => {
  function computeIsNew(createdAtIso) {
    const createdAt = new Date(createdAtIso ?? 0).getTime();
    return Date.now() - createdAt < 60_000;
  }

  it('returns true for an account created 5 seconds ago', () => {
    const ts = new Date(Date.now() - 5_000).toISOString();
    expect(computeIsNew(ts)).toBe(true);
  });

  it('returns true for an account created 59 seconds ago', () => {
    const ts = new Date(Date.now() - 59_000).toISOString();
    expect(computeIsNew(ts)).toBe(true);
  });

  it('returns false for an account created 61 seconds ago', () => {
    const ts = new Date(Date.now() - 61_000).toISOString();
    expect(computeIsNew(ts)).toBe(false);
  });

  it('returns false for a returning user created hours ago', () => {
    const ts = new Date(Date.now() - 3_600_000).toISOString();
    expect(computeIsNew(ts)).toBe(false);
  });
});
