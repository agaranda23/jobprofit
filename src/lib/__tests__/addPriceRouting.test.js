/**
 * Unit tests for the "+ Add price" routing fix (fix/add-price-route-to-line-editor).
 *
 * No DOM, no React, no @testing-library — pure logic, matches project convention.
 *
 * The routing predicate is: filter existingItems = lineItems where (desc || cost > 0).
 * chipPriceHandler / openPriceEditor routes on existingItems.length, NOT needsPrice.
 *
 *   0 items  → route to 'amount' (free-number modal, seeds a line)
 *   1 item   → route to 'lineSheet' (Edit-line sheet for that line)
 *   2+ items → route to 'accordion' (expand+scroll, user picks)
 *
 * Also tests:
 *   - handleAmountSave invariant guard (existingItems.length > 0 → discard typed number)
 *   - QuoteLineEditorSheet cost=0 presentation (empty, not '0')
 *   - handleSaveLiLine correctly derives total from sum of lineItems
 */

import { describe, it, expect, vi } from 'vitest';
import { needsPrice } from '../jobStatus';

// ---------------------------------------------------------------------------
// Mirrors the openPriceEditor routing predicate extracted from JobDetailDrawer.
// The real function is a closure over React state setters; here we test the
// pure decision logic by mirroring the exact filter and branching.
// ---------------------------------------------------------------------------

function computeExistingItems(lineItems) {
  return (Array.isArray(lineItems) ? lineItems : []).filter(i => i.desc || i.cost > 0);
}

/**
 * Mirrors chipPriceHandler / openPriceEditor routing:
 * returns 'amount' | 'lineSheet' | 'accordion'
 */
function resolveRoute(job) {
  const existing = computeExistingItems(job.lineItems);
  if (existing.length === 0) return 'amount';
  if (existing.length === 1) return 'lineSheet';
  return 'accordion';
}

/**
 * Mirrors the Option A invariant guard in handleAmountSave.
 * Returns the derivedTotal that handleAmountSave would write (ignoring the
 * typed number when existingItems.length > 0).
 */
function simulateAmountSave(job, typedNumber) {
  const existingItems = computeExistingItems(job.lineItems);
  if (existingItems.length > 0) {
    // Invariant guard: discard typed number, re-derive from existing lines.
    return existingItems.reduce((s, i) => s + Number(i.cost || 0), 0);
  }
  // Zero-line branch: seed a line from the typed number.
  return typedNumber;
}

/**
 * Mirrors handleSaveLiLine — saves an edited line and derives the new total.
 */
function simulateSaveLiLine(job, idx, { desc, cost }) {
  const base = (Array.isArray(job.lineItems) ? job.lineItems : []).filter(i => i.desc || i.cost);
  let next;
  if (idx === -1) {
    next = [...base, { desc, cost: Number(cost) }];
  } else {
    next = base.map((item, i) => i === idx ? { ...item, desc, cost: Number(cost) } : item);
  }
  const newTotal = next.reduce((s, i) => s + Number(i.cost || 0), 0);
  return { lineItems: next, total: newTotal, amount: newTotal };
}

// ---------------------------------------------------------------------------
// Routing — the core fix
// ---------------------------------------------------------------------------

describe('openPriceEditor routing by existingItems.length', () => {
  it('zero lines (empty lineItems) → routes to amount modal', () => {
    expect(resolveRoute({ lineItems: [] })).toBe('amount');
  });

  it('no lineItems field at all → routes to amount modal', () => {
    expect(resolveRoute({})).toBe('amount');
  });

  it('one line with desc but cost=0 (the founder bug) → routes to lineSheet', () => {
    const job = { lineItems: [{ desc: 'Job Stage', cost: 0 }] };
    expect(resolveRoute(job)).toBe('lineSheet');
  });

  it('one line with desc and cost>0 → routes to lineSheet', () => {
    const job = { lineItems: [{ desc: 'Labour', cost: 300 }] };
    expect(resolveRoute(job)).toBe('lineSheet');
  });

  it('one line with cost>0 but no desc → routes to lineSheet (has real cost)', () => {
    const job = { lineItems: [{ desc: '', cost: 150 }] };
    expect(resolveRoute(job)).toBe('lineSheet');
  });

  it('one line with no desc and cost=0 → treated as empty (no real item) → routes to amount', () => {
    const job = { lineItems: [{ desc: '', cost: 0 }] };
    expect(resolveRoute(job)).toBe('amount');
  });

  it('two lines both £0 with descs → routes to accordion (multi-line)', () => {
    const job = { lineItems: [{ desc: 'Labour', cost: 0 }, { desc: 'Materials', cost: 0 }] };
    expect(resolveRoute(job)).toBe('accordion');
  });

  it('two lines with costs → routes to accordion', () => {
    const job = { lineItems: [{ desc: 'Labour', cost: 200 }, { desc: 'Skip', cost: 80 }] };
    expect(resolveRoute(job)).toBe('accordion');
  });

  it('lineItems with a mix of real and empty entries → counts only real ones', () => {
    // One real (has desc), one phantom (no desc, no cost) → length 1 → lineSheet
    const job = { lineItems: [{ desc: 'Job Stage', cost: 0 }, { desc: '', cost: 0 }] };
    expect(resolveRoute(job)).toBe('lineSheet');
  });
});

