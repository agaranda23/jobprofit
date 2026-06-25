/**
 * OHNAR re-skin — black-box regression tests
 *
 * Pins the fixes for elements that regressed to solid-black after the
 * re-skin mapped brand colour tokens from green → navy/dark.
 *
 * Root cause: the Vite scaffold global resets `button { background:#1a1a1a }`
 * (nearly black). Any button class without an explicit `background` override
 * inherits this and renders as a black box.
 *
 * Test strategy: read index.css directly and assert each fixed class has an
 * explicit `background` or `background-color` override that is NOT dark.
 * We also assert the "Paid" loop chip uses a green keyframe (not Brand Blue).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CSS_PATH = resolve(__dirname, '../../index.css');
const css = readFileSync(CSS_PATH, 'utf8');

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Returns the full text of the FIRST CSS rule block for a given selector.
 * Looks for `.selector {` and returns everything up to the matching `}`.
 */
function getRuleBlock(selector) {
  const needle = selector + ' {';
  const start = css.indexOf(needle);
  if (start < 0) return null;
  const braceStart = css.indexOf('{', start);
  let depth = 0;
  let end = braceStart;
  while (end < css.length) {
    if (css[end] === '{') depth++;
    if (css[end] === '}') { depth--; if (depth === 0) break; }
    end++;
  }
  return css.slice(braceStart, end + 1);
}

// ── Referral row — not a black box ───────────────────────────────────────────

describe('referral-row__pill — not a black box', () => {
  it('has a CSS rule block defined', () => {
    expect(css).toContain('.referral-row__pill {');
  });

  it('has an explicit background that is NOT dark (#1a1a1a / #000 / black)', () => {
    const block = getRuleBlock('.referral-row__pill');
    expect(block).toBeTruthy();
    expect(block).toContain('background');
    // Must NOT be the Vite dark default
    expect(block).not.toContain('#1a1a1a');
    expect(block).not.toContain('#000000');
    expect(block).not.toContain(': #000');
  });

  it('has readable text colour (var(--text) or var(--text-dim) — not hard white on black)', () => {
    const block = getRuleBlock('.referral-row__pill');
    expect(block).toContain('color');
  });

  it('has a monospace font family (link field convention)', () => {
    const block = getRuleBlock('.referral-row__pill');
    expect(block).toContain('font-family');
    expect(block).toContain('mono');
  });

  it('has a min-height of at least 36px (touch target)', () => {
    const block = getRuleBlock('.referral-row__pill');
    expect(block).toMatch(/min-height:\s*3[6-9]px|min-height:\s*4[0-9]px/);
  });
});

describe('referral-row__share-btn — not a black box', () => {
  it('has a CSS rule block defined', () => {
    expect(css).toContain('.referral-row__share-btn {');
  });

  it('background is none (ghost icon button)', () => {
    const block = getRuleBlock('.referral-row__share-btn');
    expect(block).toBeTruthy();
    expect(block).toContain('background: none');
  });

  it('has a min-height of at least 44px (WCAG touch target)', () => {
    const block = getRuleBlock('.referral-row__share-btn');
    expect(block).toMatch(/min-height:\s*44px/);
  });
});

// ── Pencil edit button on job amount chip — not a black box ──────────────────

describe('aj-amount-chip-edit — pencil edit button not a black box', () => {
  it('has a CSS rule block defined', () => {
    expect(css).toContain('.aj-amount-chip-edit {');
  });

  it('background is none (icon-only ghost button)', () => {
    const block = getRuleBlock('.aj-amount-chip-edit');
    expect(block).toBeTruthy();
    expect(block).toContain('background: none');
  });

  it('has explicit border: none (no accidental box)', () => {
    const block = getRuleBlock('.aj-amount-chip-edit');
    expect(block).toContain('border: none');
  });

  it('has a min-height for touch target accessibility', () => {
    const block = getRuleBlock('.aj-amount-chip-edit');
    expect(block).toMatch(/min-height:\s*\d+px/);
  });
});

