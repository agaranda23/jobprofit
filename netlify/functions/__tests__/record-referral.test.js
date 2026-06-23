/**
 * Tests for netlify/functions/record-referral.js (JP-LU7 Phase 1)
 *
 * No network, no Supabase connection. All DB calls are mocked.
 * Pattern matches the project's no-DOM netlify function test convention.
 *
 * Covers:
 *   A. Method / config guards
 *   B. Auth guard — 401 on missing / invalid JWT
 *   C. Body parsing — no_code when referral_code absent
 *   D. Unknown code — no matching profile
 *   E. Self-referral guard
 *   F. Already-referred guard
 *   G. Happy path — referral row inserted, returns { recorded: true }
 *   H. Duplicate insert — unique violation treated as success (idempotent)
 *   I. Schema-missing degradation — 42703 / 42P01 → { skipped: 'table_missing' }
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Constants ─────────────────────────────────────────────────────────────────
const FAKE_URL          = 'https://test.supabase.co';
const FAKE_SERVICE_KEY  = 'service-role-key-test';
const FAKE_TOKEN        = 'valid-jwt-token';
const REFERRER_USER_ID  = 'referrer-uuid-0001';
const REFEREE_USER_ID   = 'referee-uuid-0002';
const REFERRAL_CODE     = 'ABC123';

// ── Supabase mock state ───────────────────────────────────────────────────────
// The handler calls (in order):
//   1. adminClient.auth.getUser(token)            — JWT → referee ID
//   2. from('profiles').select().eq('referral_code', code).single()
//                                                  — referrer lookup
//   3. from('profiles').select('referred_by').eq('id', refereeId).single()
//                                                  — referee check
//   4. from('profiles').update({referred_by}).eq().is() — set referred_by
//   5. from('referrals').insert(...)               — insert row

let mockGetUser;

// Configurable per-test return values
let mockReferrerResult  = null;  // { data, error } for referrer lookup
let mockRefereeResult   = null;  // { data, error } for referee check
let mockUpdateResult    = null;  // { error } for profiles update
let mockInsertResult    = null;  // { error } for referrals insert

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: (...args) => mockGetUser(...args),
    },
    from: vi.fn((table) => {
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn(async () => {
            // First call to single() returns referrer, second returns referee
            if (!profileSingleCallCount) profileSingleCallCount = 0;
            profileSingleCallCount++;
            return profileSingleCallCount === 1 ? mockReferrerResult : mockRefereeResult;
          }),
          update: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            is: vi.fn(async () => mockUpdateResult),
          })),
        };
      }
      if (table === 'referrals') {
        return {
          insert: vi.fn(async () => mockInsertResult),
        };
      }
      return {};
    }),
  })),
}));

let profileSingleCallCount = 0;

function resetMocks() {
  profileSingleCallCount = 0;
  mockGetUser = vi.fn().mockResolvedValue({
    data: { user: { id: REFEREE_USER_ID } },
    error: null,
  });
  mockReferrerResult = {
    data: { id: REFERRER_USER_ID, referred_by: null },
    error: null,
  };
  mockRefereeResult = {
    data: { referred_by: null },
    error: null,
  };
  mockUpdateResult = { error: null };
  mockInsertResult = { error: null };
}

async function getHandler() {
  const mod = await import('../record-referral.js');
  return mod.handler;
}

function makeEvent({
  method = 'POST',
  token  = FAKE_TOKEN,
  body   = { referral_code: REFERRAL_CODE },
} = {}) {
  return {
    httpMethod: method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body !== null ? JSON.stringify(body) : null,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeEach(() => {
  process.env.VITE_SUPABASE_URL         = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  resetMocks();
});

afterEach(() => {
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.resetModules();
});

// ── A. Method / config guards ─────────────────────────────────────────────────

describe('A. Method and config guards', () => {
  it('returns 200 for OPTIONS preflight', async () => {
    const handler = await getHandler();
    const res = await handler({ httpMethod: 'OPTIONS', headers: {}, body: '' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 405 for non-POST methods', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  it('returns 500 when Supabase env vars are missing', async () => {
    delete process.env.VITE_SUPABASE_URL;
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/configuration/i);
  });
});

// ── B. Auth guard ─────────────────────────────────────────────────────────────

describe('B. Auth guard', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ token: null }));
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when JWT verification fails', async () => {
    mockGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(401);
  });
});

// ── C. Body parsing — missing code ───────────────────────────────────────────

describe('C. Missing referral_code', () => {
  it('returns { skipped: no_code } when body is empty', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ body: {} }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('no_code');
  });

  it('returns { skipped: no_code } when referral_code is empty string', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ body: { referral_code: '   ' } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('no_code');
  });

  it('returns { skipped: no_code } when body is null', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent({ body: null }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('no_code');
  });
});

// ── D. Unknown code ───────────────────────────────────────────────────────────

describe('D. Unknown referral code', () => {
  it('returns { skipped: unknown_code } when no profile matches the code', async () => {
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('unknown_code');
  });
});

// ── E. Self-referral guard ────────────────────────────────────────────────────

describe('E. Self-referral rejected', () => {
  it('returns { skipped: self_referral } when referrer === referee', async () => {
    // Make the auth return the REFERRER_USER_ID as the authenticated user
    mockGetUser = vi.fn().mockResolvedValue({
      data: { user: { id: REFERRER_USER_ID } },
      error: null,
    });
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('self_referral');
  });
});

// ── F. Already-referred guard ─────────────────────────────────────────────────

describe('F. Already-referred guard', () => {
  it('returns { skipped: already_referred } when referee.referred_by is set', async () => {
    mockRefereeResult = { data: { referred_by: 'some-other-user-uuid' }, error: null };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('already_referred');
  });
});

// ── G. Happy path ─────────────────────────────────────────────────────────────

describe('G. Happy path', () => {
  it('returns 200 { recorded: true }', async () => {
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recorded).toBe(true);
  });
});

// ── H. Duplicate insert — idempotent ──────────────────────────────────────────

describe('H. Duplicate referral insert — idempotent', () => {
  it('returns { recorded: true } on unique-violation insert (23505)', async () => {
    mockInsertResult = { error: { code: '23505', message: 'duplicate key' } };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recorded).toBe(true);
  });
});

// ── I. Schema-missing degradation ────────────────────────────────────────────

describe('I. Schema-missing — migration not applied', () => {
  it('returns { skipped: table_missing } on 42703 during referrer lookup', async () => {
    mockReferrerResult = {
      data: null,
      error: { code: '42703', message: 'column does not exist' },
    };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('table_missing');
  });

  it('returns { skipped: table_missing } on 42703 during referred_by update', async () => {
    mockUpdateResult = { error: { code: '42703', message: 'column does not exist' } };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('table_missing');
  });

  it('returns { skipped: table_missing } on 42P01 during referrals insert', async () => {
    mockInsertResult = { error: { code: '42P01', message: 'relation does not exist' } };
    const handler = await getHandler();
    const res = await handler(makeEvent());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('table_missing');
  });
});
