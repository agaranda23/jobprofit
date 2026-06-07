/**
 * Golden-master test for deriveDisplayStatus.
 *
 * RULE: Every assertion here uses toEqual (not toMatchSnapshot) so that a
 * silent snapshot regeneration can never hide a profit-stage regression.
 *
 * Coverage: ≥30 fixtures spanning every branch of deriveDisplayStatus and
 * isOverdue (canonical status, net-7 fallback, legacy subordinate fields,
 * boundary / edge cases). All expected values were derived from the pre-refactor
 * WorkScreen.deriveDisplayStatus implementation before any source was moved.
 *
 * After the refactor, the import path below is the ONLY place that needs
 * updating — the expected values must never change (they are the golden record).
 */

import { describe, it, expect } from 'vitest';
import { deriveDisplayStatus } from '../jobStatus.js';

// ── Helper: build ISO date string relative to today ───────────────────────────
// offset=0 → today, offset=-1 → yesterday, offset=+20 → 20 days from now
function dayOffset(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Helper: build ISO timestamp relative to today ────────────────────────────
function isoOffset(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}

// ── 1. CANONICAL status field (short-circuits) ────────────────────────────────

describe('golden: canonical status field short-circuits', () => {
  it('lead → Lead', () => {
    expect(deriveDisplayStatus({ status: 'lead' })).toEqual('Lead');
  });

  it('quoted → Quoted', () => {
    expect(deriveDisplayStatus({ status: 'quoted' })).toEqual('Quoted');
  });

  it('quoted + paid:true + paymentStatus:paid + jobStatus:paid → Quoted (canonical wins)', () => {
    expect(deriveDisplayStatus({
      status: 'quoted',
      paid: true,
      paymentStatus: 'paid',
      jobStatus: 'paid',
    })).toEqual('Quoted');
  });

  it('active → On', () => {
    expect(deriveDisplayStatus({ status: 'active' })).toEqual('On');
  });

  it('complete → On', () => {
    expect(deriveDisplayStatus({ status: 'complete' })).toEqual('On');
  });

  it('paid → Paid', () => {
    expect(deriveDisplayStatus({ status: 'paid' })).toEqual('Paid');
  });

  it('invoice_sent + overdue:true → Overdue (manual flag wins)', () => {
    expect(deriveDisplayStatus({ status: 'invoice_sent', overdue: true })).toEqual('Overdue');
  });

  it('invoice_sent + invoiceDueDate yesterday → Overdue', () => {
    expect(deriveDisplayStatus({
      status: 'invoice_sent',
      invoiceDueDate: dayOffset(-1),
    })).toEqual('Overdue');
  });

  it('invoice_sent + invoiceDueDate +20d → Invoiced', () => {
    expect(deriveDisplayStatus({
      status: 'invoice_sent',
      invoiceDueDate: dayOffset(20),
    })).toEqual('Invoiced');
  });

  it('invoice_sent + no dates → Invoiced (net-7 not yet exceeded)', () => {
    // No invoiceDueDate, invoiceSentAt is now — 0 days since invoice < 7
    expect(deriveDisplayStatus({
      status: 'invoice_sent',
      invoiceSentAt: new Date().toISOString(),
    })).toEqual('Invoiced');
  });
});

// ── 2. NET-7 FALLBACK (no invoiceDueDate, uses invoiceSentAt + DEFAULT_PAYMENT_TERMS_DAYS) ──

describe('golden: net-7 fallback path via invoiceSentAt', () => {
  it('invoice_sent + invoiceSentAt 9 days ago → Overdue (9 > 7)', () => {
    expect(deriveDisplayStatus({
      status: 'invoice_sent',
      invoiceSentAt: isoOffset(-9),
    })).toEqual('Overdue');
  });

  it('invoice_sent + invoiceSentAt 5 days ago → Invoiced (5 ≤ 7)', () => {
    expect(deriveDisplayStatus({
      status: 'invoice_sent',
      invoiceSentAt: isoOffset(-5),
    })).toEqual('Invoiced');
  });
});

// ── 3. LEGACY FALLBACK (no canonical status field) ────────────────────────────

describe('golden: legacy fallback fields (no canonical status)', () => {
  it('paid:true → Paid', () => {
    expect(deriveDisplayStatus({ paid: true })).toEqual('Paid');
  });

  it("paymentStatus:'paid' → Paid", () => {
    expect(deriveDisplayStatus({ paymentStatus: 'paid' })).toEqual('Paid');
  });

  it("jobStatus:'paid' → Paid", () => {
    expect(deriveDisplayStatus({ jobStatus: 'paid' })).toEqual('Paid');
  });

  it("invoiceStatus:'invoiced' (not overdue) → Invoiced", () => {
    expect(deriveDisplayStatus({ invoiceStatus: 'invoiced' })).toEqual('Invoiced');
  });

  it("invoiceStatus:'invoiced' + invoiceDueDate yesterday → Overdue", () => {
    expect(deriveDisplayStatus({
      invoiceStatus: 'invoiced',
      invoiceDueDate: dayOffset(-1),
    })).toEqual('Overdue');
  });

  it("jobStatus:'complete' → On", () => {
    expect(deriveDisplayStatus({ jobStatus: 'complete' })).toEqual('On');
  });

  it("jobStatus:'active' → On", () => {
    expect(deriveDisplayStatus({ jobStatus: 'active' })).toEqual('On');
  });

  it('{} → Lead (empty object, no fields)', () => {
    expect(deriveDisplayStatus({})).toEqual('Lead');
  });
});

// ── 4. BOUNDARY / EDGE CASES ──────────────────────────────────────────────────

describe('golden: boundary and edge cases', () => {
  it('null job → Lead (no throw)', () => {
    expect(deriveDisplayStatus(null)).toEqual('Lead');
  });

  it('undefined job → Lead (no throw)', () => {
    expect(deriveDisplayStatus(undefined)).toEqual('Lead');
  });

  it('invoiceDueDate today at midnight → Invoiced (today is NOT overdue)', () => {
    // today.setHours(0,0,0,0) === due.setHours(0,0,0,0) → due < today is FALSE.
    // Must use local-date arithmetic (not toISOString which is UTC) so the YYYY-MM-DD
    // string represents today in the running system's timezone, not UTC.
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;
    expect(deriveDisplayStatus({
      status: 'invoice_sent',
      invoiceDueDate: todayStr,
    })).toEqual('Invoiced');
  });

  it('invoiceDueDate yesterday at 23:59 → Overdue', () => {
    // A YYYY-MM-DD string for yesterday: parsed as local midnight, which < today midnight
    expect(deriveDisplayStatus({
      status: 'invoice_sent',
      invoiceDueDate: dayOffset(-1),
    })).toEqual('Overdue');
  });

  it('invoice_sent + overdue:false + invoiceDueDate yesterday → Overdue (date wins over false flag)', () => {
    expect(deriveDisplayStatus({
      status: 'invoice_sent',
      overdue: false,
      invoiceDueDate: dayOffset(-1),
    })).toEqual('Overdue');
  });

  it('invoice_sent + overdue:true + invoiceDueDate +20d → Overdue (manual flag wins over future date)', () => {
    expect(deriveDisplayStatus({
      status: 'invoice_sent',
      overdue: true,
      invoiceDueDate: dayOffset(20),
    })).toEqual('Overdue');
  });

  it("status:'invoice_sent' + paid:true → Invoiced (canonical invoice_sent wins — Bug-1 class)", () => {
    // canonical status:'invoice_sent' must NOT be overridden by the subordinate paid:true
    expect(deriveDisplayStatus({
      status: 'invoice_sent',
      paid: true,
    })).toEqual('Invoiced');
  });

  it("invoiceStatus:'invoiced' + paid:true → Paid (legacy: paid checked before invoiced)", () => {
    // No canonical status — falls through to legacy path.
    // paid:true is checked before invoiceStatus:'invoiced', so Paid wins.
    expect(deriveDisplayStatus({
      invoiceStatus: 'invoiced',
      paid: true,
    })).toEqual('Paid');
  });

  it("status:'lead' + overdue:true → Lead (overdue flag only applies inside invoice_sent)", () => {
    expect(deriveDisplayStatus({
      status: 'lead',
      overdue: true,
    })).toEqual('Lead');
  });

  it("total:0 + status:'quoted' → Quoted (zero price does not change stage)", () => {
    expect(deriveDisplayStatus({
      status: 'quoted',
      total: 0,
    })).toEqual('Quoted');
  });

  it("payments:[{amount:250}] + status:'invoice_sent' → Invoiced (partial payment does NOT advance stage)", () => {
    expect(deriveDisplayStatus({
      status: 'invoice_sent',
      payments: [{ amount: 250 }],
    })).toEqual('Invoiced');
  });
});
