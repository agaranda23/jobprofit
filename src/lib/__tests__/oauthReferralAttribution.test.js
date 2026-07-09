/**
 * oauthReferralAttribution — unit tests for the referral-attribution branch
 * of the onAuthStateChange handler in AppShell.jsx.
 *
 * Bug this protects (fix/referral-attribution-oauth): a user signed up via
 * Google using a valid `?ref=` referral link, but profiles.referred_by stayed
 * null and no `referrals` row was created — attribution was silently lost.
 *
 * Root cause (verified by reading node_modules/@supabase/auth-js/dist/main/
 * GoTrueClient.js): onAuthStateChange(callback) only ever fires 'SIGNED_IN'
 * for a session establishment that happens WHILE the listener is already
 * attached. On the Google OAuth *return* leg, GoTrueClient starts processing
 * the callback's tokens as soon as the client is constructed — before
 * AppShell's useEffect has subscribed. If that processing finishes first
 * (plausible on a slow mobile connection — exactly the "one hand on a kerb"
 * scenario this app is built for), the listener instead receives
 * 'INITIAL_SESSION' with the session already populated, and a check gated on
 * 'SIGNED_IN' alone silently never runs for that signup.
 *
 * The AppShell.jsx handler was widened to check `_event === 'SIGNED_IN' ||
 * _event === 'INITIAL_SESSION'` for the referral-attribution branch
 * specifically (telemetry stays SIGNED_IN-only — INITIAL_SESSION also fires
 * on every ordinary app reopen for an already-signed-in user, which would
 * otherwise inflate that funnel metric).
 *
 * The logic is mirrored here (no DOM, no React, no network — matches
 * activationGuard.test.js's convention for AppShell-internal logic) rather
 * than mounting the 1,991-line AppShell component. If the AppShell.jsx
 * block moves, update this mirror and the comment above it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const REFERRAL_CODE_STORAGE_KEY = 'jp.referralCode';

/**
 * Mirror of AppShell.jsx's onAuthStateChange body (the referral-attribution
 * + signed_in/sign_up telemetry block only — the rest of the listener,
 * e.g. setSession/setCloudLoaded, is irrelevant to this bug).
 *
 * @param {string} event — e.g. 'SIGNED_IN' | 'INITIAL_SESSION' | 'SIGNED_OUT'
 * @param {object|null} newSession — minimal Supabase session shape
 * @param {object} storage — injectable sessionStorage-like store (key/value map)
 * @param {(url: string, opts: object) => Promise} fetchImpl — injectable fetch
 * @param {(event: string, props?: object) => void} logTelemetry — injectable
 * @returns {void}
 */
