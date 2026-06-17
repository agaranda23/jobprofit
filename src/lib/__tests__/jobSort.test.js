import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sortJobsByColumn, daysInStage, jobMatchesQuery } from '../jobSort.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return {
    id: 'job-1',
    customer: 'Alan Smith',
    summary: 'Bathroom tiles',
    amount: 1200,
    total: 1200,
    date: '2026-05-01',
    createdAt: '2026-05-01T09:00:00.000Z',
    ...overrides,
  };
}

// ── sortJobsByColumn ──────────────────────────────────────────────────────────

describe('sortJobsByColumn', () => {
  const jobs = [
    makeJob({ id: 'a', total: 300, date: '2026-04-01' }),
    makeJob({ id: 'b', total: 100, date: '2026-06-01' }),
    makeJob({ id: 'c', total: 200, date: '2026-05-01' }),
  ];

  it('sorts by amount ascending', () => {
    const result = sortJobsByColumn(jobs, 'amount', 'asc');
    expect(result.map(j => j.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by amount descending', () => {
    const result = sortJobsByColumn(jobs, 'amount', 'desc');
    expect(result.map(j => j.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by date ascending', () => {
    const result = sortJobsByColumn(jobs, 'date', 'asc');
    expect(result.map(j => j.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by date descending', () => {
    const result = sortJobsByColumn(jobs, 'date', 'desc');
    expect(result.map(j => j.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const input = [makeJob({ id: 'x', total: 500 }), makeJob({ id: 'y', total: 100 })];
    const original = [...input];
    sortJobsByColumn(input, 'amount', 'asc');
    expect(input[0].id).toBe(original[0].id);
    expect(input[1].id).toBe(original[1].id);
  });

  it('falls back to 0 for missing amount', () => {
    const noAmount = [
      makeJob({ id: 'a', total: undefined, amount: undefined }),
      makeJob({ id: 'b', total: 50 }),
    ];
    const result = sortJobsByColumn(noAmount, 'amount', 'asc');
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });

  it('falls back to epoch for missing date', () => {
    const noDate = [
      makeJob({ id: 'a', date: undefined }),
      makeJob({ id: 'b', date: '2026-01-01' }),
    ];
    const result = sortJobsByColumn(noDate, 'date', 'asc');
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('b');
  });

  it('uses total over amount when both present', () => {
    const mixed = [
      makeJob({ id: 'a', total: 900, amount: 100 }),
      makeJob({ id: 'b', total: 200, amount: 800 }),
    ];
    const result = sortJobsByColumn(mixed, 'amount', 'asc');
    expect(result[0].id).toBe('b');
    expect(result[1].id).toBe('a');
  });

  it('returns empty array for empty input', () => {
    expect(sortJobsByColumn([], 'amount', 'asc')).toEqual([]);
  });

  it('single element — returns array with that element', () => {
    const single = [makeJob({ id: 'only' })];
    expect(sortJobsByColumn(single, 'amount', 'asc').map(j => j.id)).toEqual(['only']);
  });

  // ── name sort ──────────────────────────────────────────────────────────────

  it('sorts by name ascending (A→Z)', () => {
    const byName = [
      makeJob({ id: 'a', summary: 'Zebra job', customer: 'Zebra Co' }),
      makeJob({ id: 'b', summary: 'Apple job', customer: 'Apple Co' }),
      makeJob({ id: 'c', summary: 'Mango job', customer: 'Mango Co' }),
    ];
    const result = sortJobsByColumn(byName, 'name', 'asc');
    expect(result.map(j => j.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by name descending (Z→A)', () => {
    const byName = [
      makeJob({ id: 'a', summary: 'Zebra job' }),
      makeJob({ id: 'b', summary: 'Apple job' }),
      makeJob({ id: 'c', summary: 'Mango job' }),
    ];
    const result = sortJobsByColumn(byName, 'name', 'desc');
    expect(result.map(j => j.id)).toEqual(['a', 'c', 'b']);
  });

  it('name sort prefers summary over customer over name field', () => {
    const jobs = [
      makeJob({ id: 'a', summary: '', customer: 'Zelda', name: 'ignored' }),
      makeJob({ id: 'b', summary: 'Alpha job', customer: 'Zebra' }),
    ];
    const result = sortJobsByColumn(jobs, 'name', 'asc');
    // 'alpha job' < 'zelda'
    expect(result.map(j => j.id)).toEqual(['b', 'a']);
  });

  it('name sort is case-insensitive', () => {
    const jobs = [
      makeJob({ id: 'a', summary: 'ZZZZZ' }),
      makeJob({ id: 'b', summary: 'aaaaa' }),
    ];
    const result = sortJobsByColumn(jobs, 'name', 'asc');
    expect(result[0].id).toBe('b');
  });

  it('name sort falls back to empty string for missing summary/customer/name', () => {
    const jobs = [
      makeJob({ id: 'a', summary: '', customer: '', name: '' }),
      makeJob({ id: 'b', summary: 'Boiler service', customer: '' }),
    ];
    // '' localeCompare 'boiler service' < 0 → 'a' comes first in asc
    const result = sortJobsByColumn(jobs, 'name', 'asc');
    expect(result[0].id).toBe('a');
  });

  it('name sort does not mutate the input array', () => {
    const input = [
      makeJob({ id: 'a', summary: 'Zebra job' }),
      makeJob({ id: 'b', summary: 'Apple job' }),
    ];
    const original = [input[0].id, input[1].id];
    sortJobsByColumn(input, 'name', 'asc');
    expect([input[0].id, input[1].id]).toEqual(original);
  });
});

// ── jp.workListSort persistence read/validate logic ───────────────────────────
// These tests exercise the validation logic described in the spec as an
// inline pure function (no localStorage mock needed — we test the logic directly).

describe('getPersistedSort validation logic', () => {
  const VALID_COLUMNS = ['name', 'date', 'amount', 'profit'];

  function parseSortState(raw) {
    // Mirrors the getPersistedSort logic in WorkScreen
    try {
      if (!raw) return { column: null, dir: 'asc' };
      const parsed = JSON.parse(raw);
      const col = parsed.column;
      const dir = parsed.dir === 'desc' ? 'desc' : 'asc';
      if (col !== null && !VALID_COLUMNS.includes(col)) {
        return { column: null, dir: 'asc' };
      }
      return { column: col ?? null, dir };
    } catch {
      return { column: null, dir: 'asc' };
    }
  }

  it('returns default when raw is null', () => {
    expect(parseSortState(null)).toEqual({ column: null, dir: 'asc' });
  });

  it('returns default for malformed JSON', () => {
    expect(parseSortState('not-json')).toEqual({ column: null, dir: 'asc' });
  });

  it('returns default when column is an unknown value', () => {
    expect(parseSortState(JSON.stringify({ column: 'unknown', dir: 'asc' }))).toEqual({ column: null, dir: 'asc' });
  });

  it('accepts valid columns', () => {
    for (const col of VALID_COLUMNS) {
      const result = parseSortState(JSON.stringify({ column: col, dir: 'desc' }));
      expect(result.column).toBe(col);
      expect(result.dir).toBe('desc');
    }
  });

  it('accepts column: null explicitly (unsorted / smart default)', () => {
    const result = parseSortState(JSON.stringify({ column: null, dir: 'asc' }));
    expect(result).toEqual({ column: null, dir: 'asc' });
  });

  it('defaults dir to asc for unknown dir values', () => {
    const result = parseSortState(JSON.stringify({ column: 'amount', dir: 'sideways' }));
    expect(result.dir).toBe('asc');
  });
});

// ── daysInStage ───────────────────────────────────────────────────────────────

describe('daysInStage', () => {
  // Pin "now" so tests are deterministic
  const NOW = new Date('2026-06-16T12:00:00.000Z').getTime();

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('On stage uses job.date', () => {
    const job = makeJob({ date: '2026-06-14', updatedAt: '2026-06-10T00:00:00.000Z' });
    // 2026-06-14 → 2026-06-16 = 2 days
    expect(daysInStage(job, 'On')).toBe(2);
  });

  it('On stage falls back to updatedAt when date is missing', () => {
    // NOW = 2026-06-16T12:00:00Z; updatedAt 3 days prior
    const job = makeJob({ date: undefined, updatedAt: '2026-06-13T12:00:00.000Z' });
    expect(daysInStage(job, 'On')).toBe(3);
  });

  it('Lead / Quoted stage uses createdAt', () => {
    // NOW = 2026-06-16T12:00:00Z; createdAt 5 days prior
    const job = makeJob({ createdAt: '2026-06-11T12:00:00.000Z' });
    expect(daysInStage(job, 'Lead')).toBe(5);
    expect(daysInStage(job, 'Quoted')).toBe(5);
  });

  it('Invoiced stage uses invoiceSentAt', () => {
    // NOW = 2026-06-16T12:00:00Z; invoiceSentAt 6 days prior
    const job = makeJob({ invoiceSentAt: '2026-06-10T12:00:00.000Z' });
    expect(daysInStage(job, 'Invoiced')).toBe(6);
  });

  it('Overdue stage uses invoiceSentAt', () => {
    const job = makeJob({ invoiceSentAt: '2026-06-10T12:00:00.000Z' });
    expect(daysInStage(job, 'Overdue')).toBe(6);
  });

  it('Invoiced falls back to invoiceDueDate when invoiceSentAt is absent', () => {
    // NOW = 2026-06-16T12:00:00Z; invoiceDueDate 10 days prior (midnight → floor gives 10)
    const job = makeJob({ invoiceSentAt: undefined, invoiceDueDate: '2026-06-06T12:00:00.000Z' });
    expect(daysInStage(job, 'Invoiced')).toBe(10);
  });

  it('Paid stage uses paidAt', () => {
    // NOW = 2026-06-16T12:00:00Z; paidAt 2 days prior
    const job = makeJob({ paidAt: '2026-06-14T12:00:00.000Z' });
    expect(daysInStage(job, 'Paid')).toBe(2);
  });

  it('Paid stage falls back to updatedAt when paidAt is missing', () => {
    // NOW = 2026-06-16T12:00:00Z; updatedAt 3 days prior
    const job = makeJob({ paidAt: undefined, updatedAt: '2026-06-13T12:00:00.000Z' });
    expect(daysInStage(job, 'Paid')).toBe(3);
  });

  it('returns null when no usable timestamp exists', () => {
    const bare = { id: 'x', customer: 'Test' };
    expect(daysInStage(bare, 'On')).toBeNull();
  });

  it('returns null for null/undefined job', () => {
    expect(daysInStage(null, 'On')).toBeNull();
    expect(daysInStage(undefined, 'On')).toBeNull();
  });

  it('floors partial days — never fractional', () => {
    // 1.9 days ago: expect 1 (floor)
    const stamp = new Date(NOW - 1.9 * 86400000).toISOString();
    const job = makeJob({ createdAt: stamp });
    expect(daysInStage(job, 'Lead')).toBe(1);
  });

  it('returns 0 (not null) when stamp is same day', () => {
    const stamp = new Date(NOW - 3600000).toISOString(); // 1 hour ago
    const job = makeJob({ createdAt: stamp });
    expect(daysInStage(job, 'Lead')).toBe(0);
  });

  it('returns null for a future timestamp (stamp ahead of now)', () => {
    const future = new Date(NOW + 86400000).toISOString();
    const job = makeJob({ createdAt: future });
    expect(daysInStage(job, 'Lead')).toBeNull();
  });

  it('unknown stage falls back to updatedAt then createdAt', () => {
    const job = makeJob({ updatedAt: '2026-06-15T12:00:00.000Z', createdAt: '2026-06-01T00:00:00.000Z' });
    expect(daysInStage(job, '')).toBe(1);
  });
});
