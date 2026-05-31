/**
 * Unit tests for Jobs-tab Phase 1 pure-logic functions:
 *   - jobMatchesQuery  (1B: client-side search filter)
 *   - sortJobsByStage  (1C: urgent-first sort per stage)
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
