/**
 * Money tabular-nums regression tests — PR #574
 *
 * Asserts that every £ money figure in index.css has `font-variant-numeric:
 * tabular-nums` set. This pins the consistency pass from PR #574 that completed
 * PR #563's Hanken Grotesk + tabular-nums money treatment.
 *
 * The hero profit figure (.profit-value) and several others were missing
 * tabular-nums, so the biggest number in the app rendered proportional while
 * row amounts were aligned. This test prevents that silently regressing.
 *
 * Strategy: parse index.css and assert the property is present in the rule
 * block for each class. Uses the same getRuleBlock() helper pattern as
 * ohnarReskinBlackBoxes.test.js.
 *
 * NOT tested here: non-money uses of --fs-money-hero (page titles, icon
 * sizes, close buttons) — those intentionally don't carry tabular-nums.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CSS_PATH = resolve(__dirname, '../../index.css');
const css = readFileSync(CSS_PATH, 'utf8');

/**
 * Returns the full text of a CSS rule block.
 *
 * findMode controls which occurrence to use:
 *   'first'  — (default) first occurrence — works for classes that appear once
 *   'last'   — last occurrence — use when light-theme overrides precede the base rule
 *   'standalone' — finds the occurrence where the selector is preceded by a
 *                  newline or start-of-string (not inside a compound selector)
 */
function getRuleBlock(selector, findMode = 'standalone') {
  const needle = selector + ' {';

  let pos = -1;
  if (findMode === 'last') {
    pos = css.lastIndexOf(needle);
  } else if (findMode === 'standalone') {
    // Find occurrences where the selector starts at a line boundary
    let search = 0;
    while (search < css.length) {
      const idx = css.indexOf(needle, search);
      if (idx < 0) break;
      // Check that the character immediately before the selector is a newline or start
      const charBefore = idx > 0 ? css[idx - 1] : '\n';
      if (charBefore === '\n' || charBefore === '\r' || idx === 0) {
        pos = idx;
        break;
      }
      search = idx + 1;
    }
    // If standalone not found, fall back to first
    if (pos < 0) pos = css.indexOf(needle);
  } else {
    pos = css.indexOf(needle);
  }

  if (pos < 0) return null;
  const braceStart = css.indexOf('{', pos);
  let depth = 0;
  let end = braceStart;
  while (end < css.length) {
    if (css[end] === '{') depth++;
    if (css[end] === '}') { depth--; if (depth === 0) break; }
    end++;
  }
  return css.slice(braceStart, end + 1);
}

// ── Hero profit figure — the biggest number in the app ────────────────────────

describe('.profit-value — hero profit figure has tabular-nums', () => {
  it('first .profit-value rule block exists', () => {
    expect(css).toContain('.profit-value {');
  });

  it('first .profit-value rule has font-variant-numeric: tabular-nums', () => {
    const block = getRuleBlock('.profit-value');
    expect(block).toBeTruthy();
    expect(block).toContain('tabular-nums');
  });

  it('first .profit-value rule uses var(--font-sans) — not mono', () => {
    const block = getRuleBlock('.profit-value');
    expect(block).toContain('var(--font-sans)');
    expect(block).not.toContain('var(--font-mono)');
  });

  it('second .profit-value override block also has tabular-nums', () => {
    // There are two .profit-value rules; find the second one
    const firstIdx = css.indexOf('.profit-value {');
    const secondIdx = css.indexOf('.profit-value {', firstIdx + 1);
    expect(secondIdx).toBeGreaterThan(-1);
    const braceStart = css.indexOf('{', secondIdx);
    let depth = 0;
    let end = braceStart;
    while (end < css.length) {
      if (css[end] === '{') depth++;
      if (css[end] === '}') { depth--; if (depth === 0) break; }
      end++;
    }
    const block = css.slice(braceStart, end + 1);
    expect(block).toContain('tabular-nums');
    expect(block).toContain('var(--font-sans)');
  });
});

// ── Money hero figures — --fs-money-hero with tabular-nums ───────────────────

const moneyHeroClasses = [
  '.money-hero__figure',
  '.money-hero__true-profit-figure',
  '.money-insight__value',
  '.money-vat__figure',
  '.money-true-profit__figure',
  '.money-tax-setaside__figure',
  '.money-tax-cis-block__figure',
  '.outstanding-hero-figure',
  '.avg-card-amount',
  '.modal-price',
  '.pro-upgrade-sheet__price',
  '.jd-hero-price',
];

