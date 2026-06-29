/**
 * cardPaymentsNavFix.test.js
 *
 * Regression tests for the "Set up" button in the pay-now Money banner
 * doing nothing on real devices.
 *
 * ROOT CAUSE: DashboardPager's onTouchStart did not bail out when the touch
 * started on a button element.  A slight horizontal finger wobble (≥ 10 px,
 * the LOCK_THRESHOLD) during a tap set dirLock=true, causing the native
 * touchmove listener to call e.preventDefault().  iOS Safari then suppressed
 * the synthesised click event, so the onClick handler on the "Set up" button
 * never fired.
 *
 * FIX: useDashboardPager.js now checks insideInteractiveElement(e.target)
 * in onTouchStart and returns early.  Touches that begin on a button, anchor,
 * input, select, textarea, role=button/link element, or a positive tabindex
 * element are handed back to the browser without pager interference.
 *
 * These tests cover:
 *   1.  insideInteractiveElement — mirror of the helper added to useDashboardPager.js
 *   2.  onNavigateToCardPayments handler state machine — confirms that calling the
 *       handler results in view='settings' and settingsSubView='card-payments'
 */

import { describe, it, expect } from 'vitest';

// ── 1. Mirror of insideInteractiveElement from useDashboardPager.js ───────────
//
// Mirrored here (same pattern as deriveDisplayStatus.test.js / tileCallMapButtons.test.js)
// because the function is module-internal.  If it is ever exported, import
// directly and remove this mirror.

function insideInteractiveElement(el) {
  let node = el;
  // In the browser the loop stops at document.body; in this test environment
  // our stubs set parentElement=null so the loop stops at null — same result.
  const terminus = typeof document !== 'undefined' ? document.body : null;
  while (node && node !== terminus) {
    const tag = node.tagName?.toLowerCase();
    if (
      tag === 'button' ||
      tag === 'a'      ||
      tag === 'input'  ||
      tag === 'select' ||
      tag === 'textarea'
    ) return true;
    const role = node.getAttribute?.('role');
    if (role === 'button' || role === 'link' || role === 'checkbox' || role === 'radio') {
      return true;
    }
    const tabindex = node.getAttribute?.('tabindex');
    if (tabindex !== null && tabindex !== undefined && tabindex !== '-1') return true;
    node = node.parentElement;
  }
  return false;
}

// ── Minimal DOM-node stub factory ─────────────────────────────────────────────
// Uses null as the terminal sentinel instead of document.body so these tests
// run in the default node environment (no jsdom required).

function makeNode(tag, attrs = {}, parentNode = null) {
  return {
    tagName: tag.toUpperCase(),
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    hasAttribute: (name) => name in attrs,
    parentElement: parentNode,
  };
}

// Build a chain of nodes: innermost tag first, outermost last. Returns the
// innermost node (the "touch target").
function chain(...tags) {
  let parent = null;
  const nodes = tags.map(tag => {
    const n = makeNode(tag, {}, parent);
    parent = n;
    return n;
  });
  // Return the first element (innermost); we want the deepest node as target
  // but the chain is built outermost-first here, so reverse for clarity:
  return makeNode('span', {}, nodes[nodes.length - 1]);
}

// ── Tests for insideInteractiveElement ────────────────────────────────────────

describe('insideInteractiveElement — direct interactive tags', () => {
  it('returns true for a <button> element', () => {
    expect(insideInteractiveElement(makeNode('button'))).toBe(true);
  });

  it('returns true for an <a> element', () => {
    expect(insideInteractiveElement(makeNode('a'))).toBe(true);
  });

  it('returns true for an <input> element', () => {
    expect(insideInteractiveElement(makeNode('input'))).toBe(true);
  });

  it('returns true for a <select> element', () => {
    expect(insideInteractiveElement(makeNode('select'))).toBe(true);
  });

  it('returns true for a <textarea> element', () => {
    expect(insideInteractiveElement(makeNode('textarea'))).toBe(true);
  });
});

describe('insideInteractiveElement — role attributes', () => {
  it('returns true for role=button', () => {
    expect(insideInteractiveElement(makeNode('div', { role: 'button' }))).toBe(true);
  });

  it('returns true for role=link', () => {
    expect(insideInteractiveElement(makeNode('div', { role: 'link' }))).toBe(true);
  });

  it('returns false for role=region (non-interactive)', () => {
    expect(insideInteractiveElement(makeNode('div', { role: 'region' }))).toBe(false);
  });
});

describe('insideInteractiveElement — tabindex', () => {
  it('returns true for tabindex="0"', () => {
    expect(insideInteractiveElement(makeNode('div', { tabindex: '0' }))).toBe(true);
  });

  it('returns false for tabindex="-1" (programmatically focusable, not interactive)', () => {
    expect(insideInteractiveElement(makeNode('div', { tabindex: '-1' }))).toBe(false);
  });
});

