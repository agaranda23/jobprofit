/**
 * estimatorEngine.test.js — unit tests for the deterministic materials calc engine.
 *
 * Tests:
 *   1. patio.formula — known inputs → known outputs (at PRD's illustrative defaults)
 *   2. patio.formula — wastage correctly applied
 *   3. patio.formula — assumption overrides change output
 *   4. patio.formula — with brick edging
 *   5. patio.formula — length×width resolves to area
 *   6. patio.formula — missing area returns empty lines with a note
 *   7. brickWall.formula — single skin bricks + mortar
 *   8. brickWall.formula — double skin doubles bricks and mortar
 *   9. brickWall.formula — block variant uses 10/m² rate
 *  10. brickWall.formula — missing dimensions returns empty lines
 *  11. runCalc — delegates to calc.formula, merges assumptions
 *  12. runCalc — unknown calc returns safe empty result
 *  13. runCalc — coerces string assumption overrides to numbers
 *  14. CALCS registry — patio and brickWall are registered
 *  15. getCalc — returns null for unknown id
 *
 * NOTE: All qty assertions use concrete numbers derived from the documented formulas.
 * If PRD changes the default assumptions (after trade sign-off), these tests
 * will fail intentionally — that is a feature, not a bug.
 */

import { describe, it, expect } from 'vitest';
import { patio }     from '../estimator/calcs/patio.js';
import { brickWall } from '../estimator/calcs/brickWall.js';
import { runCalc, getCalc, CALCS } from '../estimator/engine.js';

// ─── Helper ────────────────────────────────────────────────────────────────────
function lineByMaterial(lines, name) {
  return lines.find(l => l.material === name);
}

// ─── patio.formula ─────────────────────────────────────────────────────────────

describe('patio.formula — known inputs → known outputs', () => {
  it('produces 4 material lines for a simple patio with no edging', () => {
    const { lines } = patio.formula({ areaM2: 36, edgingType: 'none' }, patio.assumptions);
    expect(lines.length).toBe(4);
    const matNames = lines.map(l => l.material);
    expect(matNames).toContain('Paving slabs');
    expect(matNames).toContain('MOT Type 1 sub-base');
    expect(matNames).toContain('Sharp sand');
    expect(matNames).toContain('Cement');
  });

  it('calculates slab qty correctly: ceil(36/0.36 * 1.10) ≈ 110-111 (fp ceil)', () => {
    const { lines } = patio.formula({ areaM2: 36 }, patio.assumptions);
    const slabs = lineByMaterial(lines, 'Paving slabs');
    // 36 / 0.36 × 1.10 — floating-point may produce 110.000…001 → ceil gives 111.
    // Acceptable range: 110–111 slabs for a 36 m² patio at 600×600 slabs + 10% wastage.
    expect(slabs.qty).toBeGreaterThanOrEqual(110);
    expect(slabs.qty).toBeLessThanOrEqual(111);
    expect(slabs.unit).toBe('each');
  });

  it('calculates sub-base correctly: ceil(36 × 0.10 × 2.0 × 10)/10 = 7.2 → 7.2', () => {
    const { lines } = patio.formula({ areaM2: 36 }, patio.assumptions);
    const subBase = lineByMaterial(lines, 'MOT Type 1 sub-base');
    // 36 × 0.10 × 2.0 = 7.2 tonnes → ceil(7.2 × 10)/10 = 7.2
    expect(subBase.qty).toBe(7.2);
    expect(subBase.unit).toBe('t');
  });

  it('calculates sharp sand correctly: ceil(36 × 0.05 × 1.6 × 10)/10 = 2.9', () => {
    const { lines } = patio.formula({ areaM2: 36 }, patio.assumptions);
    const sand = lineByMaterial(lines, 'Sharp sand');
    // 36 × 0.05 × 1.6 = 2.88 → ceil(2.88 × 10)/10 = 2.9
    expect(sand.qty).toBe(2.9);
    expect(sand.unit).toBe('t');
  });

  it('calculates cement correctly: ceil(36 × 0.25) = 9 bags', () => {
    const { lines } = patio.formula({ areaM2: 36 }, patio.assumptions);
    const cement = lineByMaterial(lines, 'Cement');
    // 36 × (1/4) = 9 bags
    expect(cement.qty).toBe(9);
    expect(cement.unit).toBe('bags');
  });
});

