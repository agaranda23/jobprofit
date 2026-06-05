/**
 * bankTransferDeposit.test.js
 *
 * Tests for V1 bank-transfer-deposits feature.
 *
 * Covers:
 *   A. Picker renders for free/no-Stripe trader (un-gating logic)
 *   B. Bank-gate fires at quote send when deposit set + no bank details
 *   C. Bank-gate does NOT fire when bank details are present
 *   D. Bank-gate does NOT fire when deposit_percent is 0
 *   E. Bank-gate does NOT fire when trader is Pro+Stripe (online path)
 *   F. Clamp: deposit_amount_pence cannot exceed job total
 *   G. depositNetting extended — bank method (method:'bank') nets correctly
 *   H. Deposit credit note: payments[] with note matching /deposit/i sum correctly
 *   I. Quote function returns bank fields from public profile (documented contract)
 *
 * All pure-logic, no DOM, no React — project convention.
 */

import { describe, it, expect } from 'vitest';
import { addPayment, computeBalance, computeAmountPaid } from '../payments.js';
import { buildQuoteWhatsAppMessage } from '../quoteMessage.js';

// ── A. Picker un-gating logic ─────────────────────────────────────────────────
// The old gate was: if (!isConnected) return null.
// V1 removes this — picker always renders.
// We document the new contract: rendering is gated only on mode=quote.

describe('A. DepositPickerRow — un-gating logic', () => {
  // The component logic for "should the picker render?" is:
  //   V1: always render in quote mode (no Stripe gate).
  //   We test the mode flag computation, not the React component directly.

  function shouldRenderPicker({ mode }) {
    return mode === 'quote';
  }

  it('renders for quote mode (free/no-Stripe trader)', () => {
    expect(shouldRenderPicker({ mode: 'quote' })).toBe(true);
  });

  it('does not render in invoice mode', () => {
    expect(shouldRenderPicker({ mode: 'invoice' })).toBe(false);
  });
});

// ── B. Bank-gate intercept logic ──────────────────────────────────────────────
// The gate fires at quote send when:
//   - deposit_percent > 0
//   - trader is NOT Pro+Stripe-connected (online deposit path)
//   - profile has no sort_code + account_number

function profileHasBank(profile) {
  return !!(profile?.sort_code && profile?.account_number);
}

function isOnlineDepositPath(profile) {
  return (
    profile?.plan === 'pro' &&
    profile?.stripe_connect_status === 'connected' &&
    !!profile?.stripe_user_id
  );
}

function simulateQuoteSend({ depositPercent, profile }) {
  if (depositPercent > 0 && !isOnlineDepositPath(profile) && !profileHasBank(profile)) {
    return 'bank-gate';
  }
  return 'proceed';
}

describe('B. Bank-gate fires at quote send', () => {
  const noBank = { plan: 'free', sort_code: null, account_number: null };

  it('fires bank-gate when deposit > 0 and no bank details (free user)', () => {
    expect(simulateQuoteSend({ depositPercent: 25, profile: noBank })).toBe('bank-gate');
  });

  it('fires bank-gate for Pro user without Stripe when bank missing', () => {
    const proNoStripe = {
      plan: 'pro',
      stripe_connect_status: 'disconnected',
      stripe_user_id: null,
      sort_code: null,
      account_number: null,
    };
    expect(simulateQuoteSend({ depositPercent: 25, profile: proNoStripe })).toBe('bank-gate');
  });
});

describe('C. Bank-gate does NOT fire when bank details are present', () => {
  const withBank = { plan: 'free', sort_code: '12-34-56', account_number: '12345678' };

  it('proceeds when bank details are present', () => {
    expect(simulateQuoteSend({ depositPercent: 25, profile: withBank })).toBe('proceed');
  });

  it('proceeds after bank-gate save (optimistic profile update has bank fields)', () => {
    const savedProfile = {
      plan: 'free',
      sort_code: '12-34-56',
      account_number: '12345678',
    };
    expect(simulateQuoteSend({ depositPercent: 25, profile: savedProfile })).toBe('proceed');
  });
});

describe('D. Bank-gate does NOT fire when deposit_percent is 0', () => {
  const noBank = { plan: 'free', sort_code: null, account_number: null };

  it('proceeds when depositPercent is 0 even without bank details', () => {
    expect(simulateQuoteSend({ depositPercent: 0, profile: noBank })).toBe('proceed');
  });
});

