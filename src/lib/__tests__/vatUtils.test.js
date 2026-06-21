/**
 * Unit tests for src/lib/vatUtils.js
 *
 * Canonical arithmetic proofs for the VAT-inclusive assumption.
 * Decision: ACC, 2026-06-21 — prices entered in the app are VAT-INCLUSIVE (gross).
 * We derive net and VAT from the gross; we never add VAT on top.
 *
 * Formula: net = gross / (1 + rate), vat = gross − net
 * At 20%:  net = gross / 1.2,        vat = gross / 6
 */

import { describe, it, expect } from 'vitest';
import { splitVatInclusive } from '../vatUtils.js';

describe('splitVatInclusive', () => {
  // ── Core arithmetic ─────────────────────────────────────────────────────────

  it('£240 gross @20% → net £200, vat £40', () => {
    const { gross, net, vat } = splitVatInclusive(240, 0.2);
    expect(gross).toBe(240);
    expect(net).toBeCloseTo(200, 10);
    expect(vat).toBeCloseTo(40, 10);
  });

  it('£1200 gross @20% → net £1000, vat £200', () => {
    const { gross, net, vat } = splitVatInclusive(1200, 0.2);
    expect(gross).toBe(1200);
    expect(net).toBeCloseTo(1000, 10);
    expect(vat).toBeCloseTo(200, 10);
  });

  it('£120 gross @20% → vat £20 (not £24 — guarding old × 0.2 bug)', () => {
    const { vat } = splitVatInclusive(120, 0.2);
    expect(vat).toBeCloseTo(20, 10);
    expect(vat).not.toBeCloseTo(24, 5);
  });

  it('£60 gross @20% → net £50, vat £10', () => {
    const { net, vat } = splitVatInclusive(60, 0.2);
    expect(net).toBeCloseTo(50, 10);
    expect(vat).toBeCloseTo(10, 10);
  });

  it('net + vat === gross (no rounding loss at 20%)', () => {
    const { gross, net, vat } = splitVatInclusive(360, 0.2);
    expect(net + vat).toBeCloseTo(gross, 10);
  });

  // ── Default rate (0.2 when omitted) ─────────────────────────────────────────

  it('defaults to 20% when rate is omitted', () => {
    const withDefault = splitVatInclusive(240);
    const explicit    = splitVatInclusive(240, 0.2);
    expect(withDefault.net).toBeCloseTo(explicit.net, 10);
    expect(withDefault.vat).toBeCloseTo(explicit.vat, 10);
  });

  // ── Rate-generic (future 5% / 0% scenarios) ─────────────────────────────────

  it('£105 gross @5% → net £100, vat £5', () => {
    const { net, vat } = splitVatInclusive(105, 0.05);
    expect(net).toBeCloseTo(100, 10);
    expect(vat).toBeCloseTo(5, 10);
  });

  it('£500 gross @0% → net £500, vat £0', () => {
    const { net, vat } = splitVatInclusive(500, 0);
    expect(net).toBeCloseTo(500, 10);
    expect(vat).toBeCloseTo(0, 10);
  });

  // ── Edge cases ───────────────────────────────────────────────────────────────

  it('£0 gross → all zeros (no division risk)', () => {
    const { gross, net, vat } = splitVatInclusive(0, 0.2);
    expect(gross).toBe(0);
    expect(net).toBe(0);
    expect(vat).toBe(0);
  });

  it('null/undefined gross treated as 0', () => {
    expect(splitVatInclusive(null).gross).toBe(0);
    expect(splitVatInclusive(undefined).gross).toBe(0);
  });

  it('string numbers are coerced', () => {
    const { gross, net, vat } = splitVatInclusive('240', 0.2);
    expect(gross).toBe(240);
    expect(net).toBeCloseTo(200, 10);
    expect(vat).toBeCloseTo(40, 10);
  });
});