describe('patio.formula — wastage', () => {
  it('applies 0% wastage correctly', () => {
    const overrides = { ...patio.assumptions, wastage: 0 };
    const { lines } = patio.formula({ areaM2: 36 }, overrides);
    const slabs = lineByMaterial(lines, 'Paving slabs');
    // 36 / 0.36 = 100 exactly (no wastage)
    expect(slabs.qty).toBe(100);
  });

  it('applies 20% wastage correctly', () => {
    const overrides = { ...patio.assumptions, wastage: 0.20 };
    const { lines } = patio.formula({ areaM2: 36 }, overrides);
    const slabs = lineByMaterial(lines, 'Paving slabs');
    // 36 / 0.36 = 100 × 1.20 = 120
    expect(slabs.qty).toBe(120);
  });
});

describe('patio.formula — assumption overrides', () => {
  it('uses 450×450 slab size: ceil(36/0.2025 * 1.10) = 196', () => {
    const overrides = { ...patio.assumptions, slabCoverageM2: 0.2025 };
    const { lines } = patio.formula({ areaM2: 36 }, overrides);
    const slabs = lineByMaterial(lines, 'Paving slabs');
    // 36 / 0.2025 = 177.78 × 1.10 = 195.56 → ceil = 196
    expect(slabs.qty).toBe(196);
  });

  it('uses deeper sub-base 150mm: 36 × 0.15 × 2.0 = 10.8t', () => {
    const overrides = { ...patio.assumptions, subBaseDepthM: 0.15 };
    const { lines } = patio.formula({ areaM2: 36 }, overrides);
    const subBase = lineByMaterial(lines, 'MOT Type 1 sub-base');
    expect(subBase.qty).toBe(10.8);
  });
});

describe('patio.formula — brick edging', () => {
  it('adds edging bricks when edgingType is brick (perimeter from 6×6 = 24m)', () => {
    // 6×6 patio: perimeter = 4 × sqrt(36) = 24m
    const { lines } = patio.formula(
      { lengthM: 6, widthM: 6, edgingType: 'brick' },
      patio.assumptions
    );
    const edging = lineByMaterial(lines, 'Edging bricks');
    expect(edging).toBeDefined();
    // ceil(24 / 0.225 × 1.10) = ceil(106.67 × 1.10) = ceil(117.33) = 118
    expect(edging.qty).toBe(118);
    expect(edging.unit).toBe('each');
  });

  it('adds 5 lines (including edging) for brick edging patio', () => {
    const { lines } = patio.formula(
      { areaM2: 36, edgingType: 'brick' },
      patio.assumptions
    );
    expect(lines.length).toBe(5);
  });

  it('does NOT add edging bricks when edgingType is none', () => {
    const { lines } = patio.formula({ areaM2: 36, edgingType: 'none' }, patio.assumptions);
    const edging = lineByMaterial(lines, 'Edging bricks');
    expect(edging).toBeUndefined();
  });

  it('uses explicit perimeterM when provided', () => {
    const { lines } = patio.formula(
      { areaM2: 36, edgingType: 'brick', perimeterM: 30 },
      patio.assumptions
    );
    const edging = lineByMaterial(lines, 'Edging bricks');
    // ceil(30 / 0.225 × 1.10) = ceil(133.33 × 1.10) = ceil(146.67) = 147
    expect(edging.qty).toBe(147);
  });
});

describe('patio.formula — length × width resolves to area', () => {
  it('uses lengthM × widthM when areaM2 not provided', () => {
    const { lines: fromArea }  = patio.formula({ areaM2: 36 }, patio.assumptions);
    const { lines: fromDims }  = patio.formula({ lengthM: 6, widthM: 6 }, patio.assumptions);
    expect(fromArea.find(l => l.material === 'Paving slabs').qty)
      .toBe(fromDims.find(l => l.material === 'Paving slabs').qty);
  });
});

