// @vitest-environment jsdom
/**
 * Keyboard-safe edit sheets — regression tests (fix/line-editor-keyboard-save)
 *
 * Bug: QuoteLineEditorSheet ("Add a line") autoFocuses its Description field,
 * so the on-screen keyboard opens immediately. The action row (Cancel/Save/
 * Delete) ended up unreachable behind the keyboard — the founder typed an
 * amount and could not save it.
 *
 * Fix: .edit-field-sheet .modal-sheet-header sticks to the top and
 * .edit-field-actions sticks to the bottom of .modal-sheet's own scrollport
 * (.modal-sheet is overflow-y:auto and shrinks by --kb-inset when the
 * keyboard opens — see useKeyboardInset.js). This is shared CSS, so every
 * .edit-field-sheet consumer (QuoteLineEditorSheet, EditFieldModal, LogoModal,
 * and JobDetailDrawer's VisitEditorSheet) gets the same keyboard safety.
 *
 * jsdom has no visualViewport / on-screen keyboard, and this project's vitest
 * config does not process CSS in tests (see vitest.config.js — no `css: true`),
 * so we can't assert computed `position: sticky` here. Two things ARE worth
 * asserting and catching regressions on:
 *
 *   1. DOM structure — the action row stays inside the scrollable
 *      `.modal-sheet.edit-field-sheet` container (not, say, rendered as a
 *      sibling overlay outside it), which is the precondition the CSS fix
 *      relies on.
 *   2. The CSS source itself — a plain string assertion against index.css
 *      that the sticky rules exist and target the right selectors. Crude,
 *      but it turns "someone deletes the fix" into a red test rather than a
 *      silent regression, matching this project's no-DOM pure-logic test
 *      convention used elsewhere (see addPriceRouting.test.js).
 *
 * Manual verification (can't be automated — see PR description) is the real
 * proof: iOS Safari PWA + Android Chrome, keyboard up, Save reachable.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

afterEach(cleanup);

const NOOP = () => {};

// ── DOM structure: action row lives inside the scrollable sheet ────────────

vi.mock('../../lib/supabase.js', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: 'https://example.com/logo.png' } })),
      })),
    },
  },
}));

import QuoteLineEditorSheet from '../QuoteLineEditorSheet.jsx';
import EditFieldModal from '../EditFieldModal.jsx';
import LogoModal from '../LogoModal.jsx';

/**
 * Shared structural assertion: the action row (containing the Save button)
 * must be a descendant of the same element that carries the shared
 * `modal-sheet edit-field-sheet` classes — the element the CSS fix targets.
 * If a future change moved the actions row out of this container (e.g. into
 * a portal, or a differently-classed wrapper), this fails loudly instead of
 * silently reintroducing the unreachable-Save bug.
 */
function expectActionsInsideKeyboardSafeSheet(container, saveButtonText) {
  const saveBtn = screen.getByText(saveButtonText, { selector: 'button' });
  const actionsRow = saveBtn.closest('.edit-field-actions');
  expect(actionsRow).toBeTruthy();

  const sheet = actionsRow.closest('.modal-sheet');
  expect(sheet).toBeTruthy();
  expect(sheet.classList.contains('edit-field-sheet')).toBe(true);

  // The actions row and the sheet must be the SAME scroll container the CSS
  // fix relies on — i.e. actionsRow's sticky-positioning ancestor is .modal-sheet,
  // not some intermediate wrapper the fix doesn't reach.
  expect(actionsRow.parentElement === sheet || sheet.contains(actionsRow)).toBe(true);
}

describe('QuoteLineEditorSheet — action row stays inside the keyboard-safe sheet', () => {
  it('Save/Cancel sit inside .modal-sheet.edit-field-sheet (add mode)', () => {
    render(
      <QuoteLineEditorSheet open item={null} onSave={NOOP} onCancel={NOOP} />
    );
    expectActionsInsideKeyboardSafeSheet(document.body, 'Save');
  });

  it('Delete button (edit mode) also sits inside the actions row', () => {
    render(
      <QuoteLineEditorSheet
        open
        item={{ desc: 'Labour', cost: 300 }}
        onSave={NOOP}
        onDelete={NOOP}
        onCancel={NOOP}
      />
    );
    const deleteBtn = screen.getByText('Delete');
    expect(deleteBtn.closest('.edit-field-actions')).toBeTruthy();
  });

  it('Description field keeps autoFocus (fast entry must survive the fix)', () => {
    render(
      <QuoteLineEditorSheet open item={null} onSave={NOOP} onCancel={NOOP} />
    );
    const descInput = screen.getByLabelText('Line item description');
    expect(descInput).toHaveFocus();
  });
});

describe('EditFieldModal — action row stays inside the keyboard-safe sheet', () => {
  it('Save/Cancel sit inside .modal-sheet.edit-field-sheet', () => {
    render(
      <EditFieldModal
        open
        fieldKey="business_name"
        fieldLabel="Business name"
        currentValue="Acme Plumbing"
        onSave={NOOP}
        onClose={NOOP}
      />
    );
    expectActionsInsideKeyboardSafeSheet(document.body, 'Save');
  });
});

describe('LogoModal — action row stays inside the keyboard-safe sheet', () => {
  it('Save/Cancel (paste-URL tab) sit inside .modal-sheet.edit-field-sheet', () => {
    render(<LogoModal currentUrl="" userId="user-1" onSave={NOOP} onClose={NOOP} />);
    fireEvent.click(screen.getByText('Paste URL'));
    expectActionsInsideKeyboardSafeSheet(document.body, 'Save');
  });
});

// ── CSS source: the sticky rules exist and target the right selectors ──────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(__dirname, '../../index.css'), 'utf8');

/**
 * Pulls the full declaration block for a given selector out of index.css so
 * we can assert on its properties without a real CSS parser. Assumes (true
 * for this file) the selector appears with `{` immediately after it and a
 * matching `}` closes the block before another top-level selector starts.
 */
function ruleBlock(selector) {
  const idx = css.indexOf(`${selector} {`);
  expect(idx, `selector "${selector}" not found in index.css`).toBeGreaterThan(-1);
  const closeIdx = css.indexOf('}', idx);
  return css.slice(idx, closeIdx + 1);
}

describe('index.css — keyboard-safe sheet rules (regression guard)', () => {
  it('.edit-field-sheet .modal-sheet-header sticks to the top of the scrollport', () => {
    const block = ruleBlock('.edit-field-sheet .modal-sheet-header');
    expect(block).toContain('position: sticky');
    expect(block).toContain('top: 0');
  });

  it('.edit-field-actions sticks to the bottom of the scrollport', () => {
    const block = ruleBlock('.edit-field-actions');
    expect(block).toContain('position: sticky');
    expect(block).toContain('bottom: 0');
    expect(block).toContain('background: var(--surface)');
  });

  it('.modal-sheet is the scrolling ancestor the sticky rules rely on', () => {
    const block = ruleBlock('.modal-sheet');
    expect(block).toContain('overflow-y: auto');
    // Shrinks by --kb-inset (written by useKeyboardInset) so the shrunken
    // scrollport — not the sticky positioning alone — is what keeps the
    // header/footer within the visible area above the keyboard.
    expect(block).toContain('--kb-inset');
  });
});
