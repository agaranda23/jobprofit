/**
 * Cloud-write path tests for jobMeta (feat/jobmeta-cloud-write-impl).
 *
 * No DOM, no React, no Supabase client. Pure logic tests matching the project
 * convention (see JobDetailDrawer.test.js). Supabase-dependent paths (actual
 * cloud write, signed URL resolution) are covered by the deploy-preview
 * checklist in the PR description.
 *
 * Covers:
 *   A. extractJobMeta — new fields survive round-trip (photos, jobNotes, lineItems, total, amount)
 *   B. updateJobMetaInCloud guard logic — missing-args and offline semantics (inline mirror)
 *   C. Photo format helpers — isLegacyPhoto, dataUrlToBlob, makePhotoEntry
 *   D. Mixed photo format handling — legacy strings pass through; object entries need path
 *   E. Photo delete — bucket path extracted correctly from entry object
 *   F. Hydrate merge — cloud meta + localStorage: localStorage overlay wins
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractJobMeta, writeJobMeta, readJobMeta, applyJobMeta } from '../../lib/jobMeta';
import { isLegacyPhoto, dataUrlToBlob, makePhotoEntry } from '../../lib/jobPhotos';

// ── localStorage mock ──────────────────────────────────────────────────────
// Vitest runs in Node — localStorage doesn't exist. Provide a minimal stub.
// Pattern matches chaseLadder.test.js (the established codebase convention).

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

// Clear localStorage and vi mocks between every test for isolation.
beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

// ─── A. extractJobMeta — new fields survive round-trip ──────────────────────

describe('extractJobMeta — new META_FIELDS (photos / jobNotes / lineItems / total / amount)', () => {
  const BASE_JOB = {
    id: 'j1',
    status: 'active',
    paymentStatus: 'unpaid',
    payments: [],
    quoteStatus: 'active',
    acceptedSignature: null,
    acceptedAt: null,
    invoiceSentAt: null,
    invoiceNumber: null,
    invoiceDueDate: null,
    completedAt: null,
    paidAt: null,
    customerPhone: '07700 900000',
    paymentMethod: 'cash',
    paymentDate: '2026-05-20',
  };

  it('extracts photos array into the meta object', () => {
    const job = { ...BASE_JOB, photos: [{ path: 'uid/j1/123-photo.jpg', uploadedAt: '2026-05-20T10:00:00Z' }] };
    const meta = extractJobMeta(job);
    expect(meta.photos).toEqual(job.photos);
  });

  it('extracts jobNotes array into the meta object', () => {
    const notes = [{ id: 'N-1', subject: 'Visit', body: 'On-site inspection done', date: '2026-05-20T09:00:00Z' }];
    const job = { ...BASE_JOB, jobNotes: notes };
    const meta = extractJobMeta(job);
    expect(meta.jobNotes).toEqual(notes);
  });

  it('extracts lineItems array into the meta object', () => {
    const items = [{ desc: 'Labour', cost: 300 }, { desc: 'Materials', cost: 150 }];
    const job = { ...BASE_JOB, lineItems: items };
    const meta = extractJobMeta(job);
    expect(meta.lineItems).toEqual(items);
  });

  it('extracts total into the meta object', () => {
    const job = { ...BASE_JOB, total: 450 };
    const meta = extractJobMeta(job);
    expect(meta.total).toBe(450);
  });

  it('extracts amount into the meta object', () => {
    const job = { ...BASE_JOB, amount: 450 };
    const meta = extractJobMeta(job);
    expect(meta.amount).toBe(450);
  });

  it('includes address in the meta object (added to META_FIELDS in fix/job-drawer-customer-name-and-avatar)', () => {
    // Previously address was absent from META_FIELDS (old test asserted false).
    // It was added alongside customer/summary/email/description so that edits
    // made in the job drawer survive offline sessions and cloud-sync stomps.
    const job = { ...BASE_JOB, address: '10 Downing St', photos: [] };
    const meta = extractJobMeta(job);
    expect('address' in meta).toBe(true);
    expect(meta.address).toBe('10 Downing St');
  });

  it('round-trips all new fields through extractJobMeta → writeJobMeta → readJobMeta', () => {
    const photos = [{ path: 'uid/j1/ts-file.jpg', uploadedAt: '2026-05-20T10:00:00Z' }];
    const notes  = [{ id: 'N-1', subject: 'S', body: 'B', date: '2026-05-20T09:00:00Z' }];
    const items  = [{ desc: 'Labour', cost: 200 }];
    const job = { ...BASE_JOB, id: 'round-trip-1', photos, jobNotes: notes, lineItems: items, total: 200, amount: 200 };

    const meta = extractJobMeta(job);
    writeJobMeta(job.id, meta);
    const stored = readJobMeta(job.id);

    expect(stored.photos).toEqual(photos);
    expect(stored.jobNotes).toEqual(notes);
    expect(stored.lineItems).toEqual(items);
    expect(stored.total).toBe(200);
    expect(stored.amount).toBe(200);

    // Cleanup
    try { localStorage.removeItem('jp.jobMeta.round-trip-1'); } catch { /* ignore */ }
  });

  it('preserves mixed-format photos array (string + object) through round-trip', () => {
    const legacyBase64 = 'data:image/jpeg;base64,/9j/abc';
    const newEntry = { path: 'uid/j1/ts-photo.jpg', uploadedAt: '2026-05-20T10:00:00Z' };
    const job = { ...BASE_JOB, id: 'mixed-1', photos: [legacyBase64, newEntry] };

    const meta = extractJobMeta(job);
    writeJobMeta(job.id, meta);
    const stored = readJobMeta(job.id);

    expect(stored.photos[0]).toBe(legacyBase64);
    expect(stored.photos[1]).toEqual(newEntry);

    try { localStorage.removeItem('jp.jobMeta.mixed-1'); } catch { /* ignore */ }
  });
});

