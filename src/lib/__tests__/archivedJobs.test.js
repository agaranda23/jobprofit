/**
 * Tests for src/lib/archivedJobs.js (feat/archived-jobs-view).
 *
 * No DOM, no React — pure logic only. Style mirrors copyArchiveDelete.test.js.
 */

import { describe, it, expect } from 'vitest';
import { isArchived, selectArchivedJobs, applyRestore, formatArchivedAgo } from '../archivedJobs';

// ── isArchived ────────────────────────────────────────────────────────────

describe('isArchived', () => {
  const base = { id: 'J-0001', summary: 'Fix fence', amount: 250, status: 'active' };

  it('is false for a plain active job', () => {
    expect(isArchived(base)).toBe(false);
  });

  it('is true for a job with top-level archived: true', () => {
    expect(isArchived({ ...base, archived: true })).toBe(true);
  });

  it('is true for a job with meta.archived: true', () => {
    expect(isArchived({ ...base, meta: { archived: true } })).toBe(true);
  });

  it('is false when top-level archived: true but also deleted: true', () => {
    expect(isArchived({ ...base, archived: true, deleted: true })).toBe(false);
  });

  it('is false when meta.archived: true but also meta.deleted: true', () => {
    expect(isArchived({ ...base, meta: { archived: true, deleted: true } })).toBe(false);
  });

  it('handles null/undefined without throwing', () => {
    expect(isArchived(null)).toBe(false);
    expect(isArchived(undefined)).toBe(false);
  });
});

// ── selectArchivedJobs ───────────────────────────────────────────────────

describe('selectArchivedJobs', () => {
  it('excludes non-archived and deleted jobs', () => {
    const jobs = [
      { id: 'A', archived: true, meta: { archivedAt: '2026-07-01T00:00:00Z' } },
      { id: 'B' },
      { id: 'C', archived: true, deleted: true, meta: { archivedAt: '2026-07-02T00:00:00Z' } },
    ];
    const result = selectArchivedJobs(jobs);
    expect(result.map(j => j.id)).toEqual(['A']);
  });

  it('sorts newest-archived first', () => {
    const jobs = [
      { id: 'old', archived: true, meta: { archivedAt: '2026-06-01T00:00:00Z' } },
      { id: 'new', archived: true, meta: { archivedAt: '2026-07-10T00:00:00Z' } },
      { id: 'mid', archived: true, meta: { archivedAt: '2026-06-20T00:00:00Z' } },
    ];
    const result = selectArchivedJobs(jobs);
    expect(result.map(j => j.id)).toEqual(['new', 'mid', 'old']);
  });

  it('sorts legacy jobs with missing archivedAt last', () => {
    const jobs = [
      { id: 'legacy', archived: true, meta: {} },
      { id: 'dated', archived: true, meta: { archivedAt: '2026-07-10T00:00:00Z' } },
    ];
    const result = selectArchivedJobs(jobs);
    expect(result.map(j => j.id)).toEqual(['dated', 'legacy']);
  });

  it('sorts jobs with an invalid archivedAt string last, alongside missing ones', () => {
    const jobs = [
      { id: 'invalid', archived: true, meta: { archivedAt: 'not-a-date' } },
      { id: 'dated', archived: true, meta: { archivedAt: '2026-07-10T00:00:00Z' } },
    ];
    const result = selectArchivedJobs(jobs);
    expect(result.map(j => j.id)).toEqual(['dated', 'invalid']);
  });

  it('defaults to an empty array with no argument', () => {
    expect(selectArchivedJobs()).toEqual([]);
  });
});

// ── applyRestore ─────────────────────────────────────────────────────────

describe('applyRestore', () => {
  const now = new Date('2026-07-21T12:00:00Z');

  it('clears archived and meta.archived, keeps meta.archivedAt, stamps unarchivedAt', () => {
    const job = {
      id: 'J-1',
      status: 'invoiced',
      archived: true,
      meta: { archived: true, archivedAt: '2026-07-01T00:00:00Z' },
    };
    const result = applyRestore(job, now);
    expect(result.archived).toBe(false);
    expect(result.meta.archived).toBe(false);
    expect(result.meta.archivedAt).toBe('2026-07-01T00:00:00Z');
    expect(result.meta.unarchivedAt).toBe(now.toISOString());
  });

  it('does not touch job.status — restore lets the job re-derive its own stage', () => {
    const job = { id: 'J-2', status: 'paid', archived: true, meta: { archived: true } };
    const result = applyRestore(job, now);
    expect(result.status).toBe('paid');
  });

  it('preserves other job fields untouched', () => {
    const job = { id: 'J-3', customer: 'Enel', total: 400, archived: true, meta: { archived: true } };
    const result = applyRestore(job, now);
    expect(result.customer).toBe('Enel');
    expect(result.total).toBe(400);
    expect(result.id).toBe('J-3');
  });

  it('handles a job with no meta object at all', () => {
    const job = { id: 'J-4', archived: true };
    const result = applyRestore(job, now);
    expect(result.meta.archived).toBe(false);
    expect(result.meta.unarchivedAt).toBe(now.toISOString());
  });
});

// ── formatArchivedAgo ────────────────────────────────────────────────────

describe('formatArchivedAgo', () => {
  const now = new Date('2026-07-21T12:00:00Z');

  it('returns null for missing input', () => {
    expect(formatArchivedAgo(null, now)).toBeNull();
    expect(formatArchivedAgo(undefined, now)).toBeNull();
    expect(formatArchivedAgo('', now)).toBeNull();
  });

  it('returns null for an invalid date string', () => {
    expect(formatArchivedAgo('not-a-date', now)).toBeNull();
  });

  it('returns "just now" for under a minute', () => {
    expect(formatArchivedAgo(new Date(now.getTime() - 30 * 1000).toISOString(), now)).toBe('just now');
  });

  it('returns minutes ago bucket', () => {
    expect(formatArchivedAgo(new Date(now.getTime() - 5 * 60 * 1000).toISOString(), now)).toBe('5 min ago');
  });

  it('returns singular hour ago', () => {
    expect(formatArchivedAgo(new Date(now.getTime() - 60 * 60 * 1000).toISOString(), now)).toBe('1 hour ago');
  });

  it('returns plural hours ago', () => {
    expect(formatArchivedAgo(new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(), now)).toBe('3 hours ago');
  });

  it('returns "yesterday" for exactly 1 day', () => {
    expect(formatArchivedAgo(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(), now)).toBe('yesterday');
  });

  it('returns days ago for 2-6 days', () => {
    expect(formatArchivedAgo(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(), now)).toBe('3 days ago');
  });

  it('returns singular week ago', () => {
    expect(formatArchivedAgo(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), now)).toBe('1 week ago');
  });

  it('returns plural weeks ago', () => {
    expect(formatArchivedAgo(new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString(), now)).toBe('3 weeks ago');
  });

  it('returns absolute "on D Mon" past ~4 weeks in the same year', () => {
    // now = 2026-07-21; 40 days back = 2026-06-11
    const iso = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatArchivedAgo(iso, now)).toBe('on 11 Jun');
  });

  it('returns absolute "on D Mon YYYY" when the year differs', () => {
    const iso = '2025-12-01T00:00:00Z';
    expect(formatArchivedAgo(iso, now)).toBe('on 1 Dec 2025');
  });
});