// ---------------------------------------------------------------------------
// Regression: the old needsPrice routing (WRONG) vs the new existingItems routing (CORRECT)
// ---------------------------------------------------------------------------

describe('routing regression — needsPrice alone is NOT the correct gate', () => {
  it('needsPrice is true for a £0 seed-line job — old code would open the wrong modal', () => {
    const job = { total: 0, lineItems: [{ desc: 'Job Stage', cost: 0 }] };
    // Old (broken): needsPrice → open free-number modal → Save discards the typed number
    expect(needsPrice(job)).toBe(true);
    // New (fixed): existingItems.length === 1 → open line sheet
    expect(resolveRoute(job)).toBe('lineSheet');
  });
});

// ---------------------------------------------------------------------------
// handleAmountSave invariant — guard must stay as-is
// ---------------------------------------------------------------------------

describe('handleAmountSave invariant guard (Option A, PRD 2026-06-13)', () => {
  it('zero lines → typed number is used (seeds a line)', () => {
    const job = { lineItems: [] };
    expect(simulateAmountSave(job, 300)).toBe(300);
  });

  it('one £0 seed-line → typed number is DISCARDED, derived total = 0', () => {
    // This is the deliberate guard. The routing fix prevents this path being
    // reached when lines exist — but the guard itself must stay intact.
    const job = { lineItems: [{ desc: 'Job Stage', cost: 0 }] };
    expect(simulateAmountSave(job, 300)).toBe(0);
  });

  it('one £150 line → typed number is DISCARDED, derived total = 150', () => {
    const job = { lineItems: [{ desc: 'Labour', cost: 150 }] };
    expect(simulateAmountSave(job, 999)).toBe(150);
  });

  it('two lines summing £250 → typed number discarded, derived = 250', () => {
    const job = { lineItems: [{ desc: 'Labour', cost: 200 }, { desc: 'Skip', cost: 50 }] };
    expect(simulateAmountSave(job, 999)).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// handleSaveLiLine — saving via the line sheet updates total correctly
// ---------------------------------------------------------------------------

describe('handleSaveLiLine — total derives from sum of lineItems (invariant upheld)', () => {
  it('editing index 0 on a £0 seed-line: enter 300 → total becomes 300', () => {
    const job = { lineItems: [{ desc: 'Job Stage', cost: 0 }] };
    const result = simulateSaveLiLine(job, 0, { desc: 'Job Stage', cost: 300 });
    expect(result.total).toBe(300);
    expect(result.amount).toBe(300);
    expect(result.lineItems[0].cost).toBe(300);
  });

  it('adding a new line (idx=-1) appends and recalculates total', () => {
    const job = { lineItems: [{ desc: 'Labour', cost: 200 }] };
    const result = simulateSaveLiLine(job, -1, { desc: 'Materials', cost: 80 });
    expect(result.lineItems).toHaveLength(2);
    expect(result.total).toBe(280);
  });

  it('editing one of two lines updates only that line and recalculates total', () => {
    const job = { lineItems: [{ desc: 'Labour', cost: 200 }, { desc: 'Skip', cost: 50 }] };
    const result = simulateSaveLiLine(job, 1, { desc: 'Skip hire', cost: 120 });
    expect(result.lineItems[1].cost).toBe(120);
    expect(result.total).toBe(320);
  });

  it('zero-line job, editing index 0 with no prior lines: seeds and sets total', () => {
    const job = { lineItems: [] };
    const result = simulateSaveLiLine(job, -1, { desc: 'Job', cost: 500 });
    expect(result.total).toBe(500);
    expect(result.lineItems).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// QuoteLineEditorSheet cost initialisation — cost=0 must present as empty
// ---------------------------------------------------------------------------

describe('QuoteLineEditorSheet cost field initialisation', () => {
  // Mirrors the corrected setCost logic:
  //   item != null && Number(item.cost) !== 0 ? String(item.cost ?? '') : ''
  function initCostField(item) {
    if (item == null) return '';
    return Number(item.cost) !== 0 ? String(item.cost ?? '') : '';
  }

  it('item with cost=0 → initialises to empty string (not "0")', () => {
    expect(initCostField({ desc: 'Job Stage', cost: 0 })).toBe('');
  });

  it('item with cost=300 → initialises to "300"', () => {
    expect(initCostField({ desc: 'Labour', cost: 300 })).toBe('300');
  });

  it('new item (null) → initialises to empty string', () => {
    expect(initCostField(null)).toBe('');
  });

  it('item with cost=0.5 → initialises to "0.5" (non-zero small value is shown)', () => {
    expect(initCostField({ desc: 'Test', cost: 0.5 })).toBe('0.5');
  });

  it('item with cost undefined → initialises to empty string', () => {
    expect(initCostField({ desc: 'Test', cost: undefined })).toBe('');
  });
});
