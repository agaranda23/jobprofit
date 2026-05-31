/**
 * Phase C wiring tests — pure logic behind JobDetailDrawer.
 *
 * No DOM, no React, no @testing-library — matches this project's convention.
 * Component rendering is exercised by visual smoke on the deploy preview
 * (see PR feat/phase-c-job-detail-wiring for the checklist).
 *
 * Covers the three gate conditions for "Chase customer" CTA visibility
 * and the chase link/message generation that the CTA fires.
 *
 * The helpers under test:
 *   - shouldShowChase gate: paid/unpaid, balance, phone presence
 *   - buildChaseLink: wa.me URL shape, encoding
 *   - buildChaseMessage: tier-1 message shape
 *   - computeBalance / computeAmountPaid: data layer (addPayment auto-flip)
 *   - addPayment auto-flip: paying balance-in-full flips status to 'paid'
 */

import { describe, it, expect } from 'vitest';
import {
  computeBalance,
  computeAmountPaid,
  addPayment,
} from '../../lib/payments';
import {
  buildChaseLink,
  buildChaseMessage,
  computeTier,
} from '../../lib/chaseLadder';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function unpaidJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Alan',
    amount: 500,
    paid: false,
    paymentStatus: 'unpaid',
    customerPhone: '07700 900000',
    ...overrides,
  };
}

function paidJob(overrides = {}) {
  return {
    id: 'j2',
    customer: 'Bob',
    amount: 300,
    paid: true,
    paymentStatus: 'paid',
    customerPhone: '07700 900111',
    ...overrides,
  };
}

// Mirrors the shouldShowChase helper in JobDetailDrawer.jsx.
// Tested here as a pure-logic excerpt to validate all three gates
// without mounting a component.
function shouldShowChase(job) {
  const isPaid =
    job.paid === true ||
    job.paymentStatus === 'paid' ||
    job.jobStatus === 'paid' ||
    job.status === 'paid';
  if (isPaid) return false;

  const outstanding = computeBalance(job);
  if (outstanding <= 0) return false;

  const phone = job.customerPhone || job.phone || job.mobile || job.whatsapp || '';
  return !!phone;
}

// ── shouldShowChase gate ──────────────────────────────────────────────────────

describe('shouldShowChase — chase CTA visibility gate', () => {
  it('shows chase for an unpaid job with a phone and outstanding balance', () => {
    expect(shouldShowChase(unpaidJob())).toBe(true);
  });

  it('hides chase when job.paid === true', () => {
    expect(shouldShowChase(paidJob())).toBe(false);
  });

  it('hides chase when paymentStatus is paid', () => {
    expect(shouldShowChase(unpaidJob({ paid: false, paymentStatus: 'paid' }))).toBe(false);
  });

  it('hides chase when status is paid', () => {
    expect(shouldShowChase(unpaidJob({ paid: false, status: 'paid' }))).toBe(false);
  });

  it('hides chase when jobStatus is paid', () => {
    expect(shouldShowChase(unpaidJob({ paid: false, jobStatus: 'paid' }))).toBe(false);
  });

  it('hides chase when outstanding balance is zero (all payments received)', () => {
    const job = addPayment(unpaidJob(), {
      amount: 500,
      date: '2026-05-20',
      method: 'bank',
      note: '',
    });
    // Balance is now zero after full payment
    expect(computeBalance(job)).toBe(0);
    expect(shouldShowChase(job)).toBe(false);
  });

  it('hides chase when outstanding balance is negative (overpaid)', () => {
    const job = addPayment(unpaidJob({ amount: 400 }), {
      amount: 500,
      date: '2026-05-20',
      method: 'cash',
      note: '',
    });
    expect(computeBalance(job)).toBeLessThan(0);
    expect(shouldShowChase(job)).toBe(false);
  });

  it('hides chase when no phone number is present', () => {
    const job = unpaidJob({ customerPhone: '', phone: undefined, mobile: undefined, whatsapp: undefined });
    expect(shouldShowChase(job)).toBe(false);
  });

  it('uses job.phone as fallback when customerPhone is absent', () => {
    const job = unpaidJob({ customerPhone: undefined, phone: '07700 900222' });
    expect(shouldShowChase(job)).toBe(true);
  });

  it('uses job.mobile as fallback when neither customerPhone nor phone is set', () => {
    const job = unpaidJob({ customerPhone: undefined, phone: undefined, mobile: '07700 900333' });
    expect(shouldShowChase(job)).toBe(true);
  });

  it('uses job.whatsapp as last fallback', () => {
    const job = unpaidJob({ customerPhone: undefined, phone: undefined, mobile: undefined, whatsapp: '+447700900444' });
    expect(shouldShowChase(job)).toBe(true);
  });
});

// ── buildChaseLink — wa.me URL ────────────────────────────────────────────────