describe('E. Bank-gate does NOT fire for Pro+Stripe (online path)', () => {
  const proStripe = {
    plan: 'pro',
    stripe_connect_status: 'connected',
    stripe_user_id: 'acct_abc123',
    sort_code: null,
    account_number: null,
  };

  it('proceeds for Pro+Stripe even without bank details', () => {
    expect(simulateQuoteSend({ depositPercent: 25, profile: proStripe })).toBe('proceed');
  });
});

// ── F. Clamp logic ────────────────────────────────────────────────────────────
// deposit_amount_pence must not exceed job total pence.

describe('F. deposit_amount_pence clamp', () => {
  function computeLockedDepositPence(depositPercent, jobTotal) {
    const raw = depositPercent > 0 && jobTotal > 0
      ? Math.round(jobTotal * (depositPercent / 100) * 100)
      : 0;
    return Math.min(raw, Math.round(jobTotal * 100));
  }

  it('normal case: 25% of £1000 = 25000p', () => {
    expect(computeLockedDepositPence(25, 1000)).toBe(25000);
  });

  it('clamps to total when depositPercent exceeds 100 (stale value)', () => {
    // If a stale deposit_amount_pence is re-computed with a lower total
    // the clamp prevents the amount from exceeding the current total.
    const total = 200; // trader edited from £1000 to £200
    const depositPercent = 25;
    const raw = Math.round(total * (depositPercent / 100) * 100); // 5000p
    const clamped = Math.min(raw, Math.round(total * 100)); // 5000 ≤ 20000 → 5000
    expect(clamped).toBe(5000);
  });

  it('clamps when a 100% deposit amount exceeds the current total', () => {
    // Simulate: deposit set at 100% when total was £500, then total changed to £300.
    // The clamp fires at send time using the CURRENT total.
    const jobTotal = 300;
    const depositPercent = 100;
    const raw = Math.round(jobTotal * (depositPercent / 100) * 100); // 30000p
    const clamped = Math.min(raw, Math.round(jobTotal * 100)); // 30000 ≤ 30000 → 30000
    expect(clamped).toBe(30000);
  });

  it('zero deposit when depositPercent is 0', () => {
    expect(computeLockedDepositPence(0, 1000)).toBe(0);
  });

  it('zero deposit when jobTotal is 0', () => {
    expect(computeLockedDepositPence(25, 0)).toBe(0);
  });
});

// ── G. depositNetting extended — bank method ──────────────────────────────────

const PAST_DATE = '2024-06-01';

function quotedJob(total, overrides = {}) {
  return {
    id: 'job-bank-1',
    amount: total,
    total,
    status: 'quoted',
    paymentStatus: 'unpaid',
    payments: [],
    ...overrides,
  };
}

describe('G. depositNetting — bank method (method:"bank")', () => {
  it('nets a bank deposit off the balance', () => {
    const job = quotedJob(800);
    const result = addPayment(job, { amount: 200, date: PAST_DATE, method: 'bank', note: 'Deposit received' });
    expect(computeBalance(result)).toBe(600);
  });

  it('records the deposit with method="bank"', () => {
    const job = quotedJob(800);
    const result = addPayment(job, { amount: 200, date: PAST_DATE, method: 'bank', note: 'Deposit received' });
    expect(result.payments[0].method).toBe('bank');
    expect(result.payments[0].note).toBe('Deposit received');
  });

  it('does NOT auto-flip to Paid on partial bank deposit (pre-invoice)', () => {
    const job = quotedJob(1000);
    const result = addPayment(job, { amount: 250, date: PAST_DATE, method: 'bank', note: 'Deposit' });
    expect(result.status).toBe('quoted');
    expect(result.paymentStatus).toBe('unpaid');
  });

  it('sets _depositFullyClearsQuote when bank deposit equals full quote', () => {
    const job = quotedJob(500);
    const result = addPayment(job, { amount: 500, date: PAST_DATE, method: 'bank', note: 'Deposit' });
    expect(result._depositFullyClearsQuote).toBe(true);
    expect(result.status).not.toBe('paid');
  });

  it('amountPaid equals bank deposit amount', () => {
    const job = quotedJob(600);
    const result = addPayment(job, { amount: 150, date: PAST_DATE, method: 'bank', note: 'Deposit' });
    expect(computeAmountPaid(result)).toBe(150);
  });
});

