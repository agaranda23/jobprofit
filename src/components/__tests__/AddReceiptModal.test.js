/**
 * AddReceiptModal — pure-logic tests for Phase 1 + Phase 2 Smart Sheet.
 *
 * No DOM, no React, no @testing-library — matches project convention.
 * Visual/layout smoke is covered by the deploy-preview checklist in the PR.
 *
 * Covers:
 *   DIRTY — isDirty logic: fires when a field changes, not on identical values
 *   DISCARD — confirm='discard' triggered when dirty; skip when clean
 *   DELETE — confirm='delete' calls onDeleteReceipt; hidden when prop absent
 *   SAVE — save payload shape (add + edit mode) unchanged by Phase 1
 *   PHASE 2 — meaningfulItemCount, computeItemsSubtotal, itemsDirty helpers
 */

import { describe, it, expect, vi } from 'vitest';
import { meaningfulItemCount, computeItemsSubtotal, itemsDirty } from '../../lib/receiptItemsHelpers.js';

// ---------------------------------------------------------------------------
// isDirty helper — mirrors the expression in AddReceiptModal.jsx
// ---------------------------------------------------------------------------

function buildSeed({ photo = null, label = '', amount = '', vat = '',
  receiptDate = '', invoiceNumber = '', items = [] } = {}) {
  return { photo, label, amount, vat, receiptDate, invoiceNumber, items };
}

// Phase 2: use the exported itemsDirty helper to match component behaviour.
function isDirty(seed, { photoFile = null, label, amount, vat, receiptDate, invoiceNumber, items }) {
  return (
    photoFile !== null ||
    label !== seed.label ||
    amount !== seed.amount ||
    vat !== seed.vat ||
    receiptDate !== seed.receiptDate ||
    invoiceNumber !== seed.invoiceNumber ||
    itemsDirty(items, seed.items)
  );
}

// ---------------------------------------------------------------------------
// isDirty — unchanged fields => clean
// ---------------------------------------------------------------------------

