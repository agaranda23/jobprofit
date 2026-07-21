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
import { extractJobMeta, writeJobMeta, readJobMeta, applyJobMeta, clearPending } from '../jobMeta';

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

const FINISH_JOB_ID = 'test-job-meta-finish-001';
describe('extractJobMeta targetFinishDate', () => {
  it('included when present', () => { expect(extractJobMeta({ id: FINISH_JOB_ID, targetFinishDate: '2026-06-20' }).targetFinishDate).toBe('2026-06-20'); });
  it('absent when not on job', () => { expect('targetFinishDate' in extractJobMeta({ id: FINISH_JOB_ID })).toBe(false); });
});
describe('writeJobMeta/readJobMeta targetFinishDate', () => {
  it('round-trips', () => { writeJobMeta(FINISH_JOB_ID, { targetFinishDate: '2026-06-20' }); expect(readJobMeta(FINISH_JOB_ID).targetFinishDate).toBe('2026-06-20'); });
  it('null clears', () => { writeJobMeta(FINISH_JOB_ID, { targetFinishDate: null }); expect(readJobMeta(FINISH_JOB_ID).targetFinishDate).toBeNull(); });
});

// ── Deposit percent / amount_pence round-trip (Fix 2) ────────────────────────
// Root cause: deposit_percent and deposit_amount_pence were absent from
// META_FIELDS, so ReviewSheet's write of these fields was silently stripped
// before the localStorage write. fetch-public-job reads them from the JSONB
// meta column; without them in META_FIELDS they were always 0 on the public page.

const DEPOSIT_JOB_ID = 'test-job-meta-deposit-001';

describe('extractJobMeta — deposit fields', () => {
  it('extracts deposit_percent when present', () => {
    const meta = extractJobMeta({ id: DEPOSIT_JOB_ID, deposit_percent: 25 });
    expect(meta.deposit_percent).toBe(25);
  });

  it('extracts deposit_amount_pence when present', () => {
    const meta = extractJobMeta({ id: DEPOSIT_JOB_ID, deposit_amount_pence: 12500 });
    expect(meta.deposit_amount_pence).toBe(12500);
  });

  it('does not include deposit_percent when absent from job', () => {
    const meta = extractJobMeta({ id: DEPOSIT_JOB_ID, status: 'quoted' });
    expect('deposit_percent' in meta).toBe(false);
  });

  it('does not include deposit_amount_pence when absent from job', () => {
    const meta = extractJobMeta({ id: DEPOSIT_JOB_ID, status: 'quoted' });
    expect('deposit_amount_pence' in meta).toBe(false);
  });
});

describe('writeJobMeta / readJobMeta — deposit round-trip', () => {
  it('persists deposit_percent and reads it back', () => {
    writeJobMeta(DEPOSIT_JOB_ID, { deposit_percent: 25, deposit_amount_pence: 12500 });
    const stored = readJobMeta(DEPOSIT_JOB_ID);
    expect(stored.deposit_percent).toBe(25);
    expect(stored.deposit_amount_pence).toBe(12500);
  });

  it('deposit_percent:0 clears correctly', () => {
    writeJobMeta(DEPOSIT_JOB_ID, { deposit_percent: 25 });
    writeJobMeta(DEPOSIT_JOB_ID, { deposit_percent: 0, deposit_amount_pence: null });
    const stored = readJobMeta(DEPOSIT_JOB_ID);
    expect(stored.deposit_percent).toBe(0);
    expect(stored.deposit_amount_pence).toBeNull();
  });

  it('deposit fields survive alongside other meta fields', () => {
    writeJobMeta(DEPOSIT_JOB_ID, {
      quoteStatus: 'sent',
      publicAccessToken: 'aaaabbbb-0000-4000-8000-ccccddddeeee',
      deposit_percent: 30,
      deposit_amount_pence: 9000,
    });
    const stored = readJobMeta(DEPOSIT_JOB_ID);
    expect(stored.quoteStatus).toBe('sent');
    expect(stored.deposit_percent).toBe(30);
    expect(stored.deposit_amount_pence).toBe(9000);
  });

  it('a job with deposit_percent set has it appear in the shape fetch-public-job would read', () => {
    // Simulate the full round-trip: ReviewSheet writes to meta via writeJobMeta,
    // cloud sync writes to JSONB, fetch-public-job reads m.deposit_percent.
    // In this test the "cloud JSONB" is represented by the stored meta object.
    writeJobMeta(DEPOSIT_JOB_ID, {
      quoteStatus:          'sent',
      publicAccessToken:    'aaaabbbb-0000-4000-8000-ccccddddeeee',
      deposit_percent:      25,
      deposit_amount_pence: 12500,
    });
    const m = readJobMeta(DEPOSIT_JOB_ID);
    // This is the shape fetch-public-job reads from meta (m.deposit_percent ?? 0)
    expect(m.deposit_percent ?? 0).toBe(25);
    expect(m.deposit_amount_pence ?? null).toBe(12500);
  });
});

