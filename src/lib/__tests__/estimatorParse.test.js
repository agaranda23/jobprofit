/**
 * estimatorParse.test.js — unit tests for estimatorParse.js.
 *
 * Tests:
 *   1. regexParse — detects patio/brickWall calcType
 *   2. regexParse — extracts L×W dimensions
 *   3. regexParse — extracts area directly
 *   4. regexParse — extracts feet and converts to metres
 *   5. regexParse — detects edgingType
 *   6. regexParse — detects skin / brickOrBlock
 *   7. regexParse — returns correct missing[] keys
 *   8. regexParse — handles empty input
 *   9. parseEstimate (AI path) — returns structured result from mock AI response
 *  10. parseEstimate — falls back to regex when AI proxy is unreachable
 *  11. parseEstimate — falls back to regex when not signed in
 *
 * Supabase and fetch are mocked to avoid real network calls.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

// ── Mock Supabase ─────────────────────────────────────────────────────────────
vi.mock('../supabase.js', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
}));

import { regexParse, parseEstimate } from '../estimatorParse.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── regexParse — calcType detection ─────────────────────────────────────────

describe('regexParse — calcType detection', () => {
  it('detects patio from "patio"', () => {
    const { calcType } = regexParse('6 by 6 metre patio');
    expect(calcType).toBe('patio');
  });

  it('detects patio from "paving slabs"', () => {
    const { calcType } = regexParse('lay some paving slabs out back');
    expect(calcType).toBe('patio');
  });

  it('detects brickWall from "brick wall"', () => {
    const { calcType } = regexParse('build a brick wall 5m long');
    expect(calcType).toBe('brickWall');
  });

  it('detects brickWall from "blockwork"', () => {
    const { calcType } = regexParse('blockwork boundary fence');
    expect(calcType).toBe('brickWall');
  });

  it('returns null calcType for unrecognised job type', () => {
    const { calcType } = regexParse('repaint the kitchen ceiling');
    expect(calcType).toBeNull();
  });

  it('prefers brickWall when both wall and patio appear (ambiguous)', () => {
    const { calcType } = regexParse('patio wall at the back');
    expect(calcType).toBe('brickWall');
  });
});

// ─── regexParse — dimension extraction ───────────────────────────────────────

describe('regexParse — L×W dimensions', () => {
  it('extracts "6 by 6" → lengthM:6, widthM:6', () => {
    const { inputs } = regexParse('6 by 6 metre patio');
    expect(inputs.lengthM).toBe(6);
    expect(inputs.widthM).toBe(6);
  });

  it('extracts "4x3" → lengthM:4, widthM:3', () => {
    const { inputs } = regexParse('4x3 patio with no edging');
    expect(inputs.lengthM).toBe(4);
    expect(inputs.widthM).toBe(3);
  });

  it('extracts "3.5 by 4.2"', () => {
    const { inputs } = regexParse('patio 3.5 by 4.2 metres');
    expect(inputs.lengthM).toBeCloseTo(3.5);
    expect(inputs.widthM).toBeCloseTo(4.2);
  });

  it('extracts wall "5 by 1.2" → longer=length, shorter=height', () => {
    const { inputs } = regexParse('brick wall 5 by 1.2');
    expect(inputs.wallLengthM).toBe(5);
    expect(inputs.wallHeightM).toBe(1.2);
  });
});

describe('regexParse — area extraction', () => {
  it('extracts "36 m2" → areaM2:36', () => {
    const { inputs } = regexParse('36 m2 patio');
    expect(inputs.areaM2).toBe(36);
  });

  it('extracts "20 sq m" → areaM2:20', () => {
    const { inputs } = regexParse('20 sq m patio flag');
    expect(inputs.areaM2).toBe(20);
  });

  it('extracts "25 square metres"', () => {
    const { inputs } = regexParse('paving 25 square metres');
    expect(inputs.areaM2).toBe(25);
  });
});

describe('regexParse — feet conversion', () => {
  it('converts "6 foot by 6 foot" patio to metres', () => {
    const { inputs } = regexParse('patio 6 foot by 6 foot');
    expect(inputs.lengthM).toBeCloseTo(1.83, 1);
    expect(inputs.widthM).toBeCloseTo(1.83, 1);
  });

  it('converts "10 ft by 6 ft"', () => {
    const { inputs } = regexParse('patio 10 ft by 6 ft');
    expect(inputs.lengthM).toBeCloseTo(3.05, 1);
    expect(inputs.widthM).toBeCloseTo(1.83, 1);
  });
});

// ─── regexParse — edging detection ───────────────────────────────────────────

describe('regexParse — edgingType', () => {
  it('detects "brick edging" → brick', () => {
    const { inputs } = regexParse('6x6 patio with brick edging');
    expect(inputs.edgingType).toBe('brick');
  });

  it('detects "single skin brick edging"', () => {
    const { inputs } = regexParse('6 by 6 patio single skin');
    expect(inputs.edgingType).toBe('brick');
  });

  it('detects "no edging" → none', () => {
    const { inputs } = regexParse('patio no edging 6x4');
    expect(inputs.edgingType).toBe('none');
  });

  it('detects "block edging"', () => {
    const { inputs } = regexParse('patio 6x4 block edging');
    expect(inputs.edgingType).toBe('block');
  });
});

// ─── regexParse — skin / brickOrBlock ────────────────────────────────────────

describe('regexParse — skin and brickOrBlock', () => {
  it('detects "single skin"', () => {
    const { inputs } = regexParse('brick wall 5x1.2 single skin');
    expect(inputs.skin).toBe('single');
  });

  it('detects "double skin"', () => {
    const { inputs } = regexParse('brick wall double skin 5m long 1m high');
    expect(inputs.skin).toBe('double');
  });

  it('detects "block" → brickOrBlock:block', () => {
    const { inputs } = regexParse('blockwork wall 4 by 1.5');
    expect(inputs.brickOrBlock).toBe('block');
  });

  it('defaults to brick when no explicit brick/block mentioned for a wall', () => {
    const { inputs } = regexParse('garden wall 5 by 1.2');
    // brickOrBlock may be undefined (not set) — that is fine, engine defaults to brick
    expect(['brick', undefined]).toContain(inputs.brickOrBlock);
  });
});

// ─── regexParse — missing[] ───────────────────────────────────────────────────

describe('regexParse — missing[] keys', () => {
  it('includes "areaM2" when patio has no dimensions', () => {
    const { missing } = regexParse('back garden patio');
    expect(missing).toContain('areaM2');
  });

  it('no missing keys when patio has lengthM + widthM', () => {
    const { missing } = regexParse('6 by 6 metre patio');
    expect(missing).not.toContain('areaM2');
  });

  it('includes wallLengthM and wallHeightM when wall has no dimensions', () => {
    const { missing } = regexParse('brick wall in the back garden');
    expect(missing).toContain('wallLengthM');
    expect(missing).toContain('wallHeightM');
  });

  it('no missing keys for a fully specified wall', () => {
    const { missing } = regexParse('brick wall 5 by 1.2 single skin');
    expect(missing).toHaveLength(0);
  });
});

// ─── regexParse — edge cases ─────────────────────────────────────────────────

describe('regexParse — edge cases', () => {
  it('returns null calcType for empty string', () => {
    const { calcType, inputs, missing } = regexParse('');
    expect(calcType).toBeNull();
    expect(inputs).toEqual({});
    expect(missing).toEqual([]);
  });

  it('always returns parseMethod: "regex"', () => {
    const { parseMethod } = regexParse('any text here');
    expect(parseMethod).toBe('regex');
  });
});

// ─── parseEstimate — AI path ──────────────────────────────────────────────────

describe('parseEstimate — AI path (mocked fetch)', () => {
  it('returns AI-parsed result when proxy responds correctly', async () => {
    const aiPayload = {
      calcType: 'patio',
      inputs: { lengthM: 6, widthM: 6, edgingType: 'brick' },
      missing: [],
      assumptionOverrides: {},
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        content: [{ type: 'text', text: JSON.stringify(aiPayload) }],
      }),
    });

    const result = await parseEstimate('6 by 6 patio single skin brick edging');
    expect(result.calcType).toBe('patio');
    expect(result.inputs.lengthM).toBe(6);
    expect(result.inputs.edgingType).toBe('brick');
    expect(result.parseMethod).toBe('ai');
    expect(result.missing).toEqual([]);
  });

  it('falls back to regex when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const result = await parseEstimate('6 by 6 metre patio');
    expect(result.parseMethod).toBe('regex');
    expect(result.calcType).toBe('patio');
  });

  it('falls back to regex when proxy returns non-ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    });

    const result = await parseEstimate('patio 6x6');
    expect(result.parseMethod).toBe('regex');
  });
});

describe('parseEstimate — unauthenticated path', () => {
  it('falls back to regex when no session token', async () => {
    // Override the supabase mock to return no token for this test
    const { supabase } = await import('../supabase.js');
    supabase.auth.getSession.mockResolvedValueOnce({ data: { session: null } });

    global.fetch = vi.fn();

    const result = await parseEstimate('6 by 6 metre patio single skin brick edging');
    expect(result.parseMethod).toBe('regex');
    // Fetch should not have been called (no token = skip AI path)
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
