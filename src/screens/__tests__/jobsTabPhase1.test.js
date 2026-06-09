/**
 * Unit tests for Jobs-tab Phase 1 pure-logic functions:
 *   - jobMatchesQuery        (1B: client-side search filter)
 *   - sortJobsByStage        (1C: urgent-first sort per stage)
 *   - stage-change state     (fix/search-clears-on-tab-change: tapping a stage
 *                             tab or Show-all clears the active search query)
 *
 * No DOM, no React, no Supabase.
 */

import { describe, it, expect } from 'vitest';
import { jobMatchesQuery, sortJobsByStage } from '../../lib/jobSort.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function job(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Alice',
    summary: 'Boiler repair',
    address: '12 Oak Lane, London, SW1A 1AA',
    phone: '07700900001',
    customerPhone: '',
    mobile: '',
    status: 'active',
    createdAt: '2026-05-01T10:00:00Z',
    ...overrides,
  };
}

// ─── jobMatchesQuery ──────────────────────────────────────────────────────────

describe('jobMatchesQuery', () => {
  it('returns true for an empty query (show-all)', () => {
    expect(jobMatchesQuery(job(), '')).toBe(true);
    expect(jobMatchesQuery(job(), null)).toBe(true);
    expect(jobMatchesQuery(job(), undefined)).toBe(true);
  });

  it('matches on customer name (case-insensitive)', () => {
    const j = job({ customer: 'Bob Smith' });
    expect(jobMatchesQuery(j, 'bob')).toBe(true);
    expect(jobMatchesQuery(j, 'BOB SMITH')).toBe(true);
    expect(jobMatchesQuery(j, 'carol')).toBe(false);
  });

  it('matches on job summary', () => {
    const j = job({ summary: 'Roof tile replacement' });
    expect(jobMatchesQuery(j, 'roof')).toBe(true);
    expect(jobMatchesQuery(j, 'TILE')).toBe(true);
    expect(jobMatchesQuery(j, 'plumbing')).toBe(false);
  });

  it('matches on address', () => {
    const j = job({ address: '45 Church Street, Bristol, BS1 5TS' });
    expect(jobMatchesQuery(j, 'church')).toBe(true);
    expect(jobMatchesQuery(j, 'Bristol')).toBe(true);
    expect(jobMatchesQuery(j, 'london')).toBe(false);
  });

  it('matches on phone', () => {
    const j = job({ phone: '07700900123' });
    expect(jobMatchesQuery(j, '07700')).toBe(true);
    expect(jobMatchesQuery(j, '900123')).toBe(true);
    expect(jobMatchesQuery(j, '999')).toBe(false);
  });

  it('matches on customerPhone when job.phone is empty', () => {
    const j = job({ phone: '', customerPhone: '02079460000' });
    expect(jobMatchesQuery(j, '02079')).toBe(true);
  });

  it('uses job.name as fallback for customer', () => {
    const j = job({ customer: '', name: 'Dave Plumber' });
    expect(jobMatchesQuery(j, 'dave')).toBe(true);
  });

  it('does not match on unrelated fields (e.g. id)', () => {
    const j = job({ id: 'SEARCH_ME' });
    expect(jobMatchesQuery(j, 'SEARCH_ME')).toBe(false);
  });

  // ── Amount matching (DocumentSearchOverlay extension) ─────────────────────
  it('matches on job.total as a plain number string', () => {
    const j = job({ total: 3400 });
    expect(jobMatchesQuery(j, '3400')).toBe(true);
    expect(jobMatchesQuery(j, '340')).toBe(true); // substring
    expect(jobMatchesQuery(j, '9999')).toBe(false);
  });

  it('matches on job.amount when total is absent', () => {
    const j = job({ total: undefined, amount: 850 });
    expect(jobMatchesQuery(j, '850')).toBe(true);
    expect(jobMatchesQuery(j, '100')).toBe(false);
  });

  it('strips leading £ from query before matching amount', () => {
    const j = job({ total: 3400 });
    expect(jobMatchesQuery(j, '£3400')).toBe(true);
  });

  it('strips commas from query so £3,400 matches 3400', () => {
    const j = job({ total: 3400 });
    expect(jobMatchesQuery(j, '£3,400')).toBe(true);
    expect(jobMatchesQuery(j, '3,400')).toBe(true);
  });

  it('does not match when amount is absent and query cannot match other fields', () => {
    // Use a query that won't accidentally match name/summary/address/phone
    const j = job({ customer: 'Zeta', summary: 'Fence', address: 'Long Lane', phone: '', customerPhone: '', mobile: '', total: undefined, amount: undefined });
    expect(jobMatchesQuery(j, '9999')).toBe(false);
  });
});

