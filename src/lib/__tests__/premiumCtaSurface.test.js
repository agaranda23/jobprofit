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

  // ── Extension: the "Log a job" header button joins the premium group ────────
  it('promotes the Log-a-job header button (.new-btn) into the premium group', () => {
    // Present in the base grouped selector (just before the shared hue stops).
    expect(css).toMatch(/\.new-btn,\s*\n\.btn-premium \{\s*\n\s*\/\* hue stops/);
    // And in the one-shot sheen pseudo group.
    expect(css).toMatch(/\.new-btn::after,\s*\n\.btn-premium::after \{/);
    // And in the reduced-motion group (so it inherits the opt-out automatically).
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.new-btn,[\s\S]*\.btn-premium \{/
    );
  });
});

// ── Pipeline "Lit Accent" (Concept A) STATIC depth — no sweep, no loop ────────
describe('pipeline depth — Concept A "Lit Accent" (static)', () => {
  it('lifts the whole .stage-strip container with a hue-neutral elevation shadow', () => {
    // Container drop-shadow escapes overflow:hidden; grey (not accent-tinted).
    expect(css).toMatch(
      /\.stage-strip \{[\s\S]*box-shadow:[\s\S]*0 4px 12px -4px rgba\(0, 0, 0, 0\.28\)/
    );
    // Light-theme softened lift.
    expect(css).toMatch(
      /\[data-theme="light"\] \.stage-strip \{[\s\S]*0 3px 8px -4px rgba\(9, 12, 20, 0\.10\)/
    );
  });

  it('gives the selected tile an inset specular top hairline + bottom shade (survives overflow:hidden)', () => {
    expect(css).toMatch(
      /\.stage-tile--selected \{[\s\S]*inset 0 1px 0 rgba\(255, 255, 255, 0\.22\)[\s\S]*inset 0 -1px 0 rgba\(0, 0, 0, 0\.16\)/
    );
  });

  it('uses a TOP-ANCHORED per-stage gradient (top stop = canonical token, so text contrast never regresses)', () => {
    // Top stops stay at the canonical --stage-* token through 42%; only the foot darkens.
    expect(css).toContain(
      'linear-gradient(180deg, var(--stage-lead) 0%, var(--stage-lead) 42%, #2157CF 100%)'
    );
    expect(css).toContain(
      'linear-gradient(180deg, var(--stage-quoted) 0%, var(--stage-quoted) 42%, #0C91A1 100%)'
    );
    expect(css).toContain(
      'linear-gradient(180deg, var(--stage-paid) 0%, var(--stage-paid) 42%, #127136 100%)'
    );
  });

  it('adds a barely-there lit top edge to unselected tiles WITHOUT dropping the divider', () => {
    expect(css).toContain(
      'inset -1px 0 0 var(--border), inset 0 1px 0 rgba(255,255,255,0.04)'
    );
  });

  it('fixes light-theme selected-tile legibility with a dark-ink override (text only, palette locked)', () => {
    // The LIGHTER fills (Quoted/Invoiced/Overdue) flip to dark ink #1E3A5F in
    // light theme so white-on-fill text stops failing WCAG AA. Fills untouched.
    // On (indigo) is EXCLUDED — its fill is dark enough that white beats dark ink.
    for (const stage of ['quoted', 'invoiced', 'overdue']) {
      expect(css).toContain(
        `[data-theme="light"] .stage-tile--${stage}.stage-tile--selected .stage-tile-name`
      );
    }
    // On keeps white — no dark-ink override (verified by render: white wins on indigo).
    expect(css).not.toContain(
      '[data-theme="light"] .stage-tile--on.stage-tile--selected .stage-tile-name'
    );
    expect(css).toMatch(
      /\[data-theme="light"\] \.stage-tile--overdue\.stage-tile--selected \.stage-tile-amount \{\s*\n\s*color: #1E3A5F;/
    );
    // The override must NOT touch the fill (palette stays locked to --stage-*).
    expect(css).not.toMatch(
      /\[data-theme="light"\] \.stage-tile--\w+\.stage-tile--selected \{\s*\n\s*background/
    );
  });

  it('adds NO light-sweep pseudo, NO keyframes and NO looping animation to the strip/tiles', () => {
    // No ::after glare pseudo on the pipeline surfaces.
    expect(css).not.toMatch(/\.stage-tile[^{]*::after\s*\{/);
    expect(css).not.toMatch(/\.stage-strip[^{]*::after\s*\{/);
    // No stage-specific keyframes / infinite animation anywhere.
    expect(css).not.toMatch(/@keyframes\s+stage-/);
    expect(css).not.toMatch(/\.stage-(strip|tile)[\s\S]{0,400}animation:[^;]*infinite/);
    // The only motion on a tile is the pre-existing one-shot 150ms background fade.
    expect(css).toMatch(/\.stage-tile \{[\s\S]*transition: background 0\.15s/);
  });
});
