/**
 * Tests for netlify/functions/_lib/sendPushToUser.js
 *
 * No real web-push calls. Mocks web-push and the Supabase admin client.
 * Covers: missing env vars, no subscriptions, successful sends, stale cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── web-push mock ─────────────────────────────────────────────────────────────
const mockSetVapidDetails = vi.fn();
const mockSendNotification = vi.fn();

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: mockSetVapidDetails,
    sendNotification: mockSendNotification,
  },
}));

// ── Supabase mock ─────────────────────────────────────────────────────────────
let mockSubsResult = { data: [], error: null };
const mockDelete = vi.fn(() => ({ in: vi.fn(async () => ({ error: null })) }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn(async () => mockSubsResult),
      delete: mockDelete,
    })),
  })),
}));

// ── Env setup ─────────────────────────────────────────────────────────────────

const FAKE_VAPID_PUB = 'fake-vapid-public-key';
const FAKE_VAPID_PRIV = 'fake-vapid-private-key';
const FAKE_URL = 'https://abc.supabase.co';
const FAKE_SERVICE_KEY = 'service-role-fake';

async function getModule() {
  vi.resetModules();
  const mod = await import('../_lib/sendPushToUser.js');
  return mod.sendPushToUser;
}

beforeEach(() => {
  process.env.VAPID_PUBLIC_KEY = FAKE_VAPID_PUB;
  process.env.VAPID_PRIVATE_KEY = FAKE_VAPID_PRIV;
  process.env.VAPID_SUBJECT = 'mailto:hello@jobprofit.co.uk';
  process.env.VITE_SUPABASE_URL = FAKE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = FAKE_SERVICE_KEY;
  mockSubsResult = { data: [], error: null };
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

// ─── A. Missing env vars ──────────────────────────────────────────────────────

describe('A. Missing env vars', () => {
  it('returns { sent:0, failed:0 } when VAPID keys are not set', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    const fn = await getModule();
    const result = await fn('user-123', { title: 'Test', body: 'body' });
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('returns { sent:0, failed:0 } when Supabase env vars are not set', async () => {
    delete process.env.VITE_SUPABASE_URL;
    const fn = await getModule();
    const result = await fn('user-123', { title: 'Test', body: 'body' });
    expect(result).toEqual({ sent: 0, failed: 0 });
  });
});

// ─── B. No subscriptions ──────────────────────────────────────────────────────

describe('B. No subscriptions', () => {
  it('returns { sent:0, failed:0 } when user has no push subscriptions', async () => {
    mockSubsResult = { data: [], error: null };
    const fn = await getModule();
    const result = await fn('user-123', { title: 'Test', body: 'body' });
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(mockSendNotification).not.toHaveBeenCalled();
  });

  it('returns { sent:0, failed:0 } when Supabase returns an error', async () => {
    mockSubsResult = { data: null, error: { message: 'DB error' } };
    const fn = await getModule();
    const result = await fn('user-123', { title: 'Test', body: 'body' });
    expect(result).toEqual({ sent: 0, failed: 0 });
  });
});

// ─── C. Successful send ───────────────────────────────────────────────────────

describe('C. Successful send', () => {
  it('calls setVapidDetails and sendNotification for each subscription', async () => {
    mockSubsResult = {
      data: [
        { id: 'sub-1', endpoint: 'https://push.example.com/1', p256dh: 'key1', auth_secret: 'auth1' },
        { id: 'sub-2', endpoint: 'https://push.example.com/2', p256dh: 'key2', auth_secret: 'auth2' },
      ],
      error: null,
    };
    mockSendNotification.mockResolvedValue({});

    const fn = await getModule();
    const result = await fn('user-abc', { title: 'Quote accepted', body: 'Alan signed', url: '/' });

    expect(mockSetVapidDetails).toHaveBeenCalledOnce();
    expect(mockSendNotification).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 2, failed: 0 });
  });

  it('passes correct subscription shape to sendNotification', async () => {
    mockSubsResult = {
      data: [{ id: 'sub-x', endpoint: 'https://ep.com', p256dh: 'p256', auth_secret: 'auth' }],
      error: null,
    };
    mockSendNotification.mockResolvedValue({});

    const fn = await getModule();
    await fn('user-abc', { title: 'T', body: 'B', url: '/foo', tag: 'test-tag' });

    const callArg = mockSendNotification.mock.calls[0][0];
    expect(callArg.endpoint).toBe('https://ep.com');
    expect(callArg.keys.p256dh).toBe('p256');
    expect(callArg.keys.auth).toBe('auth');

    const payload = JSON.parse(mockSendNotification.mock.calls[0][1]);
    expect(payload.title).toBe('T');
    expect(payload.body).toBe('B');
    expect(payload.url).toBe('/foo');
    expect(payload.tag).toBe('test-tag');
  });
});

// ─── D. Stale subscription cleanup ───────────────────────────────────────────

describe('D. Stale subscription cleanup on 410/404', () => {
  it('counts 410 responses as failed and does not throw', async () => {
    mockSubsResult = {
      data: [{ id: 'sub-gone', endpoint: 'https://gone.com', p256dh: 'k', auth_secret: 'a' }],
      error: null,
    };
    const err = new Error('Gone');
    err.statusCode = 410;
    mockSendNotification.mockRejectedValue(err);

    const fn = await getModule();
    const result = await fn('user-gone', { title: 'T', body: 'B' });
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
  });

  it('counts partial failures correctly when one sub succeeds and one is stale', async () => {
    mockSubsResult = {
      data: [
        { id: 'sub-ok', endpoint: 'https://ok.com', p256dh: 'k1', auth_secret: 'a1' },
        { id: 'sub-gone', endpoint: 'https://gone.com', p256dh: 'k2', auth_secret: 'a2' },
      ],
      error: null,
    };

    const err = new Error('Gone');
    err.statusCode = 410;
    mockSendNotification
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(err);

    const fn = await getModule();
    const result = await fn('user-partial', { title: 'T', body: 'B' });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });
});