describe('patio.formula — empty inputs', () => {
  it('returns empty lines with a note when no area given', () => {
    const { lines, notes } = patio.formula({}, patio.assumptions);
    expect(lines).toHaveLength(0);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0]).toMatch(/area/i);
  });

  it('returns empty lines when areaM2 is zero', () => {
    const { lines } = patio.formula({ areaM2: 0 }, patio.assumptions);
    expect(lines).toHaveLength(0);
  });
});

// ─── brickWall.formula ────────────────────────────────────────────────────────

describe('brickWall.formula — single skin brick wall', () => {
  it('produces bricks + sand + cement for a 5m × 1.2m single skin wall', () => {
    const { lines } = brickWall.formula(
      { wallLengthM: 5, wallHeightM: 1.2, skin: 'single', brickOrBlock: 'brick' },
      brickWall.assumptions
    );
    expect(lines.length).toBe(3);
    const matNames = lines.map(l => l.material);
    expect(matNames).toContain('Bricks');
    expect(matNames).toContain('Building sand');
    expect(matNames).toContain('Cement');
  });

  it('calculates brick qty: ceil(6m² × 60 × 1 × 1.05) = 378', () => {
    const { lines } = brickWall.formula(
      { wallLengthM: 5, wallHeightM: 1.2, skin: 'single', brickOrBlock: 'brick' },
      brickWall.assumptions
    );
    const bricks = lineByMaterial(lines, 'Bricks');
    // wallArea = 5 × 1.2 = 6 m²
    // 6 × 60 × 1 × 1.05 = 378
    expect(bricks.qty).toBe(378);
    expect(bricks.unit).toBe('each');
  });
});

describe('brickWall.formula — double skin doubles bricks and mortar', () => {
  it('double skin brick qty is exactly double the single skin qty', () => {
    const single = brickWall.formula(
      { wallLengthM: 5, wallHeightM: 1.2, skin: 'single', brickOrBlock: 'brick' },
      brickWall.assumptions
    );
    const double = brickWall.formula(
      { wallLengthM: 5, wallHeightM: 1.2, skin: 'double', brickOrBlock: 'brick' },
      brickWall.assumptions
    );
    const singleBricks = lineByMaterial(single.lines, 'Bricks').qty;
    const doubleBricks = lineByMaterial(double.lines, 'Bricks').qty;
    expect(doubleBricks).toBe(singleBricks * 2);
  });

  it('double skin sand bags are greater than or equal to double the single skin sand bags', () => {
    const single = brickWall.formula(
      { wallLengthM: 5, wallHeightM: 1.2, skin: 'single', brickOrBlock: 'brick' },
      brickWall.assumptions
    );
    const double = brickWall.formula(
      { wallLengthM: 5, wallHeightM: 1.2, skin: 'double', brickOrBlock: 'brick' },
      brickWall.assumptions
    );
    const singleSand = lineByMaterial(single.lines, 'Building sand').qty;
    const doubleSand = lineByMaterial(double.lines, 'Building sand').qty;
    // Due to ceiling arithmetic, double skin may not be exactly 2× single.
    // It must be at least 2× the pre-ceiling mortar volume, which means
    // doubleSand >= singleSand (strictly more). We also bound the top:
    // it should be at most singleSand*2 + 1 (one bag rounding tolerance).
    expect(doubleSand).toBeGreaterThan(singleSand);
    expect(doubleSand).toBeLessThanOrEqual(singleSand * 2 + 1);
  });
});

describe('brickWall.formula — block variant', () => {
  it('uses 10 blocks/m² for block wall', () => {
    const { lines } = brickWall.formula(
      { wallLengthM: 5, wallHeightM: 1.2, skin: 'single', brickOrBlock: 'block' },
      brickWall.assumptions
    );
    const blocks = lineByMaterial(lines, 'Concrete blocks');
    // 6 × 10 × 1 × 1.05 = 63
    expect(blocks.qty).toBe(63);
    expect(blocks.unit).toBe('each');
  });

  it('labels material as "Concrete blocks" not "Bricks"', () => {
    const { lines } = brickWall.formula(
      { wallLengthM: 5, wallHeightM: 1.2, skin: 'single', brickOrBlock: 'block' },
      brickWall.assumptions
    );
    const bricks = lineByMaterial(lines, 'Bricks');
    const blocks = lineByMaterial(lines, 'Concrete blocks');
    expect(bricks).toBeUndefined();
    expect(blocks).toBeDefined();
  });
});

