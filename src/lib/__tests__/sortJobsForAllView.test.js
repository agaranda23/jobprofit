/**
 * Unit tests for sortJobsForAllView — urgency-tier sort for the All-view.
 *
 * Tier order: Overdue → Invoiced → On → Quoted → Lead → Paid
 * Within each tier the existing per-stage sort rule from sortJobsByStage is used.
 *
 * No DOM, no React, no Supabase.
 */

import { describe, it, expect } from 'vitest';
import { sortJobsForAllView } from '../jobSort.js';

// Minimal stage deriver — maps the fixture's `_stage` field to a canonical stage.
// WorkScreen uses its real deriveDisplayStatus; we use a trivial stub here so
// these tests stay isolated from WorkScreen's logic.
function stageOf(job) {
  return job._stage;
}

function job(id, stage, overrides = {}) {
  return { id, _stage: stage, ...overrides };
}

// ─── Tier ordering ────────────────────────────────────────────────────────────

describe('sortJobsForAllView — tier ordering', () => {
  it('places Overdue before Invoiced before On before Quoted before Lead before Paid', () => {
    const jobs = [
      job('paid-1',     'Paid',     { paidAt: '2026-05-28T00:00:00Z' }),
      job('lead-1',     'Lead',     { createdAt: '2026-05-20T00:00:00Z' }),
      job('quoted-1',   'Quoted',   { createdAt: '2026-05-15T00:00:00Z' }),
      job('on-1',       'On',       { updatedAt: '2026-05-10T00:00:00Z' }),
      job('invoiced-1', 'Invoiced', { invoiceDueDate: '2026-06-10' }),
      job('overdue-1',  'Overdue',  { invoiceDueDate: '2026-04-01' }),
    ];
    const sorted = sortJobsForAllView(jobs, stageOf);
    const ids = sorted.map(j => j.id);
    // Verify tier order
    expect(ids.indexOf('overdue-1')).toBeLessThan(ids.indexOf('invoiced-1'));
    expect(ids.indexOf('invoiced-1')).toBeLessThan(ids.indexOf('on-1'));
    expect(ids.indexOf('on-1')).toBeLessThan(ids.indexOf('quoted-1'));
    expect(ids.indexOf('quoted-1')).toBeLessThan(ids.indexOf('lead-1'));
    expect(ids.indexOf('lead-1')).toBeLessThan(ids.indexOf('paid-1'));
  });

  it('returns a flat list of all 6 jobs', () => {
    const jobs = [
      job('a', 'Paid'), job('b', 'Lead'), job('c', 'Overdue'),
      job('d', 'Quoted'), job('e', 'On'), job('f', 'Invoiced'),
    ];
    const sorted = sortJobsForAllView(jobs, stageOf);
    expect(sorted.length).toBe(6);
    expect(sorted.map(j => j.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('returns an empty array for an empty input', () => {
    expect(sortJobsForAllView([], stageOf)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const jobs = [
      job('a', 'Paid'), job('b', 'Overdue', { invoiceDueDate: '2026-04-01' }),
    ];
    const origIds = [...jobs.map(j => j.id)];
    sortJobsForAllView(jobs, stageOf);
    expect(jobs.map(j => j.id)).toEqual(origIds);
  });
});

// ─── Within-tier ordering (delegates to sortJobsByStage) ─────────────────────

describe('sortJobsForAllView — within-tier ordering', () => {
  it('sorts Overdue jobs oldest-due-date first within the Overdue tier', () => {
    const jobs = [
      job('ov-newer', 'Overdue', { invoiceDueDate: '2026-04-20' }),
      job('ov-oldest','Overdue', { invoiceDueDate: '2026-03-01' }),
      job('ov-mid',   'Overdue', { invoiceDueDate: '2026-04-10' }),
    ];
    const sorted = sortJobsForAllView(jobs, stageOf);
    expect(sorted.map(j => j.id)).toEqual(['ov-oldest', 'ov-mid', 'ov-newer']);
  });

  it('sorts Invoiced jobs soonest-due first within the Invoiced tier', () => {
    const jobs = [
      job('inv-late',  'Invoiced', { invoiceDueDate: '2026-06-20' }),
      job('inv-soon',  'Invoiced', { invoiceDueDate: '2026-06-05' }),
      job('inv-mid',   'Invoiced', { invoiceDueDate: '2026-06-12' }),
    ];
    const sorted = sortJobsForAllView(jobs, stageOf);
    expect(sorted.map(j => j.id)).toEqual(['inv-soon', 'inv-mid', 'inv-late']);
  });

  it('sorts Paid jobs most-recently-paid first within the Paid tier', () => {
    const jobs = [
      job('paid-old',    'Paid', { paidAt: '2026-04-01T00:00:00Z' }),
      job('paid-recent', 'Paid', { paidAt: '2026-05-28T00:00:00Z' }),
      job('paid-mid',    'Paid', { paidAt: '2026-05-10T00:00:00Z' }),
    ];
    const sorted = sortJobsForAllView(jobs, stageOf);
    expect(sorted.map(j => j.id)).toEqual(['paid-recent', 'paid-mid', 'paid-old']);
  });

  it('sorts Lead/Quoted jobs newest-first within their tiers', () => {
    const jobs = [
      job('lead-old', 'Lead', { createdAt: '2026-04-01T00:00:00Z' }),
      job('lead-new', 'Lead', { createdAt: '2026-05-20T00:00:00Z' }),
      job('quot-old', 'Quoted', { createdAt: '2026-04-10T00:00:00Z' }),
      job('quot-new', 'Quoted', { createdAt: '2026-05-15T00:00:00Z' }),
    ];
    const sorted = sortJobsForAllView(jobs, stageOf);
    // Lead comes before Quoted in tier order
    const ids = sorted.map(j => j.id);
    expect(ids.indexOf('quot-new')).toBeLessThan(ids.indexOf('quot-old'));
    expect(ids.indexOf('lead-new')).toBeLessThan(ids.indexOf('lead-old'));
    expect(ids.indexOf('quot-new')).toBeLessThan(ids.indexOf('lead-new'));
  });
});

// ─── Single-tier lists ────────────────────────────────────────────────────────

describe('sortJobsForAllView — single-tier lists', () => {
  it('handles a list that is entirely Overdue jobs', () => {
    const jobs = [
      job('a', 'Overdue', { invoiceDueDate: '2026-04-10' }),
      job('b', 'Overdue', { invoiceDueDate: '2026-03-01' }),
    ];
    const sorted = sortJobsForAllView(jobs, stageOf);
    expect(sorted.map(j => j.id)).toEqual(['b', 'a']); // oldest first
  });

  it('handles a list that is entirely Paid jobs', () => {
    const jobs = [
      job('x', 'Paid', { paidAt: '2026-05-01T00:00:00Z' }),
      job('y', 'Paid', { paidAt: '2026-05-20T00:00:00Z' }),
    ];
    const sorted = sortJobsForAllView(jobs, stageOf);
    expect(sorted.map(j => j.id)).toEqual(['y', 'x']); // most-recently-paid first
  });
});
