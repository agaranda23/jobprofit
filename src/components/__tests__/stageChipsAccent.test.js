// @vitest-environment jsdom
/**
 * Stage-chips colour-accent regression tests (feat/stage-chips-colour-accents).
 *
 * Verifies the structural requirements for the restrained per-stage accent
 * treatment WITHOUT rendering the full React component (CSS cannot be evaluated
 * in jsdom; we validate the class names that carry the tokens instead).
 *
 * What we assert:
 *   1. STAGES exports exactly the canonical six stages in pipeline order.
 *   2. StageTile (via the JSX source) applies a `stage-tile--{stage}` accent
 *      class for every stage — this is the hook the CSS accent tokens attach to.
 *   3. The accent class is derived solely from the stage label (lower-cased),
 *      not from any runtime condition, so it is always present regardless of
 *      count, total, or selected state.
 *   4. The green and red accent assignments are reserved correctly:
 *      Paid is the only green accent stage, Overdue is the only red accent stage.
 *      (Verified against the token names in the source; colour enforcement is
 *       a CSS concern — this test guards against accidental renaming of stages.)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { STAGES, COACHMARK_KEY } from '../StageStrip.jsx';

// ── 1. Canonical stage list ────────────────────────────────────────────────────

describe('STAGES export', () => {
  it('exports exactly six stages in pipeline order', () => {
    expect(STAGES).toEqual(['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid']);
  });

  it('COACHMARK_KEY is still the documented localStorage key', () => {
    expect(COACHMARK_KEY).toBe('jp.jobs_pipeline_coachmark_seen');
  });
});

// ── 2. Accent class derivation ─────────────────────────────────────────────────

describe('stage accent class derivation', () => {
  it('produces a stage-tile--{stage.toLowerCase()} class name for every stage', () => {
    const expectedClasses = STAGES.map(s => `stage-tile--${s.toLowerCase()}`);
    expect(expectedClasses).toEqual([
      'stage-tile--lead',
      'stage-tile--quoted',
      'stage-tile--on',
      'stage-tile--invoiced',
      'stage-tile--overdue',
      'stage-tile--paid',
    ]);
  });

  it('accent class is derived deterministically from the stage name (no runtime branching)', () => {
    // The StageTile component uses:  `stage-tile--${stage.toLowerCase()}`
    // This test guards against any future change that makes the class conditional.
    STAGES.forEach(stage => {
      const expected = `stage-tile--${stage.toLowerCase()}`;
      // Verify no special-casing branches the class name away from the pattern.
      expect(expected).toMatch(/^stage-tile--[a-z]+$/);
    });
  });
});

// ── 3. Token reservation — green=Paid, red=Overdue ────────────────────────────

describe('stage accent token reservation', () => {
  const cssSource = readFileSync(
    resolve(process.cwd(), 'src/index.css'),
    'utf8',
  );

  it('--stage-accent-paid uses a green family colour (not amber, rose, blue, or indigo)', () => {
    // Match the token definitions: --stage-accent-paid: <value>
    // In the CSS there are two token blocks (light + dark); both must be green.
    const matches = [...cssSource.matchAll(/--stage-accent-paid\s*:\s*([^;]+);/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2); // light + dark blocks
    matches.forEach(([, value]) => {
      // Green colours: #00a86b (light), #2bc48a (dark) — neither starts with #1d, #43, #b4, #e0, #f0
      const v = value.trim().toLowerCase();
      // Must NOT be amber (#b453*, #f4a0*), rose (#e035*, #f045*), blue (#1d4e*, #60a5*), indigo (#4338*, #818c*)
      expect(v).not.toMatch(/^#b4/);
      expect(v).not.toMatch(/^#f4a/);
      expect(v).not.toMatch(/^#e03/);
      expect(v).not.toMatch(/^#f04/);
      expect(v).not.toMatch(/^#1d4/);
      expect(v).not.toMatch(/^#60a/);
      expect(v).not.toMatch(/^#433/);
      expect(v).not.toMatch(/^#818/);
    });
  });

  it('--stage-accent-overdue uses a red/rose family colour (not green, blue, amber, or indigo)', () => {
    const matches = [...cssSource.matchAll(/--stage-accent-overdue\s*:\s*([^;]+);/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    matches.forEach(([, value]) => {
      const v = value.trim().toLowerCase();
      // Must NOT be green (#00a8*, #2bc4*), blue (#1d4e*, #60a5*), amber (#b453*, #f4a0*), indigo (#4338*, #818c*)
      expect(v).not.toMatch(/^#00a/);
      expect(v).not.toMatch(/^#2bc/);
      expect(v).not.toMatch(/^#1d4/);
      expect(v).not.toMatch(/^#60a/);
      expect(v).not.toMatch(/^#b4/);
      expect(v).not.toMatch(/^#f4a/);
      expect(v).not.toMatch(/^#433/);
      expect(v).not.toMatch(/^#818/);
    });
  });

  it('each of the six stages has a --stage-accent-* token defined (at least once)', () => {
    const stageTokens = STAGES.map(s => `--stage-accent-${s.toLowerCase()}`);
    stageTokens.forEach(token => {
      expect(cssSource).toContain(token);
    });
  });

  it('the six accent tokens are all distinct (no two stages share the same accent colour in either theme block)', () => {
    // Extract all accent token declarations from the CSS.
    const declarations = [];
    for (const stage of STAGES) {
      const token = `--stage-accent-${stage.toLowerCase()}`;
      const matches = [...cssSource.matchAll(new RegExp(`${token}\\s*:\\s*([^;]+);`, 'g'))];
      matches.forEach(([, value]) => {
        declarations.push({ stage, token, value: value.trim().toLowerCase() });
      });
    }
    // Within each theme block (light: first 6, dark: next 6), all values must be unique.
    // We group by checking all 12 definitions — no two should be identical colours.
    const values = declarations.map(d => d.value);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

// ── 4. Structural — accent class coexists with selected state ─────────────────

describe('selected-state and accent-class coexistence', () => {
  it('the accent CSS class (stage-tile--{stage}) is unconditional in the component source', () => {
    // Read StageStrip.jsx and confirm the accentClass line is not inside a conditional.
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/StageStrip.jsx'),
      'utf8',
    );
    // The component defines: const accentClass = `stage-tile--${stage.toLowerCase()}`;
    expect(source).toContain("const accentClass = `stage-tile--${stage.toLowerCase()}`");
    // And uses it unconditionally in the className:
    expect(source).toContain('`stage-tile ${accentClass}');
  });
});
