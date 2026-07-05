/**
 * commsLog.test.js — Capture Layer Slice A.
 *
 * Pure-function tests: logComms's only side effect is calling the
 * onUpdateJob callback it's given, so these tests spy on that callback
 * rather than touching localStorage/Supabase.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  shouldDedupComms,
  buildCommsEntry,
  logComms,
  filterCommsLog,
  removeComms,
} from '../commsLog';

describe('shouldDedupComms', () => {
  it('is false when commsLog is empty', () => {
    expect(shouldDedupComms([], 'call')).toBe(false);
    expect(shouldDedupComms(undefined, 'call')).toBe(false);
  });

  it('is false when the last entry is a different type', () => {
    const log = [{ id: 'C-1', type: 'call', date: new Date().toISOString() }];
    expect(shouldDedupComms(log, 'whatsapp')).toBe(false);
  });

  it('is true for a same-type repeat within the 90s window', () => {
    const now = 1_000_000;
    const log = [{ id: 'C-1', type: 'call', date: new Date(now - 5_000).toISOString() }];
    expect(shouldDedupComms(log, 'call', now)).toBe(true);
  });

  it('is false for a same-type repeat outside the 90s window', () => {
    const now = 1_000_000;
    const log = [{ id: 'C-1', type: 'call', date: new Date(now - 91_000).toISOString() }];
    expect(shouldDedupComms(log, 'call', now)).toBe(false);
  });

  it('only checks the LAST entry, not any same-type entry in history', () => {
    const now = 1_000_000;
    const log = [
      { id: 'C-1', type: 'call', date: new Date(now - 10_000).toISOString() },
      { id: 'C-2', type: 'whatsapp', date: new Date(now - 5_000).toISOString() },
    ];
    // Most recent entry is 'whatsapp', so a fresh 'call' is NOT a dedup even
    // though an earlier 'call' exists moments before.
    expect(shouldDedupComms(log, 'call', now)).toBe(false);
  });
});

describe('buildCommsEntry', () => {
  it('builds { id, type, date } with an ISO date', () => {
    const entry = buildCommsEntry('call', 1_000_000);
    expect(entry).toEqual({ id: 'C-1000000', type: 'call', date: new Date(1_000_000).toISOString() });
  });
});

describe('logComms', () => {
  it('appends a new entry via onUpdateJob for a job with no commsLog yet', () => {
    const job = { id: 'j1', customer: 'Dave' };
    const onUpdateJob = vi.fn();
    logComms(job, 'call', onUpdateJob);

    expect(onUpdateJob).toHaveBeenCalledTimes(1);
    const updated = onUpdateJob.mock.calls[0][0];
    expect(updated.commsLog).toHaveLength(1);
    expect(updated.commsLog[0]).toMatchObject({ type: 'call' });
    expect(updated.commsLog[0].id).toMatch(/^C-\d+$/);
    expect(updated.commsLog[0].date).toBeTruthy();
  });

  it('appends onto an existing commsLog without mutating the original array', () => {
    const existing = [{ id: 'C-1', type: 'sms', date: new Date(Date.now() - 200_000).toISOString() }];
    const job = { id: 'j1', customer: 'Dave', commsLog: existing };
    const onUpdateJob = vi.fn();
    logComms(job, 'whatsapp', onUpdateJob);

    expect(onUpdateJob).toHaveBeenCalledTimes(1);
    const updated = onUpdateJob.mock.calls[0][0];
    expect(updated.commsLog).toHaveLength(2);
    expect(updated.commsLog[0]).toBe(existing[0]);
    expect(updated.commsLog[1].type).toBe('whatsapp');
    expect(existing).toHaveLength(1); // original untouched
  });

  it('the 90s dedup guard skips a same-type repeat and does NOT call onUpdateJob', () => {
    const recent = new Date(Date.now() - 5_000).toISOString(); // 5s ago
    const job = { id: 'j1', customer: 'Dave', commsLog: [{ id: 'C-1', type: 'call', date: recent }] };
    const onUpdateJob = vi.fn();
    logComms(job, 'call', onUpdateJob);

    expect(onUpdateJob).not.toHaveBeenCalled();
  });

  it('a different type within the same window is NOT swallowed by the dedup guard', () => {
    const recent = new Date(Date.now() - 5_000).toISOString();
    const job = { id: 'j1', customer: 'Dave', commsLog: [{ id: 'C-1', type: 'call', date: recent }] };
    const onUpdateJob = vi.fn();
    logComms(job, 'whatsapp', onUpdateJob);

    expect(onUpdateJob).toHaveBeenCalledTimes(1);
  });

  it('no-ops when job, type, or onUpdateJob is missing', () => {
    const onUpdateJob = vi.fn();
    logComms(null, 'call', onUpdateJob);
    logComms({ id: 'j1' }, null, onUpdateJob);
    logComms({ id: 'j1' }, 'call', null);
    expect(onUpdateJob).not.toHaveBeenCalled();
  });
});

describe('filterCommsLog', () => {
  it('removes one entry by id', () => {
    const log = [
      { id: 'C-1', type: 'call', date: '2026-07-01T09:00:00Z' },
      { id: 'C-2', type: 'sms', date: '2026-07-01T10:00:00Z' },
    ];
    expect(filterCommsLog(log, 'C-1')).toEqual([log[1]]);
  });

  it('returns [] for undefined/empty input', () => {
    expect(filterCommsLog(undefined, 'C-1')).toEqual([]);
    expect(filterCommsLog([], 'C-1')).toEqual([]);
  });
});

describe('removeComms', () => {
  it('writes the job through onUpdateJob with the entry removed by id', () => {
    const job = {
      id: 'j1',
      commsLog: [
        { id: 'C-1', type: 'call', date: '2026-07-01T09:00:00Z' },
        { id: 'C-2', type: 'review', date: '2026-07-01T10:00:00Z' },
      ],
    };
    const onUpdateJob = vi.fn();
    removeComms(job, 'C-1', onUpdateJob);

    expect(onUpdateJob).toHaveBeenCalledTimes(1);
    const updated = onUpdateJob.mock.calls[0][0];
    expect(updated.commsLog).toEqual([job.commsLog[1]]);
  });

  it('no-ops when job or onUpdateJob is missing', () => {
    const onUpdateJob = vi.fn();
    removeComms(null, 'C-1', onUpdateJob);
    removeComms({ id: 'j1', commsLog: [] }, 'C-1', null);
    expect(onUpdateJob).not.toHaveBeenCalled();
  });
});
