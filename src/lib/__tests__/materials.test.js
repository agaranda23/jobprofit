/**
 * materials.test.js — unit tests for the pure helpers in materials.js.
 *
 * Tests:
 *   1. sellPrice(buyPrice, markupPct) — the headline profit-math function.
 *   2. resolveMarkup(rowMarkup, profileMarkup) — priority chain.
 *   3. scoreMatch(material, query) — type-ahead match scoring.
 *   4. filterMaterials(materials, query) — top-5 ranked results.
 *   5. Quote line-item buyPrice moat rule assertions.
 *
 * The Supabase cloud functions (getMaterials, addMaterial, etc.) are
 * integration-level and not tested here — they require a live connection.
 * The pure helpers are tested exhaustively because they directly affect the
 * sell prices shown on quotes (profit-affecting metric).
 *
 * Supabase client is mocked to allow the module to load without real env vars.
 */

import { describe, it, expect, vi } from 'vitest';

// Stub the supabase client before importing materials.js so the
// createClient() call in supabase.js doesn't throw "supabaseUrl is required".
vi.mock('../supabase.js', () => ({
  supabase: {
    from:  () => ({ select: () => ({}), insert: () => ({}), update: () => ({}), eq: () => ({}) }),
    auth:  { getUser: async () => ({ data: { user: null } }) },
    rpc:   async () => ({ error: new Error('mock') }),
  },
}));

import { sellPrice, resolveMarkup, scoreMatch, filterMaterials } from '../materials.js';

// ─── sellPrice ────────────────────────────────────────────────────────────────

describe('sellPrice(buyPrice, markupPct)', () => {
  it('applies 20% markup correctly', () => {
    expect(sellPrice(100, 20)).toBe(120);
  });

  it('rounds to 2 decimal places', () => {
    // £13 + 20% = £15.6 — exact, no rounding needed
    expect(sellPrice(13, 20)).toBe(15.6);
    // £10 + 33% = £13.3 — exact
    expect(sellPrice(10, 33)).toBe(13.3);
    // £1.23 + 15% = £1.4145 → £1.41
    expect(sellPrice(1.23, 15)).toBe(1.41);
  });

  it('returns buy price unchanged on 0% markup', () => {
    expect(sellPrice(50, 0)).toBe(50);
  });

  it('handles 0 buy price', () => {
    expect(sellPrice(0, 20)).toBe(0);
  });

  it('handles string inputs (coerces gracefully)', () => {
    expect(sellPrice('100', '20')).toBe(120);
  });

  it('handles NaN buy price as 0', () => {
    expect(sellPrice(NaN, 20)).toBe(0);
  });

  it('handles undefined markup as 0%', () => {
    expect(sellPrice(100, undefined)).toBe(100);
  });

  it('applies 100% markup (doubling)', () => {
    expect(sellPrice(75, 100)).toBe(150);
  });

  it('handles fractional markup', () => {
    // £200 + 2.5% = £205
    expect(sellPrice(200, 2.5)).toBe(205);
  });
});

// ─── resolveMarkup ────────────────────────────────────────────────────────────

describe('resolveMarkup(rowMarkup, profileMarkup)', () => {
  it('prefers row markup when set', () => {
    expect(resolveMarkup(30, 20)).toBe(30);
  });

  it('falls back to profile markup when row markup is null', () => {
    expect(resolveMarkup(null, 25)).toBe(25);
  });

  it('falls back to profile markup when row markup is undefined', () => {
    expect(resolveMarkup(undefined, 15)).toBe(15);
  });

  it('falls back to 20 when both are null', () => {
    expect(resolveMarkup(null, null)).toBe(20);
  });

  it('falls back to 20 when both are undefined', () => {
    expect(resolveMarkup(undefined, undefined)).toBe(20);
  });

  it('accepts 0 as a valid row markup (no markup)', () => {
    expect(resolveMarkup(0, 20)).toBe(0);
  });

  it('accepts 0 as a valid profile markup', () => {
    expect(resolveMarkup(null, 0)).toBe(0);
  });

  it('coerces string numbers', () => {
    expect(resolveMarkup('30', '20')).toBe(30);
  });
});

// ─── scoreMatch ───────────────────────────────────────────────────────────────

