/**
 * jobMeta.test.js — regression cover for META_FIELDS completeness.
 *
 * History: the `overdue` boolean was missing from META_FIELDS which meant
 * manually moving a job to Overdue stage (stagePatch sets overdue:true) would
 * survive in-memory but be silently dropped on the next cloud write/reload.
 * The job would revert to Invoiced on refresh. Added to META_FIELDS in PR
 * feat/manual-stage-move-invoiced-to-overdue.
 *
 * No DOM, no React — pure function tests following the project convention.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractJobMeta, writeJobMeta, readJobMeta } from '../jobMeta';

// ── localStorage mock ─────────────────────────────────────────────────────
// Vitest runs in Node — localStorage doesn't exist. Provide a minimal stub.
// Same pattern as src/components/__tests__/jobMetaCloud.test.js.

function makeLocalStorageMock() {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
}

const localStorageMock = makeLocalStorageMock();
vi.stubGlobal('localStorage', localStorageMock);

// ── Fixtures ──────────────────────────────────────────────────────────────

const JOB_ID = 'test-job-meta-overdue-001';

function invoicedJob() {
  return {
    id: JOB_ID,
    status: 'invoice_sent',
    overdue: false,
    invoiceSentAt: '2026-06-01T10:00:00.000Z',
    total: 350,
    amount: 350,
  };
}

function overdueJob() {
  return {
    id: JOB_ID,
    status: 'invoice_sent',
    overdue: true,
    invoiceSentAt: '2026-06-01T10:00:00.000Z',
    total: 350,
    amount: 350,
  };
}

// ── Cleanup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe('extractJobMeta — overdue field', () => {
  it('extracts overdue:true from a manually-promoted Overdue job', () => {
    const meta = extractJobMeta(overdueJob());
    expect(meta.overdue).toBe(true);
  });

  it('extracts overdue:false from an Invoiced job', () => {
    const meta = extractJobMeta(invoicedJob());
    expect(meta.overdue).toBe(false);
  });

  it('does not include overdue when the field is absent from the job', () => {
    const job = { id: JOB_ID, status: 'invoice_sent' };
    const meta = extractJobMeta(job);
    expect('overdue' in meta).toBe(false);
  });
});

describe('writeJobMeta / readJobMeta — overdue round-trip', () => {
  it('persists overdue:true and reads it back correctly', () => {
    writeJobMeta(JOB_ID, extractJobMeta(overdueJob()));
    const stored = readJobMeta(JOB_ID);
    expect(stored.overdue).toBe(true);
  });

  it('persists overdue:false and reads it back correctly', () => {
    // Simulates moving a job back from Overdue → Invoiced: stagePatch('Invoiced')
    // spreads overdue:false into the patch, which must be persisted so the job
    // doesn't re-derive as Overdue on reload.
    writeJobMeta(JOB_ID, extractJobMeta(invoicedJob()));
    const stored = readJobMeta(JOB_ID);
    expect(stored.overdue).toBe(false);
  });

  it('clears overdue flag when a previously-true value is overwritten with false', () => {
    // First move to Overdue
    writeJobMeta(JOB_ID, extractJobMeta(overdueJob()));
    expect(readJobMeta(JOB_ID).overdue).toBe(true);

    // Revert to Invoiced — overdue:false must win
    writeJobMeta(JOB_ID, extractJobMeta(invoicedJob()));
    expect(readJobMeta(JOB_ID).overdue).toBe(false);
  });
});

// ── Schedule fields regression (Issue 2) ─────────────────────────────────────
// Root cause: scheduledDate/scheduledStart/scheduledEnd were missing from
// META_FIELDS so handleScheduleSave values were silently stripped before
// localStorage write, reverting on every reload.

const SCHED_JOB_ID = 'test-job-meta-schedule-001';

describe('extractJobMeta — schedule fields', () => {
  it('includes scheduledDate when present on the job', () => {
    const job = { id: SCHED_JOB_ID, scheduledDate: '2026-06-10' };
    const meta = extractJobMeta(job);
    expect(meta.scheduledDate).toBe('2026-06-10');
  });

  it('includes scheduledStart and scheduledEnd when present', () => {
    const job = { id: SCHED_JOB_ID, scheduledDate: '2026-06-10', scheduledStart: '09:00', scheduledEnd: '11:30' };
    const meta = extractJobMeta(job);
    expect(meta.scheduledStart).toBe('09:00');
    expect(meta.scheduledEnd).toBe('11:30');
  });

  it('does not include schedule fields when absent from the job', () => {
    const job = { id: SCHED_JOB_ID, status: 'Lead' };
    const meta = extractJobMeta(job);
    expect('scheduledDate' in meta).toBe(false);
    expect('scheduledStart' in meta).toBe(false);
    expect('scheduledEnd' in meta).toBe(false);
  });
});

describe('writeJobMeta / readJobMeta — schedule round-trip', () => {
  it('persists scheduledDate and reads it back', () => {
    writeJobMeta(SCHED_JOB_ID, { scheduledDate: '2026-06-10', scheduledStart: '09:00', scheduledEnd: '11:30' });
    const stored = readJobMeta(SCHED_JOB_ID);
    expect(stored.scheduledDate).toBe('2026-06-10');
    expect(stored.scheduledStart).toBe('09:00');
    expect(stored.scheduledEnd).toBe('11:30');
  });

  it('persists scheduledDate: null (clear) and reads it back as null', () => {
    // Unschedule path writes scheduledDate: null — must survive round-trip
    writeJobMeta(SCHED_JOB_ID, { scheduledDate: null, scheduledStart: null, scheduledEnd: null });
    const stored = readJobMeta(SCHED_JOB_ID);
    expect(stored.scheduledDate).toBeNull();
    expect(stored.scheduledStart).toBeNull();
    expect(stored.scheduledEnd).toBeNull();
  });
});
