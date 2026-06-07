/**
 * Unit tests for deriveDisplayStatus — now imported from lib/jobStatus.js,
 * the single source of truth for job stage display logic.
 *
 * Tests cover:
 *  1. Canonical status field short-circuits correctly for every stage.
 *  2. 'quoted' status returns 'Quoted' (Bug 2 fix).
 *  3. A previously-Paid job moved to a non-Paid stage is not re-derived as
 *     'Paid' when the canonical status field is set (Bug 1 root-cause guard).
 *  4. Legacy fallback fields still work for pre-canonical jobs.
 */

import { describe, it, expect } from 'vitest';
import { deriveDisplayStatus, DEFAULT_PAYMENT_TERMS_DAYS } from '../../lib/jobStatus.js';

// ── Canonical status field — each stage ──────────────────────────────────────

describe('deriveDisplayStatus: canonical status field — happy path', () => {
  it("status:'lead' → 'Lead'", () => {
    expect(deriveDisplayStatus({ status: 'lead' })).toBe('Lead');
  });

  it("status:'quoted' → 'Quoted' (Bug 2 fix)", () => {
    expect(deriveDisplayStatus({ status: 'quoted' })).toBe('Quoted');
  });

  it("status:'active' → 'On'", () => {
    expect(deriveDisplayStatus({ status: 'active' })).toBe('On');
  });

  it("status:'complete' → 'On'", () => {
    expect(deriveDisplayStatus({ status: 'complete' })).toBe('On');
  });

  it("status:'invoice_sent' → 'Invoiced' (not overdue)", () => {
    expect(deriveDisplayStatus({ status: 'invoice_sent' })).toBe('Invoiced');
  });

  it("status:'paid' → 'Paid'", () => {
    expect(deriveDisplayStatus({ status: 'paid' })).toBe('Paid');
  });
});

// ── Bug 1 regression guard: canonical status wins over residual paid fields ──

describe('deriveDisplayStatus: residual paid fields do NOT override canonical status (Bug 1)', () => {
  // Simulate a job that was previously Paid and is now moved to On (active).
  // stagePatch('On') sets status:'active', paid:false, jobStatus:null, paymentStatus:null.
  // But before the fix, if jobStatus:'paid' survived the spread it would
  // override the derived stage. This test locks in the canonical-first order.

  it("canonical status:'active' wins over residual jobStatus:'paid'", () => {
    const job = { status: 'active', paid: false, jobStatus: 'paid', paymentStatus: 'paid' };
    expect(deriveDisplayStatus(job)).toBe('On');
  });

  it("canonical status:'quoted' wins over residual jobStatus:'paid'", () => {
    const job = { status: 'quoted', paid: false, jobStatus: 'paid', paymentStatus: 'paid' };
    expect(deriveDisplayStatus(job)).toBe('Quoted');
  });

  it("canonical status:'invoice_sent' wins over residual paymentStatus:'paid'", () => {
    const job = { status: 'invoice_sent', paid: false, paymentStatus: 'paid', jobStatus: 'paid' };
    expect(deriveDisplayStatus(job)).toBe('Invoiced');
  });

  it("canonical status:'lead' wins over residual jobStatus:'paid'", () => {
    const job = { status: 'lead', paid: false, jobStatus: 'paid' };
    expect(deriveDisplayStatus(job)).toBe('Lead');
  });
});

// ── Legacy fallback paths — subordinate fields (no canonical status) ──────────

describe('deriveDisplayStatus: legacy fallback fields (no canonical status)', () => {
  it('paid:true → Paid', () => {
    expect(deriveDisplayStatus({ paid: true })).toBe('Paid');
  });

  it("paymentStatus:'paid' → Paid", () => {
    expect(deriveDisplayStatus({ paymentStatus: 'paid' })).toBe('Paid');
  });

  it("jobStatus:'paid' → Paid", () => {
    expect(deriveDisplayStatus({ jobStatus: 'paid' })).toBe('Paid');
  });

  it("invoiceStatus:'invoiced' → Invoiced (not overdue)", () => {
    expect(deriveDisplayStatus({ invoiceStatus: 'invoiced' })).toBe('Invoiced');
  });

  it("jobStatus:'active' → On", () => {
    expect(deriveDisplayStatus({ jobStatus: 'active' })).toBe('On');
  });

  it("jobStatus:'complete' → On", () => {
    expect(deriveDisplayStatus({ jobStatus: 'complete' })).toBe('On');
  });

  it('no fields → Lead (fallback)', () => {
    expect(deriveDisplayStatus({})).toBe('Lead');
  });
});

// ── Manual overdue flag (Part 1 fix) ─────────────────────────────────────────

describe('deriveDisplayStatus: manual overdue flag', () => {
  it("status:'invoice_sent', overdue:true → 'Overdue' (manual override wins)", () => {
    expect(deriveDisplayStatus({ status: 'invoice_sent', overdue: true })).toBe('Overdue');
  });

  it("status:'invoice_sent', overdue:false → 'Invoiced' (when no date trigger)", () => {
    expect(deriveDisplayStatus({ status: 'invoice_sent', overdue: false })).toBe('Invoiced');
  });

  it("status:'invoice_sent', overdue:true + past due date → 'Overdue' (flag and date agree)", () => {
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(deriveDisplayStatus({ status: 'invoice_sent', overdue: true, invoiceDueDate: pastDate })).toBe('Overdue');
  });

  it("status:'invoice_sent', overdue:false + past due date → 'Overdue' (date-driven path still works)", () => {
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(deriveDisplayStatus({ status: 'invoice_sent', overdue: false, invoiceDueDate: pastDate })).toBe('Overdue');
  });
});

// ── DEFAULT_PAYMENT_TERMS_DAYS: shared net-N constant ─────────────────────────

describe('DEFAULT_PAYMENT_TERMS_DAYS: shared net-N constant', () => {
  it('equals 7 (net-7 default, shared between chaseLadder and isOverdue)', () => {
    expect(DEFAULT_PAYMENT_TERMS_DAYS).toBe(7);
  });

  it('isOverdue date path: a past invoiceDueDate always triggers Overdue regardless of terms days', () => {
    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(deriveDisplayStatus({ status: 'invoice_sent', invoiceDueDate: pastDate })).toBe('Overdue');
  });

  it('isOverdue date path: a future invoiceDueDate never triggers Overdue (commercial net-30 guard)', () => {
    const futureDate = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(deriveDisplayStatus({ status: 'invoice_sent', invoiceDueDate: futureDate })).toBe('Invoiced');
  });
});