// ── deposit_due_date + vat round-trip (quote doc VAT/deposit-due fast-follow) ──
// Root cause (same shape as the deposit_percent bug above): sendQuote.js writes
// job.deposit_due_date onto updatedJob, but without a META_FIELDS entry
// extractJobMeta stripped it before every meta write — it survived only for
// the initial in-memory send, then vanished on reload/resend. `vat` is the
// voice-quote confirm card's "plus/inc VAT" flag (AddJobModal), same story.

const VAT_DEPOSIT_JOB_ID = 'test-job-meta-vat-deposit-due-001';

describe('extractJobMeta — deposit_due_date + vat', () => {
  it('extracts deposit_due_date when present', () => {
    const meta = extractJobMeta({ id: VAT_DEPOSIT_JOB_ID, deposit_due_date: '2026-07-11' });
    expect(meta.deposit_due_date).toBe('2026-07-11');
  });

  it('does not include deposit_due_date when absent from job', () => {
    const meta = extractJobMeta({ id: VAT_DEPOSIT_JOB_ID, status: 'quoted' });
    expect('deposit_due_date' in meta).toBe(false);
  });

  it('extracts vat:true when present', () => {
    const meta = extractJobMeta({ id: VAT_DEPOSIT_JOB_ID, vat: true });
    expect(meta.vat).toBe(true);
  });

  it('extracts vat:false when present', () => {
    const meta = extractJobMeta({ id: VAT_DEPOSIT_JOB_ID, vat: false });
    expect(meta.vat).toBe(false);
  });

  it('does not include vat when absent from job', () => {
    const meta = extractJobMeta({ id: VAT_DEPOSIT_JOB_ID, status: 'quoted' });
    expect('vat' in meta).toBe(false);
  });
});

describe('writeJobMeta / readJobMeta — deposit_due_date + vat round-trip', () => {
  it('persists deposit_due_date and reads it back (the bug: previously always stripped)', () => {
    writeJobMeta(VAT_DEPOSIT_JOB_ID, { deposit_percent: 25, deposit_amount_pence: 12500, deposit_due_date: '2026-07-11' });
    const stored = readJobMeta(VAT_DEPOSIT_JOB_ID);
    expect(stored.deposit_due_date).toBe('2026-07-11');
  });

  it('persists vat:true and reads it back', () => {
    writeJobMeta(VAT_DEPOSIT_JOB_ID, { vat: true });
    expect(readJobMeta(VAT_DEPOSIT_JOB_ID).vat).toBe(true);
  });

  it('deposit_due_date + vat survive alongside other meta fields', () => {
    writeJobMeta(VAT_DEPOSIT_JOB_ID, {
      quoteStatus: 'sent',
      vat: true,
      deposit_percent: 25,
      deposit_amount_pence: 12500,
      deposit_due_date: '2026-07-11',
    });
    const stored = readJobMeta(VAT_DEPOSIT_JOB_ID);
    expect(stored.quoteStatus).toBe('sent');
    expect(stored.vat).toBe(true);
    expect(stored.deposit_due_date).toBe('2026-07-11');
  });
});

// ── quoteValidUntil regression (fix/quote-public-vat-validity) ───────────────
// Root cause: DocumentPreview's "Valid until" edit used to write
// profile.quote_validity_days, silently changing the validity window on EVERY
// future quote. quoteValidUntil is the per-JOB override that fixes this —
// it must survive the same JSONB meta round-trip as every other per-job field.

const VALID_UNTIL_JOB_ID = 'test-job-meta-quote-valid-until-001';

describe('extractJobMeta — quoteValidUntil', () => {
  it('extracts quoteValidUntil when present on the job', () => {
    const meta = extractJobMeta({ id: VALID_UNTIL_JOB_ID, quoteValidUntil: '2026-08-01' });
    expect(meta.quoteValidUntil).toBe('2026-08-01');
  });

  it('does not include quoteValidUntil when absent from the job', () => {
    const meta = extractJobMeta({ id: VALID_UNTIL_JOB_ID, status: 'quoted' });
    expect('quoteValidUntil' in meta).toBe(false);
  });
});

describe('writeJobMeta / readJobMeta — quoteValidUntil round-trip', () => {
  it('persists the per-quote override and reads it back', () => {
    writeJobMeta(VALID_UNTIL_JOB_ID, { quoteValidUntil: '2026-08-01' });
    expect(readJobMeta(VALID_UNTIL_JOB_ID).quoteValidUntil).toBe('2026-08-01');
  });

  it('quoteValidUntil survives alongside other meta fields (no profile field is touched)', () => {
    writeJobMeta(VALID_UNTIL_JOB_ID, { quoteStatus: 'sent', quoteValidUntil: '2026-08-01' });
    const stored = readJobMeta(VALID_UNTIL_JOB_ID);
    expect(stored.quoteStatus).toBe('sent');
    expect(stored.quoteValidUntil).toBe('2026-08-01');
  });
});

