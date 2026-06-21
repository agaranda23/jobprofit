/**
 * Shared VAT arithmetic helpers.
 *
 * Decision (ACC, 2026-06-21): prices entered in the app are VAT-INCLUSIVE (gross).
 * We NEVER add VAT on top of an entered price — we derive net and VAT from
 * the gross the trader typed.
 *
 * Formula (rate-generic):
 *   net = gross / (1 + rate)
 *   vat = gross - net          // at 20%: gross / 6
 *
 * Using the rate-generic form means a future 5% or 0% rate override will work
 * without touching this file.
 *
 * Out of scope (v2): per-job rate overrides, inclusive/exclusive toggle.
 */

/**
 * Splits a VAT-inclusive gross amount into its net (ex-VAT) and VAT components.
 *
 * @param {number} gross - VAT-inclusive price (what the trader entered)
 * @param {number} [rate=0.2] - fractional VAT rate, e.g. 0.2 for 20%
 * @returns {{ gross: number, net: number, vat: number }}
 *
 * @example
 * splitVatInclusive(240, 0.2)  // { gross: 240, net: 200, vat: 40 }
 * splitVatInclusive(1200, 0.2) // { gross: 1200, net: 1000, vat: 200 }
 * splitVatInclusive(0, 0.2)    // { gross: 0, net: 0, vat: 0 }
 */
export function splitVatInclusive(gross, rate = 0.2) {
  const g = Number(gross) || 0;
  if (g === 0) return { gross: 0, net: 0, vat: 0 };
  const net = g / (1 + rate);
  const vat = g - net;
  return { gross: g, net, vat };
}
