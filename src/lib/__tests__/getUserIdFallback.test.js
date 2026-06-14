/**
 * getUserIdFallback.test.js
 *
 * Regression for F2 (sync/backup bug fix): getUserId() must fall back to
 * supabase.auth.getSession() when getUser() returns null due to a transient
 * network/token-refresh blip, rather than immediately treating the user as
 * signed out and throwing "Not signed in".
 *
 * Only treat as genuinely signed out when BOTH getUser() AND getSession()
 * yield no user.
 *
 * Tests:
 *   1. getUser returns null → falls back to getSession → returns session user id
 *   2. Both return null → addJobToCloud throws "Not signed in"
 *   3. getUser returns user → returns user id (session is not called at all)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── localStorage mock ─────────────────────────────────────────────────────────
function makeLocalStorageMock() {
  let store = {};
  return {
    getItem:    vi.fn(key => store[key] ?? null),
    setItem:    vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear:      vi.fn(() => { store = {}; }),
  };
}
vi.stubGlobal('localStorage', makeLocalStorageMock());

// ── Supabase mock — controlled per-test via module-level vars ─────────────────
let _getUserResult   = null;  // { user } shape returned by getUser
let _getSessionResult = null; // { session } shape returned by getSession
let _lastInsertedRow = null;

vi.mock('../supabase', () => {
  const fakeSelect = () => ({
    single: async () => ({
      data: { ..._lastInsertedRow, created_at: new Date().toISOString(), meta: {} },
      error: null,
    }),
  });
  const fakeInsert = (row) => {
    _lastInsertedRow = row;
    return { select: fakeSelect };
  };
  return {
    supabase: {
      auth: {
        getUser:    async () => ({ data: { user: _getUserResult } }),
        getSession: async () => ({ data: { session: _getSessionResult } }),
      },
      from: vi.fn(() => ({ insert: fakeInsert })),
    },
  };
});

// Import AFTER mocks are registered. Dynamic import flushes the mock registry.
const { addJobToCloud } = await import('../store.js');

function minimalPayload(overrides = {}) {
  return {
    id:   crypto.randomUUID(),
    name: 'Test job',
    paid: false,
    ...overrides,
  };
}

beforeEach(() => {
  _getUserResult    = null;
  _getSessionResult = null;
  _lastInsertedRow  = null;
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('getUserId — session fallback when getUser returns null', () => {
  it('uses session.user.id when getUser returns null but getSession has a user', async () => {
    // Simulate a transient token-refresh blip: getUser fails to validate,
    // but getSession reads the locally-cached session and returns the user.
    _getUserResult    = null;
    _getSessionResult = { user: { id: 'session-user-uuid' } };

    const result = await addJobToCloud(minimalPayload());
    // addJobToCloud should succeed (not throw) and the inserted row should
    // carry the session user id as user_id.
    expect(_lastInsertedRow).not.toBeNull();
    expect(_lastInsertedRow.user_id).toBe('session-user-uuid');
    expect(result).toBeDefined();
  });

  it('throws "Not signed in" when both getUser and getSession yield no user', async () => {
    _getUserResult    = null;
    _getSessionResult = null;

    await expect(addJobToCloud(minimalPayload())).rejects.toThrow('Not signed in');
    expect(_lastInsertedRow).toBeNull();
  });

  it('uses getUser result directly when getUser succeeds — getSession is not needed', async () => {
    // Happy path: getUser returns the user, no fallback required.
    _getUserResult    = { id: 'primary-user-uuid' };
    _getSessionResult = { user: { id: 'should-not-be-used' } };

    const result = await addJobToCloud(minimalPayload());
    expect(_lastInsertedRow.user_id).toBe('primary-user-uuid');
    expect(result).toBeDefined();
  });
});
