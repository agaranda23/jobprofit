/**
 * Tests for netlify/functions/record-referral.js
 * (JP-LU7 Phase 1 personal codes + JP-LU9 campaign codes)
 *
 * No network, no Supabase connection. All DB calls are mocked.
 * Pattern matches the project's no-DOM netlify function test convention.
 *
 * Covers:
 *   A. Method / config guards
 *   B. Auth guard — 401 on missing / invalid JWT
 *   C. Body parsing — no_code when referral_code absent
 *   D. Unknown code — no matching profile AND no matching campaign
 *   E. Self-referral guard (personal codes only)
 *   F. Already-referred guard (personal codes)
 *   G. Happy path — personal referral row inserted, returns { recorded: true }
 *   H. Duplicate insert — unique violation treated as success (idempotent)
 *   I. Schema-missing degradation — 42703 / 42P01 → { skipped: 'table_missing' }
 *   J. Campaign-code fallback (JP-LU9) — audience perk grant, extend-only guard,
 *      founding_lock stamping, campaign_inactive / campaign_expired, dedupe
 *   K. Pure helpers — computeExtendedTrialEndsAt / foundingLockShouldStamp
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Constants ─────────────────────────────────────────────────────────────────
const FAKE_URL          = 'https://test.supabase.co';
const FAKE_SERVICE_KEY  = 'service-role-key-test';
const FAKE_TOKEN        = 'valid-jwt-token';
const REFERRER_USER_ID  = 'referrer-uuid-0001';
const REFEREE_USER_ID   = 'referee-uuid-0002';
const REFERRAL_CODE     = 'ABC123';
const CAMPAIGN_ID       = 'campaign-uuid-0001';
const CAMPAIGN_CODE     = 'MITCH60';

// ── Supabase mock state ───────────────────────────────────────────────────────
// The handler calls (in order), personal-code path:
//   1. adminClient.auth.getUser(token)            — JWT → referee ID
//   2. from('profiles').select().eq('referral_code', code).single()
//                                                  — referrer lookup
//   3. from('profiles').select('referred_by').eq('id', refereeId).single()
//                                                  — referee check
//   4. from('profiles').update({referred_by}).eq().is() — set referred_by
//   5. from('referrals').insert(...)               — insert row
//
// Campaign-code path (referral_code lookup misses — PGRST116):
//   2b. from('campaigns').select().eq('code', CODE).single()
//   3b. from('referrals').select('id').eq('referee_id', refereeId).single()
//                                                  — dedupe (existing referral?)
//   4b. from('profiles').select('trial_ends_at, founding_member, plan')
//                                                  .eq('id', refereeId).single()
//   5b. from('profiles').update({trial_ends_at, ...}).eq('id', refereeId)
//   6b. from('referrals').insert({ campaign_id, referee_id, status })

let mockGetUser;

// Configurable per-test return values
let mockReferrerResult          = null; // { data, error } for referral_code lookup
let mockRefereeResult           = null; // { data, error } for the SECOND profiles.single() call
                                         // (personal: referred_by check; campaign: perk-grant fetch)
let mockUpdateResult            = null; // { error } for profiles update (referred_by OR perk grant)
let mockInsertResult            = null; // { error } for referrals insert
let mockCampaignResult          = null; // { data, error } for campaigns lookup
let mockExistingReferralResult  = null; // { data, error } for the campaign-path dedupe check

const campaignEqArgs = []; // captures every .eq(col, val) call against the campaigns table

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
          single: vi.fn(async () => {
            // First call to single() returns referrer, second returns referee
            if (!profileSingleCallCount) profileSingleCallCount = 0;
            profileSingleCallCount++;
            return profileSingleCallCount === 1 ? mockReferrerResult : mockRefereeResult;
          }),
          update: vi.fn((payload) => {
            lastProfilesUpdatePayload = payload;
            return {
              eq: vi.fn(() => ({
                // Personal path chains .is() after .eq(); campaign path
                // terminates at .eq() itself. Making this a thenable lets
                // BOTH `await update().eq()` and `await update().eq().is()`
                // resolve correctly.
                is: vi.fn(async () => mockUpdateResult),
                then: (resolve) => resolve(mockUpdateResult),
              })),
            };
          }),
        };
      }
      if (table === 'campaigns') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn((col, val) => {
            campaignEqArgs.push([col, val]);
            return {
              single: vi.fn(async () => mockCampaignResult),
            };
          }),
        };
      }
      if (table === 'referrals') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn(() => ({
            single: vi.fn(async () => mockExistingReferralResult),
          })),
          insert: vi.fn(async (payload) => {
            lastReferralsInsertPayload = payload;
            return mockInsertResult;
          }),
        };
      }
      return {};
    }),
  })),
}));

let profileSingleCallCount = 0;
let lastReferralsInsertPayload = null;
let lastProfilesUpdatePayload = null;

function resetMocks() {
  profileSingleCallCount = 0;
  lastReferralsInsertPayload = null;
  lastProfilesUpdatePayload = null;
  campaignEqArgs.length = 0;
  mockGetUser = vi.fn().mockResolvedValue({
    data: { user: { id: REFEREE_USER_ID } },
    error: null,
  });
  mockReferrerResult = {
    data: { id: REFERRER_USER_ID, referred_by: null },
    error: null,
  };
  // Serves BOTH the personal-path referred_by check AND the campaign-path
  // perk-grant fetch — defaults are inert for either path.
  mockRefereeResult = {
    data: { referred_by: null, trial_ends_at: null, founding_member: false, plan: 'trial' },
    error: null,
  };
  mockUpdateResult = { error: null };
  mockInsertResult = { error: null };
  mockCampaignResult = { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
  mockExistingReferralResult = { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
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
  delete process.env.FOUNDER_CUTOFF;
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
  it('returns { skipped: unknown_code } when no profile AND no campaign matches the code', async () => {
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
    // mockCampaignResult already defaults to PGRST116 (not found) via resetMocks()
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

// ── J. Campaign-code fallback (JP-LU9) ────────────────────────────────────────

function makeCampaignEvent(body = {}) {
  return makeEvent({ body: { referral_code: CAMPAIGN_CODE, ...body } });
}

function activeCampaign(overrides = {}) {
  return {
    data: {
      id: CAMPAIGN_ID,
      code: CAMPAIGN_CODE,
      comp_days: 60,
      founding_lock: false,
      active: true,
      expires_at: null,
      ...overrides,
    },
    error: null,
  };
}

describe('J. Campaign-code fallback', () => {
  it('is only tried after the personal referral_code lookup misses (PGRST116)', async () => {
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };
    mockCampaignResult = activeCampaign();

    const handler = await getHandler();
    const res = await handler(makeCampaignEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recorded).toBe(true);
  });

  it('looks up the campaign case-insensitively — uppercases the incoming code', async () => {
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };
    mockCampaignResult = activeCampaign();

    const handler = await getHandler();
    await handler(makeEvent({ body: { referral_code: 'mitch60' } }));

    expect(campaignEqArgs.some(([col, val]) => col === 'code' && val === 'MITCH60')).toBe(true);
  });

  it('grants the audience perk: extends trial_ends_at to now + comp_days when no existing trial', async () => {
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };
    mockCampaignResult = activeCampaign({ comp_days: 60 });
    mockRefereeResult = { data: { trial_ends_at: null, founding_member: false, plan: 'trial' }, error: null };

    const before = Date.now();
    const handler = await getHandler();
    const res = await handler(makeCampaignEvent());
    const after = Date.now();

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recorded).toBe(true);

    expect(lastProfilesUpdatePayload).toBeTruthy();
    const writtenTrialEndsAt = new Date(lastProfilesUpdatePayload.trial_ends_at).getTime();
    expect(writtenTrialEndsAt).toBeGreaterThanOrEqual(before + 60 * 86400000);
    expect(writtenTrialEndsAt).toBeLessThanOrEqual(after + 60 * 86400000);
    expect(lastProfilesUpdatePayload.founding_member).toBeUndefined(); // no founding_lock on this campaign

    expect(lastReferralsInsertPayload).toMatchObject({
      campaign_id: CAMPAIGN_ID,
      referee_id: REFEREE_USER_ID,
      status: 'pending',
    });
    // referrer_id must NOT be present on a campaign-attributed row
    expect(lastReferralsInsertPayload.referrer_id).toBeUndefined();
  });

  it('extend-only guard: does NOT shorten an existing trial that already runs longer than comp_days', async () => {
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };
    mockCampaignResult = activeCampaign({ comp_days: 60 });
    const farFuture = new Date(Date.now() + 200 * 86400000).toISOString(); // 200 days out — longer than 60
    mockRefereeResult = { data: { trial_ends_at: farFuture, founding_member: false, plan: 'trial' }, error: null };

    const handler = await getHandler();
    const res = await handler(makeCampaignEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recorded).toBe(true);
    expect(lastProfilesUpdatePayload.trial_ends_at).toBe(new Date(farFuture).toISOString());
  });

  it('returns { skipped: campaign_inactive } for an inactive campaign', async () => {
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };
    mockCampaignResult = activeCampaign({ active: false });

    const handler = await getHandler();
    const res = await handler(makeCampaignEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('campaign_inactive');
  });

  it('returns { skipped: campaign_expired } for an expired campaign', async () => {
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };
    mockCampaignResult = activeCampaign({ expires_at: new Date(Date.now() - 86400000).toISOString() });

    const handler = await getHandler();
    const res = await handler(makeCampaignEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('campaign_expired');
  });

  it('returns { skipped: already_referred } when the referee already has a referrals row', async () => {
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };
    mockCampaignResult = activeCampaign();
    mockExistingReferralResult = { data: { id: 'existing-referral-row' }, error: null };

    const handler = await getHandler();
    const res = await handler(makeCampaignEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('already_referred');
  });

  it('stamps founding_member when founding_lock is true and now is before FOUNDER_CUTOFF', async () => {
    process.env.FOUNDER_CUTOFF = '2099-01-01T00:00:00Z'; // effectively "always before cutoff" for this test run
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };
    mockCampaignResult = activeCampaign({ founding_lock: true });
    mockRefereeResult = { data: { trial_ends_at: null, founding_member: false, plan: 'trial' }, error: null };

    const handler = await getHandler();
    const res = await handler(makeCampaignEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recorded).toBe(true);
    expect(lastProfilesUpdatePayload.founding_member).toBe(true);
  });

  it('does NOT stamp founding_member when founding_lock is true but FOUNDER_CUTOFF has passed', async () => {
    process.env.FOUNDER_CUTOFF = '2000-01-01T00:00:00Z'; // already in the past
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };
    mockCampaignResult = activeCampaign({ founding_lock: true });
    mockRefereeResult = { data: { trial_ends_at: null, founding_member: false, plan: 'trial' }, error: null };

    const handler = await getHandler();
    const res = await handler(makeCampaignEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recorded).toBe(true);
    expect(lastProfilesUpdatePayload.founding_member).toBeUndefined();
  });

  it('degrades gracefully — { skipped: table_missing } when the campaigns table does not exist (42P01)', async () => {
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };
    mockCampaignResult = { data: null, error: { code: '42P01', message: 'relation "campaigns" does not exist' } };

    const handler = await getHandler();
    const res = await handler(makeCampaignEvent());

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('table_missing');
  });

  it('a genuinely un-referred organic signup (no personal code, no campaign) is not affected', async () => {
    mockReferrerResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };
    mockCampaignResult = { data: null, error: { code: 'PGRST116', message: 'not found' } };

    const handler = await getHandler();
    const res = await handler(makeEvent({ body: { referral_code: 'NOTREAL' } }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe('unknown_code');
  });
});

// ── K. Pure helpers ────────────────────────────────────────────────────────────

describe('K. Pure helpers', () => {
  describe('computeExtendedTrialEndsAt', () => {
    it('extends to now + compDays when there is no existing trial', async () => {
      const { computeExtendedTrialEndsAt } = await import('../record-referral.js');
      const now = new Date('2026-07-01T00:00:00Z');
      const result = computeExtendedTrialEndsAt(null, 60, now);
      expect(new Date(result).getTime()).toBe(now.getTime() + 60 * 86400000);
    });

    it('does NOT shorten an existing trial that already runs longer', async () => {
      const { computeExtendedTrialEndsAt } = await import('../record-referral.js');
      const now = new Date('2026-07-01T00:00:00Z');
      const existing = new Date('2027-01-01T00:00:00Z').toISOString(); // far longer than +60d
      const result = computeExtendedTrialEndsAt(existing, 60, now);
      expect(result).toBe(new Date(existing).toISOString());
    });

    it('replaces an existing trial that is shorter than now + compDays', async () => {
      const { computeExtendedTrialEndsAt } = await import('../record-referral.js');
      const now = new Date('2026-07-01T00:00:00Z');
      const existing = new Date('2026-07-05T00:00:00Z').toISOString(); // only 4 days out
      const result = computeExtendedTrialEndsAt(existing, 60, now);
      expect(new Date(result).getTime()).toBe(now.getTime() + 60 * 86400000);
    });

    it('replaces an already-expired existing trial', async () => {
      const { computeExtendedTrialEndsAt } = await import('../record-referral.js');
      const now = new Date('2026-07-01T00:00:00Z');
      const expired = new Date('2026-01-01T00:00:00Z').toISOString();
      const result = computeExtendedTrialEndsAt(expired, 60, now);
      expect(new Date(result).getTime()).toBe(now.getTime() + 60 * 86400000);
    });
  });

  describe('foundingLockShouldStamp', () => {
    it('returns true for a fresh trial profile before the cutoff', async () => {
      const { foundingLockShouldStamp } = await import('../record-referral.js');
      const now = new Date('2026-07-01T00:00:00Z');
      expect(foundingLockShouldStamp({ founding_member: false, plan: 'trial' }, now)).toBe(true);
    });

    it('returns false when already founding_member', async () => {
      const { foundingLockShouldStamp } = await import('../record-referral.js');
      const now = new Date('2026-07-01T00:00:00Z');
      expect(foundingLockShouldStamp({ founding_member: true, plan: 'trial' }, now)).toBe(false);
    });

    it('returns false when already on plan=pro', async () => {
      const { foundingLockShouldStamp } = await import('../record-referral.js');
      const now = new Date('2026-07-01T00:00:00Z');
      expect(foundingLockShouldStamp({ founding_member: false, plan: 'pro' }, now)).toBe(false);
    });

    it('returns false when now is after FOUNDER_CUTOFF', async () => {
      process.env.FOUNDER_CUTOFF = '2026-01-01T00:00:00Z';
      const { foundingLockShouldStamp } = await import('../record-referral.js');
      const now = new Date('2026-07-01T00:00:00Z'); // after the cutoff
      expect(foundingLockShouldStamp({ founding_member: false, plan: 'trial' }, now)).toBe(false);
    });

    it('returns false for a null profile', async () => {
      const { foundingLockShouldStamp } = await import('../record-referral.js');
      expect(foundingLockShouldStamp(null)).toBe(false);
    });
  });
});
