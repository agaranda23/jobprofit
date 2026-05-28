/**
 * Unit tests for needsPrice() and stagePatch() exports added to jobStatus.js.
 *
 * These guard the core "optional amount + Lead-gated advance" feature.
 * No DOM, no React, no @testing-library — pure logic.
 */

import { describe, it, expect } from 'vitest';
import { needsPrice, stagePatch } from '../jobStatus';

// ---------------------------------------------------------------------------
// needsPrice
// ---------------------------------------------------------------------------

describe('needsPrice: null / undefined amount', () => {
  it('returns true when total and amount are both null', () => {
    expect(needsPrice({ total: null, amount: null })).toBe(true);
  });

  it('returns true when total and amount are both undefined', () => {
    expect(needsPrice({})).toBe(true);
  });

  it('returns true when amount is null and total is absent', () => {
    expect(needsPrice({ amount: null })).toBe(true);
  });

  it('returns true when amount is undefined', () => {
    expect(needsPrice({ amount: undefined })).toBe(true);
  });
});

describe('needsPrice: zero amount', () => {
  it('returns true when total === 0', () => {
    expect(needsPrice({ total: 0 })).toBe(true);
  });

  it('returns true when amount === 0 and total is absent', () => {
    expect(needsPrice({ amount: 0 })).toBe(true);
  });

  it('returns true when amount is the string "0"', () => {
    expect(needsPrice({ amount: '0' })).toBe(true);
  });
});

describe('needsPrice: positive amount', () => {
  it('returns false when total > 0', () => {
    expect(needsPrice({ total: 380 })).toBe(false);
  });

  it('returns false when amount > 0 and total is absent', () => {
    expect(needsPrice({ amount: 250 })).toBe(false);
  });

  it('total takes precedence over amount when both present', () => {
    // total is positive → priced even if amount is 0
    expect(needsPrice({ total: 380, amount: 0 })).toBe(false);
  });

  it('returns false for a small but non-zero amount (e.g. £1)', () => {
    expect(needsPrice({ amount: 1 })).toBe(false);
  });
});

describe('needsPrice: safety — null job', () => {
  it('returns true for null job (does not throw)', () => {
    expect(needsPrice(null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stagePatch
// ---------------------------------------------------------------------------

describe('stagePatch: returns correct DB fields for each stage', () => {
  it('Lead → status:lead, paid:false', () => {
    const p = stagePatch('Lead');
    expect(p.status).toBe('lead');
    expect(p.paid).toBe(false);
  });

  it('Quoted → status:quoted, paid:false', () => {
    const p = stagePatch('Quoted');
    expect(p.status).toBe('quoted');
    expect(p.paid).toBe(false);
  });

  it('On → status:active, paid:false', () => {
    const p = stagePatch('On');
    expect(p.status).toBe('active');
    expect(p.paid).toBe(false);
  });

  it('Invoiced → status:invoice_sent, invoiceStatus:invoiced', () => {
    const p = stagePatch('Invoiced');
    expect(p.status).toBe('invoice_sent');
    expect(p.invoiceStatus).toBe('invoiced');
  });

  it('Paid → status:paid, paid:true, invoiceStatus:invoiced', () => {
    const p = stagePatch('Paid');
    expect(p.status).toBe('paid');
    expect(p.paid).toBe(true);
    expect(p.invoiceStatus).toBe('invoiced');
  });

  it('unknown stage → returns empty object (no throw)', () => {
    const p = stagePatch('NonExistent');
    expect(p).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// store.js null-preserving amount logic (mirrored here for unit coverage)
// ---------------------------------------------------------------------------

describe('store.js amount coercion (null-preserving)', () => {
  // Mirror the logic added to addTodayJob / addJobToCloud
  function coerceAmount(raw) {
    return (raw == null || raw === '') ? null : Number(raw);
  }

  it('null input → null (not 0)', () => {
    expect(coerceAmount(null)).toBeNull();
  });

  it('undefined input → null', () => {
    expect(coerceAmount(undefined)).toBeNull();
  });

  it('empty string → null', () => {
    expect(coerceAmount('')).toBeNull();
  });

  it('numeric string → number', () => {
    expect(coerceAmount('380')).toBe(380);
  });

  it('number → number unchanged', () => {
    expect(coerceAmount(250)).toBe(250);
  });

  it('0 → 0 (preserves explicit zero)', () => {
    // Explicit 0 is unusual but valid to pass through
    expect(coerceAmount(0)).toBe(0);
  });
});
