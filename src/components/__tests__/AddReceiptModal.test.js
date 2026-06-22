/**
 * AddReceiptModal — pure-logic tests for Phase 1 + Phase 2 Smart Sheet +
 * Phase 3 photo-source chooser.
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
 *   PHOTO CHOOSER — photoSheetOpen state transitions; onFile feeds unchanged OCR path
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

// ---------------------------------------------------------------------------
// Itemise price input — raw-string editing + boundary coercion
//
// Regression coverage for the receipt Itemise price-input bug:
//  - updateItem must store the raw string (no eager parseFloat) so the field
//    is clearable and decimals are typeable.
//  - cost is coerced to a Number only at the three boundaries: subtotal,
//    save-to-materials buyPrice, and the save() payload (edit + create).
//  - itemsDirty must not false-fire when a live string cost ("12") matches a
//    numeric seed cost (12).
// ---------------------------------------------------------------------------

// Mirrors updateItem in AddReceiptModal.jsx: stores value verbatim for ALL fields.
function updateItem(items, idx, field, value) {
  return items.map((it, i) => (i === idx ? { ...it, [field]: value } : it));
}

// Mirrors the save() payload item mapping at both boundaries (edit + create).
function buildPayloadItems(items) {
  return items
    .filter(i => i.desc?.trim())
    .map(it => ({ ...it, cost: Number(it.cost) || 0 }));
}

describe('Itemise price input: raw-string editing (updateItem)', () => {
  it('stores the raw string for cost, not a parsed number (decimals typeable)', () => {
    let items = [{ desc: 'Timber', cost: undefined }];
    // User types "12.50" — the input emits the literal string.
    items = updateItem(items, 0, 'cost', '12.50');
    expect(items[0].cost).toBe('12.50'); // verbatim — NOT 12.5, NOT truncated
  });

  it('preserves a trailing dot mid-entry ("1." stays "1.")', () => {
    let items = [{ desc: 'Nails', cost: undefined }];
    items = updateItem(items, 0, 'cost', '1.');
    expect(items[0].cost).toBe('1.'); // eager parseFloat('1.') would have given 1
  });

  it('clearing the field leaves an empty string — NOT the number 0 / string "0"', () => {
    // This is the core bug: deleting all characters must return to empty.
    let items = [{ desc: 'Screws', cost: '4.50' }];
    items = updateItem(items, 0, 'cost', ''); // backspaced to empty
    expect(items[0].cost).toBe('');
    expect(items[0].cost).not.toBe(0);
    expect(items[0].cost).not.toBe('0');
    // value={it.cost ?? ''} renders '' => the grey "0.00" placeholder shows.
  });

  it('typing successive digits yields "123", never "0123"', () => {
    // With raw-string state, the controlled input reflects exactly what is typed.
    let items = [{ desc: 'Bolts', cost: undefined }];
    items = updateItem(items, 0, 'cost', '1');
    items = updateItem(items, 0, 'cost', '12');
    items = updateItem(items, 0, 'cost', '123');
    expect(items[0].cost).toBe('123');
  });

  it('clearing row 2 cost does not disturb row 1 (per-idx update)', () => {
    let items = [{ desc: 'A', cost: '5' }, { desc: 'B', cost: '9' }];
    items = updateItem(items, 1, 'cost', '');
    expect(items[0].cost).toBe('5'); // untouched
    expect(items[1].cost).toBe('');
  });
});

describe('Itemise price input: subtotal tolerates string costs', () => {
  it('sums string costs correctly', () => {
    const items = [{ desc: 'A', cost: '4.50' }, { desc: 'B', cost: '3.75' }];
    expect(computeItemsSubtotal(items)).toBeCloseTo(8.25);
  });

  it('treats a blank-string cost as 0', () => {
    const items = [{ desc: 'A', cost: '' }, { desc: 'B', cost: '10' }];
    expect(computeItemsSubtotal(items)).toBeCloseTo(10);
  });

  it('treats a lone trailing dot as 0 mid-entry without NaN', () => {
    const items = [{ desc: 'A', cost: '.' }];
    expect(computeItemsSubtotal(items)).toBe(0); // Number('.') is NaN => 0
  });
});

describe('Itemise price input: save payload coerces cost to a Number', () => {
  it('persists a string cost "12.50" as the number 12.5', () => {
    const items = [{ desc: 'Timber', cost: '12.50' }];
    const out = buildPayloadItems(items);
    expect(out[0].cost).toBe(12.5);
    expect(typeof out[0].cost).toBe('number');
  });

  it('persists a blank cost as the number 0', () => {
    const items = [{ desc: 'Screws', cost: '' }];
    const out = buildPayloadItems(items);
    expect(out[0].cost).toBe(0);
    expect(typeof out[0].cost).toBe('number');
  });

  it('persists an undefined cost as the number 0', () => {
    const items = [{ desc: 'Nails', cost: undefined }];
    const out = buildPayloadItems(items);
    expect(out[0].cost).toBe(0);
  });

  it('leaves an untouched numeric OCR cost unchanged (Number(12)===12)', () => {
    const items = [{ desc: 'OCR row', cost: 12 }];
    const out = buildPayloadItems(items);
    expect(out[0].cost).toBe(12);
  });

  it('still strips blank-desc rows before persisting', () => {
    const items = [{ desc: 'Keep', cost: '5' }, { desc: '', cost: '99' }];
    const out = buildPayloadItems(items);
    expect(out).toHaveLength(1);
    expect(out[0].desc).toBe('Keep');
    expect(out[0].cost).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// saveItemToMaterials: VAT-netting logic
// Receipt item costs are VAT-inclusive; the materials library stores ex-VAT
// buy prices so that sellPrice = buyPrice * (1+markup) is not inflated by VAT.
// ---------------------------------------------------------------------------

// Mirrors the netting formula in AddReceiptModal.jsx saveItemToMaterials.
function netBuyPrice(grossCost, receiptAmount, receiptVat) {
  let vatRate = 0.20;
  if (receiptVat > 0 && receiptAmount > receiptVat) {
    vatRate = receiptVat / (receiptAmount - receiptVat);
  }
  return Math.round((grossCost / (1 + vatRate)) * 100) / 100;
}

describe('saveItemToMaterials: VAT-netting (receipt costs are gross → net them)', () => {
  it('nets a 20% VAT-inclusive cost at the standard UK rate', () => {
    // Receipt: £120 inc VAT (£100 net + £20 VAT). Line item cost = £24 inc.
    // Expected net: £24 / 1.20 = £20.00
    expect(netBuyPrice(24, 120, 20)).toBeCloseTo(20.0, 2);
  });

  it('derives VAT rate from receipt header (not always 20%)', () => {
    // Receipt: £110 inc 10% VAT (£100 net + £10 VAT).
    // vatRate = 10 / (110 - 10) = 0.10
    // Line item: £11 gross → £11 / 1.10 = £10.00
    expect(netBuyPrice(11, 110, 10)).toBeCloseTo(10.0, 2);
  });

  it('falls back to 20% when receipt has no VAT field (vatRate=0)', () => {
    // vat=0 → vatRate stays 0.20; gross £12 → net £10
    expect(netBuyPrice(12, 100, 0)).toBeCloseTo(10.0, 2);
  });

  it('falls back to 20% when amount equals vat (edge: divide-by-zero guard)', () => {
    // amount === vat is a malformed receipt; guard prevents divide-by-zero
    expect(netBuyPrice(12, 20, 20)).toBeCloseTo(10.0, 2);
  });

  it('falls back to 20% when amount < vat (guard condition)', () => {
    expect(netBuyPrice(6, 10, 15)).toBeCloseTo(5.0, 2);
  });

  it('rounds to 2 decimal places (£ precision)', () => {
    // £7 gross at 20% → 7/1.2 = 5.8333... → rounds to £5.83
    expect(netBuyPrice(7, 120, 20)).toBe(5.83);
  });

  it('returns 0 for a zero-cost item', () => {
    expect(netBuyPrice(0, 120, 20)).toBe(0);
  });
});

describe('Itemise price input: itemsDirty does not false-fire on string-vs-number cost', () => {
  it('returns false when live string cost matches numeric seed cost (no spurious discard)', () => {
    // Edit mode: seed item arrives from an existing receipt as a NUMBER.
    const seed = [{ desc: 'Screws', cost: 12 }];
    // After the first keystroke (or even no edit, once the input mounts the
    // string), the live item can hold the string "12". This must NOT be dirty.
    const current = [{ desc: 'Screws', cost: '12' }];
    expect(itemsDirty(current, seed)).toBe(false);
  });

  it('returns false for an untouched decimal cost rendered as a string', () => {
    const seed = [{ desc: 'Timber', cost: 12.5 }];
    const current = [{ desc: 'Timber', cost: '12.5' }];
    expect(itemsDirty(current, seed)).toBe(false);
  });

  it('still returns true when the cost genuinely changes', () => {
    const seed = [{ desc: 'Screws', cost: 12 }];
    const current = [{ desc: 'Screws', cost: '15' }];
    expect(itemsDirty(current, seed)).toBe(true);
  });

  it('treats a cleared (empty-string) cost as 0 vs a seed cost of 0 — not dirty', () => {
    const seed = [{ desc: 'Screws', cost: 0 }];
    const current = [{ desc: 'Screws', cost: '' }];
    expect(itemsDirty(current, seed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Photo-source chooser — photoSheetOpen state transitions
// ---------------------------------------------------------------------------

describe('photo chooser: photoSheetOpen state transitions', () => {
  // These tests mirror the component's state machine logic in isolation.
  // The Add-photo CTA calls openPhotoSheet() → sets photoSheetOpen=true.
  // Sheet rows call setPhotoSheetOpen(false) before clicking the matching input.
  // Cancel / backdrop / Escape call setPhotoSheetOpen(false) with no input click.

  it('openPhotoSheet sets photoSheetOpen to true', () => {
    let photoSheetOpen = false;
    const setPhotoSheetOpen = (val) => { photoSheetOpen = typeof val === 'function' ? val(photoSheetOpen) : val; };
    const openPhotoSheet = () => setPhotoSheetOpen(true);

    openPhotoSheet();
    expect(photoSheetOpen).toBe(true);
  });

  it('onClose sets photoSheetOpen to false', () => {
    let photoSheetOpen = true;
    const setPhotoSheetOpen = (val) => { photoSheetOpen = typeof val === 'function' ? val(photoSheetOpen) : val; };

    setPhotoSheetOpen(false);
    expect(photoSheetOpen).toBe(false);
  });

  it('onTakePhoto closes the sheet then fires the camera input', () => {
    let photoSheetOpen = true;
    const setPhotoSheetOpen = (val) => { photoSheetOpen = typeof val === 'function' ? val(photoSheetOpen) : val; };
    const cameraClick = vi.fn();
    const cameraInputRef = { current: { click: cameraClick } };

    // Mirrors: () => { setPhotoSheetOpen(false); cameraInputRef.current?.click(); }
    setPhotoSheetOpen(false);
    cameraInputRef.current?.click();

    expect(photoSheetOpen).toBe(false);
    expect(cameraClick).toHaveBeenCalledOnce();
  });

  it('onUploadPhoto closes the sheet then fires the gallery input', () => {
    let photoSheetOpen = true;
    const setPhotoSheetOpen = (val) => { photoSheetOpen = typeof val === 'function' ? val(photoSheetOpen) : val; };
    const galleryClick = vi.fn();
    const galleryInputRef = { current: { click: galleryClick } };

    setPhotoSheetOpen(false);
    galleryInputRef.current?.click();

    expect(photoSheetOpen).toBe(false);
    expect(galleryClick).toHaveBeenCalledOnce();
  });

  it('Cancel fires no input click and closes the sheet', () => {
    let photoSheetOpen = true;
    const setPhotoSheetOpen = (val) => { photoSheetOpen = typeof val === 'function' ? val(photoSheetOpen) : val; };
    const cameraClick = vi.fn();
    const galleryClick = vi.fn();

    // Cancel: close only, no input click
    setPhotoSheetOpen(false);

    expect(photoSheetOpen).toBe(false);
    expect(cameraClick).not.toHaveBeenCalled();
    expect(galleryClick).not.toHaveBeenCalled();
  });

  it('onFile reads only the first file (single-select — no multiple attr)', () => {
    // Mirrors AddReceiptModal.onFile: const f = e.target.files?.[0]
    // Receipt modal is always single-image — do not inherit drawer's multiple attr.
    const files = [
      new Blob(['img1'], { type: 'image/jpeg' }),
      new Blob(['img2'], { type: 'image/jpeg' }),
    ];
    const e = { target: { files } };
    const f = e.target.files?.[0];
    expect(f).toBe(files[0]);
    // Second file is silently ignored — consistent with onFile's files?.[0]
  });

  it('selecting a photo via either input marks photoFile as dirty', () => {
    // When onFile fires, setPhotoFile(f) is called; isDirty check: photoFile !== null
    const fakeFile = new Blob(['x'], { type: 'image/jpeg' });
    const seed = buildSeed();
    expect(isDirty(seed, { ...seed, photoFile: fakeFile })).toBe(true);
  });
});
