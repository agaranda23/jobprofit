// @vitest-environment jsdom
/**
 * ProUpgradeSheet — copy tests for the card-free trial fix
 * (branch fix/pro-trial-no-card).
 *
 * The Stripe checkout that startCheckout() triggers is now genuinely card-free
 * (payment_method_collection: 'if_required' + a 14-day Stripe trial that
 * auto-cancels to plan=free if no card is ever added — see
 * netlify/functions/create-checkout.js). These tests guard the copy so it
 * never again promises something the checkout doesn't do, and never again
 * implies an auto-charge that can't happen without a card on file.
 *
 * Covers:
 *   (a) Default variant keeps "14-day free trial · no card needed" trust line
 *   (b) Default variant keeps the "no card" CTA
 *   (c) Default variant footer no longer says "£12/month after trial" (implies
 *       an automatic charge) — replaced with honest end-of-trial copy
 *   (d) Footer explicitly states no auto-charge without a card
 *   (e) trial_end variant is untouched by this fix (still promises a real
 *       charge at chargeDate, which IS accurate for that variant — a card was
 *       just added)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ProUpgradeSheet from '../ProUpgradeSheet';

vi.mock('../../lib/billing', () => ({
  startCheckout: vi.fn().mockResolvedValue({ error: null }),
  startCheckoutWithCoupon: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock('../../lib/telemetry', () => ({
  logTelemetry: vi.fn(),
  setLastUpgradeTrigger: vi.fn(),
  UPGRADE_TRIGGERS: {
    INSIGHT_LOCKED:    'insight_locked',
    WHITELABEL_FOOTER: 'whitelabel_footer',
    AUTO_CHASE_LOCKED: 'auto_chase_locked',
    SETTINGS:          'settings',
    TRIAL_BANNER:      'trial_banner',
    TODAY_PILL:        'today_pill',
    UPGRADE_BANNER:    'upgrade_banner',
    TRIAL_END:         'trial_end',
    DROP_TO_FREE:      'drop_to_free',
  },
}));

vi.mock('../OhnarWordmark', () => ({
  default: () => <span data-testid="wordmark">OHNAR</span>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProUpgradeSheet — default variant copy', () => {
  it('keeps the "14-day free trial · no card needed" trust line', () => {
    render(<ProUpgradeSheet open trigger="settings" onClose={vi.fn()} />);
    expect(screen.getByText(/14-day free trial.*no card needed.*cancel anytime/i)).toBeTruthy();
  });

  it('keeps the "no card" CTA', () => {
    render(<ProUpgradeSheet open trigger="settings" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Start 14-day free trial.*no card/i })).toBeTruthy();
  });

  it('does NOT show the old "£12/month after trial" auto-charge wording', () => {
    render(<ProUpgradeSheet open trigger="settings" onClose={vi.fn()} />);
    expect(screen.queryByText(/£12\/month after trial/i)).toBeNull();
    expect(screen.queryByText(/after your free trial/i)).toBeNull();
  });

  it('shows honest end-of-trial copy: add a card to stay Pro, or drop to free', () => {
    render(<ProUpgradeSheet open trigger="settings" onClose={vi.fn()} />);
    expect(screen.getByText(/add a card to stay on Pro/i)).toBeTruthy();
    expect(screen.getByText(/drop back to free/i)).toBeTruthy();
  });

  it('explicitly states no auto-charge without a card', () => {
    render(<ProUpgradeSheet open trigger="settings" onClose={vi.fn()} />);
    expect(screen.getByText(/no auto-charge until you choose/i)).toBeTruthy();
  });
});

describe('ProUpgradeSheet — trial_end variant is unaffected', () => {
  it('still shows its own accurate charge-date copy (a card was just added)', () => {
    const profile = { trial_ends_at: new Date().toISOString() };
    render(
      <ProUpgradeSheet open trigger="trial_end" variant="trial_end" profile={profile} jobs={[]} onClose={vi.fn()} />
    );
    // trial_end variant legal copy mentions "£12/month" tied to a real chargeDate —
    // this is accurate for that flow (card collected) and must not be touched.
    expect(screen.getByText(/nothing to pay today/i)).toBeTruthy();
    expect(screen.getByText(/£12\/month, starting/i)).toBeTruthy();
  });
});
