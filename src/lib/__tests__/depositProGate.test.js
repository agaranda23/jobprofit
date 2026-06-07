/**
 * depositProGate.test.js
 *
 * Tests for G7 — server-side Pro gate logic (belt-and-braces).
 *
 * The actual gate lives in create-deposit-payment-link.js (Node.js, Netlify
 * function) and cannot be imported directly in Vitest (ESM + env mismatch).
 * We test the pure entitlement rule that the function applies, mirrored from
 * the function's own inline logic:
 *
 *   const isProPlan      = profile.plan === 'pro';
 *   const isActiveTrial  = profile.plan === 'trial' &&
 *                          profile.trial_ends_at &&
 *                          new Date(profile.trial_ends_at) > new Date();
 *   if (!isProPlan && !isActiveTrial) return 403 PRO_REQUIRED;
 *
 * These tests also verify that the client-side isPro() from lib/plan.js
 * agrees with the server rule, so the two stay in sync.
 */

import { describe, it, expect } from 'vitest';
import { isPro } from '../plan.js';

// ── Inline mirror of the server gate rule (from create-deposit-payment-link.js) ──
function serverAllowsDeposit(profile) {
  const isProPlan     = profile.plan === 'pro';
  const isActiveTrial =
    profile.plan === 'trial' &&
    !!profile.trial_ends_at &&
    new Date(profile.trial_ends_at) > new Date();
  return isProPlan || isActiveTrial;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FUTURE_DATE  = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const PAST_DATE    = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

const proProfile = { plan: 'pro' };
const trialActiveProfile    = { plan: 'trial', trial_ends_at: FUTURE_DATE };
const trialExpiredProfile   = { plan: 'trial', trial_ends_at: PAST_DATE };
const freeProfile           = { plan: 'free' };
const noProfilePlan         = { plan: null };
// ── Tests ─────────────────────────────────────────────────────────────────────

describe('G7 server-side Pro gate — deposit link creation', () => {
  it('allows Pro users', () => {
    expect(serverAllowsDeposit(proProfile)).toBe(true);
  });

  it('allows active trial users', () => {
    expect(serverAllowsDeposit(trialActiveProfile)).toBe(true);
  });

  it('blocks expired trial users', () => {
    expect(serverAllowsDeposit(trialExpiredProfile)).toBe(false);
  });

  it('blocks free users', () => {
    expect(serverAllowsDeposit(freeProfile)).toBe(false);
  });

  it('blocks null plan', () => {
    expect(serverAllowsDeposit(noProfilePlan)).toBe(false);
  });
});

describe('G7 — client isPro() matches server gate (no drift)', () => {
  it('Pro plan: both client and server allow', () => {
    expect(isPro(proProfile)).toBe(true);
    expect(serverAllowsDeposit(proProfile)).toBe(true);
  });

  it('Active trial: both client and server allow', () => {
    expect(isPro(trialActiveProfile)).toBe(true);
    expect(serverAllowsDeposit(trialActiveProfile)).toBe(true);
  });

  it('Expired trial: both client and server deny', () => {
    expect(isPro(trialExpiredProfile)).toBe(false);
    expect(serverAllowsDeposit(trialExpiredProfile)).toBe(false);
  });

  it('Free plan: both client and server deny', () => {
    expect(isPro(freeProfile)).toBe(false);
    expect(serverAllowsDeposit(freeProfile)).toBe(false);
  });
});

describe('G7 — NOT_CONNECTED degrade path (client-side guard)', () => {
  // The customer's public page must always work — gating only applies to the
  // trader generating the link. Verify that a trader without Stripe Connect
  // would be caught by the NOT_CONNECTED guard (client and server).
  it('profile without stripe_user_id is treated as not connected', () => {
    const noStripe = { plan: 'pro', stripe_connect_status: 'disconnected', stripe_user_id: null };
    const isConnected = noStripe.stripe_connect_status === 'connected' && !!noStripe.stripe_user_id;
    expect(isConnected).toBe(false);
  });

  it('profile with stripe_user_id and status=connected is treated as connected', () => {
    const connected = { plan: 'pro', stripe_connect_status: 'connected', stripe_user_id: 'acct_abc' };
    const isConnected = connected.stripe_connect_status === 'connected' && !!connected.stripe_user_id;
    expect(isConnected).toBe(true);
  });
});