// ─── sortJobsByStage ──────────────────────────────────────────────────────────

describe('sortJobsByStage', () => {
  it('sorts Overdue jobs: oldest due-date first (most urgent to chase)', () => {
    const jobs = [
      job({ id: 'j2', invoiceDueDate: '2026-04-20' }),
      job({ id: 'j1', invoiceDueDate: '2026-04-10' }), // older = more urgent
      job({ id: 'j3', invoiceDueDate: '2026-05-01' }),
    ];
    const sorted = sortJobsByStage(jobs, 'Overdue');
    expect(sorted.map(j => j.id)).toEqual(['j1', 'j2', 'j3']);
  });

  it('sorts Invoiced jobs: soonest-due first', () => {
    const jobs = [
      job({ id: 'j3', invoiceDueDate: '2026-06-15' }),
      job({ id: 'j1', invoiceDueDate: '2026-06-01' }), // soonest due
      job({ id: 'j2', invoiceDueDate: '2026-06-10' }),
    ];
    const sorted = sortJobsByStage(jobs, 'Invoiced');
    expect(sorted.map(j => j.id)).toEqual(['j1', 'j2', 'j3']);
  });

  it('sorts On jobs: most-recently-touched first', () => {
    const jobs = [
      job({ id: 'j1', updatedAt: '2026-05-20T10:00:00Z' }),
      job({ id: 'j3', updatedAt: '2026-05-28T10:00:00Z' }), // newest
      job({ id: 'j2', updatedAt: '2026-05-25T10:00:00Z' }),
    ];
    const sorted = sortJobsByStage(jobs, 'On');
    expect(sorted.map(j => j.id)).toEqual(['j3', 'j2', 'j1']);
  });

  it('sorts Lead jobs: newest first', () => {
    const jobs = [
      job({ id: 'j1', createdAt: '2026-05-01T10:00:00Z' }),
      job({ id: 'j3', createdAt: '2026-05-20T10:00:00Z' }), // newest
      job({ id: 'j2', createdAt: '2026-05-10T10:00:00Z' }),
    ];
    const sorted = sortJobsByStage(jobs, 'Lead');
    expect(sorted.map(j => j.id)).toEqual(['j3', 'j2', 'j1']);
  });

  it('sorts Quoted jobs: newest first', () => {
    const jobs = [
      job({ id: 'j1', createdAt: '2026-04-01T00:00:00Z' }),
      job({ id: 'j2', createdAt: '2026-04-15T00:00:00Z' }), // newest
    ];
    const sorted = sortJobsByStage(jobs, 'Quoted');
    expect(sorted.map(j => j.id)).toEqual(['j2', 'j1']);
  });

  it('sorts Paid jobs: most-recently-paid first', () => {
    const jobs = [
      job({ id: 'j1', paidAt: '2026-05-10T10:00:00Z' }),
      job({ id: 'j3', paidAt: '2026-05-28T10:00:00Z' }), // most recently paid
      job({ id: 'j2', paidAt: '2026-05-15T10:00:00Z' }),
    ];
    const sorted = sortJobsByStage(jobs, 'Paid');
    expect(sorted.map(j => j.id)).toEqual(['j3', 'j2', 'j1']);
  });

  it('does not mutate the input array', () => {
    const jobs = [
      job({ id: 'j2', createdAt: '2026-05-01T00:00:00Z' }),
      job({ id: 'j1', createdAt: '2026-05-20T00:00:00Z' }),
    ];
    const original = [...jobs.map(j => j.id)];
    sortJobsByStage(jobs, 'Lead');
    expect(jobs.map(j => j.id)).toEqual(original);
  });

  it('returns the same items (no jobs lost or added)', () => {
    const jobs = [
      job({ id: 'j1', invoiceDueDate: '2026-06-01' }),
      job({ id: 'j2', invoiceDueDate: '2026-05-20' }),
      job({ id: 'j3', invoiceDueDate: '2026-06-15' }),
    ];
    const sorted = sortJobsByStage(jobs, 'Overdue');
    expect(sorted.length).toBe(3);
    expect(sorted.map(j => j.id).sort()).toEqual(['j1', 'j2', 'j3']);
  });

  it('handles jobs with no dates gracefully (epoch fallback)', () => {
    const jobs = [
      job({ id: 'j1', invoiceDueDate: null, invoiceSentAt: null }),
      job({ id: 'j2', invoiceDueDate: '2026-05-20' }),
    ];
    const sorted = sortJobsByStage(jobs, 'Overdue');
    // j1 falls back to epoch (Jan 1970) so it sorts first as most overdue
    expect(sorted[0].id).toBe('j1');
  });

  it('returns a copy when stage is unknown/null', () => {
    const jobs = [job({ id: 'j1' }), job({ id: 'j2' })];
    const sorted = sortJobsByStage(jobs, null);
    expect(sorted.length).toBe(2);
  });
});

