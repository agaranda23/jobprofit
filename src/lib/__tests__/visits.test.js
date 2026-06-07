import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  readVisits,
  writeVisits,
  computeVisitStatus,
  computeFinishStatus,
  getScheduleMeta,
  isLastPlannedVisit,
} from '../visits.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const TODAY = '2026-06-02';
const YESTERDAY = '2026-06-01';
const TOMORROW = '2026-06-03';

// Freeze the clock so computed statuses are deterministic
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-02T10:00:00'));
});
afterEach(() => vi.useRealTimers());

const simpleFmt = (d) => d; // identity — tests care about logic, not locale

// ── readVisits ─────────────────────────────────────────────────────────────

describe('readVisits', () => {
  it('returns [] for null/undefined job', () => {
    expect(readVisits(null)).toEqual([]);
    expect(readVisits(undefined)).toEqual([]);
  });

  it('returns [] when job has neither visits[] nor scheduledDate', () => {
    expect(readVisits({})).toEqual([]);
    expect(readVisits({ summary: 'Kitchen rewire' })).toEqual([]);
  });

  it('converts legacy scheduledDate-only job into a single virtual visit', () => {
    const job = { scheduledDate: '2026-06-05' };
    const result = readVisits(job);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('legacy-0');
    expect(result[0].date).toBe('2026-06-05');
    expect(result[0].status).toBe('planned');
    expect(result[0].start).toBeUndefined();
    expect(result[0].end).toBeUndefined();
  });

  it('converts legacy job with scheduledStart and scheduledEnd', () => {
    const job = { scheduledDate: '2026-06-05', scheduledStart: '09:00', scheduledEnd: '17:00' };
    const result = readVisits(job);
    expect(result[0].start).toBe('09:00');
    expect(result[0].end).toBe('17:00');
  });

  it('returns visits[] as-is when present and non-empty (visits[] wins)', () => {
    const visits = [
      { id: 'v-1', date: '2026-06-02', status: 'planned' },
      { id: 'v-2', date: '2026-06-03', status: 'planned' },
    ];
    const job = {
      scheduledDate: '2026-06-01', // legacy — should be ignored
      visits,
    };
    const result = readVisits(job);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('v-1');
    expect(result[1].id).toBe('v-2');
  });

  it('ignores visits[] when it is an empty array and falls back to legacy', () => {
    const job = { scheduledDate: '2026-06-05', visits: [] };
    const result = readVisits(job);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('legacy-0');
  });
});

// ── writeVisits ────────────────────────────────────────────────────────────

describe('writeVisits', () => {
  it('returns a patch containing visits[] and legacy scheduledDate fields', () => {
    const visits = [
      { id: 'v-1', date: '2026-06-05', start: '09:00', end: '17:00', status: 'planned' },
    ];
    const patch = writeVisits({}, visits);
    expect(patch.visits).toEqual(visits);
    expect(patch.scheduledDate).toBe('2026-06-05');
    expect(patch.scheduledStart).toBe('09:00');
    expect(patch.scheduledEnd).toBe('17:00');
  });

  it('sorts visits chronologically in the patch', () => {
    const visits = [
      { id: 'v-2', date: '2026-06-10', status: 'planned' },
      { id: 'v-1', date: '2026-06-05', status: 'planned' },
    ];
    const patch = writeVisits({}, visits);
    expect(patch.visits[0].id).toBe('v-1');
    expect(patch.visits[1].id).toBe('v-2');
    // Legacy fields point to first (earliest) visit
    expect(patch.scheduledDate).toBe('2026-06-05');
  });

  it('nulls legacy fields when visits array is empty', () => {
    const patch = writeVisits({}, []);
    expect(patch.scheduledDate).toBeNull();
    expect(patch.scheduledStart).toBeNull();
    expect(patch.scheduledEnd).toBeNull();
    expect(patch.visits).toEqual([]);
  });

  it('does not mutate the input visits array', () => {
    const visits = [
      { id: 'v-2', date: '2026-06-10', status: 'planned' },
      { id: 'v-1', date: '2026-06-05', status: 'planned' },
    ];
    const original = [...visits];
    writeVisits({}, visits);
    expect(visits[0].id).toBe(original[0].id); // v-2 still first in original
  });
});

// ── computeVisitStatus ──────────────────────────────────────────────────────

describe('computeVisitStatus', () => {
  it('returns "done" for done visits regardless of date', () => {
    expect(computeVisitStatus({ date: YESTERDAY, status: 'done' })).toBe('done');
    expect(computeVisitStatus({ date: TOMORROW, status: 'done' })).toBe('done');
  });

  it('returns "cancelled" for cancelled visits', () => {
    expect(computeVisitStatus({ date: TODAY, status: 'cancelled' })).toBe('cancelled');
  });

  it('returns "today" when visit date equals today', () => {
    expect(computeVisitStatus({ date: TODAY, status: 'planned' })).toBe('today');
  });

  it('returns "missed" when planned visit is in the past', () => {
    expect(computeVisitStatus({ date: YESTERDAY, status: 'planned' })).toBe('missed');
  });

  it('returns "planned" for future visits', () => {
    expect(computeVisitStatus({ date: TOMORROW, status: 'planned' })).toBe('planned');
  });
});

// ── getScheduleMeta ────────────────────────────────────────────────────────

