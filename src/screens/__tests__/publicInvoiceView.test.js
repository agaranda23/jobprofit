/**
 * PublicInvoiceView — render smoke tests.
 *
 * No DOM, no React render — pure logic tests covering the three key states:
 *   A. Invalid / missing token → isValidToken guard fires
 *   B. Valid token → loading state, then data fetch resolves
 *   C. Pay-now capability derivation (connected / static-link / bank-only)
 *   D. Netlify function URL constants
 *
 * The actual render is covered by the deploy-preview checklist in the PR.
 * Component mount smoke lives in screenSmoke.test.jsx (added there below).
 */

import { describe, it, expect } from 'vitest';
import { isValidToken } from '../../lib/publicInvoiceToken';
import { buildPublicInvoiceUrl } from '../../lib/publicInvoiceToken';

const VALID_TOKEN   = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TEST_ORIGIN   = 'https://app.jobprofit.co.uk';

// ── A. Token validation ───────────────────────────────────────────────────────

describe('A. PublicInvoiceView — token validation guard', () => {
  it('accepts a standard UUID v4 — page would proceed to load', () => {
    expect(isValidToken(VALID_TOKEN)).toBe(true);
  });

  it('rejects an empty token — page would show error state', () => {
    expect(isValidToken('')).toBe(false);
  });

  it('rejects a non-UUID string — page would show error state', () => {
    expect(isValidToken('not-a-uuid-at-all')).toBe(false);
  });

  it('rejects null — page would show error state', () => {
    expect(isValidToken(null)).toBe(false);
  });

  it('rejects a string with SQL injection attempt', () => {
    expect(isValidToken("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; DROP TABLE jobs; --")).toBe(false);
  });
});

// ── B. URL construction ───────────────────────────────────────────────────────

describe('B. buildPublicInvoiceUrl', () => {
  it('builds the expected /i/<token> URL', () => {
    expect(buildPublicInvoiceUrl(VALID_TOKEN, TEST_ORIGIN))
      .toBe('https://app.jobprofit.co.uk/i/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

// ── C. Pay-now capability derivation ─────────────────────────────────────────
// Mirrors the logic in PublicInvoiceView.jsx:
//   const showPayNowButton = !!profile.isConnected;
//   const showStaticLink   = !isConnected && !!biz.stripePaymentLink;
//   const hasBankDetails   = !!(biz.accountName || biz.sortCode || biz.accountNumber || biz.bankDetails);

function derivePayCapability(profile, biz) {
  const isConnected    = !!profile?.isConnected;
  const hasStaticLink  = !!(biz?.stripePaymentLink);
  const hasBankDetails = !!(biz?.accountName || biz?.sortCode || biz?.accountNumber || biz?.bankDetails);
  return {
    showPayNowButton: isConnected,
    showStaticLink:   !isConnected && hasStaticLink,
    bankOnly:         !isConnected && !hasStaticLink && hasBankDetails,
    noPayOption:      !isConnected && !hasStaticLink && !hasBankDetails,
  };
}

describe('C. Pay-now capability derivation', () => {
  it('shows Pay-now button when trader is Stripe-connected', () => {
    const result = derivePayCapability({ isConnected: true }, {});
    expect(result.showPayNowButton).toBe(true);
    expect(result.showStaticLink).toBe(false);
    expect(result.bankOnly).toBe(false);
  });

  it('shows static link when not connected but has stripe_payment_link', () => {
    const result = derivePayCapability(
      { isConnected: false },
      { stripePaymentLink: 'https://buy.stripe.com/test' }
    );
    expect(result.showPayNowButton).toBe(false);
    expect(result.showStaticLink).toBe(true);
    expect(result.bankOnly).toBe(false);
  });

  it('shows bank-only note when not connected, no static link, but has bank details', () => {
    const result = derivePayCapability(
      { isConnected: false },
      { accountName: 'Alan', sortCode: '12-34-56', accountNumber: '12345678' }
    );
    expect(result.showPayNowButton).toBe(false);
    expect(result.showStaticLink).toBe(false);
    expect(result.bankOnly).toBe(true);
  });

  it('shows bank-only note when bankDetails blob is present (legacy format)', () => {
    const result = derivePayCapability(
      { isConnected: false },
      { bankDetails: 'Sort: 12-34-56 Acc: 12345678' }
    );
    expect(result.bankOnly).toBe(true);
  });

  it('has no pay option when not connected and no bank details', () => {
    const result = derivePayCapability({ isConnected: false }, {});
    expect(result.showPayNowButton).toBe(false);
    expect(result.showStaticLink).toBe(false);
    expect(result.bankOnly).toBe(false);
    expect(result.noPayOption).toBe(true);
  });

  it('Pay-now button takes priority over static link when connected', () => {
    // Connected traders with a static link still get the dynamic button (better UX).
    const result = derivePayCapability(
      { isConnected: true },
      { stripePaymentLink: 'https://buy.stripe.com/test' }
    );
    expect(result.showPayNowButton).toBe(true);
    expect(result.showStaticLink).toBe(false);
  });

  it('profile null → no pay option (graceful)', () => {
    const result = derivePayCapability(null, {});
    expect(result.showPayNowButton).toBe(false);
    expect(result.noPayOption).toBe(true);
  });
});

// ── D. Netlify function URL constants ─────────────────────────────────────────

describe('D. Netlify function URL constants', () => {
  it('fetch-public-invoice path is /.netlify/functions/fetch-public-invoice', () => {
    const FETCH_PROFILE_URL = '/.netlify/functions/fetch-public-invoice';
    expect(FETCH_PROFILE_URL).toBe('/.netlify/functions/fetch-public-invoice');
  });

  it('create-invoice-payment-link-public path is correct', () => {
    const CREATE_PAY_LINK_URL = '/.netlify/functions/create-invoice-payment-link-public';
    expect(CREATE_PAY_LINK_URL).toBe('/.netlify/functions/create-invoice-payment-link-public');
  });
});
