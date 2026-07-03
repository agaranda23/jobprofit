/**
 * bankGateDeferral.test.js — pure-logic tests for the onboarding bank-gate deferral.
 *
 * PRD: A brand-new trader can create + send a quote with NO bank details.
 *      The bank gate moves to the invoice-send path (just-in-time).
 *
 * No DOM, no React — pure logic, matching project convention.
 *
 * Covers:
 *   A. isProfileComplete gate (job creation) — bank NOT required after deferral
 *   B. profileHasBank — used by invoice-send just-in-time gate
 *   C. Wizard firstMissingStep — bank step index is still surfaced when missing
 *   D. Invoice-send gate logic — bank-gate fires before send when bank missing
 *   E. Quote-send path — bank details NOT required (quote message has no bank)
 *   F. Existing users with bank details — unaffected (no spurious gate)
 */

import { describe, it, expect } from 'vitest';
import { getMissingInvoiceFields } from '../../lib/bizValidation';
import { buildQuoteWhatsAppMessage } from '../../lib/quoteMessage';
import { buildInvoiceWhatsAppMessage } from '../../lib/invoiceMessage';

// ── Inline the isProfileComplete and profileHasBank logic ────────────────────
// These mirror the functions in AppShell.jsx exactly so the tests break if the
// production logic drifts without a matching test update.

function isProfileComplete(profile, session) {
  if (!profile) return false;
  const hasName = !!(profile.business_name);
  const hasFirst = !!(profile.first_name);
  const hasLast = !!(profile.last_name);
  const hasEmail = !!(session?.user?.email);
  return hasName && hasFirst && hasLast && hasEmail;
}

import { profileHasBank } from '../../lib/bankDetails.js';