describe('getScheduleMeta', () => {
  it('returns "Not scheduled" for empty visits', () => {
    expect(getScheduleMeta([], simpleFmt)).toBe('Not scheduled');
    expect(getScheduleMeta(null, simpleFmt)).toBe('Not scheduled');
  });

  it('returns single-visit legacy format for one visit', () => {
    const visits = [{ id: 'v-1', date: '2026-06-05', start: '09:00', end: '17:00', status: 'planned' }];
    const meta = getScheduleMeta(visits, simpleFmt);
    expect(meta).toBe('2026-06-05 · 09:00–17:00');
  });

  it('returns single-visit format without time when no start', () => {
    const visits = [{ id: 'v-1', date: '2026-06-05', status: 'planned' }];
    expect(getScheduleMeta(visits, simpleFmt)).toBe('2026-06-05');
  });

  it('returns "Next: … · +N more" for multi-visit jobs', () => {
    const visits = [
      { id: 'v-1', date: '2026-06-05', status: 'planned' },
      { id: 'v-2', date: '2026-06-06', status: 'planned' },
      { id: 'v-3', date: '2026-06-07', status: 'planned' },
    ];
    const meta = getScheduleMeta(visits, simpleFmt);
    expect(meta).toBe('Next: 2026-06-05 · +2 more');
  });

  it('returns "All visits done · last …" when all visits are done', () => {
    const visits = [
      { id: 'v-1', date: '2026-06-03', status: 'done' },
      { id: 'v-2', date: '2026-06-05', status: 'done' },
    ];
    const meta = getScheduleMeta(visits, simpleFmt);
    expect(meta).toBe('All visits done · last 2026-06-05');
  });

  it('handles mix of done and planned', () => {
    const visits = [
      { id: 'v-1', date: '2026-06-01', status: 'done' },
      { id: 'v-2', date: '2026-06-05', status: 'planned' },
    ];
    const meta = getScheduleMeta(visits, simpleFmt);
    // Only 1 active remaining — no "+N more"
    expect(meta).toBe('Next: 2026-06-05');
  });
});

// ── isLastPlannedVisit ─────────────────────────────────────────────────────

describe('isLastPlannedVisit', () => {
  it('returns true when marking the only planned visit done', () => {
    const visits = [
      { id: 'v-1', date: '2026-06-05', status: 'planned' },
    ];
    expect(isLastPlannedVisit(visits, 'v-1')).toBe(true);
  });

  it('returns false when other planned visits remain', () => {
    const visits = [
      { id: 'v-1', date: '2026-06-05', status: 'planned' },
      { id: 'v-2', date: '2026-06-06', status: 'planned' },
    ];
    expect(isLastPlannedVisit(visits, 'v-1')).toBe(false);
  });

  it('ignores already-done visits when computing remaining', () => {
    const visits = [
      { id: 'v-1', date: '2026-06-01', status: 'done' },
      { id: 'v-2', date: '2026-06-05', status: 'planned' },
    ];
    expect(isLastPlannedVisit(visits, 'v-2')).toBe(true);
  });

  it('treats cancelled visits same as done (not "remaining planned")', () => {
    const visits = [
      { id: 'v-1', date: '2026-06-01', status: 'cancelled' },
      { id: 'v-2', date: '2026-06-05', status: 'planned' },
    ];
    expect(isLastPlannedVisit(visits, 'v-2')).toBe(true);
  });
});

describe('computeFinishStatus', () => {
  it('null/null returns null', () => { expect(computeFinishStatus(null, null)).toBeNull(); });
  it('ontrack when future', () => { const r = computeFinishStatus('2026-06-05', null); expect(r.tone).toBe('ontrack'); expect(r.label).toContain('days left'); });
  it('1 day left singular', () => { expect(computeFinishStatus(TOMORROW, null).label).toBe('On track · 1 day left'); });
  it('duetoday', () => { expect(computeFinishStatus(TODAY, null).tone).toBe('duetoday'); });
  it('overdue', () => { const r = computeFinishStatus(YESTERDAY, null); expect(r.tone).toBe('overdue'); expect(r.label).toContain('1 day over'); });
  it('finished Job ended', () => { expect(computeFinishStatus(null, '2026-06-02T09:00:00Z').label).toBe('Job ended'); });
  it('finished 2 days early', () => { expect(computeFinishStatus('2026-06-04', '2026-06-02T09:00:00Z').label).toBe('Finished 2 days early'); });
  it('finished on time', () => { expect(computeFinishStatus('2026-06-02', '2026-06-02T09:00:00Z').label).toBe('Finished on time'); });
  it('finished 2 days late', () => { expect(computeFinishStatus('2026-05-31', '2026-06-02T09:00:00Z').label).toBe('Finished 2 days late'); });
});

describe('getScheduleMeta finish-line overrides', () => {
  it('Done when completedAt', () => { expect(getScheduleMeta([], simpleFmt, { completedAt: '2026-06-02' })).toBe('Done · 2026-06-02'); });
  it('Due date when on track', () => { expect(getScheduleMeta([], simpleFmt, { targetFinishDate: '2026-06-10' })).toBe('Due 2026-06-10'); });
  it('Due today', () => { expect(getScheduleMeta([], simpleFmt, { targetFinishDate: TODAY })).toBe('Due today'); });
  it('N days over short form', () => { expect(getScheduleMeta([], simpleFmt, { targetFinishDate: YESTERDAY })).toBe('1 day over'); });
  it('completedAt beats targetFinishDate', () => { expect(getScheduleMeta([], simpleFmt, { targetFinishDate: '2026-06-10', completedAt: '2026-06-02' })).toContain('Done'); });
});
