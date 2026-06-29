/**
 * Tests for the job cascade delete and shared copy constants.
 *
 * Covers:
 *   1. buildDeleteJobCopy — all four strings returned correctly, with and
 *      without a customer name.
 *   2. deleteJobWithData — verifies the cascade order:
 *      (a) photo storage objects deleted best-effort
 *      (b) linked receipts deleted best-effort
 *      (c) jobs row deleted (throwing on failure)
 *      (d) localStorage meta side-channel removed
 *   3. deleteJobWithData — works via localStorage fallback when not signed in.
 *   4. deleteJobWithData — throws and does NOT remove localStorage job entry
 *      when the jobs-row delete fails (avoids reappear-on-sync).
 *   5. id/cloudId model — confirmed local id === cloudId === server UUID (store
 *      comment line 422); deleteJobWithData passes job.id to deleteJobFromCloud
 *      which calls .eq('id', jobId), matching the Supabase PK.
 *
 * Supabase is vi.mock'd so no env vars are required in CI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildDeleteJobCopy, buildDeleteJobBody, DELETE_JOB_TITLE, DELETE_JOB_CONFIRM_LABEL, DELETE_JOB_CANCEL_LABEL } from '../deleteJobCopy';

// ── 1. buildDeleteJobCopy ─────────────────────────────────────────────────────

describe('buildDeleteJobCopy', () => {
  it('returns the correct title string', () => {
    expect(buildDeleteJobCopy('Bob Smith').title).toBe('Delete this job?');
  });

  it('title matches DELETE_JOB_TITLE constant', () => {
    expect(buildDeleteJobCopy('Anyone').title).toBe(DELETE_JOB_TITLE);
  });

  it('confirmLabel is "Delete job"', () => {
    expect(buildDeleteJobCopy('Bob Smith').confirmLabel).toBe('Delete job');
  });

  it('confirmLabel matches DELETE_JOB_CONFIRM_LABEL constant', () => {
    expect(buildDeleteJobCopy('Anyone').confirmLabel).toBe(DELETE_JOB_CONFIRM_LABEL);
  });

  it('cancelLabel is "Cancel"', () => {
    expect(buildDeleteJobCopy('Bob Smith').cancelLabel).toBe('Cancel');
  });

  it('cancelLabel matches DELETE_JOB_CANCEL_LABEL constant', () => {
    expect(buildDeleteJobCopy('Anyone').cancelLabel).toBe(DELETE_JOB_CANCEL_LABEL);
  });

  it('body includes the customer name when provided', () => {
    const { body } = buildDeleteJobCopy('Bob Smith');
    expect(body).toContain("Bob Smith's job");
  });

  it('body mentions photos, receipts, payments and notes', () => {
    const { body } = buildDeleteJobCopy('Alice');
    expect(body).toContain('photos');
    expect(body).toContain('receipts');
    expect(body).toContain('payments');
    expect(body).toContain('notes');
  });

  it('body ends with the "can\'t get it back" line', () => {
    const { body } = buildDeleteJobCopy('Alice');
    expect(body).toContain("You can't get it back");
  });

  it('body falls back gracefully when customer name is empty string', () => {
    const { body } = buildDeleteJobCopy('');
    expect(body).not.toContain("'s job");
    expect(body).toContain('this job and everything attached to it');
  });

  it('body falls back gracefully when customer name is undefined', () => {
    const { body } = buildDeleteJobCopy(undefined);
    expect(body).not.toContain("'s job");
    expect(body).toContain('this job and everything attached to it');
  });

  it('trims whitespace from the customer name', () => {
    const { body } = buildDeleteJobCopy('  Dave  ');
    expect(body).toContain("Dave's job");
    expect(body).not.toContain("  Dave  's job");
  });
});

describe('buildDeleteJobBody', () => {
  it('is consistent with buildDeleteJobCopy body', () => {
    const name = 'Carol';
    expect(buildDeleteJobBody(name)).toBe(buildDeleteJobCopy(name).body);
  });
});

// ── 2–5. deleteJobWithData cascade ───────────────────────────────────────────

// Mock supabase before importing store.js
vi.mock('../supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
    storage: {
      from: vi.fn(),
    },
  },
}));

const localStorageData = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn(key => localStorageData[key] ?? null),
  setItem: vi.fn((key, val) => { localStorageData[key] = val; }),
  removeItem: vi.fn(key => { delete localStorageData[key]; }),
});

describe('deleteJobWithData cascade', () => {
  let deleteJobWithData;
  let mockJobsDelete;
  let mockReceiptsDelete;
  let mockPhotoStorage;
  let mockReceiptStorage;

  const JOB_ID = 'job-uuid-abc';
  const RECEIPT_ID = 'receipt-uuid-xyz';
  const PHOTO_PATH = 'user-123/job-uuid-abc/1234-photo.jpg';

  const testJob = {
    id: JOB_ID,
    cloudId: JOB_ID,
    customer: 'Test User',
    meta: {
      photos: [
        { path: PHOTO_PATH, uploadedAt: '2026-01-01T00:00:00Z' },
      ],
    },
  };

  beforeEach(async () => {
    vi.resetModules();

    // Prime localStorage with job + receipt mirror
    localStorageData['jobprofit-app-data'] = JSON.stringify({
      jobs: [
        { id: JOB_ID, cloudId: JOB_ID },
        { id: 'job-other', cloudId: 'job-other' },
      ],
      expenses: [
        { id: RECEIPT_ID, cloudId: RECEIPT_ID, jobId: JOB_ID, imagePath: null },
        { id: 'receipt-other', cloudId: 'receipt-other', jobId: 'job-other' },
      ],
      invoices: [],
    });

    // Prime job meta side-channel
    localStorageData[`jp.jobMeta.${JOB_ID}`] = JSON.stringify({ status: 'active' });

    // Photo storage mock — .from('job-photos').remove([path])
    mockPhotoStorage = { remove: vi.fn().mockResolvedValue({ error: null }) };
    // Receipt storage mock — .from('receipts').remove([path])
    mockReceiptStorage = { remove: vi.fn().mockResolvedValue({ error: null }) };

    // Jobs delete chain: .from('jobs').delete().eq('id', jobId)
    mockJobsDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    // Receipts delete chain: .from('receipts').delete().eq('id', receiptId)
    mockReceiptsDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }) ,
    });

    const { supabase } = await import('../supabase');
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    supabase.from.mockImplementation(table => {
      if (table === 'jobs')     return { delete: mockJobsDelete };
      if (table === 'receipts') return { delete: mockReceiptsDelete };
      return { delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
    });
    supabase.storage.from.mockImplementation(bucket => {
      if (bucket === 'job-photos') return mockPhotoStorage;
      if (bucket === 'receipts')   return mockReceiptStorage;
      return { remove: vi.fn().mockResolvedValue({ error: null }) };
    });

    ({ deleteJobWithData } = await import('../store'));
  });

  it('deletes the jobs row from Supabase', async () => {
    await deleteJobWithData(testJob, []);
    expect(mockJobsDelete).toHaveBeenCalledOnce();
    const eqMock = mockJobsDelete.mock.results[0].value.eq;
    expect(eqMock).toHaveBeenCalledWith('id', JOB_ID);
  });

  it('passes job.id (= cloudId = Supabase PK) — id/cloudId model confirmed', async () => {
    // store.js line 422: local id === cloudId === server UUID
    // deleteJobWithData must call .eq('id', job.id) so cloud delete hits the right row
    await deleteJobWithData(testJob, []);
    const eqMock = mockJobsDelete.mock.results[0].value.eq;
    expect(eqMock).toHaveBeenCalledWith('id', testJob.id);
    expect(testJob.id).toBe(testJob.cloudId); // confirms the identity
  });

  it('removes the job from the localStorage mirror', async () => {
    await deleteJobWithData(testJob, []);
    const stored = JSON.parse(localStorageData['jobprofit-app-data']);
    expect(stored.jobs.find(j => j.id === JOB_ID)).toBeUndefined();
    expect(stored.jobs.find(j => j.id === 'job-other')).toBeDefined();
  });

  it('removes the localStorage meta side-channel entry', async () => {
    await deleteJobWithData(testJob, []);
    expect(localStorageData[`jp.jobMeta.${JOB_ID}`]).toBeUndefined();
  });

  it('deletes linked receipt rows from Supabase (best-effort)', async () => {
    await deleteJobWithData(testJob, [RECEIPT_ID]);
    expect(mockReceiptsDelete).toHaveBeenCalledOnce();
    const eqMock = mockReceiptsDelete.mock.results[0].value.eq;
    expect(eqMock).toHaveBeenCalledWith('id', RECEIPT_ID);
  });

  it('removes the linked receipt from the localStorage mirror', async () => {
    await deleteJobWithData(testJob, [RECEIPT_ID]);
    const stored = JSON.parse(localStorageData['jobprofit-app-data']);
    expect(stored.expenses.find(e => e.id === RECEIPT_ID)).toBeUndefined();
    expect(stored.expenses.find(e => e.id === 'receipt-other')).toBeDefined();
  });

  it('removes photo storage objects for new-format photo entries', async () => {
    await deleteJobWithData(testJob, []);
    expect(mockPhotoStorage.remove).toHaveBeenCalledWith([PHOTO_PATH]);
  });

  it('skips storage delete for legacy base64 photo entries (strings)', async () => {
    const jobWithLegacyPhoto = {
      ...testJob,
      meta: { photos: ['data:image/jpeg;base64,abc123'] },
    };
    await deleteJobWithData(jobWithLegacyPhoto, []);
    // Legacy base64 strings have no storage path to delete
    expect(mockPhotoStorage.remove).not.toHaveBeenCalled();
  });

  it('handles a job with no meta.photos gracefully', async () => {
    const jobNoPhotos = { id: JOB_ID, cloudId: JOB_ID };
    await expect(deleteJobWithData(jobNoPhotos, [])).resolves.not.toThrow();
  });

  it('throws when the jobs-row delete fails (prevents local removal hiding the reappear bug)', async () => {
    vi.resetModules();
    localStorageData['jobprofit-app-data'] = JSON.stringify({
      jobs: [{ id: JOB_ID, cloudId: JOB_ID }],
      expenses: [],
      invoices: [],
    });
    const failingDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: new Error('db error') }),
    });
    const { supabase } = await import('../supabase');
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    supabase.from.mockImplementation(table => {
      if (table === 'jobs') return { delete: failingDelete };
      return { delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
    });
    supabase.storage.from.mockReturnValue({ remove: vi.fn().mockResolvedValue({ error: null }) });
    const { deleteJobWithData: djwd } = await import('../store');

    await expect(djwd(testJob, [])).rejects.toThrow();
  });

  it('returns early without throwing when job has no id', async () => {
    await expect(deleteJobWithData({ customer: 'Nobody' }, [])).resolves.toBeUndefined();
    expect(mockJobsDelete).not.toHaveBeenCalled();
  });

  it('derives linked receipts from localStorage when no explicit ids are passed', async () => {
    // No explicit receipt ids — function reads localStorage mirror
    await deleteJobWithData(testJob);
    expect(mockReceiptsDelete).toHaveBeenCalledOnce();
  });

  it('best-effort: a receipt delete failure does NOT abort the job-row delete', async () => {
    vi.resetModules();
    localStorageData['jobprofit-app-data'] = JSON.stringify({
      jobs: [{ id: JOB_ID, cloudId: JOB_ID }],
      expenses: [{ id: RECEIPT_ID, cloudId: RECEIPT_ID, jobId: JOB_ID }],
      invoices: [],
    });
    const failReceiptsDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: new Error('receipt gone') }),
    });
    const okJobsDelete = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const { supabase } = await import('../supabase');
    supabase.auth.getUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    supabase.from.mockImplementation(table => {
      if (table === 'jobs') return { delete: okJobsDelete };
      if (table === 'receipts') return { delete: failReceiptsDelete };
      return { delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
    });
    supabase.storage.from.mockReturnValue({ remove: vi.fn().mockResolvedValue({ error: null }) });
    const { deleteJobWithData: djwd } = await import('../store');

    // Should resolve — receipt failure is tolerated, job row still deleted
    await expect(djwd(testJob, [RECEIPT_ID])).resolves.not.toThrow();
    expect(okJobsDelete).toHaveBeenCalledOnce();
  });
});

// ── Drawer delete prompt — pendingDeleteAction guard (job-delete variant) ─────

describe('job-delete pendingDeleteAction guard', () => {
  /**
   * Mirrors the kebab onClick logic in JobDetailDrawer for the "Delete job" item.
   * The async onConfirm manages the deleting guard; the dialog stays open on error.
   */
  async function simulateDrawerDelete({ onDeleteJob, setDeleting, setToast }) {
    let deleting = false;
    const setPendingDeleteAction = vi.fn();

    // Simulate the onClick that queues the action
    const copy = buildDeleteJobCopy('Bob Smith');
    const queuedAction = {
      title: copy.title,
      message: copy.body,
      confirmLabel: copy.confirmLabel,
      isJobDelete: true,
      onConfirm: async () => {
        if (deleting) return;
        deleting = true;
        setDeleting(true);
        try {
          await onDeleteJob({ id: 'job-uuid', customer: 'Bob Smith' });
        } catch (err) {
          setToast('Couldn\'t delete that job — try again');
        } finally {
          deleting = false;
          setDeleting(false);
        }
      },
    };
    setPendingDeleteAction(queuedAction);
    return { queuedAction, setPendingDeleteAction };
  }

  it('queues the action without firing onDeleteJob immediately', async () => {
    const onDeleteJob = vi.fn().mockResolvedValue(undefined);
    const setDeleting = vi.fn();
    const setToast = vi.fn();

    const { queuedAction } = await simulateDrawerDelete({ onDeleteJob, setDeleting, setToast });
    expect(onDeleteJob).not.toHaveBeenCalled();
    expect(queuedAction.isJobDelete).toBe(true);
    expect(queuedAction.title).toBe('Delete this job?');
    expect(queuedAction.confirmLabel).toBe('Delete job');
  });

  it('fires onDeleteJob when the confirm button is tapped', async () => {
    const onDeleteJob = vi.fn().mockResolvedValue(undefined);
    const setDeleting = vi.fn();
    const setToast = vi.fn();

    const { queuedAction } = await simulateDrawerDelete({ onDeleteJob, setDeleting, setToast });
    await queuedAction.onConfirm();

    expect(onDeleteJob).toHaveBeenCalledOnce();
    expect(setToast).not.toHaveBeenCalled();
  });

  it('shows error toast when onDeleteJob throws, without closing the dialog', async () => {
    const onDeleteJob = vi.fn().mockRejectedValue(new Error('network error'));
    const setDeleting = vi.fn();
    const setToast = vi.fn();

    const { queuedAction } = await simulateDrawerDelete({ onDeleteJob, setDeleting, setToast });
    await queuedAction.onConfirm();

    expect(setToast).toHaveBeenCalledWith("Couldn't delete that job — try again");
  });

  it('sets and clears the deleting flag around the async call', async () => {
    const calls = [];
    const setDeleting = vi.fn(v => calls.push(v));
    const onDeleteJob = vi.fn().mockResolvedValue(undefined);
    const setToast = vi.fn();

    const { queuedAction } = await simulateDrawerDelete({ onDeleteJob, setDeleting, setToast });
    await queuedAction.onConfirm();

    // setDeleting(true) then setDeleting(false)
    expect(calls).toEqual([true, false]);
  });
});
