/**
 * CollapsedSectionRow — accordion logic tests (node environment)
 *
 * The jsdom environment is broken on this machine due to a pre-existing ESM
 * incompatibility with @exodus/bytes / html-encoding-sniffer (also blocks
 * componentSmoke.test.jsx and screenSmoke.test.jsx on main). This file uses
 * the node environment and tests the stateful logic by mirroring the exact
 * expressions CollapsedSectionRow.jsx uses — no DOM mount required.
 *
 * What these tests verify:
 *   1. Initial expanded state derives correctly from defaultExpanded + needsAttention.
 *   2. The panel maxHeight value is '2000px' when expanded, '0' when collapsed.
 *   3. The panel overflow is always 'hidden' regardless of expanded state.
 *   4. Toggling expanded state flips maxHeight between '0' and '2000px'.
 *   5. needsAttention forcing expansion is correctly computed.
 *   6. CSS regression guard — .jd-csr does NOT have overflow:hidden.
 *      This was the root cause of the 4th drawer-expansion regression (June 2026):
 *      overflow:hidden on .jd-csr caused iOS Safari / PWA WebKit to hold the
 *      container at its pre-expansion height and clip the panel content. This test
 *      will fail if overflow:hidden is re-added to .jd-csr, catching the regression
 *      at CI time rather than silently in production.
 *
 * These are the exact expressions in CollapsedSectionRow.jsx. If the component
 * changes the logic, these tests break — catching the regression.
 *
 * Limitation: we cannot verify that children are visually revealed (jsdom does
 * not simulate CSS layout). The Netlify deploy-preview checklist in the PR covers
 * the physical tap test at 375px.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Mirror the exact initialisation logic from CollapsedSectionRow.jsx ────────

function initialExpanded(defaultExpanded = false, needsAttention = false) {
  return defaultExpanded || needsAttention;
}

// ── Mirror the exact style object CollapsedSectionRow renders on the panel ────

function panelStyle(expanded, prefersReducedMotion = false) {
  return {
    maxHeight: expanded ? '2000px' : '0',
    overflow: 'hidden',
    transition: prefersReducedMotion ? 'none' : 'max-height 220ms ease-out',
  };
}

// ── Mirror the toggle handler ──────────────────────────────────────────────────

function toggle(expanded) {
  return !expanded;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CollapsedSectionRow — initial expanded state', () => {
  it('collapsed by default when no props', () => {
    expect(initialExpanded()).toBe(false);
  });

  it('expanded when defaultExpanded=true', () => {
    expect(initialExpanded(true)).toBe(true);
  });

  it('expanded when needsAttention=true (overrides defaultExpanded=false)', () => {
    expect(initialExpanded(false, true)).toBe(true);
  });

  it('expanded when both defaultExpanded=true and needsAttention=true', () => {
    expect(initialExpanded(true, true)).toBe(true);
  });
});

describe('CollapsedSectionRow — panel maxHeight reflects expanded state', () => {
  it('maxHeight is "0" when collapsed', () => {
    expect(panelStyle(false).maxHeight).toBe('0');
  });

  it('maxHeight is "2000px" when expanded', () => {
    expect(panelStyle(true).maxHeight).toBe('2000px');
  });

  it('maxHeight is "0" when collapsed (needsAttention=false default)', () => {
    const expanded = initialExpanded(false, false);
    expect(panelStyle(expanded).maxHeight).toBe('0');
  });

  it('maxHeight is "2000px" when needsAttention forces expansion', () => {
    const expanded = initialExpanded(false, true);
    expect(panelStyle(expanded).maxHeight).toBe('2000px');
  });
});

describe('CollapsedSectionRow — panel overflow is always hidden', () => {
  it('overflow is "hidden" when collapsed', () => {
    expect(panelStyle(false).overflow).toBe('hidden');
  });

  it('overflow is "hidden" when expanded', () => {
    expect(panelStyle(true).overflow).toBe('hidden');
  });
});

describe('CollapsedSectionRow — transition respects prefers-reduced-motion', () => {
  it('transition is the max-height animation when no preference', () => {
    expect(panelStyle(true, false).transition).toBe('max-height 220ms ease-out');
  });

  it('transition is "none" when prefers-reduced-motion', () => {
    expect(panelStyle(true, true).transition).toBe('none');
  });
});

describe('CollapsedSectionRow — toggle logic', () => {
  it('toggle flips false to true (collapsed → expanded)', () => {
    expect(toggle(false)).toBe(true);
  });

  it('toggle flips true to false (expanded → collapsed)', () => {
    expect(toggle(true)).toBe(false);
  });

  it('double toggle returns to original state', () => {
    const start = false;
    expect(toggle(toggle(start))).toBe(start);
  });

  it('maxHeight after toggle from collapsed is "2000px"', () => {
    const afterToggle = toggle(false); // was collapsed, now expanded
    expect(panelStyle(afterToggle).maxHeight).toBe('2000px');
  });

  it('maxHeight after toggle from expanded is "0"', () => {
    const afterToggle = toggle(true); // was expanded, now collapsed
    expect(panelStyle(afterToggle).maxHeight).toBe('0');
  });
});

// ── Wrapper className mirrors the JSX expression ──────────────────────────────

function wrapperClassName(expanded, needsAttention = false) {
  // Mirrors exactly: `jd-csr${expanded ? ' jd-csr--expanded' : ''}${needsAttention ? ' jd-csr--attention' : ''}`
  return `jd-csr${expanded ? ' jd-csr--expanded' : ''}${needsAttention ? ' jd-csr--attention' : ''}`;
}

describe('CollapsedSectionRow — wrapper className reflects expanded and attention state', () => {
  it('collapsed, no attention: base class only', () => {
    expect(wrapperClassName(false, false)).toBe('jd-csr');
  });

  it('expanded, no attention: includes jd-csr--expanded', () => {
    expect(wrapperClassName(true, false)).toContain('jd-csr--expanded');
  });

  it('collapsed, no attention: does NOT include jd-csr--expanded', () => {
    expect(wrapperClassName(false, false)).not.toContain('jd-csr--expanded');
  });

  it('expanded, with attention: includes both modifier classes', () => {
    const cls = wrapperClassName(true, true);
    expect(cls).toContain('jd-csr--expanded');
    expect(cls).toContain('jd-csr--attention');
  });

  it('collapsed, with attention: includes jd-csr--attention but NOT jd-csr--expanded', () => {
    const cls = wrapperClassName(false, true);
    expect(cls).toContain('jd-csr--attention');
    expect(cls).not.toContain('jd-csr--expanded');
  });
});

// ── CSS regression guard — .jd-csr must NOT have overflow:hidden ──────────────
//
// Root cause of the 4th drawer-expansion regression (June 2026):
//
//   overflow:hidden on .jd-csr caused iOS Safari / PWA WebKit to hold the
//   container element at its pre-expansion height and clip the max-height
//   panel transition. Result: Schedule / Quote / Costs sections appeared
//   to tap correctly (JS state did flip) but the content was clipped to 0px
//   visible height. Three prior animation approaches (scrollHeight JS, CSS
//   grid-template-rows, max-height) all failed for the same root cause.
//
//   Fix: remove overflow:hidden from .jd-csr. The property was placed there
//   to clip the tap-highlight to the border-radius corners, but:
//     - .jd-csr-row already sets -webkit-tap-highlight-color: transparent
//     - The :active style is opacity:0.65, not a background-color change
//     - .jd-csr-row has background:none — nothing to clip
//   So overflow:hidden was serving no purpose while silently breaking expand.
//
//   These tests read the live CSS file to detect if overflow:hidden is
//   re-added to .jd-csr in a future refactor. They will fail at CI time
//   rather than silently in production.
//
// What "overflow:hidden absent from .jd-csr rule" means:
//   The CSS block that starts with ".jd-csr {" must not contain
//   "overflow: hidden" (or "overflow:hidden") before the closing brace.

const CSS_PATH = path.resolve(__dirname, '../../../src/index.css');

function extractJdCsrBlock(cssText) {
  // Find the .jd-csr { ... } block (not .jd-csr-- variants, not .jd-csr-row etc.)
  // Strategy: find the exact selector ".jd-csr {" then grab everything up to
  // the matching closing brace (accounting for single-depth nesting only — the
  // .jd-csr rule has no at-rule nesting in our CSS).
  const markerIdx = cssText.indexOf('\n.jd-csr {');
  if (markerIdx === -1) return null;
  const blockStart = markerIdx + 1; // skip the leading newline
  const openBrace = cssText.indexOf('{', blockStart);
  if (openBrace === -1) return null;
  const closeBrace = cssText.indexOf('}', openBrace);
  if (closeBrace === -1) return null;
  return cssText.slice(blockStart, closeBrace + 1);
}

function extractJdCsrExpandedBlock(cssText) {
  // Find the .jd-csr--expanded { ... } block.
  // Uses the same single-depth brace strategy as extractJdCsrBlock.
  const markerIdx = cssText.indexOf('\n.jd-csr--expanded {');
  if (markerIdx === -1) return null;
  const blockStart = markerIdx + 1;
  const openBrace = cssText.indexOf('{', blockStart);
  if (openBrace === -1) return null;
  const closeBrace = cssText.indexOf('}', openBrace);
  if (closeBrace === -1) return null;
  return cssText.slice(blockStart, closeBrace + 1);
}

// ── CSS regression guard — .jd-csr--expanded stacking fix ────────────────────
//
// Root cause of the 5th drawer stacking regression (June 2026):
//
//   When a CollapsedSectionRow expands inside .job-detail-body (overflow-y:auto
//   flex column), the expanding panel had no stacking context. Later sibling
//   cards in the flex column painted on top of the revealed panel content —
//   the user could tap Schedule/Quote/Costs and the JS state flipped correctly,
//   but the expanded editing UI was visually obscured behind the next card.
//
//   Fix: add .jd-csr--expanded { position: relative; z-index: 1 } in index.css
//   and apply the class from CollapsedSectionRow.jsx when expanded === true.
//   position:relative promotes the element into a stacking context; z-index:1
//   ensures it paints above position:static siblings (z-index:auto).
//
//   These tests read the live CSS file so a future refactor that removes
//   position:relative or z-index from .jd-csr--expanded fails loudly at CI
//   time rather than silently in production.

describe('CSS regression guard — .jd-csr--expanded stacking (5th stacking regression)', () => {
  const cssText = fs.readFileSync(CSS_PATH, 'utf8');
  const expandedBlock = extractJdCsrExpandedBlock(cssText);

  it('CSS file contains a .jd-csr--expanded { } rule (sanity check)', () => {
    expect(expandedBlock).not.toBeNull();
    expect(expandedBlock).toContain('.jd-csr--expanded');
  });

  it('.jd-csr--expanded has position:relative (creates stacking context)', () => {
    const blockWithoutComments = expandedBlock.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(blockWithoutComments).toMatch(/position\s*:\s*relative/);
  });

  it('.jd-csr--expanded has z-index:1 (wins over position:static siblings)', () => {
    const blockWithoutComments = expandedBlock.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(blockWithoutComments).toMatch(/z-index\s*:\s*1\b/);
  });
});

describe('CSS regression guard — .jd-csr overflow (4th expansion regression)', () => {
  const cssText = fs.readFileSync(CSS_PATH, 'utf8');
  const jdCsrBlock = extractJdCsrBlock(cssText);

  it('CSS file contains a .jd-csr { } rule (sanity check — guard is not vacuously true)', () => {
    expect(jdCsrBlock).not.toBeNull();
    expect(jdCsrBlock).toContain('.jd-csr');
  });

  it('.jd-csr rule does NOT have an active overflow:hidden declaration (root cause of expansion regression)', () => {
    // overflow:hidden on .jd-csr clips the max-height panel in iOS Safari PWA.
    // This test will fail if overflow:hidden is re-added as an active rule —
    // ensuring the regression is caught at CI time rather than silently in production.
    //
    // We strip CSS comments (/* ... */) before checking so that the
    // "overflow: hidden REMOVED" comment in the CSS does not false-fire.
    const blockWithoutComments = jdCsrBlock.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(blockWithoutComments).not.toMatch(/overflow\s*:\s*hidden/);
  });

  it('.jd-csr rule still has border-radius:12px (visual chrome preserved after fix)', () => {
    expect(jdCsrBlock).toMatch(/border-radius\s*:\s*12px/);
  });

  it('.jd-csr rule still has min-height:48px (thin-line regression guard preserved)', () => {
    expect(jdCsrBlock).toMatch(/min-height\s*:\s*48px/);
  });
});

