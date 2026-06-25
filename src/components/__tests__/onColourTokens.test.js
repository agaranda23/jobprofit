/**
 * ON-COLOUR TOKEN PINNING TESTS
 *
 * Pins the three-part fix for OHNAR re-skin contrast bugs:
 *
 *  1. Global dark resets killed — bare `button { background:#1a1a1a }` and
 *     `:root { background-color:#242424 }` scaffold defaults are gone.
 *  2. on-* tokens defined — every coloured surface has a paired foreground
 *     token in :root (dark) and [data-theme="light"].
 *  3. Low-contrast failure sites fixed — chase button amber, placeholder
 *     double-opacity, margin cost input, jobs search placeholder.
 *
 * Test strategy: read index.css and JSX sources directly — no JSDOM required.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CSS_PATH    = resolve(__dirname, '../../index.css');
const css         = readFileSync(CSS_PATH, 'utf8');

const SYNC_BADGE_PATH = resolve(__dirname, '../SyncBadge.jsx');
const syncBadgeSrc    = readFileSync(SYNC_BADGE_PATH, 'utf8');

const CONSENT_PATH = resolve(__dirname, '../ConsentBanner.jsx');
const consentSrc   = readFileSync(CONSENT_PATH, 'utf8');

// ── helpers ──────────────────────────────────────────────────────────────────

/** Return the full text of the FIRST :root { … } block that contains the
 *  given declaration, or null if absent. */
function getRootBlock() {
  // Find the main :root block (the one with --bg / --surface tokens)
  const rootIdx = css.indexOf(':root {\n  --bg:');
  if (rootIdx < 0) return null;
  let depth = 0, i = css.indexOf('{', rootIdx);
  const start = i;
  while (i < css.length) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return css.slice(start, i + 1);
}