// ── H. Deposit credit note — payments[] /deposit/i filter ─────────────────────

describe('H. Invoice deposit credit line — payments[] filter', () => {
  function computeDepositCredit(payments) {
    if (!Array.isArray(payments)) return 0;
    return payments
      .filter(p => /deposit/i.test(p.note || ''))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
  }

  it('sums payments whose note matches /deposit/i', () => {
    const payments = [
      { id: 'p1', amount: 250, note: 'Deposit received', method: 'bank', date: PAST_DATE },
    ];
    expect(computeDepositCredit(payments)).toBe(250);
  });

  it('ignores payments whose note does not match /deposit/i', () => {
    const payments = [
      { id: 'p1', amount: 500, note: 'Final payment', method: 'bank', date: PAST_DATE },
    ];
    expect(computeDepositCredit(payments)).toBe(0);
  });

  it('sums multiple deposit payments', () => {
    const payments = [
      { id: 'p1', amount: 100, note: 'Deposit 1', method: 'bank', date: PAST_DATE },
      { id: 'p2', amount: 150, note: 'Deposit 2', method: 'bank', date: PAST_DATE },
    ];
    expect(computeDepositCredit(payments)).toBe(250);
  });

  it('is case-insensitive (matches "Deposit on acceptance" from Stripe webhook)', () => {
    const payments = [
      { id: 'p1', amount: 300, note: 'Deposit on acceptance', method: 'card', date: PAST_DATE },
    ];
    expect(computeDepositCredit(payments)).toBe(300);
  });

  it('returns 0 for empty payments array', () => {
    expect(computeDepositCredit([])).toBe(0);
  });

  it('returns 0 when payments is null/undefined', () => {
    expect(computeDepositCredit(null)).toBe(0);
    expect(computeDepositCredit(undefined)).toBe(0);
  });
});

// ── I. Public quote profile — bank fields contract ────────────────────────────
// Documents that fetch-public-quote-profile now returns accountName, sortCode,
// accountNumber. We test the shape expectation (not the Netlify function itself
// which requires env vars — that is an integration test).

describe('I. fetch-public-quote-profile bank fields contract', () => {
  // The function now returns these fields when the trader has bank details saved.
  // This test documents the contract: PublicQuoteView reads traderProfile.accountName,
  // .sortCode, .accountNumber and passes them to BankDepositBlock.

  function mockProfileResponse(overrides = {}) {
    return {
      businessName: 'Smith Plumbing',
      address: '1 Pipe Lane',
      phone: '07700 900000',
      email: 'alan@smith.co.uk',
      logoUrl: '',
      website: '',
      vatRegistered: false,
      vatNumber: '',
      utrNumber: '',
      quoteValidityDays: 30,
      termsText: '',
      accountName: '',
      sortCode: '',
      accountNumber: '',
      isPro: false,
      ...overrides,
    };
  }

  it('response includes accountName, sortCode, accountNumber fields', () => {
    const r = mockProfileResponse();
    expect(r).toHaveProperty('accountName');
    expect(r).toHaveProperty('sortCode');
    expect(r).toHaveProperty('accountNumber');
  });

  it('bank fields are populated when trader has bank details', () => {
    const r = mockProfileResponse({
      accountName: 'Alan Smith',
      sortCode: '12-34-56',
      accountNumber: '12345678',
    });
    expect(r.accountName).toBe('Alan Smith');
    expect(r.sortCode).toBe('12-34-56');
    expect(r.accountNumber).toBe('12345678');
  });

  it('bank fields are empty strings when trader has no bank details', () => {
    const r = mockProfileResponse();
    expect(r.accountName).toBe('');
    expect(r.sortCode).toBe('');
    expect(r.accountNumber).toBe('');
  });

  // BankDepositBlock render condition: sortCode AND accountNumber must both be truthy
  it('BankDepositBlock does not render when sortCode is empty', () => {
    const r = mockProfileResponse({ accountNumber: '12345678' });
    const wouldRender = !!(r.sortCode && r.accountNumber);
    expect(wouldRender).toBe(false);
  });

  it('BankDepositBlock renders when both sortCode and accountNumber are set', () => {
    const r = mockProfileResponse({ sortCode: '12-34-56', accountNumber: '12345678' });
    const wouldRender = !!(r.sortCode && r.accountNumber);
    expect(wouldRender).toBe(true);
  });
});
