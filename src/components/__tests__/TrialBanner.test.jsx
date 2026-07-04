// @vitest-environment jsdom
/**
 * TrialBanner — CTA routing tests (branch fix/pro-trial-no-card)
 *
 * NOTE: as of this branch, TrialBanner.jsx is not imported/rendered anywhere
 * in the app (grep confirms no <TrialBanner /> usage outside this test and
 * its own file) — GetProPill covers the same countdown states on Today.
 * Testing it anyway: it's still shipped code, its bundled CTA now touches
 * live billing, and it may be wired back in later — a silent regression here
 * would surface the moment someone adds <TrialBanner />.
 *
 * TrialBanner only ever renders while isTrialActive(profile) — i.e. the user
 * is on the homegrown trial and has never been through Stripe checkout yet.
 * Both its states (settled countdown + urgent "keep Pro free") are therefore
 * a "convert my running trial → real subscription" action, never a "start a
 * trial" one, so the CTA must collect a card: startCheckoutImmediate()
 * (coupon_mode:'none'), NOT the now-card-free startCheckout().
 *
 * Covers:
 *   1. Hidden when not on an active trial
 *   2. Non-urgent (>2 days left): CTA calls startCheckoutImmediate, not startCheckout
 *   3. Urgent (<=2 days left): CTA calls startCheckoutImmediate, not startCheckout
 *   4. Checkout error is forwarded to onError
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TrialBanner from '../TrialBanner';

vi.mock('../../lib/billing.js', () => ({
  startCheckout: vi.fn().mockResolvedValue({}),
  startCheckoutImmediate: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../lib/telemetry.js', () => ({
  logTelemetry: vi.fn(),
  setLastUpgradeTrigger: vi.fn(),
  UPGRADE_TRIGGERS: { TRIAL_BANNER: 'trial_banner' },
}));

import { startCheckout, startCheckoutImmediate } from '../../lib/billing.js';

function msFromNow(ms) {
  return new Date(Date.now() + ms).toISOString();
}

function trialProfile(daysFromNow) {
  return { plan: 'trial', trial_ends_at: msFromNow(daysFromNow * 86400000) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TrialBanner — visibility', () => {
  it('renders nothing when not on an active trial', () => {
    const { container } = render(<TrialBanner profile={{ plan: 'free' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a paid Pro profile', () => {
    const { container } = render(<TrialBanner profile={{ plan: 'pro' }} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('TrialBanner — CTA routes to card-required checkout, never card-free', () => {
  it('non-urgent (>2 days left): tapping CTA calls startCheckoutImmediate, NOT startCheckout', async () => {
    render(<TrialBanner profile={trialProfile(8)} />);
    fireEvent.click(screen.getByRole('button', { name: /Add a card to stay Pro/i }));
    await vi.waitFor(() => expect(startCheckoutImmediate).toHaveBeenCalledTimes(1));
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('urgent (<=2 days left): tapping CTA calls startCheckoutImmediate, NOT startCheckout', async () => {
    render(<TrialBanner profile={trialProfile(2)} />);
    fireEvent.click(screen.getByRole('button', { name: /Keep Pro free/i }));
    await vi.waitFor(() => expect(startCheckoutImmediate).toHaveBeenCalledTimes(1));
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it('forwards a checkout error to onError', async () => {
    startCheckoutImmediate.mockResolvedValueOnce({ error: 'Network error' });
    const onError = vi.fn();
    render(<TrialBanner profile={trialProfile(8)} onError={onError} />);
    fireEvent.click(screen.getByRole('button', { name: /Add a card to stay Pro/i }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Network error'));
  });
});