/** Return the text of the [data-theme="light"] block that contains --on-* tokens */
function getLightThemeBlock() {
  // The block that has --on-surface override for light
  const marker = '[data-theme="light"] {\n  color-scheme: light;';
  const idx = css.indexOf(marker);
  if (idx < 0) return null;
  let depth = 0, i = css.indexOf('{', idx);
  const start = i;
  while (i < css.length) {
    if (css[i] === '{') depth++;
    if (css[i] === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return css.slice(start, i + 1);
}

// ── 1. Global dark resets killed ─────────────────────────────────────────────

describe('global dark resets — killed', () => {
  it('bare button rule does NOT contain background-color: #1a1a1a', () => {
    // Find the bare `button {` rule block
    const idx = css.indexOf('\nbutton {\n');
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, css.indexOf('\n}', idx) + 2);
    expect(block).not.toContain('#1a1a1a');
    expect(block).not.toContain('background-color: #1a1a1a');
  });

  it('bare button rule uses transparent background (ghost default)', () => {
    const idx = css.indexOf('\nbutton {\n');
    const block = css.slice(idx, css.indexOf('\n}', idx) + 2);
    expect(block).toContain('background: transparent');
  });

  it(':root opening block (typography tokens) does NOT contain background-color: #242424', () => {
    // The Vite scaffold dark default was a bare declaration on :root { /* Brand typography */…}
    // It's removed; only token declarations live there now.
    const firstRootIdx = css.indexOf(':root {\n  /* Brand typography');
    expect(firstRootIdx).toBeGreaterThan(-1);
    // Grab just the first :root block
    let depth = 0, i = css.indexOf('{', firstRootIdx);
    const blockStart = i;
    while (i < css.length) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') { depth--; if (depth === 0) break; }
      i++;
    }
    const block = css.slice(blockStart, i + 1);
    expect(block).not.toMatch(/background-color:\s*#242424/);
  });

  it(':root opening block does NOT declare bare color: rgba(255,255,255,…) Vite default', () => {
    // The Vite scaffold white-text default is gone from the :root block.
    // Note: the value may appear as a CSS-variable fallback elsewhere — that is fine.
    // We only care it's not a bare property on :root.
    const firstRootIdx = css.indexOf(':root {\n  /* Brand typography');
    let depth = 0, i = css.indexOf('{', firstRootIdx);
    const blockStart = i;
    while (i < css.length) {
      if (css[i] === '{') depth++;
      if (css[i] === '}') { depth--; if (depth === 0) break; }
      i++;
    }
    const block = css.slice(blockStart, i + 1);
    // Must not have bare `color: rgba(255,255,255,0.87)` as a property (not inside var())
    expect(block).not.toMatch(/^\s*color:\s*rgba\(255,\s*255,\s*255,\s*0\.87\)/m);
  });

  it('bare button hover does NOT contain Vite purple (border-color: #646cff)', () => {
    // The bare `button:hover {` rule should no longer exist with #646cff
    expect(css).not.toMatch(/button:hover\s*\{[^}]*#646cff/);
  });
});

// ── 2. on-* tokens defined in :root (dark) ───────────────────────────────────

describe('on-colour tokens defined in :root (dark theme)', () => {
  const ROOT_TOKENS = [
    '--on-accent',
    '--on-navy',
    '--on-surface',
    '--on-bg',
    '--on-success',
    '--on-amber',
    '--on-danger',
    '--on-gold',
  ];

  ROOT_TOKENS.forEach(token => {
    it(`${token} is declared in :root`, () => {
      const rootBlock = getRootBlock();
      expect(rootBlock).not.toBeNull();
      expect(rootBlock).toContain(token);
    });
  });

  it('--on-accent is #ffffff (white on Brand Blue)', () => {
    const rootBlock = getRootBlock();
    expect(rootBlock).toMatch(/--on-accent:\s*#ffffff/i);
  });

  it('--on-navy is #ffffff (white on Deep Navy)', () => {
    const rootBlock = getRootBlock();
    expect(rootBlock).toMatch(/--on-navy:\s*#ffffff/i);
  });

  it('--on-success is #ffffff (white on green)', () => {
    const rootBlock = getRootBlock();
    expect(rootBlock).toMatch(/--on-success:\s*#ffffff/i);
  });

  it('--on-amber is a dark value (dark text on amber for 8:1 contrast)', () => {
    const rootBlock = getRootBlock();
    // Must NOT be white on amber — that fails. Must be a dark hex.
    expect(rootBlock).toMatch(/--on-amber:\s*#0b1320/i);
  });

  it('--on-danger is #ffffff (white on red)', () => {
    const rootBlock = getRootBlock();
    expect(rootBlock).toMatch(/--on-danger:\s*#ffffff/i);
  });
});

// ── 3. on-* tokens defined in [data-theme="light"] ───────────────────────────

describe('on-colour tokens defined in [data-theme="light"]', () => {
  it('--on-surface overridden for light (#111827 on white)', () => {
    const light = getLightThemeBlock();
    expect(light).not.toBeNull();
    expect(light).toContain('--on-surface');
    expect(light).toMatch(/--on-surface:\s*#111827/i);
  });

  it('--on-bg overridden for light (#111827 on near-white)', () => {
    const light = getLightThemeBlock();
    expect(light).toMatch(/--on-bg:\s*#111827/i);
  });

  it('--on-danger in light theme is #ffffff (white on red)', () => {
    const light = getLightThemeBlock();
    expect(light).toMatch(/--on-danger:\s*#ffffff/i);
  });

  it('--on-gold in light theme is #ffffff', () => {
    const light = getLightThemeBlock();
    expect(light).toMatch(/--on-gold:\s*#ffffff/i);
  });
});

// ── 4. Low-contrast failure sites fixed ──────────────────────────────────────

describe('chase-row-btn-chase — amber button uses --on-amber', () => {
  it('chase-row-btn-chase uses var(--on-amber) for color', () => {
    expect(css).toContain('.chase-row-btn-chase');
    const idx = css.indexOf('.chase-row-btn-chase');
    const block = css.slice(idx, css.indexOf('\n', idx) + 1);
    expect(block).toContain('var(--on-amber)');
    expect(block).not.toContain('#1a0e00');
  });
});

describe('ppc-amount-input placeholder — double opacity removed', () => {
  it('placeholder rule uses --text-dim without opacity reduction', () => {
    const idx = css.indexOf('.ppc-amount-input::placeholder');
    expect(idx).toBeGreaterThan(-1);
    const line = css.slice(idx, css.indexOf('\n', idx) + 1);
    expect(line).toContain('var(--text-dim)');
    expect(line).not.toContain('opacity');
  });
});

describe('aj-margin-cost-input placeholder — hardcoded #4B5563 replaced', () => {
  it('no hardcoded dark grey (#4B5563) anywhere in the placeholder rules', () => {
    // Was: .aj-margin-cost-input::placeholder { color: #4B5563; }
    // Both the base rule and any scoped override should use the token now.
    expect(css).not.toContain('.aj-margin-cost-input::placeholder { color: #4B5563');
    expect(css).not.toContain('.aj-margin-cost-input::placeholder { color: #4b5563');
  });

  it('base (unscoped) placeholder rule uses --text-dim', () => {
    // The base rule is on one line at ~line 13690. Find it by looking for the
    // unscoped selector (no [data-theme] prefix on the same line).
    const allIdx = [...css.matchAll(/\.aj-margin-cost-input::placeholder/g)].map(m => m.index);
    expect(allIdx.length).toBeGreaterThan(0);
    const baseIdx = allIdx.find(i => !css.slice(Math.max(0, i - 30), i).includes('[data-theme'));
    expect(baseIdx).not.toBeUndefined();
    const line = css.slice(baseIdx, css.indexOf('\n', baseIdx) + 1);
    expect(line).toContain('var(--text-dim)');
  });
});

describe('jobs-search placeholder — double opacity removed', () => {
  it('placeholder rule uses --text-dim without opacity', () => {
    const idx = css.indexOf('.jobs-search::placeholder');
    expect(idx).toBeGreaterThan(-1);
    // Grab the rule block
    const braceStart = css.indexOf('{', idx);
    const braceEnd   = css.indexOf('}', braceStart);
    const block = css.slice(braceStart, braceEnd + 1);
    expect(block).toContain('var(--text-dim)');
    expect(block).not.toContain('opacity');
  });
});

describe('receipt-preview — no hardcoded black background', () => {
  it('uses var(--surface) not #000', () => {
    const idx = css.indexOf('.receipt-preview {');
    expect(idx).toBeGreaterThan(-1);
    const braceStart = css.indexOf('{', idx);
    const braceEnd   = css.indexOf('}', braceStart);
    const block = css.slice(braceStart, braceEnd + 1);
    expect(block).not.toMatch(/background:\s*#000\b/);
    expect(block).toContain('var(--surface');
  });
});

// ── 5. SyncBadge accent button uses --on-accent ──────────────────────────────

describe('SyncBadge — accent buttons use --on-accent, not hardcoded dark green', () => {
  it('no inline color: "#0b1f10" on accent buttons (was illegible on blue)', () => {
    expect(syncBadgeSrc).not.toContain("color: '#0b1f10'");
    expect(syncBadgeSrc).not.toContain('color: "#0b1f10"');
  });

  it('uses var(--on-accent) for accent button text colour', () => {
    expect(syncBadgeSrc).toContain("color: 'var(--on-accent)'");
  });
});

// ── 6. ConsentBanner — tokens replace hardcoded colour fallbacks ──────────────

describe('ConsentBanner — token-driven colours', () => {
  it('banner background uses var(--surface) not var(--color-surface, #fff)', () => {
    expect(consentSrc).not.toContain('var(--color-surface,');
    expect(consentSrc).toContain("background: 'var(--surface");
  });

  it('banner text uses var(--text) not hardcoded #1a1a1a fallback', () => {
    expect(consentSrc).not.toContain('#1a1a1a');
    expect(consentSrc).toContain("color: 'var(--text)'");
  });

  it('"Accept all" button uses var(--on-accent) for text colour', () => {
    expect(consentSrc).toContain("color: 'var(--on-accent)'");
  });

  it('"Essentials only" ghost button uses var(--text) not a hardcoded colour', () => {
    // Find the onClick={handleEssentials} prop (unique to the ghost button JSX)
    const onClickIdx = consentSrc.indexOf('onClick={handleEssentials}');
    expect(onClickIdx).toBeGreaterThan(-1);
    // Look ahead 300 chars — the style prop follows immediately
    const region = consentSrc.slice(onClickIdx, onClickIdx + 300);
    expect(region).toContain("var(--text)");
  });
});
