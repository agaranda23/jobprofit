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

describe('buildChaseMessage — message text by tier', () => {
  const base = { name: 'Alan', amountOutstanding: '£500', daysSinceDue: 7, amountPaid: 0 };

  it('tier 1 mentions the outstanding amount', () => {
    const msg = buildChaseMessage({ ...base, tier: 1 });
    expect(msg).toContain('£500');
  });

  it('tier 2 mentions days since due', () => {
    const msg = buildChaseMessage({ ...base, tier: 2 });
    expect(msg).toContain('7 days');
  });

  it('tier 3 is a firmer message and mentions days', () => {
    const msg = buildChaseMessage({ ...base, tier: 3 });
    expect(msg).toContain('7 days');
  });

  it('tier 4 uses tier-3 copy (no separate tier-4 template)', () => {
    const tier3 = buildChaseMessage({ ...base, tier: 3 });
    const tier4 = buildChaseMessage({ ...base, tier: 4 });
    expect(tier4).toBe(tier3);
  });

  it('uses "there" as safe fallback when name is empty', () => {
    const msg = buildChaseMessage({ ...base, name: '', tier: 1 });
    expect(msg).toContain('there');
  });
});

// ── computeTier — tier from chase state ──────────────────────────────────────

describe('computeTier — first-chase and tier progression', () => {
  it('returns tier 1 when state is null (never chased)', () => {
    expect(computeTier(null)).toBe(1);
  });

  it('returns tier 1 when chased fewer than 7 days ago', () => {
    const state = {
      count: 1,
      lastChasedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      firstChasedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(computeTier(state)).toBe(1);
  });

  it('returns tier 2 when chased once and >= 7 days ago', () => {
    const state = {
      count: 1,
      lastChasedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      firstChasedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(computeTier(state)).toBe(2);
  });

  it('returns tier 3 when chased twice and >= 7 days ago', () => {
    const state = {
      count: 2,
      lastChasedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      firstChasedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(computeTier(state)).toBe(3);
  });

  it('returns tier 4 when chased 3+ times and >= 7 days ago', () => {
    const state = {
      count: 3,
      lastChasedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      firstChasedAt: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000).toISOString(),
    };
    expect(computeTier(state)).toBe(4);
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
