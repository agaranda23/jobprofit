// @vitest-environment jsdom
/**
 * Stage-chips regression tests — source + CSS analysis (feat/stage-chip-rings).
 *
 * No React rendering here (JSX not available in .js files).
 * Render-based tests (counts, £ totals, marker colour, filter callback,
 * selected state) live alongside this file in stageChipRings.test.jsx.
 *
 * What this file asserts:
 *   1. STAGES exports exactly six stages in pipeline order.
 *   2. StageTile applies a stage-tile--{stage} class for every stage (unconditional).
 *   3. --stage-accent-* CSS tokens are still defined (tokens kept, bars removed).
 *   4. The old inset 0 3px 0 top-bar accent is absent from every resting-state
 *      stage-tile rule (superseded by .stage-marker dot).
 *   5. STAGE_TOKEN in StageStrip.jsx references the canonical --stage-* token for
 *      every stage, and the .stage-marker element is wired up correctly in source.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { STAGES, COACHMARK_KEY } from '../../lib/pipelineStages.js';

// ── shared source snapshots ───────────────────────────────────────────────────

const cssSource = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
const jsxSource = readFileSync(
  resolve(process.cwd(), 'src/components/StageStrip.jsx'),
  'utf8',
);

// ── 1. Canonical stage list ───────────────────────────────────────────────────

describe('STAGES export', () => {
  it('exports exactly six stages in pipeline order', () => {
    expect(STAGES).toEqual(['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid']);
  });

  it('COACHMARK_KEY is the documented localStorage key', () => {
    expect(COACHMARK_KEY).toBe('jp.jobs_pipeline_coachmark_seen');
  });
});

// ── 2. Accent class derivation ────────────────────────────────────────────────

describe('stage accent class derivation', () => {
  it('produces a stage-tile--{stage.toLowerCase()} class name for every stage', () => {
    expect(STAGES.map(s => `stage-tile--${s.toLowerCase()}`)).toEqual([
      'stage-tile--lead',
      'stage-tile--quoted',
      'stage-tile--on',
      'stage-tile--invoiced',
      'stage-tile--overdue',
      'stage-tile--paid',
    ]);
  });

  it('accent class is derived deterministically (no runtime branching)', () => {
    STAGES.forEach(stage => {
      expect(`stage-tile--${stage.toLowerCase()}`).toMatch(/^stage-tile--[a-z]+$/);
    });
  });

  it('the accent CSS class is unconditional in the component source', () => {
    expect(jsxSource).toContain("const accentClass = `stage-tile--${stage.toLowerCase()}`");
    expect(jsxSource).toContain('`stage-tile ${accentClass}');
  });
});

// ── 3. CSS token reservation — --stage-accent-* still defined ─────────────────

describe('stage accent tokens still defined in CSS (tokens kept, bars removed)', () => {
  it('--stage-accent-paid uses a green family colour', () => {
    const matches = [...cssSource.matchAll(/--stage-accent-paid\s*:\s*([^;]+);/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    matches.forEach(([, value]) => {
      const v = value.trim().toLowerCase();
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

  it('--stage-accent-overdue uses a red/rose family colour', () => {
    const matches = [...cssSource.matchAll(/--stage-accent-overdue\s*:\s*([^;]+);/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    matches.forEach(([, value]) => {
      const v = value.trim().toLowerCase();
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
    STAGES.map(s => `--stage-accent-${s.toLowerCase()}`).forEach(token => {
      expect(cssSource).toContain(token);
    });
  });

  it('the six accent tokens are all distinct', () => {
    const declarations = [];
    for (const stage of STAGES) {
      const token = `--stage-accent-${stage.toLowerCase()}`;
      const matches = [...cssSource.matchAll(new RegExp(`${token}\\s*:\\s*([^;]+);`, 'g'))];
      matches.forEach(([, value]) => declarations.push(value.trim().toLowerCase()));
    }
    expect(new Set(declarations).size).toBe(declarations.length);
  });
});

// ── 4. TOP-BAR ACCENT REMOVED from resting-state CSS rules ───────────────────

describe('top-bar accent bar removed from chip CSS', () => {
  // Each resting-state block is extracted and asserted to contain no
  // "inset 0 3px 0 var(--stage-accent-" pattern.

  it('stage-tile--lead resting rule has no inset top-bar accent', () => {
    const block = cssSource.match(
      /\.stage-tile--lead:not\(\.stage-tile--selected\)\s*\{([^}]*)\}/,
    );
    expect(block).not.toBeNull();
    expect(block[1]).not.toMatch(/inset\s+0\s+3px\s+0\s+var\(--stage-accent-/);
  });

  it('stage-tile--quoted resting rule has no inset top-bar accent', () => {
    const block = cssSource.match(
      /\.stage-tile--quoted:not\(\.stage-tile--selected\)\s*\{([^}]*)\}/,
    );
    expect(block).not.toBeNull();
    expect(block[1]).not.toMatch(/inset\s+0\s+3px\s+0\s+var\(--stage-accent-/);
  });

  it('stage-tile--on resting rule has no inset top-bar accent', () => {
    const block = cssSource.match(
      /\.stage-tile--on:not\(\.stage-tile--selected\)\s*\{([^}]*)\}/,
    );
    expect(block).not.toBeNull();
    expect(block[1]).not.toMatch(/inset\s+0\s+3px\s+0\s+var\(--stage-accent-/);
  });

  it('stage-tile--invoiced resting rule has no inset top-bar accent', () => {
    const block = cssSource.match(
      /\.stage-tile--invoiced:not\(\.stage-tile--selected\)\s*\{([^}]*)\}/,
    );
    expect(block).not.toBeNull();
    expect(block[1]).not.toMatch(/inset\s+0\s+3px\s+0\s+var\(--stage-accent-/);
  });

  it('stage-tile--overdue resting rule has no inset top-bar accent', () => {
    const block = cssSource.match(
      /\.stage-tile--overdue:not\(\.stage-tile--selected\)\s*\{([^}]*)\}/,
    );
    expect(block).not.toBeNull();
    expect(block[1]).not.toMatch(/inset\s+0\s+3px\s+0\s+var\(--stage-accent-/);
  });

  it('stage-tile--paid resting rule has no inset top-bar accent', () => {
    const block = cssSource.match(
      /\.stage-tile--paid:not\(\.stage-tile--selected\)\s*\{([^}]*)\}/,
    );
    expect(block).not.toBeNull();
    expect(block[1]).not.toMatch(/inset\s+0\s+3px\s+0\s+var\(--stage-accent-/);
  });
});

// ── 5. STAGE MARKER — source structure ───────────────────────────────────────

describe('stage marker element (.stage-marker) — source structure', () => {
  it('StageStrip.jsx renders a .stage-marker span (class present in source)', () => {
    expect(jsxSource).toContain('className={`stage-marker');
  });

  it('marker carries an inline --marker-colour custom property', () => {
    expect(jsxSource).toContain("'--marker-colour': STAGE_TOKEN[stage]");
  });

  it('STAGE_TOKEN covers all six stages', () => {
    const tokenBlock = jsxSource.match(/const STAGE_TOKEN\s*=\s*\{([^}]+)\}/s);
    expect(tokenBlock).not.toBeNull();
    STAGES.forEach(stage => {
      expect(tokenBlock[1]).toContain(stage + ':');
    });
  });

  it('each stage token references its canonical --stage-* CSS variable', () => {
    const tokenBlock = jsxSource.match(/const STAGE_TOKEN\s*=\s*\{([^}]+)\}/s);
    expect(tokenBlock).not.toBeNull();
    const block = tokenBlock[1];
    STAGES.forEach(stage => {
      expect(block).toContain(`var(--stage-${stage.toLowerCase()})`);
    });
  });

  it('marker applies stage-marker--selected class conditionally on selected', () => {
    expect(jsxSource).toContain('stage-marker--selected');
    expect(jsxSource).toMatch(/`stage-marker\$\{selected \? ' stage-marker--selected' : ''\}`/);
  });

  it('marker element is aria-hidden (decorative — not part of accessible label)', () => {
    expect(jsxSource).toContain('aria-hidden="true"');
  });

  it('.stage-marker CSS class is defined in index.css', () => {
    expect(cssSource).toContain('.stage-marker {');
  });

  it('.stage-marker--selected CSS class is defined in index.css', () => {
    expect(cssSource).toContain('.stage-marker--selected {');
  });
});