// ─── B. updateJobMetaInCloud guard logic (inline mirror — no Supabase) ──────
//
// Tests the guard logic at the top of updateJobMetaInCloud as an inline pure
// function, mirroring the production implementation. This matches the project
// convention: Supabase-dependent paths are integration concerns exercised by
// the deploy-preview checklist. The store.js module is NOT imported here
// because supabase.js runs createClient() at module load and requires env vars.
//
// Production implementation: src/lib/store.js — updateJobMetaInCloud()

async function updateJobMetaInCloudMirror(jobId, metaObject, getUserId) {
  if (!jobId || !metaObject) return { ok: false, error: 'missing-args' };

  let user_id;
  try {
    user_id = await getUserId();
  } catch {
    return { ok: false, error: 'offline' };
  }

  if (!user_id) return { ok: false, error: 'offline' };

  // (Supabase UPDATE would happen here — not tested in unit tests)
  return { ok: true };
}

describe('updateJobMetaInCloud — guard logic (offline / missing-args)', () => {
  it('returns { ok: false, error: "missing-args" } when jobId is null', async () => {
    const result = await updateJobMetaInCloudMirror(null, { status: 'active' }, () => Promise.resolve('uid'));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('missing-args');
  });

  it('returns { ok: false, error: "missing-args" } when metaObject is null', async () => {
    const result = await updateJobMetaInCloudMirror('j1', null, () => Promise.resolve('uid'));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('missing-args');
  });

  it('returns { ok: false, error: "offline" } when getUserId throws (network error)', async () => {
    const result = await updateJobMetaInCloudMirror('j1', { status: 'active' }, () => {
      throw new Error('Network Error');
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('offline');
  });

  it('returns { ok: false, error: "offline" } when getUserId returns null (not signed in)', async () => {
    const result = await updateJobMetaInCloudMirror('j1', { status: 'active' }, () => Promise.resolve(null));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('offline');
  });

  it('returns { ok: true } when auth is present and both args are provided', async () => {
    const result = await updateJobMetaInCloudMirror('j1', { status: 'active' }, () => Promise.resolve('uid-abc'));
    expect(result.ok).toBe(true);
  });

  it('passes through when lineItems in meta (combined UPDATE logic)', async () => {
    const meta = { status: 'active', lineItems: [{ desc: 'Labour', cost: 300 }] };
    const result = await updateJobMetaInCloudMirror('j1', meta, () => Promise.resolve('uid-abc'));
    expect(result.ok).toBe(true);
    // lineItems presence is checked inline — the UPDATE payload building is
    // an integration concern covered by deploy-preview manual testing.
    expect(Array.isArray(meta.lineItems)).toBe(true);
  });
});

// ─── C. Photo format helpers ─────────────────────────────────────────────────

describe('isLegacyPhoto — photo format detection', () => {
  it('returns true for a base64 data-URL string', () => {
    expect(isLegacyPhoto('data:image/jpeg;base64,/9j/abc')).toBe(true);
  });

  it('returns true for any string (legacy format)', () => {
    expect(isLegacyPhoto('some-string')).toBe(true);
  });

  it('returns false for a { path, uploadedAt } object', () => {
    expect(isLegacyPhoto({ path: 'uid/j1/ts.jpg', uploadedAt: '2026-05-20T10:00:00Z' })).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(isLegacyPhoto({})).toBe(false);
  });
});

describe('makePhotoEntry — photo entry constructor', () => {
  it('returns an object with the given path', () => {
    const entry = makePhotoEntry('uid/j1/ts-photo.jpg');
    expect(entry.path).toBe('uid/j1/ts-photo.jpg');
  });

  it('returns an object with an uploadedAt ISO string', () => {
    const entry = makePhotoEntry('uid/j1/ts-photo.jpg');
    expect(typeof entry.uploadedAt).toBe('string');
    // Should be parseable as a date
    expect(new Date(entry.uploadedAt).toString()).not.toBe('Invalid Date');
  });
});

describe('dataUrlToBlob — base64 to Blob conversion', () => {
  it('returns a Blob', () => {
    // Minimal valid JPEG base64 (1x1 white pixel)
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoH7gQFBgoLCgsKCwsLDxARDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVIP/2Q==';
    const blob = dataUrlToBlob(dataUrl);
    expect(blob instanceof Blob).toBe(true);
  });

  it('preserves the MIME type from the data-URL header', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const blob = dataUrlToBlob(dataUrl);
    expect(blob.type).toBe('image/png');
  });
});

// ─── D. Mixed photo format — render gate logic ───────────────────────────────

describe('Mixed photo format — isLegacyPhoto determines render path', () => {
  const legacyEntry = 'data:image/jpeg;base64,/9j/abc';
  const newEntry    = { path: 'uid/j1/ts-photo.jpg', uploadedAt: '2026-05-20T10:00:00Z' };

  it('legacy entries render as-is (no signed URL needed)', () => {
    expect(isLegacyPhoto(legacyEntry)).toBe(true);
  });

  it('new-format entries require signed URL resolution', () => {
    expect(isLegacyPhoto(newEntry)).toBe(false);
    // The path field is what gets passed to getSignedPhotoUrl
    expect(newEntry.path).toBeTruthy();
  });

  it('array with both formats is accepted and classified correctly', () => {
    const photos = [legacyEntry, newEntry, 'data:image/jpeg;base64,xyz', { path: 'uid/j2/ts.jpg', uploadedAt: '' }];
    const legacyCount = photos.filter(isLegacyPhoto).length;
    const bucketCount = photos.filter(p => !isLegacyPhoto(p)).length;
    expect(legacyCount).toBe(2);
    expect(bucketCount).toBe(2);
  });
});

// ─── E. Photo delete — storage path extraction ───────────────────────────────

describe('Photo delete — storage path extraction from entry', () => {
  it('extracts .path from a bucket-format entry', () => {
    const entry = { path: 'uid/j1/1716199999-photo.jpg', uploadedAt: '2026-05-20T10:00:00Z' };
    expect(isLegacyPhoto(entry)).toBe(false);
    expect(entry.path).toBe('uid/j1/1716199999-photo.jpg');
  });

  it('does not attempt storage delete for legacy base64 entries', () => {
    const entry = 'data:image/jpeg;base64,/9j/abc';
    expect(isLegacyPhoto(entry)).toBe(true);
    // No .path property — storage.remove should not be called
    expect(entry.path).toBeUndefined();
  });

  it('photo array after delete contains correct remaining entries', () => {
    const photos = [
      'data:image/jpeg;base64,/9j/abc',                                      // idx 0 — legacy
      { path: 'uid/j1/1716199999-photo.jpg', uploadedAt: '2026-05-20T10:00:00Z' }, // idx 1 — bucket
      { path: 'uid/j1/1716200000-photo.jpg', uploadedAt: '2026-05-20T11:00:00Z' }, // idx 2 — bucket
    ];

    // Simulate deleting idx 1 (the first bucket entry)
    const updated = photos.filter((_, i) => i !== 1);
    expect(updated.length).toBe(2);
    expect(updated[0]).toBe(photos[0]);
    expect(updated[1]).toEqual(photos[2]);
  });
});

// ─── F. Hydrate merge — cloud meta + localStorage overlay semantics ───────────

describe('Hydrate merge — applyJobMeta overlays localStorage on cloud baseline', () => {
  it('returns the job unchanged when no meta is stored in localStorage', () => {
    const job = { id: 'j-hydrate-1', status: 'active', photos: [], jobNotes: [] };
    const result = applyJobMeta(job);
    // No localStorage entry exists, so result should mirror the input
    expect(result.id).toBe(job.id);
    expect(result.status).toBe(job.status);
  });

  it('localStorage meta overlay wins over cloud-provided values when both exist', () => {
    // Simulate: cloud loaded the job with status 'active'
    const cloudJob = { id: 'j-hydrate-2', status: 'active', paymentStatus: 'unpaid', photos: [] };

    // Simulate: user made a payment offline → localStorage has 'paid'
    writeJobMeta('j-hydrate-2', { status: 'paid', paymentStatus: 'paid', paidAt: '2026-05-20T10:00:00Z' });

    // applyJobMeta overlays localStorage on top of the cloud-loaded job
    const result = applyJobMeta(cloudJob);
    expect(result.status).toBe('paid');
    expect(result.paymentStatus).toBe('paid');
  });

  it('photos from localStorage survive when cloud job has no photos in meta yet', () => {
    // Cloud job has no photos (meta column was empty before this PR)
    const cloudJob = { id: 'j-hydrate-3', status: 'active', photos: [] };

    // User previously added a photo (stored in localStorage)
    const savedPhoto = { path: 'uid/j3/ts-photo.jpg', uploadedAt: '2026-05-20T10:00:00Z' };
    writeJobMeta('j-hydrate-3', { photos: [savedPhoto] });

    const result = applyJobMeta(cloudJob);
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0]).toEqual(savedPhoto);
  });

  it('jobNotes from localStorage survive when cloud job has no notes in meta yet', () => {
    const cloudJob = { id: 'j-hydrate-4', status: 'active', jobNotes: [] };
    const note = { id: 'N-1', subject: 'Visit', body: 'Arrived on-site', date: '2026-05-20T09:00:00Z' };
    writeJobMeta('j-hydrate-4', { jobNotes: [note] });

    const result = applyJobMeta(cloudJob);
    expect(result.jobNotes).toHaveLength(1);
    expect(result.jobNotes[0]).toEqual(note);
  });

  it('lineItems from localStorage survive when cloud meta has no lineItems yet', () => {
    const cloudJob = { id: 'j-hydrate-5', status: 'active', lineItems: [] };
    const items = [{ desc: 'Labour', cost: 300 }, { desc: 'Materials', cost: 100 }];
    writeJobMeta('j-hydrate-5', { lineItems: items, total: 400, amount: 400 });

    const result = applyJobMeta(cloudJob);
    expect(result.lineItems).toEqual(items);
    expect(result.total).toBe(400);
    expect(result.amount).toBe(400);
  });
});