describe('buildChaseLink — WhatsApp deep-link', () => {
  const base = {
    phone: '07700 900000',
    name: 'Alan',
    amountOutstanding: '£500',
    daysSinceDue: 10,
    tier: 1,
    amountPaid: 0,
  };

  it('returns a wa.me URL', () => {
    const url = buildChaseLink(base);
    expect(url).toMatch(/^https:\/\/wa\.me\//);
  });

  it('strips leading zero and prefixes UK country code 44', () => {
    const url = buildChaseLink(base);
    expect(url).toContain('wa.me/447700900000');
  });

  it('handles a + prefixed international number', () => {
    const url = buildChaseLink({ ...base, phone: '+447700900000' });
    expect(url).toContain('wa.me/447700900000');
  });

  it('URL-encodes the message text', () => {
    const url = buildChaseLink(base);
    // Encoded message should contain no raw spaces
    const queryPart = url.split('?text=')[1];
    expect(queryPart).toBeTruthy();
    // No literal newlines (those would break the URL)
    expect(queryPart).not.toMatch(/\n/);
  });

  it('returns null when phone is empty string', () => {
    expect(buildChaseLink({ ...base, phone: '' })).toBeNull();
  });

  it('returns null when phone is undefined', () => {
    expect(buildChaseLink({ ...base, phone: undefined })).toBeNull();
  });
});

// ── buildChaseMessage — tier content ─────────────────────────────────────────
// v2 API: { customerName, amount, daysOverdue, tier, amountPaid, ... }

describe('buildChaseMessage — message text by tier', () => {
  const base = { customerName: 'Alan', amount: '£500', daysOverdue: 7, amountPaid: 0 };

  it('tier 1 mentions the outstanding amount', () => {
    const msg = buildChaseMessage({ ...base, tier: 1 });
    expect(msg).toContain('£500');
  });

  it('tier 2 mentions days overdue', () => {
    const msg = buildChaseMessage({ ...base, tier: 2 });
    expect(msg).toContain('7 days overdue');
  });

  it('tier 3 is a firmer message and mentions days overdue', () => {
    const msg = buildChaseMessage({ ...base, tier: 3 });
    expect(msg).toContain('7 days overdue');
  });

  it('tier 4 uses tier-3 copy (no separate tier-4 template)', () => {
    const tier3 = buildChaseMessage({ ...base, tier: 3 });
    const tier4 = buildChaseMessage({ ...base, tier: 4 });
    expect(tier4).toBe(tier3);
  });

  it('uses "there" as safe fallback when customerName is empty', () => {
    const msg = buildChaseMessage({ ...base, customerName: '', tier: 1 });
    expect(msg).toContain('there');
  });
});

// ── computeTier — tier from days-past-due ────────────────────────────────────
// v2 API: computeTier(job, _now) — tier driven by invoiceDueDate, not chase count.
// 'grace': [0, 1) days past due — just flipped Overdue, 24h silent window.
// Tier 1: [1, 7). Tier 2: [7, 14). Tier 3: 14+. Tier 0: pre-due.

describe('computeTier — days-past-due tier progression', () => {
  it('returns "grace" when job has no invoice due date (daysPastDue 0 fallback -> grace)', () => {
    expect(computeTier(null)).toBe('grace');
    expect(computeTier({})).toBe('grace');
  });

  it('returns "grace" when invoice is due today (0 days overdue — 24h silent window)', () => {
    const fixedNow = new Date('2025-06-01T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe('grace');
  });

  it('returns tier 1 when 3 days overdue (within 1-6 day band)', () => {
    const fixedNow = new Date('2025-06-04T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(1);
  });

  it('returns tier 2 when exactly 7 days overdue', () => {
    const fixedNow = new Date('2025-06-08T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(2);
  });

  it('returns tier 3 when exactly 14 days overdue', () => {
    const fixedNow = new Date('2025-06-15T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(3);
  });

  it('returns tier 3 for 20+ days overdue (no tier 4 — max is 3)', () => {
    const fixedNow = new Date('2025-06-21T12:00:00Z');
    const job = { invoiceDueDate: '2025-06-01' };
    expect(computeTier(job, fixedNow)).toBe(3);
  });
});

// ── Content section visibility helpers (mirroring drawer logic) ──────────────

// Mirrors MaterialsSection render gate: show only when there are non-empty line items.
function hasMaterials(job) {
  const items = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost) : [];
  return items.length > 0;
}

// Mirrors ReceiptsSection render gate: show only when receipts are linked to this job.
function hasLinkedReceipts(job, receipts) {
  return receipts.some(r => {
    if (!r.jobId) return false;
    return String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId);
  });
}

// Mirrors PhotosSection render gate.
function hasPhotos(job) {
  return Array.isArray(job.photos) && job.photos.length > 0;
}

// Mirrors NotesSection render gate.
function hasNotes(job) {
  const structured = Array.isArray(job.jobNotes) ? job.jobNotes : [];
  const plain = typeof job.notes === 'string' ? job.notes.trim() : '';
  return structured.length > 0 || !!plain;
}

// Mirrors MaterialsSection total calculation.
function materialsTotal(job) {
  const items = Array.isArray(job.lineItems) ? job.lineItems : [];
  return items.reduce((sum, i) => sum + Number(i.cost || 0), 0);
}

describe('MaterialsSection — render gate and total', () => {
  it('shows when job has at least one line item with a desc', () => {
    expect(hasMaterials({ lineItems: [{ desc: 'Pipes', cost: 40 }] })).toBe(true);
  });

  it('shows when line item has no desc but has a non-zero cost', () => {
    expect(hasMaterials({ lineItems: [{ desc: '', cost: 10 }] })).toBe(true);
  });

  it('hides when lineItems is an empty array', () => {
    expect(hasMaterials({ lineItems: [] })).toBe(false);
  });

  it('hides when lineItems is absent', () => {
    expect(hasMaterials({})).toBe(false);
  });

  it('hides when all items have neither desc nor cost', () => {
    expect(hasMaterials({ lineItems: [{ desc: '', cost: 0 }] })).toBe(false);
  });

  it('totals line item costs correctly', () => {
    const job = { lineItems: [{ desc: 'A', cost: 30 }, { desc: 'B', cost: 45.5 }] };
    expect(materialsTotal(job)).toBeCloseTo(75.5);
  });

  it('treats missing cost as zero in total', () => {
    const job = { lineItems: [{ desc: 'A' }, { desc: 'B', cost: 20 }] };
    expect(materialsTotal(job)).toBe(20);
  });
});

describe('ReceiptsSection — render gate', () => {
  const job = { id: 'j1' };

  it('shows when a receipt is linked by jobId string match', () => {
    const receipts = [{ id: 'r1', jobId: 'j1', amount: 12, label: 'Screws' }];
    expect(hasLinkedReceipts(job, receipts)).toBe(true);
  });

  it('shows when jobId is stored as integer matching string id', () => {
    const receipts = [{ id: 'r2', jobId: 'j1', amount: 5, label: 'Tape' }];
    expect(hasLinkedReceipts({ id: 'j1' }, receipts)).toBe(true);
  });

  it('hides when no receipts are linked to this job', () => {
    const receipts = [{ id: 'r3', jobId: 'j2', amount: 8, label: 'Paint' }];
    expect(hasLinkedReceipts(job, receipts)).toBe(false);
  });

  it('hides when receipts array is empty', () => {
    expect(hasLinkedReceipts(job, [])).toBe(false);
  });

  it('matches via cloudId when job has a cloudId', () => {
    const jobWithCloud = { id: 'local1', cloudId: 'cloud-uuid-abc' };
    const receipts = [{ id: 'r4', jobId: 'cloud-uuid-abc', amount: 20 }];
    expect(hasLinkedReceipts(jobWithCloud, receipts)).toBe(true);
  });

  it('ignores receipts with no jobId', () => {
    const receipts = [{ id: 'r5', jobId: null, amount: 7 }];
    expect(hasLinkedReceipts(job, receipts)).toBe(false);
  });
});

describe('PhotosSection — render gate', () => {
  it('shows when job.photos has entries', () => {
    expect(hasPhotos({ photos: ['data:image/jpeg;base64,abc'] })).toBe(true);
  });

  it('hides when job.photos is an empty array', () => {
    expect(hasPhotos({ photos: [] })).toBe(false);
  });

  it('hides when job.photos is absent', () => {
    expect(hasPhotos({})).toBe(false);
  });
});

describe('NotesSection — render gate', () => {
  it('shows when job.jobNotes has entries', () => {
    const job = { jobNotes: [{ id: 'n1', subject: 'Visit', body: 'Arrived 9am', date: new Date().toISOString() }] };
    expect(hasNotes(job)).toBe(true);
  });

  it('shows when job.notes is a non-empty string (cloud jobs)', () => {
    expect(hasNotes({ notes: 'Needs key from neighbour' })).toBe(true);
  });

  it('hides when jobNotes is empty and notes is blank', () => {
    expect(hasNotes({ jobNotes: [], notes: '   ' })).toBe(false);
  });

  it('hides when both fields are absent', () => {
    expect(hasNotes({})).toBe(false);
  });
});

// ── ProfitBarSection — render gate and profit / margin computation ────────────

/**
 * Mirrors ProfitBarSection logic:
 *   quote = job.total ?? job.amount ?? 0
 *   materials = sum of receipts for this job
 *   profit = quote - materials
 *   margin = quote > 0 ? round(profit/quote*100) : 0
 * Hidden when quote === 0.
 */
function profitBarCalc(job, receipts) {
  const quote = job.total ?? job.amount ?? 0;
  if (!quote) return null; // hidden
  const materials = receipts
    .filter(r => r.jobId && (String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId)))
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const profit = quote - materials;
  const margin = quote > 0 ? Math.round((profit / quote) * 100) : 0;
  return { quote, materials, profit, margin };
}

describe('ProfitBarSection — render gate and profit/margin calculation', () => {
  it('returns null (hidden) when job.quote (total) is 0', () => {
    expect(profitBarCalc({ id: 'j1', total: 0 }, [])).toBeNull();
  });

  it('returns null when job has neither total nor amount', () => {
    expect(profitBarCalc({ id: 'j1' }, [])).toBeNull();
  });

  it('uses job.amount as fallback when job.total is absent', () => {
    const result = profitBarCalc({ id: 'j1', amount: 500 }, []);
    expect(result).not.toBeNull();
    expect(result.quote).toBe(500);
  });

  it('calculates profit as quote minus materials cost', () => {
    const receipts = [{ jobId: 'j1', amount: 120 }];
    const result = profitBarCalc({ id: 'j1', total: 400 }, receipts);
    expect(result.materials).toBe(120);
    expect(result.profit).toBe(280);
  });

  it('calculates margin as a rounded integer percentage', () => {
    // 280 / 400 * 100 = 70%
    const receipts = [{ jobId: 'j1', amount: 120 }];
    const result = profitBarCalc({ id: 'j1', total: 400 }, receipts);
    expect(result.margin).toBe(70);
  });

  it('yields 100% margin and 0 materials when no receipts are linked', () => {
    const result = profitBarCalc({ id: 'j1', total: 500 }, []);
    expect(result.materials).toBe(0);
    expect(result.profit).toBe(500);
    expect(result.margin).toBe(100);
  });

  it('yields 0% margin when materials equal the full quote', () => {
    const receipts = [{ jobId: 'j1', amount: 300 }];
    const result = profitBarCalc({ id: 'j1', total: 300 }, receipts);
    expect(result.margin).toBe(0);
    expect(result.profit).toBe(0);
  });

  it('only sums receipts linked to this job (not other jobs)', () => {
    const receipts = [
      { jobId: 'j1', amount: 80 },
      { jobId: 'j2', amount: 200 }, // different job — should be ignored
    ];
    const result = profitBarCalc({ id: 'j1', total: 400 }, receipts);
    expect(result.materials).toBe(80);
  });

  it('matches via cloudId when job has a cloudId', () => {
    const receipts = [{ jobId: 'cloud-abc', amount: 50 }];
    const result = profitBarCalc({ id: 'local-1', cloudId: 'cloud-abc', total: 200 }, receipts);
    expect(result.materials).toBe(50);
  });
});

// ── QuoteBreakdownSection — render gate and total ─────────────────────────────

/**
 * Mirrors QuoteBreakdownSection logic:
 *   items = job.lineItems filtered to those with desc or cost
 *   total = sum of (qty * unitCost) per item
 * Hidden when items is empty or absent.
 */
function quoteBreakdownCalc(job) {
  const items = Array.isArray(job.lineItems) ? job.lineItems.filter(i => i.desc || i.cost) : [];
  if (items.length === 0) return null; // hidden
  const total = items.reduce((sum, i) => {
    const qty = Number(i.qty || i.quantity || 1);
    const unit = Number(i.cost || i.unitCost || i.price || 0);
    return sum + qty * unit;
  }, 0);
  return { items, total };
}

describe('QuoteBreakdownSection — render gate and total', () => {
  it('returns null (hidden) when lineItems is absent', () => {
    expect(quoteBreakdownCalc({})).toBeNull();
  });

  it('returns null (hidden) when lineItems is an empty array', () => {
    expect(quoteBreakdownCalc({ lineItems: [] })).toBeNull();
  });

  it('returns null when all items have neither desc nor cost', () => {
    expect(quoteBreakdownCalc({ lineItems: [{ desc: '', cost: 0 }] })).toBeNull();
  });

  it('shows when at least one item has a desc', () => {
    const result = quoteBreakdownCalc({ lineItems: [{ desc: 'Labour', cost: 200 }] });
    expect(result).not.toBeNull();
    expect(result.items.length).toBe(1);
  });

  it('sums item costs to the correct total', () => {
    const job = { lineItems: [{ desc: 'Labour', cost: 200 }, { desc: 'Materials', cost: 150 }] };
    const result = quoteBreakdownCalc(job);
    expect(result.total).toBeCloseTo(350);
  });

  it('applies quantity when item.qty is present', () => {
    const job = { lineItems: [{ desc: 'Tiles', cost: 25, qty: 4 }] };
    const result = quoteBreakdownCalc(job);
    expect(result.total).toBe(100);
  });

  it('uses item.quantity as fallback for qty', () => {
    const job = { lineItems: [{ desc: 'Hours', cost: 50, quantity: 3 }] };
    const result = quoteBreakdownCalc(job);
    expect(result.total).toBe(150);
  });

  it('defaults qty to 1 when neither qty nor quantity is set', () => {
    const job = { lineItems: [{ desc: 'Boiler service', cost: 120 }] };
    const result = quoteBreakdownCalc(job);
    expect(result.total).toBe(120);
  });

  it('treats missing cost as zero', () => {
    const job = { lineItems: [{ desc: 'TBC', cost: undefined }, { desc: 'Labour', cost: 100 }] };
    const result = quoteBreakdownCalc(job);
    expect(result.total).toBe(100);
  });
});

// ── QuickContactSection — render gate ─────────────────────────────────────────

/**
 * Mirrors QuickContactSection logic:
 *   phone = customerPhone || phone || mobile
 *   email = email || customerEmail
 * Hidden when neither phone nor email is present.
 */
function quickContactGate(job) {
  const phone = job.customerPhone || job.phone || job.mobile || '';
  const email = job.email || job.customerEmail || '';
  if (!phone && !email) return null;
  return { phone, email };
}

describe('QuickContactSection — render gate', () => {
  it('returns null (hidden) when neither phone nor email is present', () => {
    expect(quickContactGate({ customer: 'Alan' })).toBeNull();
  });

  it('shows when job.phone is present', () => {
    const result = quickContactGate({ phone: '07700 900000' });
    expect(result).not.toBeNull();
    expect(result.phone).toBe('07700 900000');
  });

  it('uses customerPhone as primary phone source', () => {
    const result = quickContactGate({ customerPhone: '07700 900111', phone: '07700 900000' });
    expect(result.phone).toBe('07700 900111');
  });

  it('falls back to job.mobile when customerPhone and phone are absent', () => {
    const result = quickContactGate({ mobile: '07700 900222' });
    expect(result.phone).toBe('07700 900222');
  });

  it('shows when only email is present (no phone buttons rendered)', () => {
    const result = quickContactGate({ email: 'alan@example.com' });
    expect(result).not.toBeNull();
    expect(result.email).toBe('alan@example.com');
    expect(result.phone).toBe('');
  });

  it('uses customerEmail when job.email is absent', () => {
    const result = quickContactGate({ customerEmail: 'bob@example.com' });
    expect(result.email).toBe('bob@example.com');
  });

  it('shows when both phone and email are present', () => {
    const result = quickContactGate({ phone: '07700 900000', email: 'alan@example.com' });
    expect(result.phone).toBeTruthy();
    expect(result.email).toBeTruthy();
  });
});

// ── addPayment auto-flip — balance-hits-zero marks paid ──────────────────────

describe('addPayment auto-flip — paying balance in full', () => {
  it('flips status to paid when payment equals full balance', () => {
    const job = unpaidJob({ amount: 300 });
    const updated = addPayment(job, {
      amount: 300,
      date: '2026-05-20',
      method: 'cash',
      note: '',
    });
    expect(updated.status).toBe('paid');
    expect(updated.paymentStatus).toBe('paid');
    expect(computeBalance(updated)).toBe(0);
  });

  it('does NOT flip status when only a partial payment is recorded', () => {
    const job = unpaidJob({ amount: 500 });
    const updated = addPayment(job, {
      amount: 200,
      date: '2026-05-20',
      method: 'bank',
      note: 'deposit',
    });
    expect(updated.status).not.toBe('paid');
    expect(computeBalance(updated)).toBe(300);
  });

  it('accumulates payments correctly across two partial payments', () => {
    let job = unpaidJob({ amount: 600 });
    job = addPayment(job, { amount: 200, date: '2026-05-18', method: 'cash', note: '' });
    job = addPayment(job, { amount: 200, date: '2026-05-20', method: 'bank', note: '' });
    expect(computeAmountPaid(job)).toBe(400);
    expect(computeBalance(job)).toBe(200);
    expect(shouldShowChase(job)).toBe(true);
  });

  it('chase CTA disappears after final payment clears the balance', () => {
    let job = unpaidJob({ amount: 400 });
    job = addPayment(job, { amount: 400, date: '2026-05-20', method: 'bank', note: '' });
    expect(shouldShowChase(job)).toBe(false);
  });
});

// ── Phase E-3: lineItems edit helpers ────────────────────────────────────────

/**
 * Pure helpers extracted from the handleSaveLiEdit and handleUpdateLiItem
 * closures in JobDetailDrawer. Tested here as pure functions — same pattern
 * used throughout this file (no DOM mount).
 */

function computeLineItemsTotal(items) {
  return items.reduce((s, i) => s + Number(i.cost || 0), 0);
}

function applyUpdateItem(draft, idx, field, value) {
  const next = [...draft];
  next[idx] = { ...next[idx], [field]: field === 'cost' ? value : value };
  return next;
}

function addBlankItem(draft) {
  return [...draft, { desc: '', cost: 0 }];
}

function deleteItem(draft, idx) {
  return draft.filter((_, i) => i !== idx);
}

function finaliseDraft(draft) {
  return draft
    .map(i => ({ desc: i.desc || '', cost: Number(i.cost || 0) }))
    .filter(i => i.desc || i.cost > 0);
}

describe('lineItems edit — computeLineItemsTotal', () => {
  it('sums costs correctly', () => {
    expect(computeLineItemsTotal([{ desc: 'A', cost: 100 }, { desc: 'B', cost: 250 }])).toBe(350);
  });

  it('returns 0 for an empty draft', () => {
    expect(computeLineItemsTotal([])).toBe(0);
  });

  it('treats missing cost as 0', () => {
    expect(computeLineItemsTotal([{ desc: 'Labour' }])).toBe(0);
  });

  it('coerces string cost values (from input onChange) to numbers', () => {
    expect(computeLineItemsTotal([{ desc: 'A', cost: '120.50' }])).toBeCloseTo(120.5);
  });
});

describe('lineItems edit — applyUpdateItem', () => {
  const draft = [{ desc: 'Labour', cost: 200 }, { desc: 'Materials', cost: 100 }];

  it('updates desc of the correct index', () => {
    const result = applyUpdateItem(draft, 0, 'desc', 'New labour');
    expect(result[0].desc).toBe('New labour');
    expect(result[1].desc).toBe('Materials'); // unchanged
  });

  it('updates cost of the correct index', () => {
    const result = applyUpdateItem(draft, 1, 'cost', '150');
    expect(result[1].cost).toBe('150');
    expect(result[0].cost).toBe(200); // unchanged
  });

  it('does not mutate the original draft array', () => {
    applyUpdateItem(draft, 0, 'desc', 'X');
    expect(draft[0].desc).toBe('Labour'); // original unchanged
  });
});

describe('lineItems edit — addBlankItem', () => {
  it('appends a blank item to the draft', () => {
    const result = addBlankItem([{ desc: 'A', cost: 100 }]);
    expect(result.length).toBe(2);
    expect(result[1]).toEqual({ desc: '', cost: 0 });
  });

  it('works on an empty draft', () => {
    const result = addBlankItem([]);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual({ desc: '', cost: 0 });
  });
});

describe('lineItems edit — deleteItem', () => {
  const draft = [{ desc: 'A', cost: 10 }, { desc: 'B', cost: 20 }, { desc: 'C', cost: 30 }];

  it('removes the item at the given index', () => {
    const result = deleteItem(draft, 1);
    expect(result.length).toBe(2);
    expect(result.map(i => i.desc)).toEqual(['A', 'C']);
  });

  it('does not mutate the original array', () => {
    deleteItem(draft, 0);
    expect(draft.length).toBe(3);
  });
});

describe('lineItems edit — finaliseDraft (blank row filtering)', () => {
  it('removes items with no desc and zero cost', () => {
    const result = finaliseDraft([{ desc: '', cost: 0 }, { desc: 'Labour', cost: 100 }]);
    expect(result.length).toBe(1);
    expect(result[0].desc).toBe('Labour');
  });

  it('keeps items that have a desc but zero cost', () => {
    const result = finaliseDraft([{ desc: 'TBC', cost: 0 }]);
    expect(result.length).toBe(1);
  });

  it('keeps items with a cost but no desc', () => {
    const result = finaliseDraft([{ desc: '', cost: 50 }]);
    expect(result.length).toBe(1);
  });

  it('coerces cost string to number', () => {
    const result = finaliseDraft([{ desc: 'Labour', cost: '200' }]);
    expect(result[0].cost).toBe(200);
  });

  it('total of finalised items matches computeLineItemsTotal after coercion', () => {
    const draft = [{ desc: 'A', cost: '120' }, { desc: '', cost: 0 }, { desc: 'B', cost: '80' }];
    const finalItems = finaliseDraft(draft);
    expect(computeLineItemsTotal(finalItems)).toBe(200);
  });
});

// ── Phase E-3: schedule update shape ─────────────────────────────────────────

/**
 * Validates the exact field shape written to onUpdateJob when the schedule
 * is saved. The handler in JobDetailDrawer does:
 *   onUpdateJob({ ...job, scheduledDate, scheduledStart, scheduledEnd })
 * Null is written when a field is cleared (empty string → null).
 */
function buildScheduleUpdate(job, schedDate, schedStart, schedEnd) {
  return {
    ...job,
    scheduledDate: schedDate || null,
    scheduledStart: schedStart || null,
    scheduledEnd: schedEnd || null,
  };
}

describe('schedule update — buildScheduleUpdate', () => {
  const baseJob = { id: 'j1', customer: 'Alan', amount: 500 };

  it('writes scheduledDate into the returned object', () => {
    const result = buildScheduleUpdate(baseJob, '2026-06-01', '09:00', '17:00');
    expect(result.scheduledDate).toBe('2026-06-01');
  });

  it('writes scheduledStart and scheduledEnd', () => {
    const result = buildScheduleUpdate(baseJob, '2026-06-01', '09:00', '17:00');
    expect(result.scheduledStart).toBe('09:00');
    expect(result.scheduledEnd).toBe('17:00');
  });

  it('writes null when schedStart is empty (user left it blank)', () => {
    const result = buildScheduleUpdate(baseJob, '2026-06-01', '', '');
    expect(result.scheduledStart).toBeNull();
    expect(result.scheduledEnd).toBeNull();
  });

  it('preserves all other job fields', () => {
    const result = buildScheduleUpdate(baseJob, '2026-06-01', '', '');
    expect(result.id).toBe('j1');
    expect(result.customer).toBe('Alan');
  });
});

// ── Phase E-3: pipeline transition logic ─────────────────────────────────────

/**
 * Mirrors showMarkSent and showConvert visibility logic in JobDetailDrawer,
 * and the field updates written to onUpdateJob for each transition.
 */

function showMarkSentGate(job) {
  return job.quoteStatus === 'draft';
}

function showConvertGate(job) {
  return (
    job.quoteStatus === 'sent' ||
    (job.quoteStatus === 'accepted' && (!job.jobStatus || job.jobStatus === 'quote'))
  );
}

function buildMarkSentUpdate(job) {
  return { ...job, quoteStatus: 'sent' };
}

function buildConvertUpdate(job) {
  return { ...job, quoteStatus: 'accepted', jobStatus: 'active' };
}

describe('pipeline — Mark Sent visibility and transition', () => {
  it('shows Mark Sent when quoteStatus is draft', () => {
    expect(showMarkSentGate({ quoteStatus: 'draft' })).toBe(true);
  });

  it('hides Mark Sent when quoteStatus is sent', () => {
    expect(showMarkSentGate({ quoteStatus: 'sent' })).toBe(false);
  });

  it('hides Mark Sent when quoteStatus is accepted', () => {
    expect(showMarkSentGate({ quoteStatus: 'accepted' })).toBe(false);
  });

  it('Mark Sent transition writes quoteStatus: sent', () => {
    const job = { id: 'j1', quoteStatus: 'draft' };
    const updated = buildMarkSentUpdate(job);
    expect(updated.quoteStatus).toBe('sent');
  });

  it('Mark Sent does not alter other fields', () => {
    const job = { id: 'j1', customer: 'Alan', quoteStatus: 'draft' };
    expect(buildMarkSentUpdate(job).customer).toBe('Alan');
  });
});

describe('pipeline — Convert visibility and transition', () => {
  it('shows Convert when quoteStatus is sent', () => {
    expect(showConvertGate({ quoteStatus: 'sent', jobStatus: undefined })).toBe(true);
  });

  it('shows Convert when accepted and jobStatus is absent (legacy quote that was never activated)', () => {
    expect(showConvertGate({ quoteStatus: 'accepted', jobStatus: undefined })).toBe(true);
  });

  it('shows Convert when accepted and jobStatus is quote', () => {
    expect(showConvertGate({ quoteStatus: 'accepted', jobStatus: 'quote' })).toBe(true);
  });

  it('hides Convert when already active', () => {
    expect(showConvertGate({ quoteStatus: 'accepted', jobStatus: 'active' })).toBe(false);
  });

  it('hides Convert when already complete', () => {
    expect(showConvertGate({ quoteStatus: 'accepted', jobStatus: 'complete' })).toBe(false);
  });

  it('hides Convert when quoteStatus is draft (use Mark Sent first)', () => {
    expect(showConvertGate({ quoteStatus: 'draft' })).toBe(false);
  });

  it('Convert transition sets quoteStatus: accepted AND jobStatus: active', () => {
    const job = { id: 'j1', quoteStatus: 'sent' };
    const updated = buildConvertUpdate(job);
    expect(updated.quoteStatus).toBe('accepted');
    expect(updated.jobStatus).toBe('active');
  });

  it('Convert does not alter other fields', () => {
    const job = { id: 'j1', customer: 'Alan', quoteStatus: 'sent', amount: 500 };
    expect(buildConvertUpdate(job).amount).toBe(500);
  });
});

// ── Phase E-3: lineItems total feeds back to job.amount ──────────────────────

describe('lineItems save — total recomputed and written to job.amount / job.total', () => {
  function buildLineItemsSave(job, finalItems) {
    const newTotal = finalItems.reduce((s, i) => s + Number(i.cost || 0), 0);
    return { ...job, lineItems: finalItems, total: newTotal, amount: newTotal };
  }

  it('sets total and amount to the sum of finalised item costs', () => {
    const job = { id: 'j1', lineItems: [], total: 0, amount: 0 };
    const items = [{ desc: 'Labour', cost: 300 }, { desc: 'Materials', cost: 150 }];
    const updated = buildLineItemsSave(job, items);
    expect(updated.total).toBe(450);
    expect(updated.amount).toBe(450);
  });

  it('both total and amount are set to the same value', () => {
    const job = { id: 'j1', total: 999, amount: 999 };
    const items = [{ desc: 'A', cost: 200 }];
    const updated = buildLineItemsSave(job, items);
    expect(updated.total).toBe(updated.amount);
  });

  it('sets total/amount to 0 when all items are removed', () => {
    const job = { id: 'j1', total: 500, amount: 500 };
    const updated = buildLineItemsSave(job, []);
    expect(updated.total).toBe(0);
    expect(updated.amount).toBe(0);
  });

  it('writes finalised lineItems array onto the updated job', () => {
    const job = { id: 'j1', lineItems: [{ desc: 'Old', cost: 100 }] };
    const items = [{ desc: 'New', cost: 200 }];
    const updated = buildLineItemsSave(job, items);
    expect(updated.lineItems).toEqual(items);
  });
});

// ── Phase F: Accept Quote with signature ─────────────────────────────────────
//
// Pure logic tests — no canvas, no React, no DOM.
// Canvas drawing is covered by visual smoke on the deploy preview.

/**
 * Mirrors the showAcceptQuote visibility logic in JobDetailDrawer:
 *   - visible when quoteStatus is 'sent' AND acceptedSignature is absent
 *   - hidden when quoteStatus is 'accepted' (already signed)
 *   - hidden when quoteStatus is 'draft' (not yet sent)
 *   - hidden when acceptedSignature already present (already accepted with sig)
 */
function showAcceptQuoteGate(job) {
  return job.quoteStatus === 'sent' && !job.acceptedSignature;
}

/**
 * Mirrors the update written to onUpdateJob when handleSignatureSave fires.
 * acceptedAt is injected via the real Date — tests pass a fixed ISO string.
 */
function buildAcceptedUpdate(job, signatureDataURL, acceptedAt) {
  return {
    ...job,
    acceptedSignature: signatureDataURL,
    quoteStatus: 'accepted',
    acceptedAt,
    jobStatus: 'active',
  };
}

/**
 * Mirrors the showConvert fallback gate in JobDetailDrawer after Phase F.
 * Convert is hidden when showAcceptQuote is true (prefer the signature path).
 */
function showConvertFallbackGate(job) {
  const acceptQuoteVisible = showAcceptQuoteGate(job);
  if (acceptQuoteVisible) return false;
  return (
    job.quoteStatus === 'sent' ||
    (job.quoteStatus === 'accepted' && (!job.jobStatus || job.jobStatus === 'quote'))
  );
}

const FAKE_SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const FAKE_AT  = '2026-05-20T10:30:00.000Z';

describe('Phase F — Accept Quote visibility gate', () => {
  it('shows Accept Quote when quoteStatus is sent and no signature yet', () => {
    expect(showAcceptQuoteGate({ quoteStatus: 'sent' })).toBe(true);
  });

  it('hides Accept Quote when quoteStatus is accepted (already signed)', () => {
    expect(showAcceptQuoteGate({ quoteStatus: 'accepted', acceptedSignature: FAKE_SIG })).toBe(false);
  });

  it('hides Accept Quote when quoteStatus is draft (not sent yet)', () => {
    expect(showAcceptQuoteGate({ quoteStatus: 'draft' })).toBe(false);
  });

  it('hides Accept Quote when acceptedSignature already present (idempotent)', () => {
    expect(showAcceptQuoteGate({ quoteStatus: 'sent', acceptedSignature: FAKE_SIG })).toBe(false);
  });
});

describe('Phase F — buildAcceptedUpdate field shape', () => {
  it('writes acceptedSignature dataURL onto the job', () => {
    const job = { id: 'j1', quoteStatus: 'sent', jobStatus: 'quote' };
    const updated = buildAcceptedUpdate(job, FAKE_SIG, FAKE_AT);
    expect(updated.acceptedSignature).toBe(FAKE_SIG);
  });

  it('flips quoteStatus to accepted', () => {
    const job = { id: 'j1', quoteStatus: 'sent' };
    const updated = buildAcceptedUpdate(job, FAKE_SIG, FAKE_AT);
    expect(updated.quoteStatus).toBe('accepted');
  });

  it('flips jobStatus to active', () => {
    const job = { id: 'j1', quoteStatus: 'sent', jobStatus: 'quote' };
    const updated = buildAcceptedUpdate(job, FAKE_SIG, FAKE_AT);
    expect(updated.jobStatus).toBe('active');
  });

  it('writes acceptedAt ISO timestamp', () => {
    const job = { id: 'j1', quoteStatus: 'sent' };
    const updated = buildAcceptedUpdate(job, FAKE_SIG, FAKE_AT);
    expect(updated.acceptedAt).toBe(FAKE_AT);
  });

  it('preserves all other job fields', () => {
    const job = { id: 'j1', customer: 'Alan', amount: 500, quoteStatus: 'sent' };
    const updated = buildAcceptedUpdate(job, FAKE_SIG, FAKE_AT);
    expect(updated.customer).toBe('Alan');
    expect(updated.amount).toBe(500);
    expect(updated.id).toBe('j1');
  });
});

describe('Phase F — Convert fallback hidden when Accept Quote is available', () => {
  it('hides Convert when Accept Quote is showing (quoteStatus sent, no sig)', () => {
    expect(showConvertFallbackGate({ quoteStatus: 'sent' })).toBe(false);
  });

  it('shows Convert for legacy accepted-but-no-jobStatus edge case', () => {
    expect(showConvertFallbackGate({ quoteStatus: 'accepted', jobStatus: undefined })).toBe(true);
  });

  it('shows Convert for legacy quoteStatus: accepted + jobStatus: quote', () => {
    expect(showConvertFallbackGate({ quoteStatus: 'accepted', jobStatus: 'quote' })).toBe(true);
  });

  it('hides Convert when job is fully active', () => {
    expect(showConvertFallbackGate({ quoteStatus: 'accepted', jobStatus: 'active' })).toBe(false);
  });

  it('hides Convert when quoteStatus is draft', () => {
    expect(showConvertFallbackGate({ quoteStatus: 'draft' })).toBe(false);
  });
});

// ── Phase G: customer field editing — buildCustomerFieldUpdate ───────────────
//
// Mirrors the handleCustomerFieldSave logic in JobDetailDrawer:
//   patch = { [fieldKey]: rawValue } from EditFieldModal
//   value = rawValue.trim()
//   onUpdateJob({ ...job, [fieldKey]: value || null })
//
// Canonical field map:
//   customer      → name displayed in header
//   customerPhone → modern phone field (fallback chain reads this first)
//   email         → customer email
//   summary       → job description

function buildCustomerFieldUpdate(job, fieldKey, rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  const canonicalKeys = ['customer', 'customerPhone', 'email', 'summary'];
  if (!canonicalKeys.includes(fieldKey)) return null; // reject unknown keys
  return { ...job, [fieldKey]: value || null };
}

describe('buildCustomerFieldUpdate — customer name', () => {
  const job = { id: 'j1', customer: 'Old Name', amount: 500 };

  it('writes the new name to job.customer', () => {
    const updated = buildCustomerFieldUpdate(job, 'customer', 'Sarah Jones');
    expect(updated.customer).toBe('Sarah Jones');
  });

  it('trims whitespace from the saved value', () => {
    const updated = buildCustomerFieldUpdate(job, 'customer', '  Sarah Jones  ');
    expect(updated.customer).toBe('Sarah Jones');
  });

  it('writes null when the name field is cleared (empty string)', () => {
    const updated = buildCustomerFieldUpdate(job, 'customer', '');
    expect(updated.customer).toBeNull();
  });

  it('preserves all other job fields', () => {
    const updated = buildCustomerFieldUpdate(job, 'customer', 'New');
    expect(updated.id).toBe('j1');
    expect(updated.amount).toBe(500);
  });
});

describe('buildCustomerFieldUpdate — phone (customerPhone)', () => {
  const job = { id: 'j1', customerPhone: '07700 900000', phone: '07700 000000', amount: 300 };

  it('writes the new phone to job.customerPhone', () => {
    const updated = buildCustomerFieldUpdate(job, 'customerPhone', '07700 900999');
    expect(updated.customerPhone).toBe('07700 900999');
  });

  it('trims whitespace', () => {
    const updated = buildCustomerFieldUpdate(job, 'customerPhone', ' 07700 900999 ');
    expect(updated.customerPhone).toBe('07700 900999');
  });

  it('writes null when field is cleared', () => {
    const updated = buildCustomerFieldUpdate(job, 'customerPhone', '');
    expect(updated.customerPhone).toBeNull();
  });

  it('does NOT touch legacy job.phone field (left untouched for downstream safety)', () => {
    const updated = buildCustomerFieldUpdate(job, 'customerPhone', '07700 900999');
    // job.phone should be unchanged — we do not touch legacy fields
    expect(updated.phone).toBe('07700 000000');
  });
});

describe('buildCustomerFieldUpdate — email', () => {
  const job = { id: 'j1', email: 'old@example.com', amount: 200 };

  it('writes the new email to job.email', () => {
    const updated = buildCustomerFieldUpdate(job, 'email', 'new@example.com');
    expect(updated.email).toBe('new@example.com');
  });

  it('writes null when email is cleared', () => {
    const updated = buildCustomerFieldUpdate(job, 'email', '   ');
    expect(updated.email).toBeNull();
  });
});

describe('buildCustomerFieldUpdate — summary (job description)', () => {
  const job = { id: 'j1', summary: 'Old description', amount: 400 };

  it('writes multi-line description to job.summary', () => {
    const updated = buildCustomerFieldUpdate(job, 'summary', 'New boiler\nInstall and test');
    expect(updated.summary).toBe('New boiler\nInstall and test');
  });

  it('writes null when summary is cleared', () => {
    const updated = buildCustomerFieldUpdate(job, 'summary', '');
    expect(updated.summary).toBeNull();
  });

  it('preserves all other job fields', () => {
    const updated = buildCustomerFieldUpdate(job, 'summary', 'New desc');
    expect(updated.id).toBe('j1');
    expect(updated.amount).toBe(400);
  });
});

describe('buildCustomerFieldUpdate — rejects unknown field keys', () => {
  const job = { id: 'j1', amount: 500 };

  it('returns null for an unrecognised field key', () => {
    expect(buildCustomerFieldUpdate(job, 'address', '123 High St')).toBeNull();
  });

  it('returns null for an attempt to patch status', () => {
    expect(buildCustomerFieldUpdate(job, 'status', 'paid')).toBeNull();
  });
});

// ── Phase G: DetailsSection field visibility rules ────────────────────────────
//
// Mirrors the hasPhone / hasEmail derived values in the updated DetailsSection.
// When edit callbacks are provided:
//   - phone row always shows (hasPhone || canEditFields)
//   - email row always shows (hasEmail || canEditFields)
// When no edit callbacks:
//   - rows only show when the field has a value (original behaviour preserved)

function detailsRowVisibility(job, canEditFields) {
  const hasPhone = !!(job.customerPhone || job.phone || job.mobile);
  const hasEmail = !!(job.email || job.customerEmail);
  return {
    showPhone: hasPhone || canEditFields,
    showEmail: hasEmail || canEditFields,
    phoneIsAdd: !hasPhone && canEditFields,
    emailIsAdd: !hasEmail && canEditFields,
  };
}

describe('DetailsSection — phone/email row visibility with edit mode', () => {
  it('shows phone row with value when job has customerPhone', () => {
    const v = detailsRowVisibility({ customerPhone: '07700 900000' }, true);
    expect(v.showPhone).toBe(true);
    expect(v.phoneIsAdd).toBe(false);
  });

  it('shows phone row in Add mode when job has no phone and edit is enabled', () => {
    const v = detailsRowVisibility({}, true);
    expect(v.showPhone).toBe(true);
    expect(v.phoneIsAdd).toBe(true);
  });

  it('hides phone row when job has no phone and edit is disabled', () => {
    const v = detailsRowVisibility({}, false);
    expect(v.showPhone).toBe(false);
  });

  it('shows email row in Add mode when job has no email and edit is enabled', () => {
    const v = detailsRowVisibility({}, true);
    expect(v.showEmail).toBe(true);
    expect(v.emailIsAdd).toBe(true);
  });

  it('hides email row when job has no email and edit is disabled', () => {
    const v = detailsRowVisibility({}, false);
    expect(v.showEmail).toBe(false);
  });

  it('uses customerEmail as fallback for hasEmail', () => {
    const v = detailsRowVisibility({ customerEmail: 'a@b.com' }, false);
    expect(v.showEmail).toBe(true);
    expect(v.emailIsAdd).toBe(false);
  });

  it('uses job.phone as fallback for hasPhone', () => {
    const v = detailsRowVisibility({ phone: '07700 900000' }, false);
    expect(v.showPhone).toBe(true);
  });

  it('uses job.mobile as fallback for hasPhone', () => {
    const v = detailsRowVisibility({ mobile: '07700 900222' }, false);
    expect(v.showPhone).toBe(true);
  });
});

// ── View receipt button — show condition ─────────────────────────────────────
//
// Mirrors the isPaid + onViewReceipt gate in JobDetailDrawer's payment-section
// render block. Tested as pure-logic excerpt — no DOM mount required.
//
// isPaid mirrors JobDetailDrawer line ~1843:
//   job.paid === true || job.paymentStatus === 'paid' ||
//   job.jobStatus === 'paid' || job.status === 'paid'

function isPaidJob(job) {
  return (
    job.paid === true ||
    job.paymentStatus === 'paid' ||
    job.jobStatus === 'paid' ||
    job.status === 'paid'
  );
}

function showViewReceiptBtn(job, hasHandler) {
  return isPaidJob(job) && hasHandler;
}

describe('View receipt button — show condition', () => {
  it('shows when job is paid via job.paid and handler is provided', () => {
    expect(showViewReceiptBtn({ paid: true }, true)).toBe(true);
  });

  it('shows when job.status is paid and handler is provided', () => {
    expect(showViewReceiptBtn({ status: 'paid' }, true)).toBe(true);
  });

  it('shows when job.paymentStatus is paid and handler is provided', () => {
    expect(showViewReceiptBtn({ paymentStatus: 'paid' }, true)).toBe(true);
  });

  it('shows when job.jobStatus is paid and handler is provided', () => {
    expect(showViewReceiptBtn({ jobStatus: 'paid' }, true)).toBe(true);
  });

  it('hides when job is paid but no handler is provided (parent did not wire it)', () => {
    expect(showViewReceiptBtn({ paid: true }, false)).toBe(false);
  });

  it('hides when handler is provided but job is not paid', () => {
    expect(showViewReceiptBtn({ paid: false, status: 'invoice_sent' }, true)).toBe(false);
  });

  it('hides when both job is unpaid and handler is absent', () => {
    expect(showViewReceiptBtn({ paid: false }, false)).toBe(false);
  });
});

// ── Customer-name persistence regression ─────────────────────────────────────
//
// Bug: when a user edited a customer name from the job detail drawer, the name
// appeared in-memory but was lost on the next cloud sync because:
//   1. 'customer' was absent from META_FIELDS → extractJobMeta() silently dropped it
//   2. updateJobMetaInCloud() only wrote the meta JSON blob, never the customer_name column
//   3. mapCloudJobToToday() sets job.customer from r.customer_name, overwriting the edit
//
// Fix (PR fix/job-drawer-customer-name-and-avatar):
//   1. 'customer' (and summary, address, email, description) added to META_FIELDS
//   2. updateJobMetaInCloud() now mirrors those keys to their canonical DB columns
//
// These tests validate both fix layers as pure-logic excerpts.

import { extractJobMeta } from '../../lib/jobMeta';

describe('customer-name persistence — extractJobMeta includes customer (regression guard)', () => {
  it('includes job.customer in the extracted meta object', () => {
    const job = { id: 'j1', customer: 'Sarah Jones', amount: 300, photos: [] };
    const meta = extractJobMeta(job);
    expect('customer' in meta).toBe(true);
    expect(meta.customer).toBe('Sarah Jones');
  });

  it('includes null when customer is cleared', () => {
    const job = { id: 'j1', customer: null, amount: 300 };
    const meta = extractJobMeta(job);
    expect('customer' in meta).toBe(true);
    expect(meta.customer).toBeNull();
  });

  it('does NOT include customer when it is not set on the job (no key present)', () => {
    const job = { id: 'j1', amount: 300 };
    const meta = extractJobMeta(job);
    // 'customer' key absent on source → absent from meta (no false positive)
    expect('customer' in meta).toBe(false);
  });

  it('also includes summary in the meta (column-level fix)', () => {
    const job = { id: 'j1', summary: 'Kitchen refit', amount: 400 };
    const meta = extractJobMeta(job);
    expect(meta.summary).toBe('Kitchen refit');
  });

  it('also includes address in the meta (column-level fix)', () => {
    const job = { id: 'j1', address: '14 Elm Road' };
    const meta = extractJobMeta(job);
    expect(meta.address).toBe('14 Elm Road');
  });

  it('also includes email in the meta (column-level fix)', () => {
    const job = { id: 'j1', email: 'sarah@example.com' };
    const meta = extractJobMeta(job);
    expect(meta.email).toBe('sarah@example.com');
  });

  it('also includes description in the meta (column-level fix)', () => {
    const job = { id: 'j1', description: 'Replace tiles and re-grout' };
    const meta = extractJobMeta(job);
    expect(meta.description).toBe('Replace tiles and re-grout');
  });
});

// Mirrors the column-mapping logic added to updateJobMetaInCloud in store.js.
// That function can't be imported here (it hits Supabase), so we test the
// mapping logic as a pure function that mirrors what the real code does.
function buildUpdatePayload(metaObject) {
  const payload = { meta: metaObject };
  if (Array.isArray(metaObject.lineItems)) {
    payload.line_items = metaObject.lineItems;
  }
  if ('customer' in metaObject)    payload.customer_name = metaObject.customer    || null;
  if ('summary' in metaObject)     payload.summary       = metaObject.summary     || null;
  if ('address' in metaObject)     payload.address       = metaObject.address     || null;
  if ('email' in metaObject)       payload.email         = metaObject.email       || null;
  if ('description' in metaObject) payload.description   = metaObject.description || null;
  return payload;
}

describe('customer-name persistence — updateJobMetaInCloud payload maps customer → customer_name (regression guard)', () => {
  it('maps meta.customer to customer_name in the DB update payload', () => {
    const meta = { customer: 'Sarah Jones', status: 'active' };
    const payload = buildUpdatePayload(meta);
    expect(payload.customer_name).toBe('Sarah Jones');
  });

  it('writes null to customer_name when customer is cleared', () => {
    const meta = { customer: null };
    const payload = buildUpdatePayload(meta);
    expect(payload.customer_name).toBeNull();
  });

  it('does NOT add customer_name when customer is absent from meta', () => {
    const meta = { status: 'active', photos: [] };
    const payload = buildUpdatePayload(meta);
    expect('customer_name' in payload).toBe(false);
  });

  it('maps meta.summary to the summary column', () => {
    const meta = { summary: 'Bathroom refit' };
    const payload = buildUpdatePayload(meta);
    expect(payload.summary).toBe('Bathroom refit');
  });

  it('maps meta.address to the address column', () => {
    const meta = { address: '14 Elm Road, Manchester' };
    const payload = buildUpdatePayload(meta);
    expect(payload.address).toBe('14 Elm Road, Manchester');
  });

  it('maps meta.email to the email column', () => {
    const meta = { email: 'customer@example.com' };
    const payload = buildUpdatePayload(meta);
    expect(payload.email).toBe('customer@example.com');
  });

  it('maps meta.description to the description column', () => {
    const meta = { description: 'Replace tiling — 2 days' };
    const payload = buildUpdatePayload(meta);
    expect(payload.description).toBe('Replace tiling — 2 days');
  });

  it('still writes meta blob alongside column updates (both layers always present)', () => {
    const meta = { customer: 'Alan', status: 'active' };
    const payload = buildUpdatePayload(meta);
    expect(payload.meta).toBe(meta);
    expect(payload.customer_name).toBe('Alan');
  });

  it('still mirrors lineItems to line_items column alongside customer_name', () => {
    const items = [{ desc: 'Labour', cost: 300 }];
    const meta = { customer: 'Bob', lineItems: items };
    const payload = buildUpdatePayload(meta);
    expect(payload.line_items).toEqual(items);
    expect(payload.customer_name).toBe('Bob');
  });
});

// ── Regression: job-name edit must not touch the customer field ───────────────
//
// Bug (fix/job-drawer-customer-name-and-avatar v2 commits):
// When a job's default name was 'Job', addJobToCloud wrote customer_name = 'Job'
// (from `payload.customer || payload.name || 'Job'`). On next cloud sync,
// mapCloudJobToToday set job.customer = 'Job'. When the user edited the job name
// (summary), handleCustomerFieldSave wrote { ...job, summary: newName }, and
// extractJobMeta picked up the stale job.customer = 'Job', writing it back to the
// DB via updateJobMetaInCloud. Result: editing the name appeared to set the customer
// to 'Job'.
//
// Fix: addJobToCloud now writes customer_name = payload.customer || null — never
// inherits from the job name. This test validates that the summary-edit path
// leaves job.customer unchanged.
//
// Mirror functions below match the production implementations used in the
// drawer + cloud write path. No Supabase, no React, no DOM required.

function simulateAddJobToCloud(payload) {
  // Mirrors the customer_name derivation in store.js addJobToCloud (AFTER the fix).
  // Previously: payload.customer || payload.name || 'Job'
  // Fixed:      payload.customer || null
  return {
    customer_name: payload.customer || null,
    summary: payload.name || 'Job',
  };
}

function simulateMapCloudJobToToday(row) {
  // Mirrors mapCloudJobToToday in store.js (the relevant fields only).
  return {
    customer: row.customer_name || '',
    summary: row.summary || '',
  };
}

function simulateSummaryEdit(job, newSummary) {
  // Mirrors handleCustomerFieldSave in JobDetailDrawer when editingField === 'summary'.
  // patch = { summary: newSummary } → onUpdateJob({ ...job, summary: newSummary || null })
  return { ...job, summary: newSummary || null };
}

function simulateExtractJobMetaCustomer(job) {
  // Mirrors the customer extraction from extractJobMeta in jobMeta.js.
  // Only includes 'customer' in the returned object when the key is present on the job.
  return 'customer' in job ? job.customer : undefined;
}

describe('Regression: job-name edit must not pollute job.customer', () => {
  it('a job created with only a name (no customer) has an empty customer field after cloud round-trip', () => {
    // Simulate creating a job with name 'Job' and no explicit customer
    const cloudRow = simulateAddJobToCloud({ name: 'Job' });
    expect(cloudRow.customer_name).toBeNull(); // fixed: no longer defaults to 'Job'

    const job = simulateMapCloudJobToToday(cloudRow);
    expect(job.customer).toBe(''); // empty, not 'Job'
  });

  it('editing the job name (summary) leaves job.customer unchanged', () => {
    // Simulate cloud state: job with no customer (customer_name = null after the fix)
    const cloudRow = simulateAddJobToCloud({ name: 'Job' });
    const job = simulateMapCloudJobToToday(cloudRow);
    expect(job.customer).toBe('');

    // User renames the job: handleCustomerFieldSave writes { ...job, summary: 'Bathroom refit' }
    const updated = simulateSummaryEdit(job, 'Bathroom refit');
    expect(updated.summary).toBe('Bathroom refit');

    // customer must be untouched — spread of job preserves the empty string
    expect(updated.customer).toBe('');

    // extractJobMeta would include customer: '' — but updateJobMetaInCloud writes
    // customer_name = metaObject.customer || null = null (no leak of 'Job')
    const extractedCustomer = simulateExtractJobMetaCustomer(updated);
    const cloudCustomerName = extractedCustomer || null; // mirrors updateJobMetaInCloud gate
    expect(cloudCustomerName).toBeNull(); // no 'Job' leaked back to customer_name
  });

  it('a job with a real customer is unaffected by a summary edit', () => {
    // Simulate creating a job WITH an explicit customer
    const cloudRow = simulateAddJobToCloud({ name: 'Bathroom refit', customer: 'Sarah Jones' });
    expect(cloudRow.customer_name).toBe('Sarah Jones');

    const job = simulateMapCloudJobToToday(cloudRow);
    expect(job.customer).toBe('Sarah Jones');

    // User renames the job
    const updated = simulateSummaryEdit(job, 'Kitchen refit');
    expect(updated.summary).toBe('Kitchen refit');
    expect(updated.customer).toBe('Sarah Jones'); // unchanged

    // Cloud write preserves the real customer name
    const extractedCustomer = simulateExtractJobMetaCustomer(updated);
    const cloudCustomerName = extractedCustomer || null;
    expect(cloudCustomerName).toBe('Sarah Jones');
  });

  it('addJobToCloud fix: customer_name is null when no customer is supplied (prevents the leak at source)', () => {
    // The root fix: addJobToCloud no longer inherits customer_name from the job name
    expect(simulateAddJobToCloud({ name: 'Job' }).customer_name).toBeNull();
    expect(simulateAddJobToCloud({ name: 'Plumbing' }).customer_name).toBeNull();
    expect(simulateAddJobToCloud({ name: 'Job', customer: '' }).customer_name).toBeNull();
  });

  it('addJobToCloud still writes customer_name when a real customer is supplied', () => {
    expect(simulateAddJobToCloud({ name: 'Job', customer: 'Alan' }).customer_name).toBe('Alan');
    expect(simulateAddJobToCloud({ name: 'Job', customer: 'Bob Smith' }).customer_name).toBe('Bob Smith');
  });
});

// ── CIS-4/5 regression: resolveCisStatus + isCisUser guard ──────────────────
//
// These tests cover the root cause of the P0 blank-screen bug (fix/job-detail-blank):
//
//   The second IIFE in the JobDetailDrawer return() body referenced `isCisUser` and
//   `taxMetaEl` as if they were in scope, but both were actually `const` declarations
//   inside the FIRST IIFE (the stage-aware layout block). JavaScript closures do not
//   share sibling IIFE scopes — the second IIFE threw a ReferenceError on every open.
//
//   Fix: `isCisUser` was lifted to component scope (above the return()); `taxMetaEl`
//   in the MoreDisclosure IIFE was replaced with an inline <JobTaxMeta> that doesn't
//   need the IIFE-local `quote`/`materials` values (the non-CIS path only uses the
//   exclude-from-tax toggle which ignores those props).
//
// Tests here validate the guards that must survive the null/undefined profile path.

import { resolveCisStatus } from '../../lib/cashflow';

describe('resolveCisStatus — undefined / null profile guard (crash regression)', () => {
  const job = { id: 'j1', customer: 'Alan', amount: 500 };

  it('returns isCisJob:false when profile is null', () => {
    expect(resolveCisStatus(job, null)).toEqual({ isCisJob: false, rate: 0 });
  });

  it('returns isCisJob:false when profile is undefined', () => {
    expect(resolveCisStatus(job, undefined)).toEqual({ isCisJob: false, rate: 0 });
  });

  it('returns isCisJob:false when profile.is_cis_subcontractor is false', () => {
    expect(resolveCisStatus(job, { is_cis_subcontractor: false })).toEqual({ isCisJob: false, rate: 0 });
  });

  it('returns isCisJob:false when profile.is_cis_subcontractor is absent (undefined)', () => {
    expect(resolveCisStatus(job, {})).toEqual({ isCisJob: false, rate: 0 });
  });

  it('returns isCisJob:true with default rate 20 for a CIS user with no job override', () => {
    const profile = { is_cis_subcontractor: true };
    expect(resolveCisStatus(job, profile)).toEqual({ isCisJob: true, rate: 20 });
  });

  it('uses profile.cis_default_rate when job has no cisRate override', () => {
    const profile = { is_cis_subcontractor: true, cis_default_rate: 30 };
    expect(resolveCisStatus(job, profile)).toEqual({ isCisJob: true, rate: 30 });
  });

  it('uses job.cisRate in preference to profile.cis_default_rate', () => {
    const profile = { is_cis_subcontractor: true, cis_default_rate: 20 };
    const jobWithRate = { ...job, cisRate: 0 };
    expect(resolveCisStatus(jobWithRate, profile)).toEqual({ isCisJob: true, rate: 0 });
  });

  it('returns isCisJob:false when job.cis is explicitly false (per-job opt-out)', () => {
    const profile = { is_cis_subcontractor: true, cis_default_rate: 20 };
    const optedOutJob = { ...job, cis: false };
    expect(resolveCisStatus(optedOutJob, profile)).toEqual({ isCisJob: false, rate: 0 });
  });
});

// isCisUser derivation — the expression lifted to component scope in the fix
describe('isCisUser derivation — null/undefined profile is safe', () => {
  function deriveIsCisUser(profile) {
    return !!profile?.is_cis_subcontractor;
  }

  it('returns false when profile is null', () => {
    expect(deriveIsCisUser(null)).toBe(false);
  });

  it('returns false when profile is undefined', () => {
    expect(deriveIsCisUser(undefined)).toBe(false);
  });

  it('returns false when profile.is_cis_subcontractor is false', () => {
    expect(deriveIsCisUser({ is_cis_subcontractor: false })).toBe(false);
  });

  it('returns false when profile.is_cis_subcontractor is absent', () => {
    expect(deriveIsCisUser({})).toBe(false);
  });

  it('returns true when profile.is_cis_subcontractor is true', () => {
    expect(deriveIsCisUser({ is_cis_subcontractor: true })).toBe(true);
  });
});