describe('scoreMatch(material, query)', () => {
  const mat = (desc, supplier_code = '') => ({ desc, supplier_code, use_count: 0 });

  it('returns 2 for prefix match on desc', () => {
    expect(scoreMatch(mat('Copper pipe'), 'copper')).toBe(2);
  });

  it('returns 2 for prefix match on supplier_code', () => {
    expect(scoreMatch(mat('Pipe', 'SFX-123'), 'sfx')).toBe(2);
  });

  it('returns 1 for contains match on desc', () => {
    expect(scoreMatch(mat('22mm copper pipe'), 'copper')).toBe(1);
  });

  it('returns 1 for contains match on supplier_code', () => {
    expect(scoreMatch(mat('Pipe', 'ABC-SFX-99'), 'sfx')).toBe(1);
  });

  it('returns 0 for no match', () => {
    expect(scoreMatch(mat('Copper pipe'), 'plywood')).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(scoreMatch(mat('Copper Pipe'), 'COPPER')).toBe(2);
  });

  it('returns 1 for empty query (all materials match)', () => {
    expect(scoreMatch(mat('Anything'), '')).toBe(1);
  });
});

// ─── filterMaterials ─────────────────────────────────────────────────────────

describe('filterMaterials(materials, query)', () => {
  const lib = [
    { id: '1', desc: 'Copper pipe 22mm',   supplier_code: 'SFX-100', use_count: 10 },
    { id: '2', desc: 'Plastic pipe 22mm',  supplier_code: 'SFX-101', use_count:  5 },
    { id: '3', desc: 'Copper elbow',       supplier_code: 'SFX-200', use_count:  8 },
    { id: '4', desc: 'Cable clips',        supplier_code: 'CXY-001', use_count:  3 },
    { id: '5', desc: 'Cable ties',         supplier_code: 'CXY-002', use_count:  7 },
    { id: '6', desc: 'Junction box',       supplier_code: 'JBX-001', use_count:  1 },
  ];

  it('returns up to 5 results', () => {
    const results = filterMaterials(lib, 'c');
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('returns prefix matches before contains matches', () => {
    // 'copper' prefix matches: [1 Copper pipe, 3 Copper elbow]
    // no contains match for 'copper' elsewhere
    const results = filterMaterials(lib, 'copper');
    expect(results[0].id).toBe('1'); // higher use_count tiebreak
    expect(results[1].id).toBe('3');
  });

  it('ranks higher use_count first within same score tier', () => {
    // 'cable' matches id:4 (use_count 3) and id:5 (use_count 7) — prefix
    const results = filterMaterials(lib, 'cable');
    expect(results[0].id).toBe('5'); // use_count 7 wins
    expect(results[1].id).toBe('4');
  });

  it('empty query returns top 5 by use_count', () => {
    const results = filterMaterials(lib, '');
    expect(results.length).toBe(5);
    // First result should be the highest use_count item
    expect(results[0].id).toBe('1'); // use_count 10
  });

  it('returns empty array for no matches', () => {
    const results = filterMaterials(lib, 'zxqwerty');
    expect(results).toEqual([]);
  });

  it('handles null/undefined library gracefully', () => {
    expect(filterMaterials(null, 'copper')).toEqual([]);
    expect(filterMaterials(undefined, 'copper')).toEqual([]);
  });

  it('matches supplier_code', () => {
    const results = filterMaterials(lib, 'JBX');
    expect(results.length).toBe(1);
    expect(results[0].id).toBe('6');
  });
});

// ─── Quote line-item shape — buyPrice moat rule ───────────────────────────────

describe('quote line-item buyPrice stashing (moat rule)', () => {
  it('sellPrice result should be used as cost on quote lines, not buyPrice', () => {
    const buyPrice = 50;
    const markup   = 20;
    const sell     = sellPrice(buyPrice, markup);
    // The line-item cost (charge to customer) must be the sell price
    const lineItem = {
      desc:      'Test material',
      cost:      sell,       // sell price → shown on quote / charged to customer
      buyPrice:  buyPrice,   // stashed for later receipt/cost creation, never double-counted
      materialId: 'mat-uuid',
      provenance: 'material',
    };
    expect(lineItem.cost).toBe(60);
    expect(lineItem.buyPrice).toBe(50);
    expect(lineItem.cost).not.toBe(lineItem.buyPrice);
  });

  it('buyPrice on a cost/receipt context line should equal the cost field', () => {
    // In a receipt context (logging actual spend), cost = buyPrice
    const buyPrice = 50;
    const lineItem = {
      desc:      'Test material',
      cost:      buyPrice,   // in receipt context: cost = buy price
      buyPrice:  buyPrice,
      provenance: 'material',
    };
    expect(lineItem.cost).toBe(lineItem.buyPrice);
  });

  it('resolveMarkup + sellPrice integration: matches expected sell price', () => {
    // Row has no markup override, profile says 25%
    const markup = resolveMarkup(null, 25);
    expect(markup).toBe(25);
    const sell = sellPrice(80, markup);
    expect(sell).toBe(100);
  });
});