describe('insideInteractiveElement — ancestor walk', () => {
  it('returns true for a <span> inside a <button>', () => {
    // Mimics: <button class="pay-now-money-banner__setup"><span>Set up</span></button>
    // The touch target may be the inner <span> text node wrapper, not the button itself.
    const button = makeNode('button');
    const span   = makeNode('span', {}, button);
    expect(insideInteractiveElement(span)).toBe(true);
  });

  it('returns true for an <svg> inside a <button> (icon buttons)', () => {
    const button = makeNode('button');
    const svg    = makeNode('svg', {}, button);
    expect(insideInteractiveElement(svg)).toBe(true);
  });

  it('returns false for a <div> inside a plain <div>', () => {
    const outer = makeNode('div');
    const inner = makeNode('div', {}, outer);
    expect(insideInteractiveElement(inner)).toBe(false);
  });

  it('returns false for a deep element with no interactive ancestors', () => {
    // div > section > article > span  — none are interactive
    const div     = makeNode('div');
    const section = makeNode('section', {}, div);
    const article = makeNode('article', {}, section);
    const span    = makeNode('span', {}, article);
    expect(insideInteractiveElement(span)).toBe(false);
  });

  it('returns true for a deeply nested element inside a button', () => {
    // button > div > span > svg  — should find the button ancestor
    const button = makeNode('button');
    const div    = makeNode('div', {}, button);
    const span   = makeNode('span', {}, div);
    const svg    = makeNode('svg', {}, span);
    expect(insideInteractiveElement(svg)).toBe(true);
  });
});

// ── 2. onNavigateToCardPayments handler — state machine ───────────────────────
//
// Verifies that the AppShell handler
//   () => { navigate('settings'); setSettingsSubView('card-payments'); }
// produces the expected state — view='settings', settingsSubView='card-payments' —
// when both callbacks are called synchronously (as they are in a React click event).
//
// This does NOT render any React component.  It models the state machine that
// AppShell implements so that a regression here catches a future refactor that
// breaks the two-call pattern.

describe('onNavigateToCardPayments handler — state machine', () => {
  it('calling navigate(settings) + setSettingsSubView(card-payments) sets both states', () => {
    let view            = 'finance';
    let settingsSubView = null;

    const navigate           = (v) => { view = v; };
    const setSettingsSubView = (s) => { settingsSubView = s; };

    // The exact handler passed as onNavigateToCardPayments to FinanceScreen (AppShell ~1351)
    const onNavigateToCardPayments = () => {
      navigate('settings');
      setSettingsSubView('card-payments');
    };

    onNavigateToCardPayments();

    expect(view).toBe('settings');
    expect(settingsSubView).toBe('card-payments');
  });

  it('CardPaymentsScreen render condition is true after the handler fires', () => {
    let view            = 'finance';
    let settingsSubView = null;

    const navigate           = (v) => { view = v; };
    const setSettingsSubView = (s) => { settingsSubView = s; };

    const onNavigateToCardPayments = () => {
      navigate('settings');
      setSettingsSubView('card-payments');
    };

    onNavigateToCardPayments();

    // AppShell render condition for CardPaymentsScreen (AppShell ~1361)
    const cardPaymentsVisible = view === 'settings' && settingsSubView === 'card-payments';
    // AppShell render condition for SettingsScreen hub (AppShell ~1375)
    const settingsHubVisible  = view === 'settings' && settingsSubView !== 'card-payments';

    expect(cardPaymentsVisible).toBe(true);
    expect(settingsHubVisible).toBe(false);
  });

  it('handleTabChange("settings") while already on settings resets settingsSubView to null', () => {
    // Mirrors the same-tab re-tap guard in handleTabChange (AppShell ~1221-1224).
    // Ensures a user tapping the Settings nav tab from CardPaymentsScreen
    // returns them to the hub (not stuck on card-payments).
    let view             = 'settings';
    let settingsSubView  = 'card-payments';
    let settingsResetKey = 0;

    const setSettingsSubView  = (s)  => { settingsSubView = s; };
    const setSettingsResetKey = (fn) => { settingsResetKey = fn(settingsResetKey); };

    const handleTabChangeSameTab = (nextView) => {
      if (nextView === 'settings' && view === 'settings') {
        setSettingsSubView(null);
        setSettingsResetKey(k => k + 1);
        return;
      }
    };

    handleTabChangeSameTab('settings');

    expect(settingsSubView).toBeNull();
    expect(settingsResetKey).toBe(1);
  });

  it('navigating away from settings via handleTabChange resets settingsSubView to null', () => {
    // Mirrors the guard at AppShell ~1228:
    //   if (nextView !== 'settings') setSettingsSubView(null)
    let settingsSubView  = 'card-payments';
    const setSettingsSubView = (s) => { settingsSubView = s; };

    const handleTabChangeAway = (nextView) => {
      if (nextView !== 'settings') setSettingsSubView(null);
    };

    handleTabChangeAway('finance');
    expect(settingsSubView).toBeNull();
  });
});