// ── Archived-jobs persistence fix (fix/archived-flag-persistence) ────────────
// Founder-reported bug: archiving a job showed it in the Archived tab briefly,
// then it reverted to the pipeline as soon as the Archived tab was opened.
// Root cause: archived/archivedAt/unarchivedAt were set on the in-memory job
// but absent from META_FIELDS, so extractJobMeta stripped them before every
// meta write — they never reached the cloud meta JSONB. The next reconcile
// (applyJobMeta) rebuilt the job from the cloud baseline with no archived
// flag and nothing pending to re-overlay it, so the local flag was discarded.
// Same bug class as `overdue` above — see jobMeta.js META_FIELDS comment.

const ARCHIVED_JOB_ID = 'test-job-meta-archived-001';

function archivedJob() {
  return {
    id: ARCHIVED_JOB_ID,
    status: 'invoice_sent',
    archived: true,
    archivedAt: '2026-07-21T09:00:00.000Z',
  };
}

describe('extractJobMeta — archived fields (the persistence bug)', () => {
  it('extracts archived:true from an archived job', () => {
    const meta = extractJobMeta(archivedJob());
    expect(meta.archived).toBe(true);
  });

  it('extracts archivedAt when present', () => {
    const meta = extractJobMeta(archivedJob());
    expect(meta.archivedAt).toBe('2026-07-21T09:00:00.000Z');
  });

  it('extracts unarchivedAt when present (restore path)', () => {
    const meta = extractJobMeta({ id: ARCHIVED_JOB_ID, archived: false, unarchivedAt: '2026-07-21T10:00:00.000Z' });
    expect(meta.unarchivedAt).toBe('2026-07-21T10:00:00.000Z');
  });

  it('does not include archived/archivedAt/unarchivedAt when absent from the job', () => {
    const job = { id: ARCHIVED_JOB_ID, status: 'active' };
    const meta = extractJobMeta(job);
    expect('archived'     in meta).toBe(false);
    expect('archivedAt'   in meta).toBe(false);
    expect('unarchivedAt' in meta).toBe(false);
  });
});

describe('writeJobMeta / readJobMeta — archived round-trip', () => {
  it('persists archived:true + archivedAt and reads them back (the bug: previously always stripped)', () => {
    writeJobMeta(ARCHIVED_JOB_ID, extractJobMeta(archivedJob()));
    const stored = readJobMeta(ARCHIVED_JOB_ID);
    expect(stored.archived).toBe(true);
    expect(stored.archivedAt).toBe('2026-07-21T09:00:00.000Z');
  });

  it('persists archived:false + unarchivedAt on restore, preserving archivedAt', () => {
    writeJobMeta(ARCHIVED_JOB_ID, extractJobMeta(archivedJob()));
    writeJobMeta(ARCHIVED_JOB_ID, {
      archived: false,
      archivedAt: '2026-07-21T09:00:00.000Z', // preserved by applyRestore's spread
      unarchivedAt: '2026-07-21T10:00:00.000Z',
    });
    const stored = readJobMeta(ARCHIVED_JOB_ID);
    expect(stored.archived).toBe(false);
    expect(stored.archivedAt).toBe('2026-07-21T09:00:00.000Z');
    expect(stored.unarchivedAt).toBe('2026-07-21T10:00:00.000Z');
  });
});

describe('applyJobMeta — archived overlay survives a cloud reconcile while pending', () => {
  it('pending archived:true survives a cloud refetch that has no archived flag (this is the exact revert bug)', () => {
    // Trader taps Archive. handleArchiveJob → handleUpdateJob → writeJobMeta
    // marks archived/archivedAt as pending (not yet confirmed synced).
    writeJobMeta(ARCHIVED_JOB_ID, extractJobMeta(archivedJob()));

    // Trader opens the Archived tab, which triggers a cloud refetch. Before the
    // fix, the cloud job below (no archived field — matches the old cloud row
    // written before archived/archivedAt were in META_FIELDS) would silently
    // win because applyJobMeta had nothing pending to re-overlay.
    const cloudJobNoArchiveFlag = { id: ARCHIVED_JOB_ID, status: 'invoice_sent', total: 300, amount: 300 };
    const result = applyJobMeta(cloudJobNoArchiveFlag);

    expect(result.archived).toBe(true);
    expect(result.archivedAt).toBe('2026-07-21T09:00:00.000Z');
  });

  it('once the cloud write is confirmed (pending cleared), the cloud archived value is authoritative', () => {
    writeJobMeta(ARCHIVED_JOB_ID, extractJobMeta(archivedJob()));
    clearPending(ARCHIVED_JOB_ID, ['archived', 'archivedAt']); // simulate confirmed sync

    const cloudJobWithArchiveFlag = { id: ARCHIVED_JOB_ID, status: 'invoice_sent', archived: true, archivedAt: '2026-07-21T09:00:00.000Z' };
    const result = applyJobMeta(cloudJobWithArchiveFlag);

    expect(result.archived).toBe(true);
    expect(result.archivedAt).toBe('2026-07-21T09:00:00.000Z');
  });
});