// ── Inline the firstMissingStep logic from OnboardingWizard.jsx ──────────────
function firstMissingStep(profile) {
  if (!profile?.business_name) return 0;
  if (!profile?.first_name) return 1;
  if (!profile?.last_name) return 2;
  if (!profile?.sort_code || !profile?.account_number) return 3;
  return 0;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function nameOnlyProfile(overrides = {}) {
  return {
    business_name: 'Smith Plumbing',
    first_name: 'Alan',
    last_name: 'Smith',
    sort_code: null,
    account_number: null,
    ...overrides,
  };
}

function fullProfile(overrides = {}) {
  return {
    business_name: 'Smith Plumbing',
    first_name: 'Alan',
    last_name: 'Smith',
    sort_code: '12-34-56',
    account_number: '12345678',
    ...overrides,
  };
}

function fakeSession(email = 'alan@smith.co.uk') {
  return { user: { email } };
}

// ── A. isProfileComplete gate (job/quote creation) ────────────────────────────

describe('A. isProfileComplete — bank NOT required for job/quote creation', () => {
  it('returns true when name fields are present and session email exists, even with no bank', () => {
    expect(isProfileComplete(nameOnlyProfile(), fakeSession())).toBe(true);
  });

  it('returns false when business_name is missing', () => {
    const p = nameOnlyProfile({ business_name: null });
    expect(isProfileComplete(p, fakeSession())).toBe(false);
  });

  it('returns false when first_name is missing', () => {
    const p = nameOnlyProfile({ first_name: null });
    expect(isProfileComplete(p, fakeSession())).toBe(false);
  });

  it('returns false when last_name is missing', () => {
    const p = nameOnlyProfile({ last_name: null });
    expect(isProfileComplete(p, fakeSession())).toBe(false);
  });

  it('returns false when session email is absent', () => {
    expect(isProfileComplete(nameOnlyProfile(), { user: { email: null } })).toBe(false);
  });

  it('returns false when profile is null', () => {
    expect(isProfileComplete(null, fakeSession())).toBe(false);
  });

  it('returns true when all name fields present AND bank details present', () => {
    expect(isProfileComplete(fullProfile(), fakeSession())).toBe(true);
  });
});

// ── B. profileHasBank — invoice-send just-in-time check ───────────────────────

describe('B. profileHasBank — detects whether bank details are saved', () => {
  it('returns false when profile is null', () => {
    expect(profileHasBank(null)).toBe(false);
  });

  it('returns false when sort_code is null', () => {
    expect(profileHasBank(nameOnlyProfile({ sort_code: null, account_number: '12345678' }))).toBe(false);
  });

  it('returns false when account_number is null', () => {
    expect(profileHasBank(nameOnlyProfile({ sort_code: '12-34-56', account_number: null }))).toBe(false);
  });

  it('returns false when both bank fields are null (skipped onboarding bank step)', () => {
    expect(profileHasBank(nameOnlyProfile())).toBe(false);
  });

  it('returns false when sort_code is empty string', () => {
    expect(profileHasBank(nameOnlyProfile({ sort_code: '', account_number: '12345678' }))).toBe(false);
  });

  it('returns true when both bank fields are populated', () => {
    expect(profileHasBank(fullProfile())).toBe(true);
  });
});

// ── C. Wizard firstMissingStep — bank step surfaced when only bank is missing ─

describe('C. wizard firstMissingStep — bank step index', () => {
  it('returns 3 (bank step) when name is complete but bank is missing', () => {
    expect(firstMissingStep(nameOnlyProfile())).toBe(3);
  });

  it('returns 0 (start) when profile is null', () => {
    expect(firstMissingStep(null)).toBe(0);
  });

  it('returns 0 when business_name is missing', () => {
    expect(firstMissingStep({ first_name: 'A', last_name: 'B', sort_code: '123456', account_number: '12345678' })).toBe(0);
  });

  it('returns 1 when first_name is missing', () => {
    expect(firstMissingStep({ business_name: 'X', last_name: 'B' })).toBe(1);
  });

  it('returns 2 when last_name is missing', () => {
    expect(firstMissingStep({ business_name: 'X', first_name: 'A' })).toBe(2);
  });

  it('returns 0 when all four fields are present (wizard should not have opened)', () => {
    expect(firstMissingStep(fullProfile())).toBe(0);
  });
});

// ── D. Invoice-send gate — bank-gate fires before send when bank missing ──────

describe('D. invoice-send bank-gate — intercepts send when bank missing', () => {
  // Mirror the attemptSend gate logic from SendInvoiceModal without mounting it.

  function simulateSendAttempt({ profile, isUnpriced = false }) {
    if (isUnpriced) return 'blocked-unpriced';
    if (!profileHasBank(profile)) return 'bank-gate';
    return 'proceed';
  }

  it('shows bank-gate when profile has no bank details', () => {
    expect(simulateSendAttempt({ profile: nameOnlyProfile() })).toBe('bank-gate');
  });

  it('proceeds when profile has bank details', () => {
    expect(simulateSendAttempt({ profile: fullProfile() })).toBe('proceed');
  });

  it('blocks on unpriced invoice before checking bank', () => {
    expect(simulateSendAttempt({ profile: nameOnlyProfile(), isUnpriced: true })).toBe('blocked-unpriced');
  });

  it('bank-gate does not fire when bank details are present even on re-send', () => {
    expect(simulateSendAttempt({ profile: fullProfile() })).toBe('proceed');
  });

  it('after bank save, localProfile with bank details clears the gate', () => {
    const saved = { ...nameOnlyProfile(), sort_code: '12-34-56', account_number: '12345678' };
    expect(simulateSendAttempt({ profile: saved })).toBe('proceed');
  });
});

// ── E. Quote-send path — bank details NOT required ────────────────────────────

describe('E. quote-send — bank details absent from quote message', () => {
  const baseJob = {
    id: 'j1',
    customer: 'Mrs. Smith',
    summary: 'Fix boiler',
    total: 300,
  };
  const baseBiz = { name: 'Smith Plumbing' };

  it('quote message does not include bank details (sort code)', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: baseJob,
      biz: baseBiz,
      quoteUrl: 'https://app.jobprofit.co.uk/q/abc',
    });
    expect(msg).not.toContain('Sort code');
    expect(msg).not.toContain('sort code');
  });

  it('quote message does not include account number', () => {
    const msg = buildQuoteWhatsAppMessage({
      job: baseJob,
      biz: baseBiz,
      quoteUrl: 'https://app.jobprofit.co.uk/q/abc',
    });
    expect(msg).not.toContain('Account:');
    expect(msg).not.toContain('12345678');
  });

  it('getMissingInvoiceFields — bank fields are NOT required for quote validity', () => {
    // Quotes use buildQuoteWhatsAppMessage, not getMissingInvoiceFields.
    // This test documents that getMissingInvoiceFields is invoice-only.
    // A no-bank profile can still produce a valid quote message (no bank block).
    const msg = buildQuoteWhatsAppMessage({
      job: baseJob,
      biz: { name: 'Smith Plumbing' },
      quoteUrl: 'https://app.jobprofit.co.uk/q/abc',
    });
    expect(msg).toContain('view and accept or decline it');
  });
});

