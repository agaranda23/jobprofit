/**
 * Unit tests for stagePatch (src/lib/jobStatus.js).
 *
 * Covers:
 *  - Overdue entry has overdue:true (regression guard for spread order)
 *  - Invoiced entry has overdue:false (moving back out of Overdue clears flag)
 *  - Lead, On, Quoted entries have overdue:false (full cleared set)
 *  - Paid entry is not affected (Paid path does not set overdue)
 *  - Legacy cleared fields (jobStatus, paymentStatus, paidAt) still null for non-Paid stages
 */

import { describe, it, expect } from 'vitest';
import { stagePatch } from '../jobStatus';

describe('stagePatch: overdue flag spread order', () => {
  it("stagePatch('Overdue').overdue === true", () => {
    expect(stagePatch('Overdue').overdue).toBe(true);
  });

  it("stagePatch('Invoiced').overdue === false (moving back out of Overdue clears flag)", () => {
    expect(stagePatch('Invoiced').overdue).toBe(false);
  });

  it("stagePatch('Lead').overdue === false", () => {
    expect(stagePatch('Lead').overdue).toBe(false);
  });

  it("stagePatch('On').overdue === false", () => {
    expect(stagePatch('On').overdue).toBe(false);
  });

  it("stagePatch('Quoted').overdue === false", () => {
    expect(stagePatch('Quoted').overdue).toBe(false);
  });
});

describe('stagePatch: legacy cleared fields still work for non-Paid stages', () => {
  const nonPaidStages = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue'];

  it.each(nonPaidStages)("stagePatch('%s') clears jobStatus", (stage) => {
    expect(stagePatch(stage).jobStatus).toBeNull();
  });

  it.each(nonPaidStages)("stagePatch('%s') clears paymentStatus", (stage) => {
    expect(stagePatch(stage).paymentStatus).toBeNull();
  });

  it.each(nonPaidStages)("stagePatch('%s') clears paidAt", (stage) => {
    expect(stagePatch(stage).paidAt).toBeNull();
  });
});

describe('stagePatch: Paid entry is independent (no overdue field)', () => {
  it("stagePatch('Paid') sets paid:true and status:'paid'", () => {
    const patch = stagePatch('Paid');
    expect(patch.paid).toBe(true);
    expect(patch.status).toBe('paid');
  });

  it("stagePatch('Paid') has a paidAt timestamp", () => {
    const patch = stagePatch('Paid');
    expect(typeof patch.paidAt).toBe('string');
    expect(patch.paidAt.length).toBeGreaterThan(0);
  });
});

describe('stagePatch: unknown stage returns empty object', () => {
  it("stagePatch('Unknown') → {}", () => {
    expect(stagePatch('Unknown')).toEqual({});
  });
});
