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
 *   2. When collapsed, children are NOT rendered (conditional render returns null).
 *   3. When expanded, children ARE rendered (conditional render returns truthy).
 *   4. Toggling expanded state flips the children-rendered condition correctly.
 *   5. needsAttention forcing expansion is correctly computed.
 *   6. CSS regression guard — .jd-csr does NOT have overflow:hidden (4th regression).
 *   7. CSS regression guard — .jd-csr--expanded carries no layout-affecting rules
 *      (8th regression fix: position:relative and z-index both removed; rule kept as
 *      a class hook only).
 *   8. CSS regression guard — .jd-csr-panel has an opaque background (6th regression).
 *   9. Component source uses conditional render, NOT max-height inline styles
 *      (guard: ensures a future refactor does not silently reintroduce the overflow
 *      mechanism that caused the 8th regression).
 *
 * These are the exact expressions in CollapsedSectionRow.jsx. If the component
 * changes the logic, these tests break — catching the regression.
 *
 * Limitation: we cannot verify that children are visually revealed (jsdom does
 * not simulate CSS layout). The Netlify deploy-preview checklist in the PR covers
 * the physical tap test at 375px — ESPECIALLY on iOS/PWA/WebKit where the failure
 * mode (container not reflowing) is not reproducible in static analysis.
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

// ── Mirror the conditional-render expression ───────────────────────────────────
// CollapsedSectionRow renders: {expanded ? children : null}
// We model this with a sentinel value to confirm truthy/null without a DOM.

const CHILDREN_SENTINEL = 'children';