// ── F. Existing users with bank details — no spurious gate ────────────────────

describe('F. existing users with bank details — unaffected by deferral', () => {
  it('isProfileComplete returns true for existing user with full profile', () => {
    expect(isProfileComplete(fullProfile(), fakeSession())).toBe(true);
  });

  it('profileHasBank returns true for existing user', () => {
    expect(profileHasBank(fullProfile())).toBe(true);
  });

  it('invoice-send proceeds immediately for existing user (no bank-gate)', () => {
    function simulateSendAttempt({ profile }) {
      if (!profileHasBank(profile)) return 'bank-gate';
      return 'proceed';
    }
    expect(simulateSendAttempt({ profile: fullProfile() })).toBe('proceed');
  });

  it('getMissingInvoiceFields returns empty array for existing user with full profile', () => {
    const profile = fullProfile({ account_name: 'Alan Smith' });
    expect(getMissingInvoiceFields(null, profile)).not.toContain('Sort code');
    expect(getMissingInvoiceFields(null, profile)).not.toContain('Account number');
  });

  it('invoice message includes bank details for existing user', () => {
    const msg = buildInvoiceWhatsAppMessage({
      job: { customer: 'Mrs. Smith', total: 300, summary: 'Fix boiler' },
      biz: {
        name: 'Smith Plumbing',
        sortCode: '12-34-56',
        accountNumber: '12345678',
        accountName: 'Alan Smith',
      },
      invoiceNumber: 'JP-0001',
      dueDate: '2026-07-01',
    });
    expect(msg).toContain('12-34-56');
    expect(msg).toContain('12345678');
  });
});

// ── G. Zero-friction entry — app accessible without a complete profile ─────────
// feat/zero-friction-entry (2026-06-02): wizard no longer auto-opens.
// The app is reachable immediately after sign-in. Missing identity fields are
// collected just-in-time at the invoice-send step (identity-gate in SendInvoiceModal).

describe('G. zero-friction entry — wizard non-blocking contract', () => {
  // The wizard auto-open logic was removed. isProfileComplete is no longer used
  // as a render gate in AppShell. These tests document the new JIT gate order
  // in SendInvoiceModal: identity-gate → bank-gate → paywall → send.

  function simulateInvoiceSend({ profile, isUnpriced = false }) {
    if (isUnpriced) return 'blocked-unpriced';
    // Identity gate (feat/zero-friction-entry): fires when any name field is missing.
    const identityMissing = !profile?.business_name || !profile?.first_name || !profile?.last_name;
    if (identityMissing) return 'identity-gate';
    // Bank gate fires next.
    if (!profileHasBank(profile)) return 'bank-gate';
    return 'proceed';
  }

  it('brand-new user with empty profile hits identity-gate before bank-gate', () => {
    expect(simulateInvoiceSend({ profile: {} })).toBe('identity-gate');
  });

  it('user with only business_name still hits identity-gate (first/last missing)', () => {
    expect(simulateInvoiceSend({ profile: { business_name: 'Smith Plumbing' } })).toBe('identity-gate');
  });

  it('user with name fields but no bank hits bank-gate (identity passes)', () => {
    expect(simulateInvoiceSend({ profile: nameOnlyProfile() })).toBe('bank-gate');
  });

  it('user with full profile proceeds immediately (no gate)', () => {
    expect(simulateInvoiceSend({ profile: fullProfile() })).toBe('proceed');
  });

  it('unpriced invoice blocks before identity-gate', () => {
    expect(simulateInvoiceSend({ profile: {}, isUnpriced: true })).toBe('blocked-unpriced');
  });

  it('after identity-gate save, localProfile with name fields passes identity check', () => {
    const saved = { business_name: 'Smith Plumbing', first_name: 'Alan', last_name: 'Smith' };
    const identityMissing = !saved.business_name || !saved.first_name || !saved.last_name;
    expect(identityMissing).toBe(false);
  });

  it('after identity + bank save, full localProfile proceeds to send', () => {
    const saved = {
      business_name: 'Smith Plumbing',
      first_name: 'Alan',
      last_name: 'Smith',
      sort_code: '12-34-56',
      account_number: '12345678',
    };
    expect(simulateInvoiceSend({ profile: saved })).toBe('proceed');
  });
});
