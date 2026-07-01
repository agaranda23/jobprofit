/**
 * Regression lock for the move-picker swatch / job-card rail colour source.
 *
 * The move-picker swatches (WorkScreen.jsx StageChipDropdown, `--sw-hue`) and
 * the job-card left accent rail (`--jt-hue`) both read their colour from
 * STAGE_META[stage].hue. The founder's requirement: those colours MUST match
 * the Jobs pipeline header dots, which read from the canonical --stage-*
 * palette (StageStrip.jsx STAGE_TOKEN / index.css :root).
 *
 * This test reads WorkScreen.jsx source and asserts every STAGE_META.hue value
 * is the canonical var(--stage-slug) token — never an old pre-rebrand token
 * (the jp-, grn-, or danger families) and never a raw hex. This is the drift
 * guard that keeps the swatch locked to the pipeline palette.
 *
 * Pure Node env (no jsdom, no React render) so it stays out of the known
 * ERR_REQUIRE_ESM broken pool and gives a clean pass/fail signal.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workScreenPath = resolve(__dirname, '..', '..', 'screens', 'WorkScreen.jsx');
const src = readFileSync(workScreenPath, 'utf8');

// Canonical stage -> token mapping (must mirror StageStrip.jsx STAGE_TOKEN).
const EXPECTED_HUE = {
  Lead:     'var(--stage-lead)',
  Quoted:   'var(--stage-quoted)',
  On:       'var(--stage-on)',
  Invoiced: 'var(--stage-invoiced)',
  Overdue:  'var(--stage-overdue)',
  Paid:     'var(--stage-paid)',
};

// Isolate the STAGE_META object literal so we only assert against the map,
// not incidental occurrences elsewhere in the file.
function extractStageMetaBlock(source) {
  const start = source.indexOf('const STAGE_META = {');
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('};', start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 2);
}

describe('STAGE_META.hue is locked to the canonical --stage-* pipeline palette', () => {
  const block = extractStageMetaBlock(src);

  for (const [stage, token] of Object.entries(EXPECTED_HUE)) {
    it(`${stage}.hue === '${token}'`, () => {
      // Match e.g.  Lead:  { hue: 'var(--stage-lead)', ...
      const re = new RegExp(`${stage}\\s*:\\s*\\{[^}]*?hue\\s*:\\s*'([^']+)'`);
      const m = block.match(re);
      expect(m, `could not find hue for ${stage} in STAGE_META`).toBeTruthy();
      expect(m[1]).toBe(token);
    });
  }

  it('contains no old pre-rebrand hue tokens (--jp-*/--grn-*/--danger)', () => {
    // Extract just the hue field values and assert none reference dead tokens.
    const hueValues = [...block.matchAll(/hue\s*:\s*'([^']+)'/g)].map(m => m[1]);
    expect(hueValues).toHaveLength(6);
    for (const v of hueValues) {
      expect(v).not.toMatch(/var\(--jp-/);
      expect(v).not.toMatch(/var\(--grn-/);
      expect(v).not.toMatch(/var\(--danger/);
    }
  });

  it('has no raw hex in any hue field (must derive from a token)', () => {
    const hueValues = [...block.matchAll(/hue\s*:\s*'([^']+)'/g)].map(m => m[1]);
    for (const v of hueValues) {
      expect(v).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(v).toMatch(/^var\(--stage-/);
    }
  });
});