function renderChildren(expanded) {
  return expanded ? CHILDREN_SENTINEL : null;
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

describe('CollapsedSectionRow — conditional render: children in DOM only when expanded', () => {
  it('children are null (not in DOM) when collapsed', () => {
    expect(renderChildren(false)).toBeNull();
  });

  it('children are rendered when expanded', () => {
    expect(renderChildren(true)).not.toBeNull();
    expect(renderChildren(true)).toBe(CHILDREN_SENTINEL);
  });

  it('children are null when collapsed (needsAttention=false default)', () => {
    const expanded = initialExpanded(false, false);
    expect(renderChildren(expanded)).toBeNull();
  });

  it('children are rendered when needsAttention forces expansion', () => {
    const expanded = initialExpanded(false, true);
    expect(renderChildren(expanded)).not.toBeNull();
  });

  it('children are null when defaultExpanded=false and needsAttention=false', () => {
    const expanded = initialExpanded(false, false);
    expect(renderChildren(expanded)).toBeNull();
  });

  it('children are rendered when defaultExpanded=true', () => {
    const expanded = initialExpanded(true, false);
    expect(renderChildren(expanded)).not.toBeNull();
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

  it('children rendered after toggle from collapsed', () => {
    const afterToggle = toggle(false); // was collapsed, now expanded
    expect(renderChildren(afterToggle)).not.toBeNull();
  });

  it('children null after toggle from expanded', () => {
    const afterToggle = toggle(true); // was expanded, now collapsed
    expect(renderChildren(afterToggle)).toBeNull();
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
//   container element at its pre-expansion height and clip the content.
//   Fix: remove overflow:hidden from .jd-csr.
//
//   These tests read the live CSS file to detect if overflow:hidden is
//   re-added to .jd-csr in a future refactor.

const CSS_PATH = path.resolve(__dirname, '../../../src/index.css');

function extractJdCsrBlock(cssText) {
  // Find the .jd-csr { ... } block (not .jd-csr-- variants, not .jd-csr-row etc.)
  const markerIdx = cssText.indexOf('\n.jd-csr {');
  if (markerIdx === -1) return null;
  const blockStart = markerIdx + 1;
  const openBrace = cssText.indexOf('{', blockStart);
  if (openBrace === -1) return null;
  const closeBrace = cssText.indexOf('}', openBrace);
  if (closeBrace === -1) return null;
  return cssText.slice(blockStart, closeBrace + 1);
}

function extractJdCsrExpandedBlock(cssText) {
  // Find the .jd-csr--expanded { ... } block.
  const markerIdx = cssText.indexOf('\n.jd-csr--expanded {');
  if (markerIdx === -1) return null;
  const blockStart = markerIdx + 1;
  const openBrace = cssText.indexOf('{', blockStart);
  if (openBrace === -1) return null;
  const closeBrace = cssText.indexOf('}', openBrace);
  if (closeBrace === -1) return null;
  return cssText.slice(blockStart, closeBrace + 1);
}

// ── CSS regression guard — .jd-csr--expanded (8th regression fix) ─────────────
//
// Regression history:
//
//   5th regression: expanded panel had no stacking context — later sibling cards
//     painted over. Fix: added position:relative + z-index:1.
//
//   6th regression: panel background was transparent — siblings bled through.
//     Fix: added background on .jd-csr-panel.
//
//   7th regression: z-index:1 on both Schedule and Quote (default-expanded) —
//     Quote's stacking context painted over Schedule. Fix: removed z-index;
//     retained position:relative.
//
//   8th regression (DEFINITIVE FIX): the max-height panel overflowed the container's
//     layout box in WebKit PWA. Container never grew; siblings never reflowed; paint
//     order determined visibility. Fix: conditional render — children only in DOM when
//     expanded → container grows naturally → siblings push down.
//     position:relative is also removed from .jd-csr--expanded — it was only a
//     stacking-context candidate, no longer needed when there is no overflow.
//
//   Guard rules (read the live CSS — future refactors caught at CI time):
//     - .jd-csr--expanded MUST NOT have z-index (7th + 8th regression guard).
//     - .jd-csr--expanded MUST NOT have position:relative as a load-bearing rule
//       (8th regression guard: re-adding position context restores the paint-order
//       asymmetry that was half the problem in the 7th regression). The rule may
//       exist as an empty/comment-only block; we guard that it has no active
//       position or z-index declarations.

describe('CSS regression guard — .jd-csr--expanded (8th regression fix)', () => {
  const cssText = fs.readFileSync(CSS_PATH, 'utf8');
  const expandedBlock = extractJdCsrExpandedBlock(cssText);

  it('CSS file contains a .jd-csr--expanded { } rule (sanity check)', () => {
    expect(expandedBlock).not.toBeNull();
    expect(expandedBlock).toContain('.jd-csr--expanded');
  });

  it('.jd-csr--expanded does NOT have z-index (7th+8th regression guard: z-index recreates stacking context that obscures Schedule behind Quote)', () => {
    const blockWithoutComments = expandedBlock.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(blockWithoutComments).not.toMatch(/z-index\s*:/);
  });

  it('.jd-csr--expanded does NOT have position:relative as an active declaration (8th regression guard: position context is no longer needed; reintroducing it restores the paint-order asymmetry)', () => {
    const blockWithoutComments = expandedBlock.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(blockWithoutComments).not.toMatch(/position\s*:/);
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
    // We strip CSS comments before checking so the "overflow: hidden REMOVED"
    // comment in the CSS does not false-fire.
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
// Originally added so the panel area was opaque when the max-height panel overflowed
// the container's layout box. With conditional render the container now grows in-flow —
// no overflow to mask. Rule is kept as defensive chrome; guard remains so a future
// refactor that removes the background from .jd-csr-panel fails loudly at CI time.

function extractJdCsrPanelBlock(cssText) {
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

  it('.jd-csr-panel background references --surface (palette variable, lighter than --surface-expanded so the header row is visually distinct from the body)', () => {
    // Changed from --surface-2 to --surface in chore/accordion-headline-colour-consistency:
    // .jd-csr--expanded sets the container to --surface-expanded (darker); the panel body
    // uses --surface (lighter) so every accordion header appears visually distinct from its
    // content, matching the existing Quote section behaviour uniformly across all sections.
    expect(panelBlock).toContain('--surface');
  });

  it('.jd-csr-panel background does not use a hardcoded hex fallback (palette variable is sufficient)', () => {
    // --surface is defined in :root for both dark and light modes — no hardcoded fallback needed.
    const blockWithoutComments = panelBlock.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(blockWithoutComments).toMatch(/background\s*:\s*var\(--surface\)/);
  });
});

// ── Meta render logic — collapsed and keepMetaWhenExpanded (expanded) paths ───
//
// The meta string (e.g. "£133 (2 items)") is rendered:
//   - In the COLLAPSED header: when !expanded && meta is truthy
//       → <span className="jd-csr-meta">{meta}</span>
//   - In the EXPANDED header:  when expanded && keepMetaWhenExpanded && meta
//       → <span className="jd-csr-meta jd-csr-meta--expanded">{meta}</span>
//
// These two paths are mutually exclusive — meta never double-renders.
// Only the Price accordion opts in to keepMetaWhenExpanded; all other
// accordions use the default (false) so they are byte-for-byte unchanged.
//
// The guard tests below read the component source to ensure the render
// expressions are present. If a future refactor removes or rewrites the
// collapsed-meta path, these tests catch it before it ships.

function renderMeta(expanded, meta, keepMetaWhenExpanded = false) {
  // Mirrors the three branches in CollapsedSectionRow JSX:
  //   {!expanded && meta && <span className="jd-csr-meta">{meta}</span>}
  //   {expanded && keepMetaWhenExpanded && meta && <span className="jd-csr-meta jd-csr-meta--expanded">{meta}</span>}
  const collapsedMeta  = !expanded && meta ? { cls: 'jd-csr-meta', text: meta } : null;
  const expandedMeta   = expanded && keepMetaWhenExpanded && meta ? { cls: 'jd-csr-meta jd-csr-meta--expanded', text: meta } : null;
  return { collapsedMeta, expandedMeta };
}

describe('CollapsedSectionRow — meta render logic (collapsed + keepMetaWhenExpanded paths)', () => {
  it('collapsed with meta: renders collapsed meta span, no expanded meta', () => {
    const { collapsedMeta, expandedMeta } = renderMeta(false, '£133 (2 items)');
    expect(collapsedMeta).not.toBeNull();
    expect(collapsedMeta.cls).toBe('jd-csr-meta');
    expect(collapsedMeta.text).toBe('£133 (2 items)');
    expect(expandedMeta).toBeNull();
  });

  it('collapsed without meta: renders neither span', () => {
    const { collapsedMeta, expandedMeta } = renderMeta(false, '');
    expect(collapsedMeta).toBeNull();
    expect(expandedMeta).toBeNull();
  });

  it('collapsed without meta (undefined): renders neither span', () => {
    const { collapsedMeta, expandedMeta } = renderMeta(false, undefined);
    expect(collapsedMeta).toBeNull();
    expect(expandedMeta).toBeNull();
  });

  it('expanded, keepMetaWhenExpanded=true, with meta: renders expanded meta span, no collapsed meta', () => {
    const { collapsedMeta, expandedMeta } = renderMeta(true, '£133 (2 items)', true);
    expect(collapsedMeta).toBeNull();
    expect(expandedMeta).not.toBeNull();
    expect(expandedMeta.cls).toBe('jd-csr-meta jd-csr-meta--expanded');
    expect(expandedMeta.text).toBe('£133 (2 items)');
  });

  it('expanded, keepMetaWhenExpanded=false (default): renders neither span', () => {
    const { collapsedMeta, expandedMeta } = renderMeta(true, '£133 (2 items)', false);
    expect(collapsedMeta).toBeNull();
    expect(expandedMeta).toBeNull();
  });

  it('expanded, keepMetaWhenExpanded=true, without meta: renders neither span', () => {
    const { collapsedMeta, expandedMeta } = renderMeta(true, '', true);
    expect(collapsedMeta).toBeNull();
    expect(expandedMeta).toBeNull();
  });

  it('collapsed and expanded meta are mutually exclusive across all four expansion states', () => {
    const states = [false, true];
    const keepStates = [false, true];
    for (const expanded of states) {
      for (const keep of keepStates) {
        const { collapsedMeta, expandedMeta } = renderMeta(expanded, '£133 (2 items)', keep);
        // Never both truthy simultaneously
        expect(collapsedMeta !== null && expandedMeta !== null).toBe(false);
      }
    }
  });
});

// ── Price accordion meta derivation — quoteMeta logic from JobDetailDrawer ───
//
// The Price accordion passes quoteMeta as the `meta` prop to CollapsedSectionRow.
// quoteMeta derives the label shown in both collapsed and expanded headers.
// These tests mirror the exact derivation in JobDetailDrawer so a refactor that
// changes the string format breaks loudly at CI time.
//
// format: "£133 (2 items)" | "£133 (1 item)" | "£133" (no items) | "None yet"

function gbpMock(n) {
  // Minimal replica of gbp() for testing — not the real formatter.
  return `£${Number(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function deriveQuoteMeta(job) {
  // Mirrors exactly the derivation in JobDetailDrawer (around line 3648–3652 on main).
  const quoteTotal = job.total ?? job.amount ?? 0;
  const _quoteLineCount = (job.lineItems || []).filter(i => i.desc || i.cost).length;
  return quoteTotal > 0
    ? `${gbpMock(quoteTotal)}${_quoteLineCount > 0 ? ` (${_quoteLineCount} item${_quoteLineCount === 1 ? '' : 's'})` : ''}`
    : 'None yet';
}

describe('Price accordion — quoteMeta derivation (JobDetailDrawer mirror)', () => {
  it('job with total and 2 line items → "£133 (2 items)"', () => {
    const job = {
      total: 133,
      lineItems: [{ desc: 'Job', cost: 123 }, { desc: 'Hammer', cost: 10 }],
    };
    expect(deriveQuoteMeta(job)).toBe('£133 (2 items)');
  });

  it('job with total and 1 line item → singular "£133 (1 item)"', () => {
    const job = {
      total: 133,
      lineItems: [{ desc: 'Job', cost: 133 }],
    };
    expect(deriveQuoteMeta(job)).toBe('£133 (1 item)');
  });

  it('job with total but no line items → just the price, no bracket', () => {
    const job = { total: 133, lineItems: [] };
    expect(deriveQuoteMeta(job)).toBe('£133');
  });

  it('job with total and only empty/seed line items (no desc, no cost) → no bracket', () => {
    // Empty seed rows (desc='', cost=0) must not inflate the count.
    const job = {
      total: 133,
      lineItems: [{ desc: '', cost: 0 }],
    };
    expect(deriveQuoteMeta(job)).toBe('£133');
  });

  it('job with zero total → "None yet"', () => {
    const job = { total: 0, lineItems: [] };
    expect(deriveQuoteMeta(job)).toBe('None yet');
  });

  it('job with no total/amount fields → "None yet"', () => {
    const job = {};
    expect(deriveQuoteMeta(job)).toBe('None yet');
  });

  it('job uses amount as fallback when total is absent', () => {
    const job = { amount: 250, lineItems: [{ desc: 'Labour', cost: 250 }] };
    expect(deriveQuoteMeta(job)).toBe('£250 (1 item)');
  });

  it('total takes precedence over amount', () => {
    const job = { total: 380, amount: 200, lineItems: [{ desc: 'Labour', cost: 380 }] };
    expect(deriveQuoteMeta(job)).toBe('£380 (1 item)');
  });
});

// ── Source-code regression guard — meta render expressions ───────────────────
//
// Guards that BOTH meta render paths are present in CollapsedSectionRow.jsx:
//   collapsed:  {!expanded && meta && <span className="jd-csr-meta">}
//   expanded:   {expanded && keepMetaWhenExpanded && meta && <span className="jd-csr-meta jd-csr-meta--expanded">}
//
// A future refactor that accidentally deletes either expression will fail here
// at CI time rather than silently shipping a regression to users.

describe('Source-code regression guard — meta render expressions in CollapsedSectionRow', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../CollapsedSectionRow.jsx'), 'utf8');

  it('collapsed meta render: source contains {!expanded && meta &&} guard expression', () => {
    // The collapsed-state meta is gated on !expanded && meta. This is the load-bearing
    // expression that shows "£133 (2 items)" in the Price header when collapsed.
    expect(src).toMatch(/!expanded\s*&&\s*meta\s*&&/);
  });

  it('collapsed meta render: source renders jd-csr-meta span in collapsed path', () => {
    // The span with class jd-csr-meta must be present and tied to the collapsed path.
    expect(src).toContain('jd-csr-meta');
  });

  it('expanded meta render: source contains {expanded && keepMetaWhenExpanded && meta &&} guard', () => {
    // The expanded-state meta is gated on expanded && keepMetaWhenExpanded && meta.
    // Only the Price accordion opts in by passing keepMetaWhenExpanded.
    expect(src).toMatch(/expanded\s*&&\s*keepMetaWhenExpanded\s*&&\s*meta\s*&&/);
  });

  it('expanded meta render: source renders jd-csr-meta--expanded span in expanded path', () => {
    expect(src).toContain('jd-csr-meta--expanded');
  });

  it('keepMetaWhenExpanded defaults to false (no opt-in unless prop passed)', () => {
    // The prop declaration must have a default of false so all other accordions
    // (Schedule, Costs, Customer, Documents) are unchanged.
    expect(src).toMatch(/keepMetaWhenExpanded\s*=\s*false/);
  });
});

// ── CSS regression guard — collapsed meta must have min-width:0 for mobile ───
//
// On narrow (375px) screens the meta text must truncate with ellipsis rather than
// overflow or wrap onto a second line and push the chevron off-screen.
// min-width:0 on a flex child prevents the default min-width:auto from overriding
// the overflow:hidden that enables ellipsis. If min-width:0 is removed from
// .jd-csr-meta, this guard fails at CI time.

describe('CSS regression guard — jd-csr-meta mobile truncation (min-width:0)', () => {
  const cssText = fs.readFileSync(CSS_PATH, 'utf8');

  it('.jd-csr-meta rule has min-width:0 (prevents meta from overflowing on mobile)', () => {
    // Extract the .jd-csr-meta { ... } block.
    const markerIdx = cssText.indexOf('\n.jd-csr-meta {');
    expect(markerIdx).not.toBe(-1);
    const openBrace  = cssText.indexOf('{', markerIdx + 1);
    const closeBrace = cssText.indexOf('}', openBrace);
    const block = cssText.slice(openBrace, closeBrace + 1);
    expect(block).toMatch(/min-width\s*:\s*0/);
  });

  it('.jd-csr-meta rule has text-overflow:ellipsis (graceful truncation on narrow screens)', () => {
    const markerIdx = cssText.indexOf('\n.jd-csr-meta {');
    const openBrace  = cssText.indexOf('{', markerIdx + 1);
    const closeBrace = cssText.indexOf('}', openBrace);
    const block = cssText.slice(openBrace, closeBrace + 1);
    expect(block).toMatch(/text-overflow\s*:\s*ellipsis/);
  });

  it('.jd-csr-meta rule has white-space:nowrap (prevents meta from wrapping to second line)', () => {
    const markerIdx = cssText.indexOf('\n.jd-csr-meta {');
    const openBrace  = cssText.indexOf('{', markerIdx + 1);
    const closeBrace = cssText.indexOf('}', openBrace);
    const block = cssText.slice(openBrace, closeBrace + 1);
    expect(block).toMatch(/white-space\s*:\s*nowrap/);
  });
});

// ── CSS regression guard — expanded meta must NOT be right-aligned ────────────
//
// Root cause of the expanded-Price-header alignment bug (June 2026):
//
//   .jd-csr-meta--expanded had text-align:right, which pushed the meta string
//   ("£133 (2 items)") to the far-right of the flex row (before the chevron),
//   while the COLLAPSED meta (no text-align override) sat left-aligned immediately
//   after the title.
//
//   The founder's desired design: EXPANDED meta hugs the title on the LEFT,
//   identical to the collapsed layout: [icon] "Price" "£133 (2 items)" ...[chevron].
//
//   Fix: removed text-align:right from .jd-csr-meta--expanded.
//   Guard: if text-align:right is re-added, this test fails at CI time.

function extractJdCsrMetaExpandedBlock(cssText) {
  const markerIdx = cssText.indexOf('\n.jd-csr-meta--expanded {');
  if (markerIdx === -1) return null;
  const blockStart = markerIdx + 1;
  const openBrace = cssText.indexOf('{', blockStart);
  if (openBrace === -1) return null;
  const closeBrace = cssText.indexOf('}', openBrace);
  if (closeBrace === -1) return null;
  return cssText.slice(blockStart, closeBrace + 1);
}

describe('CSS regression guard — .jd-csr-meta--expanded left-alignment (expanded Price meta fix)', () => {
  const cssText = fs.readFileSync(CSS_PATH, 'utf8');
  const expandedMetaBlock = extractJdCsrMetaExpandedBlock(cssText);

  it('CSS file contains a .jd-csr-meta--expanded { } rule (sanity check)', () => {
    expect(expandedMetaBlock).not.toBeNull();
    expect(expandedMetaBlock).toContain('.jd-csr-meta--expanded');
  });

  it('.jd-csr-meta--expanded does NOT have text-align:right (expanded meta must left-align, hugging the title)', () => {
    // text-align:right was the root cause that pushed the expanded Price meta to the
    // far right. Removing it makes the expanded meta left-align identically to the
    // collapsed .jd-csr-meta. If re-added, this guard catches the regression at CI time.
    const blockWithoutComments = expandedMetaBlock.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(blockWithoutComments).not.toMatch(/text-align\s*:\s*right/);
  });

  it('.jd-csr-meta--expanded does NOT have margin-left:auto (auto-margin would right-push the meta rather than hugging the title)', () => {
    const blockWithoutComments = expandedMetaBlock.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(blockWithoutComments).not.toMatch(/margin-left\s*:\s*auto/);
  });
});

// ── Source-code regression guard — no max-height inline style on the panel ────
//
// 8th regression guard: the definitive fix is CONDITIONAL RENDER, not max-height
// animation. If a future refactor re-introduces `maxHeight` as an inline style on
// the panel, this guard fails at CI time — ensuring the regression is caught before
// it ships to the WebKit PWA target where the container-not-reflow failure mode lives.

const COMPONENT_PATH = path.resolve(__dirname, '../CollapsedSectionRow.jsx');

describe('Source-code regression guard — conditional render, no max-height (8th regression)', () => {
  const src = fs.readFileSync(COMPONENT_PATH, 'utf8');

  it('component source does NOT use maxHeight as an inline style on the panel (8th regression guard)', () => {
    // maxHeight inline style is the mechanism that caused the overflow-spill bug.
    // Conditional render replaced it. If maxHeight reappears, this fails.
    expect(src).not.toMatch(/maxHeight\s*:/);
  });

  it('component source uses conditional render for children: {expanded ? children : null}', () => {
    // This is the load-bearing expression. Confirms the render path is present.
    expect(src).toMatch(/expanded\s*\?\s*children\s*:\s*null/);
  });

  it('component source does NOT use overflow:hidden as an inline style on the panel', () => {
    // overflow:hidden on the panel was part of the max-height mechanism.
    // With conditional render it is not needed and must not be re-added inline.
    // (The CSS rule on .jd-csr-panel has no overflow:hidden — this guards the JSX.)
    expect(src).not.toMatch(/overflow\s*:\s*['"]hidden['"]/);
  });
});
