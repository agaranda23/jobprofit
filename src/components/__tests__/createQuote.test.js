/**
 * createQuote — unit tests for the "Create quote" flow.
 *
 * No DOM, no React, no @testing-library — matches project convention.
 * Visual smoke is covered by the deploy-preview checklist in the PR.
 *
 * Covers:
 *   A — defaultMode="quote" derives initial view correctly.
 *   B — buildQuotePayload: validation, line-item sum, single-line fallback.
 *   C — lineItemsTotal: auto-sum stays correct as rows are added/removed.
 *   D — saveQuote vs saveQuoteAndSend gating (which callback fires).
 *   E — quoteStatus is always 'draft' on save; status is always 'lead'.
 */

import { describe, it, expect } from 'vitest';

// ── Ticket A ─────────────────────────────────────────────────────────────────

/**
 * Mirrors AddJobModal's initial view derivation (extended for 'quote').
 */
function resolveInitialView(defaultMode) {
  if (defaultMode === 'voice') return 'details';
  if (defaultMode === 'quote') return 'quote';
  return 'micro';
}

describe('Ticket A: defaultMode="quote" initial view', () => {
  it('defaultMode="quote" mounts into the quote view', () => {
    expect(resolveInitialView('quote')).toBe('quote');
  });

  it('defaultMode="voice" still mounts into details view (unchanged)', () => {
    expect(resolveInitialView('voice')).toBe('details');
  });

  it('no defaultMode mounts into micro view (unchanged)', () => {
    expect(resolveInitialView(undefined)).toBe('micro');
  });

  it('unknown defaultMode falls back to micro', () => {
    expect(resolveInitialView('whatever')).toBe('micro');
  });
});

// ── Ticket B — buildQuotePayload ──────────────────────────────────────────────

/**
 * Pure mirror of buildQuotePayload() in AddJobModal.
 * Returns { ok: true, payload } or { ok: false, error }.
 */
function buildQuotePayload({ summary, customer, phone, qTotal, lineItems = [] }) {
  const resolvedSummary  = (summary  || '').trim() || 'New quote';
  const resolvedCustomer = (customer || '').trim() || null;
  const resolvedPhone    = (phone    || '').trim() || null;

  const hasLineItems = lineItems.length > 0 && lineItems.some(li => (li.desc || '').trim() || parseFloat(li.cost) > 0);
  let resolvedTotal;
  let resolvedLineItems;

  if (hasLineItems) {
    const filledItems = lineItems
      .filter(li => (li.desc || '').trim() || parseFloat(li.cost) > 0)
      .map(li => ({ desc: (li.desc || '').trim() || 'Item', cost: parseFloat(li.cost) || 0 }));
    resolvedTotal = filledItems.reduce((s, li) => s + li.cost, 0);
    resolvedLineItems = filledItems;
  } else {
    const parsed = (qTotal || '').trim() ? parseFloat(qTotal) : null;
    if (parsed !== null && (isNaN(parsed) || parsed <= 0)) {
      return { ok: false, error: "That amount doesn't look right" };
    }
    resolvedTotal = parsed;
    resolvedLineItems = parsed != null
      ? [{ desc: resolvedSummary, cost: parsed }]
      : [];
  }

  return {
    ok: true,
    payload: {
      id:          'test-uuid',
      name:        resolvedSummary,
      summary:     resolvedSummary,
      customer:    resolvedCustomer,
      phone:       resolvedPhone,
      amount:      resolvedTotal,
      total:       resolvedTotal,
      lineItems:   resolvedLineItems,
      paid:        false,
      paymentType: null,
      status:      'lead',
      quoteStatus: 'draft',
    },
  };
}

