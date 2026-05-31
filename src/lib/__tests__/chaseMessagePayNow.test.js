/**
 * Tests for the Pay-now URL prepend in chase messages (PR 2, Section 2.2).
 *
 * Verifies that buildChaseMessageWithPayNow:
 *   A. Prepends "Pay by card here: <url>" when payNowUrl is provided
 *   B. Returns the original message unchanged when payNowUrl is absent
 *   C. Returns the original message unchanged when payNowUrl is empty string
 *   D. Works across all tiers (spot-check tier 1 and tier 2)
 *   E. buildChaseLink includes the Pay-now prefix when payNowUrl is provided
 *   F. buildChaseLink returns unchanged link when payNowUrl is absent
 */

import { describe, it, expect, vi } from 'vitest';
import { buildChaseMessageWithPayNow, buildChaseMessage, buildChaseLink } from '../chaseLadder.js';

// Stub localStorage for Node (chaseLadder.js reads it for chase state)
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

const BASE_PARAMS = {
  customerName: 'Sam',
  amount: '£540.00',
  jobSummary: 'Bathroom re-tile',
  daysOverdue: 3,
  tier: 1,
  paymentDetails: 'Sort code: 12-34-56 · Account: 12345678',
  businessName: 'Murphy Plumbing',
};

// ─── A. Prepends Pay-now line when payNowUrl is provided ─────────────────────

describe('A. Prepends Pay-now line when payNowUrl is provided', () => {
  it('starts the message with "Pay by card here: <url>"', () => {
    const url = 'https://app.jobprofit.co.uk/p/abc123';
    const msg = buildChaseMessageWithPayNow({ ...BASE_PARAMS, payNowUrl: url });
    expect(msg).toMatch(/^Pay by card here: https:\/\/app\.jobprofit\.co\.uk\/p\/abc123/);
  });

  it('preserves the original tier copy below the Pay-now line', () => {
    const url = 'https://app.jobprofit.co.uk/p/xyz789';
    const msg = buildChaseMessageWithPayNow({ ...BASE_PARAMS, payNowUrl: url });
    const base = buildChaseMessage(BASE_PARAMS);
    expect(msg).toContain(base);
  });

  it('separates the Pay-now line from the chase copy with a blank line', () => {
    const url = 'https://app.jobprofit.co.uk/p/abc123';
    const msg = buildChaseMessageWithPayNow({ ...BASE_PARAMS, payNowUrl: url });
    // "Pay by card here: url\n\n<chase copy>"
    expect(msg).toMatch(/Pay by card here: .+\n\n/);
  });
});

// ─── B. Original message unchanged when payNowUrl absent ─────────────────────

describe('B. Original message unchanged when payNowUrl is absent', () => {
  it('returns exactly buildChaseMessage output when payNowUrl is undefined', () => {
    const msg = buildChaseMessageWithPayNow(BASE_PARAMS);
    const base = buildChaseMessage(BASE_PARAMS);
    expect(msg).toBe(base);
  });
});

// ─── C. Original message unchanged when payNowUrl is empty string ─────────────

describe('C. Original message unchanged when payNowUrl is empty string', () => {
  it('returns exactly buildChaseMessage output when payNowUrl is ""', () => {
    const msg = buildChaseMessageWithPayNow({ ...BASE_PARAMS, payNowUrl: '' });
    const base = buildChaseMessage(BASE_PARAMS);
    expect(msg).toBe(base);
  });
});

// ─── D. Works across tiers ────────────────────────────────────────────────────

describe('D. Works across tiers', () => {
  it('prepends correctly for tier 1', () => {
    const url = 'https://app.jobprofit.co.uk/p/t1';
    const msg = buildChaseMessageWithPayNow({ ...BASE_PARAMS, tier: 1, payNowUrl: url });
    expect(msg.startsWith(`Pay by card here: ${url}`)).toBe(true);
  });

  it('prepends correctly for tier 2', () => {
    const url = 'https://app.jobprofit.co.uk/p/t2';
    const msg = buildChaseMessageWithPayNow({ ...BASE_PARAMS, tier: 2, daysOverdue: 10, payNowUrl: url });
    expect(msg.startsWith(`Pay by card here: ${url}`)).toBe(true);
  });

  it('prepends correctly for tier 3 B2C', () => {
    const url = 'https://app.jobprofit.co.uk/p/t3';
    const msg = buildChaseMessageWithPayNow({ ...BASE_PARAMS, tier: 3, daysOverdue: 21, payNowUrl: url });
    expect(msg.startsWith(`Pay by card here: ${url}`)).toBe(true);
  });
});

// ─── E. buildChaseLink includes Pay-now prefix when payNowUrl provided ────────

describe('E. buildChaseLink includes Pay-now prefix in the encoded message', () => {
  it('wa.me link encodes the Pay-now line in the message', () => {
    const url = 'https://app.jobprofit.co.uk/p/xyz123';
    const link = buildChaseLink({ phone: '07900123456', ...BASE_PARAMS, payNowUrl: url });
    expect(link).not.toBeNull();
    expect(decodeURIComponent(link)).toContain(`Pay by card here: ${url}`);
  });
});

// ─── F. buildChaseLink unchanged when payNowUrl absent ───────────────────────

describe('F. buildChaseLink returns original link when payNowUrl absent', () => {
  it('wa.me link does not contain Pay-by-card prefix', () => {
    const link = buildChaseLink({ phone: '07900123456', ...BASE_PARAMS });
    expect(link).not.toBeNull();
    expect(decodeURIComponent(link)).not.toContain('Pay by card here:');
  });
});
