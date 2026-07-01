/**
 * Source-assertion guard for the "Live Steel Blue" premium primary-button
 * system (Concept C), shipped in feat/premium-cta-live-steel-blue.
 *
 * This is a VISUAL + MOTION treatment with no runtime logic, so there is
 * nothing to unit-test behaviourally. Instead we assert the CSS *source* still
 * contains the load-bearing rules, so the premium surface can't be silently
 * deleted or regressed by an unrelated refactor of the 21k-line index.css.
 *
 * Pure Node — reads the file off disk. No DOM, no jsdom, no React, so this
 * stays out of the pre-broken ERR_REQUIRE_ESM / navigator suites.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(__dirname, '../../index.css');
const css = readFileSync(cssPath, 'utf8');

describe('premium CTA surface — "Live Steel Blue"', () => {
  it('ships the premium primary button system block', () => {
    expect(css).toContain('PREMIUM PRIMARY BUTTON SYSTEM');
    expect(css).toContain('Live Steel Blue');
  });

  it('applies the surface to the blue primary CTAs via grouped selector', () => {
    for (const sel of [
      '.jt-cta',
      '.btn-primary',
      '.foreman-cta-primary',
      '.foreman-pivot-btn',
      '.chase-row-btn-paid',
      '.btn-premium',
    ]) {
      expect(css).toContain(sel);
    }
  });

  it('uses the vertical steel-blue gradient stops, not a flat fill', () => {
    expect(css).toContain('--btn-top: #2f6ef2');
    expect(css).toContain('--btn-bot: #1d4fd0');
    expect(css).toContain(
      'linear-gradient(180deg, var(--btn-top) 0%, var(--btn-bot) 100%)'
    );
  });

  it('fires the sheen as a one-shot background-position transition (not an infinite keyframe)', () => {
    expect(css).toContain('transition: background-position 620ms ease');
    // The looping doc-specimen keyframe must NOT leak into production CSS.
    expect(css).not.toContain('@keyframes cC-sweep');
    expect(css).not.toContain('animation: cC-sweep');
  });

  it('has a tactile press (translateY depress), superseding the old opacity-only :active', () => {
    expect(css).toContain('transform: translateY(1px) scale(0.995)');
  });

  it('keeps a focus-visible ring for keyboard nav', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('0 0 0 4px #7aa8ff');
  });

  it('guarantees a 44px tap target on the surface itself', () => {
    expect(css).toContain('min-height: 44px');
  });

  it('hue-swaps the variants (rose / green / red) with the same depth recipe', () => {
    expect(css).toContain('.jt-cta--urgent');
    expect(css).toContain('.jt-cta--markpaid');
    expect(css).toContain('.btn-danger-filled');
    expect(css).toContain('--btn-top: #f2556a'); // urgent rose
    expect(css).toContain('--btn-top: #1f9d55'); // markpaid green
    expect(css).toContain('--btn-top: #f2564e'); // danger red
  });

  it('has a reduced-motion block that kills the sweep + press but keeps depth', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.btn-premium::after[\s\S]*display: none/
    );
  });
});