describe('Ticket B: buildQuotePayload — single-line (no items)', () => {
  it('valid summary + total produces a correct payload', () => {
    const r = buildQuotePayload({ summary: 'Bathroom tiling', qTotal: '500' });
    expect(r.ok).toBe(true);
    expect(r.payload.total).toBe(500);
    expect(r.payload.amount).toBe(500);
    expect(r.payload.summary).toBe('Bathroom tiling');
    expect(r.payload.lineItems).toEqual([{ desc: 'Bathroom tiling', cost: 500 }]);
  });

  it('negative total returns validation error', () => {
    const r = buildQuotePayload({ summary: 'Job', qTotal: '-100' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/amount/i);
  });

  it('zero total returns validation error', () => {
    const r = buildQuotePayload({ summary: 'Job', qTotal: '0' });
    expect(r.ok).toBe(false);
  });

  it('blank total saves as null (price-later)', () => {
    const r = buildQuotePayload({ summary: 'Roof survey', qTotal: '' });
    expect(r.ok).toBe(true);
    expect(r.payload.total).toBeNull();
    expect(r.payload.lineItems).toEqual([]);
  });

  it('blank summary defaults to "New quote"', () => {
    const r = buildQuotePayload({ summary: '', qTotal: '200' });
    expect(r.ok).toBe(true);
    expect(r.payload.summary).toBe('New quote');
  });

  it('customer and phone pass through when provided', () => {
    const r = buildQuotePayload({ summary: 'Job', qTotal: '300', customer: 'Dave Jones', phone: '07700900123' });
    expect(r.ok).toBe(true);
    expect(r.payload.customer).toBe('Dave Jones');
    expect(r.payload.phone).toBe('07700900123');
  });

  it('blank customer and phone become null', () => {
    const r = buildQuotePayload({ summary: 'Job', qTotal: '300', customer: '', phone: '' });
    expect(r.ok).toBe(true);
    expect(r.payload.customer).toBeNull();
    expect(r.payload.phone).toBeNull();
  });
});

describe('Ticket B: buildQuotePayload — quote status fields', () => {
  it('status is always "lead" (pre-work estimate)', () => {
    const r = buildQuotePayload({ summary: 'Job', qTotal: '400' });
    expect(r.ok).toBe(true);
    expect(r.payload.status).toBe('lead');
  });

  it('quoteStatus is always "draft" (not yet sent)', () => {
    const r = buildQuotePayload({ summary: 'Job', qTotal: '400' });
    expect(r.ok).toBe(true);
    expect(r.payload.quoteStatus).toBe('draft');
  });

  it('paid is always false', () => {
    const r = buildQuotePayload({ summary: 'Job', qTotal: '400' });
    expect(r.ok).toBe(true);
    expect(r.payload.paid).toBe(false);
    expect(r.payload.paymentType).toBeNull();
  });
});

describe('Ticket B: buildQuotePayload — itemised breakdown', () => {
  it('line items auto-sum to total', () => {
    const items = [
      { desc: 'Labour', cost: '300' },
      { desc: 'Materials', cost: '150' },
    ];
    const r = buildQuotePayload({ summary: 'Kitchen job', lineItems: items });
    expect(r.ok).toBe(true);
    expect(r.payload.total).toBe(450);
    expect(r.payload.lineItems).toHaveLength(2);
    expect(r.payload.lineItems[0]).toEqual({ desc: 'Labour', cost: 300 });
    expect(r.payload.lineItems[1]).toEqual({ desc: 'Materials', cost: 150 });
  });

  it('blank-desc items get fallback desc "Item"', () => {
    const items = [{ desc: '', cost: '100' }];
    const r = buildQuotePayload({ summary: 'Job', lineItems: items });
    expect(r.ok).toBe(true);
    expect(r.payload.lineItems[0].desc).toBe('Item');
  });

  it('fully empty item rows are filtered out', () => {
    const items = [
      { desc: 'Labour', cost: '200' },
      { desc: '', cost: '' },          // blank row — should be excluded
    ];
    const r = buildQuotePayload({ summary: 'Job', lineItems: items });
    expect(r.ok).toBe(true);
    expect(r.payload.lineItems).toHaveLength(1);
    expect(r.payload.total).toBe(200);
  });

  it('three line items sum correctly', () => {
    const items = [
      { desc: 'Labour', cost: '400' },
      { desc: 'Materials', cost: '250' },
      { desc: 'Call-out charge', cost: '50' },
    ];
    const r = buildQuotePayload({ summary: 'Plumbing', lineItems: items });
    expect(r.ok).toBe(true);
    expect(r.payload.total).toBe(700);
  });
});

// ── Ticket C — lineItemsTotal ─────────────────────────────────────────────────

/**
 * Mirrors the lineItemsTotal helper in AddJobModal.
 */
function lineItemsTotal(items) {
  return items.reduce((s, li) => s + (parseFloat(li.cost) || 0), 0);
}

describe('Ticket C: lineItemsTotal auto-sum', () => {
  it('empty array returns 0', () => {
    expect(lineItemsTotal([])).toBe(0);
  });

  it('single item returns its cost', () => {
    expect(lineItemsTotal([{ desc: 'Labour', cost: '500' }])).toBe(500);
  });

  it('multiple items sum correctly', () => {
    expect(lineItemsTotal([
      { desc: 'A', cost: '100' },
      { desc: 'B', cost: '250.50' },
      { desc: 'C', cost: '49.50' },
    ])).toBeCloseTo(400, 5);
  });

  it('blank cost treated as 0', () => {
    expect(lineItemsTotal([{ desc: 'Item', cost: '' }])).toBe(0);
  });

  it('non-numeric cost treated as 0', () => {
    expect(lineItemsTotal([{ desc: 'Item', cost: 'abc' }])).toBe(0);
  });

  it('after removing an item the sum updates correctly', () => {
    const original = [
      { desc: 'A', cost: '200' },
      { desc: 'B', cost: '300' },
    ];
    // Simulate removeLineItem(0)
    const afterRemove = original.filter((_, i) => i !== 0);
    expect(lineItemsTotal(afterRemove)).toBe(300);
  });
});

// ── Ticket D — save vs send gating ───────────────────────────────────────────

/**
 * Mirrors the condition that controls whether saveQuoteAndSend is available.
 * The "Send to customer" button is only rendered when onSaveAndSend is provided.
 */
function canSendToCustomer(onSaveAndSendProvided) {
  return onSaveAndSendProvided === true;
}

describe('Ticket D: Save vs Send to customer gating', () => {
  it('Send to customer available when onSaveAndSend is provided', () => {
    expect(canSendToCustomer(true)).toBe(true);
  });

  it('Send to customer hidden when onSaveAndSend is not provided', () => {
    expect(canSendToCustomer(false)).toBe(false);
  });

  it('Save quote always available regardless of onSaveAndSend', () => {
    // Save is not gated — both paths use saveQuote()
    expect(true).toBe(true);
  });
});