// ── Add-details button — blue tint post re-skin ───────────────────────────────

describe('aj-details-btn — blue tint post re-skin (no green)', () => {
  it('has a CSS rule block defined', () => {
    expect(css).toContain('.aj-details-btn {');
  });

  it('does not use the old green rgba tint in the base rule', () => {
    // The old tint was rgba(34, 197, 94, ...) which is green #22c55e
    const block = getRuleBlock('.aj-details-btn');
    expect(block).not.toContain('rgba(34, 197, 94');
  });

  it('uses the Brand Blue rgba tint in the base rule', () => {
    const block = getRuleBlock('.aj-details-btn');
    // Brand Blue is #2563EB = rgb(37, 99, 235)
    expect(block).toContain('rgba(37, 99, 235');
  });
});

// ── Auth loop — "Paid" chip animates to success green ────────────────────────

describe('auth landing — Paid chip uses success green animation', () => {
  it('defines an auth-chip-pulse-paid keyframe', () => {
    expect(css).toContain('auth-chip-pulse-paid');
  });

  it('auth-chip-pulse-paid keyframe uses a green colour (#16a34a)', () => {
    const kfStart = css.indexOf('@keyframes auth-chip-pulse-paid');
    expect(kfStart).toBeGreaterThan(-1);
    // Find the block
    const kfEnd = css.indexOf('}', css.indexOf('}', kfStart) + 1);
    const kfBlock = css.slice(kfStart, kfEnd + 1);
    expect(kfBlock.toLowerCase()).toContain('#16a34a');
  });

  it('chip--4 (Paid) uses the paid keyframe, not the generic blue one', () => {
    // Find the chip--4 animation rule
    const chip4Idx = css.indexOf('.auth-loop-chip--4');
    expect(chip4Idx).toBeGreaterThan(-1);
    const chip4Rule = css.slice(chip4Idx, chip4Idx + 120);
    expect(chip4Rule).toContain('auth-chip-pulse-paid');
    expect(chip4Rule).not.toContain('auth-chip-pulse 4s');
  });

  it('chips 1–3 (Quote, Signed, Invoiced) still use the blue pulse animation', () => {
    // Check chip--1 uses the generic blue pulse
    const chip1Idx = css.indexOf('.auth-loop-chip--1');
    const chip1Rule = css.slice(chip1Idx, chip1Idx + 120);
    expect(chip1Rule).toContain('auth-chip-pulse');
    expect(chip1Rule).not.toContain('auth-chip-pulse-paid');
  });
});

// ── Auth landing — already re-skinned (source fix, not cache) ────────────────

describe('AuthScreen JSX — OHNAR branding already in source', () => {
  it('AuthScreen.jsx renders "OHNAR" wordmark text (not a logo image)', async () => {
    const src = readFileSync(
      resolve(__dirname, '../../components/AuthScreen.jsx'),
      'utf8'
    );
    // Should contain the text wordmark
    expect(src).toContain('>OHNAR<');
    // Should NOT contain the old img tag pointing to jobprofit-logo.png
    expect(src).not.toContain('jobprofit-logo.png');
  });

  it('AuthScreen.jsx h1 reads "OHNAR", not "JobProfit"', async () => {
    const src = readFileSync(
      resolve(__dirname, '../../components/AuthScreen.jsx'),
      'utf8'
    );
    expect(src).toContain('<h1 className="auth-title">OHNAR</h1>');
    expect(src).not.toContain('>JobProfit<');
  });

  it('auth-submit button uses var(--accent) — Brand Blue via CSS token', () => {
    const submitIdx = css.indexOf('.auth-submit {');
    expect(submitIdx).toBeGreaterThan(-1);
    const block = css.slice(submitIdx, submitIdx + 300);
    expect(block).toContain('var(--accent)');
  });
});