function handleAuthStateChange(event, newSession, storage, fetchImpl, logTelemetry) {
  if (newSession?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
    const createdAt = new Date(newSession.user.created_at ?? 0).getTime();
    const isNew = Date.now() - createdAt < 60_000;

    if (event === 'SIGNED_IN') {
      logTelemetry('signed_in', { is_new_user: isNew });
      if (isNew) logTelemetry('sign_up', { plan: 'free' });
    }

    const refCode = storage[REFERRAL_CODE_STORAGE_KEY];
    if (refCode && isNew && newSession.access_token) {
      delete storage[REFERRAL_CODE_STORAGE_KEY];
      fetchImpl('/.netlify/functions/record-referral', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${newSession.access_token}`,
        },
        body: JSON.stringify({ referral_code: refCode }),
      });
    }
  }
}

function freshSession(secsAgo = 2) {
  return {
    access_token: 'token-abc',
    user: { id: 'uuid-referee', created_at: new Date(Date.now() - secsAgo * 1000).toISOString() },
  };
}

function oldSession(secsAgo = 3600) {
  return {
    access_token: 'token-abc',
    user: { id: 'uuid-existing', created_at: new Date(Date.now() - secsAgo * 1000).toISOString() },
  };
}

describe('oauthReferralAttribution — SIGNED_IN and INITIAL_SESSION both attribute', () => {
  let storage;
  let fetchImpl;
  let logTelemetry;

  beforeEach(() => {
    storage = { [REFERRAL_CODE_STORAGE_KEY]: 'ruvWbv' };
    fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    logTelemetry = vi.fn();
  });

  it('calls record-referral on a plain SIGNED_IN event (magic link / normal timing)', () => {
    handleAuthStateChange('SIGNED_IN', freshSession(), storage, fetchImpl, logTelemetry);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, opts] = fetchImpl.mock.calls[0];
    expect(url).toBe('/.netlify/functions/record-referral');
    expect(opts.headers.Authorization).toBe('Bearer token-abc');
    expect(JSON.parse(opts.body)).toEqual({ referral_code: 'ruvWbv' });
  });

  it('ALSO calls record-referral on INITIAL_SESSION — the OAuth-race regression this fix closes', () => {
    // Simulates a Google OAuth return where GoTrueClient's _initialize()
    // already finished processing the callback tokens before AppShell's
    // useEffect subscribed, so the listener receives INITIAL_SESSION instead
    // of SIGNED_IN. Before the fix, this branch was gated on SIGNED_IN only,
    // so the referral was silently never recorded.
    handleAuthStateChange('INITIAL_SESSION', freshSession(), storage, fetchImpl, logTelemetry);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [, opts] = fetchImpl.mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ referral_code: 'ruvWbv' });
  });

  it('removes the sessionStorage code after firing, on either event', () => {
    handleAuthStateChange('INITIAL_SESSION', freshSession(), storage, fetchImpl, logTelemetry);
    expect(storage[REFERRAL_CODE_STORAGE_KEY]).toBeUndefined();
  });

  it('does not call record-referral when there is no pending referral code', () => {
    storage = {};
    handleAuthStateChange('SIGNED_IN', freshSession(), storage, fetchImpl, logTelemetry);
    handleAuthStateChange('INITIAL_SESSION', freshSession(), storage, fetchImpl, logTelemetry);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not call record-referral for an existing user (isNew guard), on either event', () => {
    handleAuthStateChange('SIGNED_IN', oldSession(), storage, fetchImpl, logTelemetry);
    expect(fetchImpl).not.toHaveBeenCalled();
    // Code is still pending in storage — re-check on INITIAL_SESSION too.
    handleAuthStateChange('INITIAL_SESSION', oldSession(), storage, fetchImpl, logTelemetry);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('ignores unrelated auth events (e.g. SIGNED_OUT, TOKEN_REFRESHED)', () => {
    handleAuthStateChange('SIGNED_OUT', null, storage, fetchImpl, logTelemetry);
    handleAuthStateChange('TOKEN_REFRESHED', freshSession(), storage, fetchImpl, logTelemetry);
    expect(fetchImpl).not.toHaveBeenCalled();
    // TOKEN_REFRESHED didn't consume the code — a following real SIGNED_IN/
    // INITIAL_SESSION still attributes.
    handleAuthStateChange('SIGNED_IN', freshSession(), storage, fetchImpl, logTelemetry);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('fires signed_in/sign_up telemetry on SIGNED_IN but NOT on INITIAL_SESSION (avoids inflating the funnel metric on every app reopen)', () => {
    handleAuthStateChange('INITIAL_SESSION', freshSession(), storage, fetchImpl, logTelemetry);
    expect(logTelemetry).not.toHaveBeenCalled();

    storage[REFERRAL_CODE_STORAGE_KEY] = 'ruvWbv'; // re-seed, previous call consumed it
    handleAuthStateChange('SIGNED_IN', freshSession(), storage, fetchImpl, logTelemetry);
    expect(logTelemetry).toHaveBeenCalledWith('signed_in', { is_new_user: true });
    expect(logTelemetry).toHaveBeenCalledWith('sign_up', { plan: 'free' });
  });

  it('does not attempt attribution when the session has no access_token', () => {
    const noToken = { user: freshSession().user };
    handleAuthStateChange('SIGNED_IN', noToken, storage, fetchImpl, logTelemetry);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