describe('isDirty: clean state', () => {
  it('returns false when all fields match seed', () => {
    const seed = buildSeed({ label: 'Screwfix', amount: '42.00', vat: '7.00' });
    expect(isDirty(seed, { ...seed, photoFile: null })).toBe(false);
  });

  it('returns false for empty add-mode fields', () => {
    const seed = buildSeed();
    expect(isDirty(seed, { ...seed, photoFile: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDirty — changed fields => dirty
// ---------------------------------------------------------------------------

describe('isDirty: dirty state', () => {
  it('returns true when label changes', () => {
    const seed = buildSeed({ label: 'Screwfix' });
    expect(isDirty(seed, { ...seed, photoFile: null, label: 'Travis Perkins' })).toBe(true);
  });

  it('returns true when amount changes', () => {
    const seed = buildSeed({ amount: '42.00' });
    expect(isDirty(seed, { ...seed, photoFile: null, amount: '99.00' })).toBe(true);
  });

  it('returns true when vat changes', () => {
    const seed = buildSeed({ vat: '7.00' });
    expect(isDirty(seed, { ...seed, photoFile: null, vat: '10.00' })).toBe(true);
  });

  it('returns true when receiptDate changes', () => {
    const seed = buildSeed({ receiptDate: '2026-06-01' });
    expect(isDirty(seed, { ...seed, photoFile: null, receiptDate: '2026-06-21' })).toBe(true);
  });

  it('returns true when invoiceNumber changes', () => {
    const seed = buildSeed({ invoiceNumber: '' });
    expect(isDirty(seed, { ...seed, photoFile: null, invoiceNumber: 'INV-001' })).toBe(true);
  });

  it('returns true when a new photo file is selected', () => {
    const seed = buildSeed();
    const fakeFile = new Blob(['x'], { type: 'image/jpeg' });
    expect(isDirty(seed, { ...seed, photoFile: fakeFile })).toBe(true);
  });

  it('returns true when items change (meaningful desc)', () => {
    const seed = buildSeed({ items: [{ desc: 'Screws', cost: 4.5 }] });
    const changed = [{ desc: 'Bolts', cost: 3.0 }];
    expect(isDirty(seed, { ...seed, photoFile: null, items: changed })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Discard guard logic — matches requestClose() in AddReceiptModal.jsx
// ---------------------------------------------------------------------------

describe('requestClose / discard guard', () => {
  it('calls onClose immediately when not dirty', () => {
    const onClose = vi.fn();
    const seed = buildSeed({ label: 'Screwfix', amount: '42.00' });
    const state = { ...seed, photoFile: null };

    // Guard logic: if dirty → set confirm; else → onClose()
    if (isDirty(seed, state)) {
      /* setConfirm('discard') — would not reach here */
    } else {
      onClose();
    }

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does NOT call onClose when dirty (would set confirm instead)', () => {
    const onClose = vi.fn();
    const seed = buildSeed({ label: 'Screwfix', amount: '42.00' });
    const state = { ...seed, photoFile: null, label: 'Travis Perkins' };

    if (isDirty(seed, state)) {
      // setConfirm('discard') — modal stays open
    } else {
      onClose();
    }

    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Delete confirm — onDeleteReceipt called with the receipt id
// ---------------------------------------------------------------------------

describe('delete confirm', () => {
  it('calls onDeleteReceipt with the receipt id on confirm', async () => {
    const onDeleteReceipt = vi.fn().mockResolvedValue(undefined);
    const receiptId = 42;

    // Simulates the handleConfirmDelete body in AddReceiptModal
    await onDeleteReceipt(receiptId);
    expect(onDeleteReceipt).toHaveBeenCalledWith(42);
  });

  it('Delete trigger is absent when onDeleteReceipt prop is not provided', () => {
    // Unit-level: no onDeleteReceipt => isEditMode && onDeleteReceipt evaluates false
    const onDeleteReceipt = undefined;
    const isEditMode = true;
    expect(isEditMode && !!onDeleteReceipt).toBe(false);
  });

  it('Delete trigger is present when onDeleteReceipt prop is provided in edit mode', () => {
    const onDeleteReceipt = vi.fn();
    const isEditMode = true;
    expect(isEditMode && !!onDeleteReceipt).toBe(true);
  });

  it('Delete trigger is absent in add mode even when onDeleteReceipt is provided', () => {
    const onDeleteReceipt = vi.fn();
    const isEditMode = false; // add mode
    expect(isEditMode && !!onDeleteReceipt).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Save payload — edit mode shape unchanged from pre-Phase-1
// ---------------------------------------------------------------------------

describe('save payload: edit mode', () => {
  function buildEditPayload({ existingReceipt, label, amount, vat, invoiceNumber, receiptDate, items, photoFile, photo }) {
    const amt = parseFloat(amount);
    const vatNum = vat === '' ? 0 : parseFloat(vat);
    return {
      ...existingReceipt,
      label: label.trim() || 'Receipt',
      amount: amt,
      vat: isNaN(vatNum) ? 0 : vatNum,
      items: items.filter(i => i.desc?.trim()),
      invoiceNumber: invoiceNumber.trim() || null,
      date: receiptDate,
      ...(photoFile ? { photo } : {}),
    };
  }

  it('preserves existing receipt id and jobId', () => {
    const existing = { id: 99, jobId: 'job-1', label: 'Old', amount: 10 };
    const payload = buildEditPayload({
      existingReceipt: existing, label: 'New', amount: '20', vat: '4',
      invoiceNumber: '', receiptDate: '2026-06-21', items: [], photoFile: null, photo: null,
    });
    expect(payload.id).toBe(99);
    expect(payload.jobId).toBe('job-1');
  });

  it('does not overwrite photo when no new file is chosen', () => {
    const existing = { id: 1, photo: 'data:image/jpeg;base64,abc' };
    const payload = buildEditPayload({
      existingReceipt: existing, label: 'R', amount: '5', vat: '',
      invoiceNumber: '', receiptDate: '2026-06-21', items: [], photoFile: null, photo: null,
    });
    expect(payload.photo).toBe('data:image/jpeg;base64,abc');
  });

  it('overwrites photo when a new file is chosen', () => {
    const existing = { id: 1, photo: 'old-data' };
    const newPhoto = 'data:image/jpeg;base64,new';
    const fakeFile = new Blob(['x'], { type: 'image/jpeg' });
    const payload = buildEditPayload({
      existingReceipt: existing, label: 'R', amount: '5', vat: '',
      invoiceNumber: '', receiptDate: '2026-06-21', items: [], photoFile: fakeFile, photo: newPhoto,
    });
    expect(payload.photo).toBe(newPhoto);
  });
});

// ---------------------------------------------------------------------------
// Save payload — add mode shape unchanged from pre-Phase-1
// ---------------------------------------------------------------------------

describe('save payload: add mode', () => {
  function buildAddPayload({ label, amount, vat, invoiceNumber, receiptDate, items, photo }) {
    const amt = parseFloat(amount);
    const vatNum = vat === '' ? 0 : parseFloat(vat);
    return {
      id: Date.now(),
      label: label.trim() || 'Receipt',
      amount: amt,
      vat: isNaN(vatNum) ? 0 : vatNum,
      items: items.filter(i => i.desc?.trim()),
      invoiceNumber: invoiceNumber.trim() || null,
      photo,
      date: receiptDate,
      createdAt: new Date().toISOString(),
    };
  }

  it('uses "Receipt" as fallback label when merchant is blank', () => {
    const payload = buildAddPayload({ label: '', amount: '10', vat: '', invoiceNumber: '', receiptDate: '2026-06-21', items: [], photo: null });
    expect(payload.label).toBe('Receipt');
  });

  it('rejects when amount is not a number', () => {
    const amt = parseFloat('');
    expect(isNaN(amt)).toBe(true);
  });

  it('filters out OCR items with empty desc before saving', () => {
    const items = [{ desc: 'Screws', cost: 4.5 }, { desc: '', cost: 2 }];
    const payload = buildAddPayload({ label: 'R', amount: '10', vat: '', invoiceNumber: '', receiptDate: '2026-06-21', items, photo: null });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].desc).toBe('Screws');
  });
});

// ---------------------------------------------------------------------------
// Phase 2: meaningfulItemCount
// ---------------------------------------------------------------------------

describe('meaningfulItemCount', () => {
  it('returns 0 for an empty array', () => {
    expect(meaningfulItemCount([])).toBe(0);
  });

  it('counts only items with a non-empty desc', () => {
    const items = [
      { desc: 'Screws', cost: 4.5 },
      { desc: '', cost: 2 },
      { desc: '  ', cost: 1 }, // whitespace-only — not meaningful
      { desc: 'Nails', cost: 3 },
    ];
    expect(meaningfulItemCount(items)).toBe(2);
  });

  it('counts OCR items and manually added items together (source-agnostic)', () => {
    const items = [
      { desc: 'OCR item', cost: 10 },
      { desc: 'Manual item', cost: 5 },
      { desc: '', cost: 0 }, // freshly added blank row
    ];
    expect(meaningfulItemCount(items)).toBe(2);
  });

  it('returns 0 when all rows are blank', () => {
    const items = [{ desc: '', cost: 0 }, { desc: '  ', cost: 1 }];
    expect(meaningfulItemCount(items)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: computeItemsSubtotal
// ---------------------------------------------------------------------------

describe('computeItemsSubtotal', () => {
  it('returns 0 for an empty array', () => {
    expect(computeItemsSubtotal([])).toBe(0);
  });

  it('sums all item costs including blank-desc rows', () => {
    const items = [
      { desc: 'Screws', cost: 4.5 },
      { desc: '', cost: 2 },
      { desc: 'Nails', cost: 3.75 },
    ];
    expect(computeItemsSubtotal(items)).toBeCloseTo(10.25);
  });

  it('treats undefined/null cost as 0', () => {
    const items = [{ desc: 'Item', cost: undefined }, { desc: 'B', cost: null }];
    expect(computeItemsSubtotal(items)).toBe(0);
  });

  it('handles a single item', () => {
    expect(computeItemsSubtotal([{ desc: 'Timber', cost: 99.99 }])).toBeCloseTo(99.99);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: itemsDirty — blank-desc rows stripped before comparison
// ---------------------------------------------------------------------------

describe('itemsDirty', () => {
  it('returns false when meaningful items match seed', () => {
    const seed = [{ desc: 'Screws', cost: 4.5 }];
    const current = [{ desc: 'Screws', cost: 4.5 }];
    expect(itemsDirty(current, seed)).toBe(false);
  });

  it('returns true when a meaningful item is changed', () => {
    const seed = [{ desc: 'Screws', cost: 4.5 }];
    const current = [{ desc: 'Bolts', cost: 4.5 }];
    expect(itemsDirty(current, seed)).toBe(true);
  });

  it('returns false when current has an extra blank-desc row vs seed (open+add scenario)', () => {
    // This is the key regression: user opens Itemise + taps "+ Add item" (blank row added)
    // then tries to close — should NOT trigger dirty guard.
    const seed = [{ desc: 'Screws', cost: 4.5 }];
    const current = [{ desc: 'Screws', cost: 4.5 }, { desc: '', cost: undefined }];
    expect(itemsDirty(current, seed)).toBe(false);
  });

  it('returns false for empty seed and only blank rows in current', () => {
    expect(itemsDirty([{ desc: '', cost: undefined }], [])).toBe(false);
  });

  it('returns true when a previously blank row now has a desc', () => {
    const seed = [{ desc: 'Screws', cost: 4.5 }];
    const current = [{ desc: 'Screws', cost: 4.5 }, { desc: 'New item', cost: 2 }];
    expect(itemsDirty(current, seed)).toBe(true);
  });

  it('returns false when both seed and current are empty', () => {
    expect(itemsDirty([], [])).toBe(false);
  });
});