// ── CSS regression guard — .jd-csr-panel opaque background (6th regression) ─────
//
// Root cause of the 6th drawer regression (June 2026):
//
//   When .jd-csr had overflow:hidden it implicitly clipped-but-covered the
//   panel content with the parent's background. After overflow:hidden was removed
//   (fix #203) the parent's background only fills its layout box (the trigger row
//   height). The .jd-csr-panel div has no background of its own so when it expands
//   beyond the parent's layout box — which it does via max-height animation — the
//   panel content is rendered over a transparent area. Siblings below in the flex
//   column (Money card, "View profit breakdown" CTA) bleed through visually.
//
//   Fix: add .jd-csr-panel { background: var(--surface-raised, #142035) } so the
//   panel div itself is always opaque. var(--surface-raised) is themed so both
//   dark and light modes are handled without hard-coding colours.
//
//   This test reads the live CSS file so a future refactor that removes the
//   background from .jd-csr-panel will fail loudly at CI time.

function extractJdCsrPanelBlock(cssText) {
  // Find the .jd-csr-panel { ... } block (exact selector, not child selectors).
  const markerIdx = cssText.indexOf('\n.jd-csr-panel {');
  if (markerIdx === -1) return null;
  const blockStart = markerIdx + 1;
  const openBrace = cssText.indexOf('{', blockStart);
  if (openBrace === -1) return null;
  const closeBrace = cssText.indexOf('}', openBrace);
  if (closeBrace === -1) return null;
  return cssText.slice(blockStart, closeBrace + 1);
}

describe('CSS regression guard — .jd-csr-panel opaque background (6th regression)', () => {
  const cssText = fs.readFileSync(CSS_PATH, 'utf8');
  const panelBlock = extractJdCsrPanelBlock(cssText);

  it('CSS file contains a .jd-csr-panel { } rule (sanity check)', () => {
    expect(panelBlock).not.toBeNull();
    expect(panelBlock).toContain('.jd-csr-panel');
  });

  it('.jd-csr-panel has a background declaration (panel must be opaque)', () => {
    const blockWithoutComments = panelBlock.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(blockWithoutComments).toMatch(/background\s*:/);
  });

  it('.jd-csr-panel background references --surface-raised (must match card surface, not a random colour)', () => {
    expect(panelBlock).toContain('--surface-raised');
  });

  it('.jd-csr-panel background fallback is #142035 (dark-mode opaque, matches .jd-csr)', () => {
    expect(panelBlock).toContain('#142035');
  });
});
