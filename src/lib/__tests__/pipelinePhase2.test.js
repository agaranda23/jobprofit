/**
 * Tests for Pipeline Phase 2 — workflow visibility helpers.
 *
 * Covers:
 *   1. stageToFilledCount — maps deriveDisplayStatus stage to 0-4 dot fill count.
 *   2. Funnel count derivation — given a jobs array, the per-stage counts are correct.
 *
 * These are the two pure-logic functions introduced in feat/pipeline-phase-2.
 * Component rendering is not tested here (no DOM dependency).
 */

import { describe, it, expect } from 'vitest';
import { stageToFilledCount } from '../pipelineProgress';
import { deriveDisplayStatus } from '../jobStatus';

// ── stageToFilledCount ────────────────────────────────────────────────────────

describe('stageToFilledCount: maps stage to 0-4 filled dot count', () => {
  it('Lead → 0 (no step reached)', () => {
    expect(stageToFilledCount('Lead')).toBe(0);
  });

  it('Quoted → 1 (first segment filled)', () => {
    expect(stageToFilledCount('Quoted')).toBe(1);
  });

  it('On → 2 (two segments filled)', () => {
    expect(stageToFilledCount('On')).toBe(2);
  });

  it('Invoiced → 3 (three segments filled)', () => {
    expect(stageToFilledCount('Invoiced')).toBe(3);
  });

  it('Overdue → 3 (same position as Invoiced — overdue is a sub-state)', () => {
    expect(stageToFilledCount('Overdue')).toBe(3);
  });

  it('Paid → 4 (all segments filled)', () => {
    expect(stageToFilledCount('Paid')).toBe(4);
  });

  it('unknown stage → 0 (safe default)', () => {
    expect(stageToFilledCount('Unknown')).toBe(0);
    expect(stageToFilledCount('')).toBe(0);
    expect(stageToFilledCount(undefined)).toBe(0);
  });
});

describe('stageToFilledCount: never exceeds 4 and never goes below 0', () => {
  const allStages = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

  it.each(allStages)('stage %s: 0 <= filled <= 4', (stage) => {
    const n = stageToFilledCount(stage);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(4);
  });
});

// ── Funnel count derivation ───────────────────────────────────────────────────
// The funnel strip in WorkScreen counts visible jobs per stage using
// deriveDisplayStatus. We test the counting logic directly against a synthetic
// jobs array to ensure the strip will show the right numbers.

const FUNNEL_STAGES = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

function countPerStage(jobs) {
  return FUNNEL_STAGES.reduce((acc, s) => {
    acc[s] = jobs.filter(j => deriveDisplayStatus(j) === s).length;
    return acc;
  }, {});
}

describe('funnel strip: countPerStage using deriveDisplayStatus', () => {
  it('empty jobs → all zeros', () => {
    const counts = countPerStage([]);
    for (const s of FUNNEL_STAGES) {
      expect(counts[s]).toBe(0);
    }
  });

  it('single Lead job (no status) → Lead:1, others:0', () => {
    const jobs = [{ id: 1 }]; // no status field → falls through to 'Lead'
    const counts = countPerStage(jobs);
    expect(counts.Lead).toBe(1);
    expect(counts.Quoted).toBe(0);
    expect(counts.Paid).toBe(0);
  });

  it('canonical status fields are correctly bucketed', () => {
    const jobs = [
      { id: 1, status: 'lead' },
      { id: 2, status: 'quoted' },
      { id: 3, status: 'active' },
      { id: 4, status: 'invoice_sent' },
      { id: 5, status: 'paid' },
    ];
    const counts = countPerStage(jobs);
    expect(counts.Lead).toBe(1);
    expect(counts.Quoted).toBe(1);
    expect(counts.On).toBe(1);
    expect(counts.Invoiced).toBe(1);
    expect(counts.Paid).toBe(1);
    expect(counts.Overdue).toBe(0);
  });

  it('overdue job (invoice_sent + overdue flag) is counted in Overdue not Invoiced', () => {
    const jobs = [
      { id: 1, status: 'invoice_sent', overdue: true },
      { id: 2, status: 'invoice_sent', overdue: false },
    ];
    const counts = countPerStage(jobs);
    expect(counts.Overdue).toBe(1);
    expect(counts.Invoiced).toBe(1);
  });

  it('mixed stages give correct totals', () => {
    const jobs = [
      { id: 1, status: 'quoted' },
      { id: 2, status: 'quoted' },
      { id: 3, status: 'active' },
      { id: 4, status: 'active' },
      { id: 5, status: 'active' },
      { id: 6, status: 'invoice_sent' },
      { id: 7, status: 'paid' },
      { id: 8, status: 'paid' },
      { id: 9, status: 'paid' },
      { id: 10, status: 'paid' },
    ];
    const counts = countPerStage(jobs);
    expect(counts.Quoted).toBe(2);
    expect(counts.On).toBe(3);
    expect(counts.Invoiced).toBe(1);
    expect(counts.Paid).toBe(4);
    expect(counts.Lead).toBe(0);
    expect(counts.Overdue).toBe(0);
  });

  it('total count across all stages equals jobs.length', () => {
    const jobs = [
      { id: 1, status: 'lead' },
      { id: 2, status: 'quoted' },
      { id: 3, status: 'active' },
      { id: 4, status: 'invoice_sent' },
      { id: 5, status: 'invoice_sent', overdue: true },
      { id: 6, status: 'paid' },
    ];
    const counts = countPerStage(jobs);
    const total = FUNNEL_STAGES.reduce((sum, s) => sum + counts[s], 0);
    expect(total).toBe(jobs.length);
  });
});