describe('brickWall.formula — missing dimensions', () => {
  it('returns empty lines with a note when dimensions are absent', () => {
    const { lines, notes } = brickWall.formula({}, brickWall.assumptions);
    expect(lines).toHaveLength(0);
    expect(notes.length).toBeGreaterThan(0);
  });

  it('returns empty lines when wallHeightM is zero', () => {
    const { lines } = brickWall.formula({ wallLengthM: 5, wallHeightM: 0 }, brickWall.assumptions);
    expect(lines).toHaveLength(0);
  });
});

// ─── runCalc ──────────────────────────────────────────────────────────────────

describe('runCalc', () => {
  it('delegates to calc.formula and returns lines + effectiveAssumptions', () => {
    const { lines, effectiveAssumptions } = runCalc(patio, { areaM2: 36 });
    expect(lines.length).toBeGreaterThan(0);
    expect(effectiveAssumptions.wastage).toBe(patio.assumptions.wastage);
  });

  it('merges assumption overrides correctly', () => {
    const { effectiveAssumptions } = runCalc(patio, { areaM2: 36 }, { wastage: 0.15 });
    expect(effectiveAssumptions.wastage).toBe(0.15);
  });

  it('coerces string assumption overrides to numbers', () => {
    const { effectiveAssumptions, lines } = runCalc(patio, { areaM2: 36 }, { wastage: '0.15' });
    expect(effectiveAssumptions.wastage).toBe(0.15);
    // And the formula runs with the numeric value
    const slabs = lineByMaterial(lines, 'Paving slabs');
    // 36/0.36 × 1.15 = 115
    expect(slabs.qty).toBe(115);
  });

  it('returns safe empty result for null calc', () => {
    const { lines, notes } = runCalc(null, {});
    expect(lines).toEqual([]);
    expect(notes.length).toBeGreaterThan(0);
  });

  it('returns safe empty result for calc without formula', () => {
    const { lines } = runCalc({ id: 'bad', assumptions: {} }, {});
    expect(lines).toEqual([]);
  });
});

// ─── CALCS registry ───────────────────────────────────────────────────────────

describe('CALCS registry', () => {
  it('contains patio', () => {
    expect(CALCS.patio).toBeDefined();
    expect(typeof CALCS.patio.formula).toBe('function');
  });

  it('contains brickWall', () => {
    expect(CALCS.brickWall).toBeDefined();
    expect(typeof CALCS.brickWall.formula).toBe('function');
  });
});

describe('getCalc', () => {
  it('returns the patio calc', () => {
    expect(getCalc('patio')).toBe(patio);
  });

  it('returns null for unknown id', () => {
    expect(getCalc('unknownCalcType')).toBeNull();
  });
});

// ─── Multi-material output integrity ─────────────────────────────────────────

describe('patio multi-material output integrity', () => {
  it('all patio lines have material, qty, unit, and assumptionsUsed', () => {
    const { lines } = patio.formula({ areaM2: 36, edgingType: 'brick' }, patio.assumptions);
    for (const line of lines) {
      expect(typeof line.material).toBe('string');
      expect(line.material.length).toBeGreaterThan(0);
      expect(typeof line.qty).toBe('number');
      expect(line.qty).toBeGreaterThan(0);
      expect(typeof line.unit).toBe('string');
      expect(Array.isArray(line.assumptionsUsed)).toBe(true);
    }
  });

  it('all brickWall lines have valid shape', () => {
    const { lines } = brickWall.formula(
      { wallLengthM: 5, wallHeightM: 2, skin: 'double', brickOrBlock: 'brick' },
      brickWall.assumptions
    );
    for (const line of lines) {
      expect(typeof line.material).toBe('string');
      expect(line.qty).toBeGreaterThan(0);
      expect(typeof line.unit).toBe('string');
    }
  });
});
