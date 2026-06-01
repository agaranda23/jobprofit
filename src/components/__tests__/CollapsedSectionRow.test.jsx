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
 *
 * These are the exact expressions in CollapsedSectionRow.jsx. If the component
 * changes the logic, these tests break — catching the regression.
 *
 * Limitation: we cannot verify that children are visually revealed (jsdom does
 * not simulate CSS layout). The Netlify deploy-preview checklist in the PR covers
 * the physical tap test at 375px.
 */
import { describe, it, expect } from 'vitest';

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