// ─── Stage-change clears search (feat/unified-stage-control) ──────────────────
//
// WorkScreen handlers: handleSelectStage and handleSelectAll.
// handleSelectStage: sets a real stage, sets showAll=false, clears query.
// handleSelectAll:   sets showAll=true, clears query (idempotent — no toggle).
//   Triggered by the "All" pill in the controls row (not a stage-strip segment).
// These tests model that state machine as a plain reducer to keep them framework-free.

function makeState(overrides = {}) {
  return { searchQuery: '', selectedStage: 'On', showAll: false, ...overrides };
}

// Mirrors handleSelectStage: sets stage, clears query, exits showAll mode.
function selectStage(state, stage) {
  return { ...state, selectedStage: stage, showAll: false, searchQuery: '' };
}

// Mirrors handleSelectAll: always activates All view, clears query.
function selectAll(state) {
  return { ...state, searchQuery: '', showAll: true };
}

describe('stage-change clears search query', () => {
  it('tapping a stage tab clears an active search query', () => {
    const before = makeState({ searchQuery: 'dave', selectedStage: 'Lead' });
    const after = selectStage(before, 'On');
    expect(after.searchQuery).toBe('');
  });

  it('tapping a stage tab switches to the new stage', () => {
    const before = makeState({ selectedStage: 'Lead' });
    const after = selectStage(before, 'Quoted');
    expect(after.selectedStage).toBe('Quoted');
  });

  it('tapping a stage tab exits showAll mode', () => {
    const before = makeState({ showAll: true, searchQuery: 'plumbing' });
    const after = selectStage(before, 'On');
    expect(after.showAll).toBe(false);
    expect(after.searchQuery).toBe('');
  });

  it('tapping the All segment sets showAll=true and clears the search query', () => {
    const before = makeState({ searchQuery: 'dave', showAll: false });
    const after = selectAll(before);
    expect(after.searchQuery).toBe('');
    expect(after.showAll).toBe(true);
  });

  it('tapping the All segment when already in All view stays in All view (idempotent)', () => {
    const before = makeState({ showAll: true });
    const after = selectAll(before);
    expect(after.showAll).toBe(true);
  });

  it('tapping a real stage after All exits All mode', () => {
    const before = makeState({ showAll: true, selectedStage: 'Lead' });
    const after = selectStage(before, 'On');
    expect(after.showAll).toBe(false);
    expect(after.selectedStage).toBe('On');
  });

  it('selecting the already-active stage still clears the query', () => {
    const before = makeState({ searchQuery: 'roof', selectedStage: 'On' });
    const after = selectStage(before, 'On');
    expect(after.searchQuery).toBe('');
    expect(after.selectedStage).toBe('On');
  });

  it('cross-stage search is unaffected while query is active (JobsList logic)', () => {
    // When searchQuery is non-empty, JobsList ignores the stage filter and shows all matches.
    // This test verifies jobMatchesQuery is the gating function — not selectedStage.
    const jobs = [
      job({ id: 'j1', customer: 'Dave', status: 'active' }),          // On
      job({ id: 'j2', customer: 'Dave Jones', status: 'invoice_sent' }), // Invoiced
      job({ id: 'j3', customer: 'Alan', status: 'lead' }),             // Lead
    ];
    const matched = jobs.filter(j => jobMatchesQuery(j, 'dave'));
    expect(matched.map(j => j.id)).toEqual(['j1', 'j2']);
  });
});
