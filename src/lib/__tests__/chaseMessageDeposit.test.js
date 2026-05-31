/**
 * Tests for the deposit deduction copy in buildChaseMessageWithPayNow (PR 4).
 *
 * Verifies that buildChaseMessageWithPayNow correctly annotates chase messages
 * when a deposit has already been paid by the customer, across two scenarios:
 *
 *   A. With payNowUrl + depositPaidPence — pay-link line includes deposit context
 *   B. Without payNowUrl + depositPaidPence — base message gets a deposit suffix
 *   C. depositPaidPence = 0 with payNowUrl — plain "Pay by card here:" (no deposit context)
 *   D. depositPaidPence > 0 with payNowUrl = '' — suffix appended to base message
 *   E. buildChaseLink encodes deposit context in the wa.me URL
 *   F. Deposit amount formatted correctly (pence → £X.XX)
 */

import { describe, it, expect, vi } from 'vitest';
import { buildChaseMessageWithPayNow, buildChaseMessage, buildChaseLink } from '../chaseLadder.js';

// localStorage stub (Node has no localStorage)
const localStorageMock = (() => {
  let store = {};
  return {
    getItem:    vi.fn(key => store[key] ?? null),
    setItem:    vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear:      vi.fn(() => { store = {}; }),
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

// Shared base params for all tests
const BASE = {
  customerName:   'Mark',
  amount:         '£375.00', // represents the balance, not the gross
  jobSummary:     'Patio job',
  daysOverdue:    5,
  tier:           1,
  paymentDetails: 'Sort code: 20-00-00 · Account: 55443322',
  businessName:   'Brickwork Plus',
};

const PAY_URL = 'https://app.jobprofit.co.uk/p/bal_abc123';

// ── A. With payNowUrl + depositPaidPence ──────────────────────────────────────

describe('A. payNowUrl + depositPaidPence > 0: deposit context on pay-link line', () => {
  it('pay-link line says "Pay balance by card here (deposit of £X already received):"', () => {
    const msg = buildChaseMessageWithPayNow({
      ...BASE,
      payNowUrl: PAY_URL,
      depositPaidPence: 12500, // £125.00
    });
    expect(msg).toContain('Pay balance by card here (deposit of £125.00 already received):');
  });

  it('pay-link line is followed by the pay URL', () => {
    const msg = buildChaseMessageWithPayNow({
      ...BASE,
      payNowUrl: PAY_URL,
      depositPaidPence: 12500,
    });
    const lines = msg.split('\n');
    const payLinkLineIdx = lines.findIndex(l => l.includes('Pay balance by card here'));
    expect(payLinkLineIdx).toBeGreaterThan(-1);
    expect(lines[payLinkLineIdx + 1]).toBe(PAY_URL);
  });

  it('still includes the original tier chase copy below the pay link', () => {
    const msg = buildChaseMessageWithPayNow({
      ...BASE,
      payNowUrl: PAY_URL,
      depositPaidPence: 12500,
    });
    const base = buildChaseMessage(BASE);
    expect(msg).toContain(base);
  });

  it('does NOT append the no-payNowUrl deposit suffix when payNowUrl is set', () => {
    const msg = buildChaseMessageWithPayNow({
      ...BASE,
      payNowUrl: PAY_URL,
      depositPaidPence: 12500,
    });
    // The suffix "(Deposit of £X already paid...)" is only for unconnected traders
    expect(msg).not.toContain('this is for the remaining balance');
  });
});

// ── B. Without payNowUrl + depositPaidPence ───────────────────────────────────

describe('B. No payNowUrl + depositPaidPence > 0: suffix appended to base message', () => {
  it('appends "(Deposit of £X already paid — this is for the remaining balance.)"', () => {
    const msg = buildChaseMessageWithPayNow({
      ...BASE,
      depositPaidPence: 7500, // £75.00
    });
    expect(msg).toContain('Deposit of £75.00 already paid — this is for the remaining balance.');
  });

  it('suffix is separated from the base message by a blank line', () => {
    const msg = buildChaseMessageWithPayNow({
      ...BASE,
      depositPaidPence: 7500,
    });
    const base = buildChaseMessage(BASE);
    expect(msg).toMatch(new RegExp(`${escapeRegex(base)}\\n\\n`));
  });

  it('returned message starts with the original base chase copy (not the suffix)', () => {
    const msg = buildChaseMessageWithPayNow({
      ...BASE,
      depositPaidPence: 7500,
    });
    const base = buildChaseMessage(BASE);
    expect(msg.startsWith(base)).toBe(true);
  });
});

// ── C. depositPaidPence = 0 with payNowUrl ────────────────────────────────────

describe('C. depositPaidPence = 0 with payNowUrl — plain pay-link line', () => {
  it('uses "Pay by card here:" (not "balance" variant) when depositPaidPence = 0', () => {
    const msg = buildChaseMessageWithPayNow({
      ...BASE,
      payNowUrl: PAY_URL,
      depositPaidPence: 0,
    });
    expect(msg).toContain('Pay by card here:');
    expect(msg).not.toContain('deposit of');
  });

  it('same output as no depositPaidPence param when depositPaidPence = 0', () => {
    const withZero    = buildChaseMessageWithPayNow({ ...BASE, payNowUrl: PAY_URL, depositPaidPence: 0 });
    const withAbsent  = buildChaseMessageWithPayNow({ ...BASE, payNowUrl: PAY_URL });
    expect(withZero).toBe(withAbsent);
  });
});

// ── D. depositPaidPence > 0, payNowUrl = '' ───────────────────────────────────

describe('D. depositPaidPence > 0 with payNowUrl = "" — same as no URL', () => {
  it('falls back to suffix-only mode (no "Pay balance by card" line)', () => {
    const msg = buildChaseMessageWithPayNow({
      ...BASE,
      payNowUrl: '',
      depositPaidPence: 5000,
    });
    expect(msg).not.toContain('Pay balance by card here');
    expect(msg).toContain('Deposit of £50.00 already paid');
  });
});

// ── E. buildChaseLink encodes deposit context ──────────────────────────────────

describe('E. buildChaseLink encodes deposit context in wa.me URL', () => {
  it('wa.me URL decodes to include deposit-context pay-link line', () => {
    const link = buildChaseLink({
      phone: '07700900123',
      ...BASE,
      payNowUrl: PAY_URL,
      depositPaidPence: 12500,
    });
    expect(link).not.toBeNull();
    const decoded = decodeURIComponent(link);
    expect(decoded).toContain('Pay balance by card here (deposit of £125.00 already received):');
    expect(decoded).toContain(PAY_URL);
  });

  it('wa.me URL without deposit has plain "Pay by card here:" copy', () => {
    const link = buildChaseLink({
      phone: '07700900123',
      ...BASE,
      payNowUrl: PAY_URL,
    });
    const decoded = decodeURIComponent(link);
    expect(decoded).toContain('Pay by card here:');
    expect(decoded).not.toContain('deposit of');
  });
});

// ── F. Deposit pence → £ formatting ──────────────────────────────────────────

describe('F. Deposit pence formatted correctly as £X.XX', () => {
  it('1 pence → £0.01', () => {
    const msg = buildChaseMessageWithPayNow({ ...BASE, depositPaidPence: 1 });
    expect(msg).toContain('£0.01');
  });

  it('100 pence → £1.00', () => {
    const msg = buildChaseMessageWithPayNow({ ...BASE, depositPaidPence: 100 });
    expect(msg).toContain('£1.00');
  });

  it('25000 pence → £250.00', () => {
    const msg = buildChaseMessageWithPayNow({
      ...BASE,
      payNowUrl: PAY_URL,
      depositPaidPence: 25000,
    });
    expect(msg).toContain('£250.00');
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