describe('--fs-money-hero figures have tabular-nums', () => {
  moneyHeroClasses.forEach((cls) => {
    it(`${cls} has font-variant-numeric: tabular-nums`, () => {
      expect(css).toContain(cls + ' {');
      const block = getRuleBlock(cls);
      expect(block).toBeTruthy();
      expect(block).toContain('tabular-nums');
    });

    it(`${cls} uses var(--font-sans)`, () => {
      const block = getRuleBlock(cls);
      expect(block).not.toContain('var(--font-mono)');
    });
  });
});

// ── Money sm / row amounts — per-row £ figures ────────────────────────────────

const moneyRowClasses = [
  '.total-value',
  '.preview-amount',
  '.unpaid-amount',
  '.awaiting-job-amount',
  '.chase-row-amount',
  '.jd-chip-primary',
  '.jd-line-total-value',
  '.aj-amount-chip-value',
  '.pqv-line-total-value',
  '.pqv-flat-total-value',
  '.invoice-preview-amount',
];

describe('money row / sm figures have tabular-nums', () => {
  moneyRowClasses.forEach((cls) => {
    it(`${cls} has font-variant-numeric: tabular-nums`, () => {
      expect(css).toContain(cls + ' {');
      const block = getRuleBlock(cls);
      expect(block).toBeTruthy();
      expect(block).toContain('tabular-nums');
    });
  });

  it('.jt-price has font-variant-numeric: tabular-nums (base rule, not the compound .jt-pricerow override)', () => {
    // .jt-pricerow .jt-price { margin: 0; } precedes the standalone base rule
    // getRuleBlock 'standalone' mode finds the line-boundary occurrence
    const block = getRuleBlock('.jt-price', 'standalone');
    expect(block).toBeTruthy();
    expect(block).toContain('tabular-nums');
  });

  it('.receipt-total-value has font-variant-numeric: tabular-nums (base rule, not the light-theme colour override)', () => {
    // [data-theme="light"] .receipt-total-value precedes the standalone base rule
    const block = getRuleBlock('.receipt-total-value', 'last');
    expect(block).toBeTruthy();
    expect(block).toContain('tabular-nums');
  });
});

// ── Per-job profit value ───────────────────────────────────────────────────────

describe('.jd-profit-value — per-job profit figure', () => {
  it('has font-variant-numeric: tabular-nums', () => {
    const block = getRuleBlock('.jd-profit-value');
    expect(block).toBeTruthy();
    expect(block).toContain('tabular-nums');
  });

  it('uses var(--font-sans)', () => {
    const block = getRuleBlock('.jd-profit-value');
    expect(block).toContain('var(--font-sans)');
  });
});

// ── Quote input fields — typed £ amounts stay aligned while typing ────────────

describe('quote total input has tabular-nums (stays aligned while typing)', () => {
  it('.aj-quote-total-input has font-variant-numeric: tabular-nums', () => {
    // Use 'last' because a [data-theme="light"] override precedes the base rule
    const block = getRuleBlock('.aj-quote-total-input', 'last');
    expect(block).toBeTruthy();
    expect(block).toContain('tabular-nums');
  });

  it('.aj-quote-line-cost has font-variant-numeric: tabular-nums', () => {
    // Use 'last' because a [data-theme="light"] override precedes the base rule
    const block = getRuleBlock('.aj-quote-line-cost', 'last');
    expect(block).toBeTruthy();
    expect(block).toContain('tabular-nums');
  });
});

// ── recent-amount base class ──────────────────────────────────────────────────

describe('.recent-amount base class has tabular-nums', () => {
  it('has font-variant-numeric: tabular-nums on the base class', () => {
    const block = getRuleBlock('.recent-amount');
    expect(block).toBeTruthy();
    expect(block).toContain('tabular-nums');
  });
});

// ── Sanity: no money class uses --font-mono (Hanken is the canonical money font) ─

describe('canonical money treatment — Hanken (--font-sans) not mono', () => {
  const noMonoClasses = [
    '.profit-value',
    '.money-hero__figure',
    '.money-hero__true-profit-figure',
    '.total-value',
    '.jd-hero-price',
  ];

  noMonoClasses.forEach((cls) => {
    it(`${cls} does NOT use var(--font-mono)`, () => {
      const block = getRuleBlock(cls);
      if (block) {
        expect(block).not.toContain('var(--font-mono)');
      }
    });
  });
});
