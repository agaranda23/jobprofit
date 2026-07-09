// @vitest-environment jsdom
/**
 * legal.js — ToS acceptance tracking, incl. the cross-device magic-link fix.
 *
 * The scenario under test: stashTosAcceptance() writes to localStorage on
 * the device that REQUESTED the magic link. When the link is opened on a
 * DIFFERENT device/browser (Mail app in-app browser vs an installed
 * home-screen PWA on iOS — a flow the app's own "email a link, tap it,
 * you're in" hint normalises), that device's localStorage never had the
 * stash. buildTosRedirectUrl() embeds the acceptance on the redirect URL's
 * query string instead, and captureTosAcceptanceFromUrl() recovers it on
 * landing — so flushTosAcceptance() has something to persist regardless of
 * which device opens the link.
 *
 * jsdom environment is required for real localStorage + window.location/
 * history.replaceState behaviour.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../telemetry', () => ({
  logTelemetry: vi.fn(),
}));

import { logTelemetry } from '../telemetry';
import {
  TOS_VERSION,
  stashTosAcceptance,
  buildTosRedirectUrl,
  captureTosAcceptanceFromUrl,
  flushTosAcceptance,
} from '../legal';

const STASH_KEY = 'jp.tosAcceptance';

function setUrl(pathAndSearch) {
  window.history.replaceState(null, '', pathAndSearch);
}

beforeEach(() => {
  localStorage.clear();
  setUrl('/');
  vi.clearAllMocks();
});

afterEach(() => {
  localStorage.clear();
  setUrl('/');
});

// ── stashTosAcceptance ────────────────────────────────────────────────────

describe('stashTosAcceptance', () => {
  it('writes {version, acceptedAt} to localStorage and returns the same record', () => {
    const record = stashTosAcceptance();
    expect(record.version).toBe(TOS_VERSION);
    expect(Number.isNaN(Date.parse(record.acceptedAt))).toBe(false);
    expect(JSON.parse(localStorage.getItem(STASH_KEY))).toEqual(record);
  });
});

// ── buildTosRedirectUrl ───────────────────────────────────────────────────

describe('buildTosRedirectUrl', () => {
  it('appends tos_v and tos_at to the base URL', () => {
    const record = { version: '2026-07-07', acceptedAt: '2026-07-09T10:00:00.000Z' };
    const url = new URL(buildTosRedirectUrl(record, 'https://app.ohnar.co.uk/'));
    expect(url.searchParams.get('tos_v')).toBe('2026-07-07');
    expect(url.searchParams.get('tos_at')).toBe('2026-07-09T10:00:00.000Z');
  });

  it('returns the base URL unchanged when the record is incomplete', () => {
    const url = buildTosRedirectUrl({}, 'https://app.ohnar.co.uk/');
    expect(url).toBe('https://app.ohnar.co.uk/');
  });
});

// ── captureTosAcceptanceFromUrl ───────────────────────────────────────────

describe('captureTosAcceptanceFromUrl', () => {
  it('stashes tos_v/tos_at from the URL when nothing is stashed yet', () => {
    setUrl('/?tos_v=2026-07-07&tos_at=2026-07-09T10%3A00%3A00.000Z');
    captureTosAcceptanceFromUrl();
    expect(JSON.parse(localStorage.getItem(STASH_KEY))).toEqual({
      version: '2026-07-07',
      acceptedAt: '2026-07-09T10:00:00.000Z',
    });
  });

  it('strips tos_v/tos_at from the URL bar but preserves other params and the hash', () => {
    setUrl('/?tos_v=2026-07-07&tos_at=2026-07-09T10%3A00%3A00.000Z&ref=ABC123#/today');
    captureTosAcceptanceFromUrl();
    expect(window.location.search).not.toContain('tos_v');
    expect(window.location.search).not.toContain('tos_at');
    expect(window.location.search).toContain('ref=ABC123');
    expect(window.location.hash).toBe('#/today');
  });

  it('does not clobber an existing stash (first request wins)', () => {
    localStorage.setItem(STASH_KEY, JSON.stringify({ version: 'existing', acceptedAt: 'existing-at' }));
    setUrl('/?tos_v=2026-07-07&tos_at=2026-07-09T10%3A00%3A00.000Z');
    captureTosAcceptanceFromUrl();
    expect(JSON.parse(localStorage.getItem(STASH_KEY))).toEqual({
      version: 'existing',
      acceptedAt: 'existing-at',
    });
  });

  it('is a no-op when the URL has no tos_v/tos_at params', () => {
    setUrl('/?ref=ABC123');
    captureTosAcceptanceFromUrl();
    expect(localStorage.getItem(STASH_KEY)).toBeNull();
    expect(window.location.search).toBe('?ref=ABC123');
  });
});

// ── flushTosAcceptance ────────────────────────────────────────────────────

describe('flushTosAcceptance', () => {
  it('is a no-op when there is no user', async () => {
    const updateUser = vi.fn();
    await flushTosAcceptance({ auth: { updateUser } }, null);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('flushes a same-device stash to user_metadata and clears the stash', async () => {
    const record = stashTosAcceptance();
    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const user = { id: 'u1', user_metadata: {} };
    await flushTosAcceptance({ auth: { updateUser } }, user);
    expect(updateUser).toHaveBeenCalledWith({
      data: { tos_version: record.version, tos_accepted_at: record.acceptedAt },
    });
    expect(localStorage.getItem(STASH_KEY)).toBeNull();
  });

  it('flushes a cross-device stash recovered from the URL by captureTosAcceptanceFromUrl', async () => {
    // Simulate: link requested on device A (never runs here), opened on device B —
    // device B's localStorage starts empty, only the URL carries the acceptance.
    setUrl('/?tos_v=2026-07-07&tos_at=2026-07-09T10%3A00%3A00.000Z');
    captureTosAcceptanceFromUrl();

    const updateUser = vi.fn().mockResolvedValue({ error: null });
    const user = { id: 'u2', user_metadata: {} };
    await flushTosAcceptance({ auth: { updateUser } }, user);

    expect(updateUser).toHaveBeenCalledWith({
      data: { tos_version: '2026-07-07', tos_accepted_at: '2026-07-09T10:00:00.000Z' },
    });
    expect(localStorage.getItem(STASH_KEY)).toBeNull();
  });

  it('skips the network call and just clears the stash when already recorded at this version', async () => {
    const record = stashTosAcceptance();
    const updateUser = vi.fn();
    const user = { id: 'u3', user_metadata: { tos_version: record.version } };
    await flushTosAcceptance({ auth: { updateUser } }, user);
    expect(updateUser).not.toHaveBeenCalled();
    expect(localStorage.getItem(STASH_KEY)).toBeNull();
  });

  it('leaves the stash in place on a network/auth error so the next load retries', async () => {
    stashTosAcceptance();
    const updateUser = vi.fn().mockRejectedValue(new Error('network down'));
    const user = { id: 'u4', user_metadata: {} };
    await flushTosAcceptance({ auth: { updateUser } }, user);
    expect(localStorage.getItem(STASH_KEY)).not.toBeNull();
  });

  it('fires tos_acceptance_flush_missing for a brand-new sign-up with no stash and no recorded acceptance', async () => {
    const updateUser = vi.fn();
    const user = { id: 'u5', created_at: new Date().toISOString(), user_metadata: {} };
    await flushTosAcceptance({ auth: { updateUser } }, user);
    expect(logTelemetry).toHaveBeenCalledWith('tos_acceptance_flush_missing');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('does NOT fire telemetry on an ordinary returning-user reload with no fresh stash', async () => {
    const updateUser = vi.fn();
    const user = { id: 'u6', user_metadata: { tos_version: TOS_VERSION } };
    await flushTosAcceptance({ auth: { updateUser } }, user);
    expect(logTelemetry).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('does NOT fire telemetry for a pre-existing account with no stash (predates the clickwrap, not a flush failure)', async () => {
    const updateUser = vi.fn();
    const user = {
      id: 'u7',
      created_at: '2026-01-01T00:00:00.000Z',
      user_metadata: {},
    };
    await flushTosAcceptance({ auth: { updateUser } }, user);
    expect(logTelemetry).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });
});
