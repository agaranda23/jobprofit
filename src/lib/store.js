// Unified store adapter.
// Cloud (Supabase) is authoritative. localStorage is a legacy mirror for the Manage/CRM tab.
//
// Old app uses localStorage key "jobprofit-app-data" with shape { jobs, expenses, invoices }.
// Today screen uses cloud-backed functions with localStorage dual-write.

import { supabase } from './supabase';

// Returns YYYY-MM-DD in the user's local timezone (not UTC).
// Critical: new Date().toISOString().slice(0,10) returns UTC date,
// which differs from local date in evenings (UK +0/+1 from UTC).
function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}



const KEY = 'jobprofit-app-data';

// ============================================================
// localStorage helpers (kept for legacy App.jsx compatibility)
// ============================================================

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { jobs: [], expenses: [], invoices: [] };
    const parsed = JSON.parse(raw);
    return {
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
    };
  } catch {
    return { jobs: [], expenses: [], invoices: [] };
  }
}

function write(data) {
  try {
    const current = read();
    localStorage.setItem(KEY, JSON.stringify({ ...current, ...data }));
  } catch { /* localStorage may be blocked or full */ }
}

function nextJobId(jobs) {
  let max = 0;
  for (const j of jobs) {
    const m = /^J-(\d+)$/.exec(j.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'J-' + String(max + 1).padStart(4, '0');
}

function nextExpenseId(expenses) {
  let max = 0;
  for (const e of expenses) {
    const m = /^E-(\d+)$/.exec(e.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'E-' + String(max + 1).padStart(4, '0');
}

// ============================================================
// Legacy reads/writes (used by Manage + as mirror cache)
// ============================================================

export function getJobs() {
  return read().jobs;
}

export function getReceipts() {
  return read().expenses;
}

export function getTodayJobs() {
  const { jobs } = read();
  return jobs.map(j => ({
    id: j.id,
    name: j.customer || j.summary?.slice(0, 40) || 'Job',
    amount: Number(j.total || 0),
    paid: j.paymentStatus === 'paid',
    paymentType: j.paymentMethod || null,
    date: j.paymentDate || j.date || j.scheduledDate || localDateString(),
    createdAt: j.createdAt || j.date || new Date().toISOString(),
  }));
}

export function getTodayReceipts() {
  const { expenses } = read();
  return expenses.map(e => ({
    id: e.id,
    label: e.merchant || e.desc || 'Receipt',
    amount: Number(e.amount || 0),
    photo: e.photo || null,
    date: e.date || localDateString(),
    createdAt: e.createdAt || e.date || new Date().toISOString(),
    jobId: e.jobId || null,
  }));
}

export function addTodayJob(payload) {
  const data = read();
  const now = new Date();
  const today = localDateString(now);
  const id = payload.legacyId || nextJobId(data.jobs);
  // Preserve null/empty amount — don't coerce to 0. A blank amount means
  // "no price yet" (Lead state). Only parse when something meaningful was passed.
  const amount = (payload.amount == null || payload.amount === '') ? null : Number(payload.amount);
  const isPaid = payload.paid !== false;

  const newJob = {
    id,
    customer: payload.name || 'Job',
    address: '',
    phone: '',
    email: '',
    date: today,
    summary: payload.name || 'Job',
    lineItems: amount != null ? [{ desc: payload.name || 'Job', cost: amount }] : [],
    total: amount,
    quoteStatus: 'accepted',
    jobStatus: isPaid ? 'complete' : 'active',
    invoiceStatus: 'none',
    paymentStatus: isPaid ? 'paid' : 'unpaid',
    paymentDate: isPaid ? today : '',
    paymentMethod: payload.paymentType || (isPaid ? 'cash' : ''),
    source: payload.source || 'Quick add',
    jobNotes: [],
    photos: [],
    invoiceId: '',
    createdAt: now.toISOString(),
    cloudId: payload.cloudId || null, // link back to Supabase row
  };

  data.jobs = [newJob, ...data.jobs];
  write(data);
  return newJob;
}

export function addTodayReceipt(payload) {
  const data = read();
  const now = new Date();
  const today = localDateString(now);
  const id = payload.legacyId || nextExpenseId(data.expenses);

  const items = Array.isArray(payload.items) ? payload.items : [];
  const desc = items.length > 0
    ? items.map(i => i.desc).filter(Boolean).join(', ')
    : '';
  const expDate = payload.date ? payload.date.slice(0, 10) : today;
  const newExp = {
    id,
    jobId: payload.jobId || '',
    merchant: payload.label || 'Receipt',
    date: expDate,
    amount: Number(payload.amount || 0),
    vat: Number(payload.vat || 0),
    desc,
    items,
    invoiceNumber: payload.invoiceNumber || null,
    photo: payload.photo || null,
    imagePath: payload.imagePath || null,
    createdAt: now.toISOString(),
    cloudId: payload.cloudId || null,
  };

  data.expenses = [newExp, ...data.expenses];
  write(data);
  return newExp;
}

export function markJobPaid(jobId) {
  const data = read();
  const today = localDateString();
  data.jobs = data.jobs.map(j =>
    j.id === jobId
      ? { ...j, paymentStatus: 'paid', paymentDate: today, jobStatus: 'complete', paymentMethod: j.paymentMethod || 'cash' }
      : j
  );
  write(data);
}

// ============================================================
// CLOUD LAYER — Supabase is authoritative. localStorage is mirror.
// ============================================================

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id || null;
}

// --- READS ---

export async function getJobsFromCloud() {
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .order('date', { ascending: false });
  if (error) {
    console.warn('getJobsFromCloud failed', error);
    return [];
  }
  return (data || []).map(mapCloudJobToToday);
}

export async function getReceiptsFromCloud() {
  const { data, error } = await supabase
    .from('receipts')
    .select('*')
    .order('date', { ascending: false });
  if (error) {
    console.warn('getReceiptsFromCloud failed', error);
    return [];
  }
  return (data || []).map(mapCloudReceiptToToday);
}

function mapCloudJobToToday(r) {
  // Spread r.meta first as the cloud baseline. All fields below are the
  // explicit column values — they override any same-named key from meta so
  // the database schema always wins for canonical columns (id, amount, paid…).
  // Fields that only exist in meta (photos, jobNotes, lineItems edits, payments,
  // acceptedSignature, etc.) survive via the spread and are then overlaid by
  // applyJobMetaToJobs which merges the localStorage side-channel on top.
  // Merge semantics: cloud meta → explicit columns → localStorage overlay.
  const cloudMeta = (r.meta && typeof r.meta === 'object') ? r.meta : {};

  return {
    ...cloudMeta,
    id: r.id, // Supabase UUID (source of truth)
    name: r.customer_name || r.summary?.slice(0, 40) || 'Job',
    amount: Number(r.amount || 0),
    paid: r.paid === true,
    paymentType: r.payment_type || null,
    date: r.payment_date || r.date,
    createdAt: r.created_at,
    summary: r.summary || '',
    address: r.address || '',
    phone: r.phone || '',
    email: r.email || '',
    notes: r.notes || '',
    // lineItems: prefer meta version (post-insert edits) over the DB column.
    // If meta has no lineItems, fall back to the line_items column or empty array.
    lineItems: cloudMeta.lineItems ?? (Array.isArray(r.line_items) ? r.line_items : []),
    total: cloudMeta.total ?? Number(r.amount || 0),
    status: cloudMeta.status ?? r.status ?? undefined,
    jobStatus: cloudMeta.jobStatus ?? (r.paid === true ? 'paid' : 'unpaid'),
    paymentStatus: cloudMeta.paymentStatus ?? (r.paid === true ? 'paid' : 'unpaid'),
    quoteStatus: cloudMeta.quoteStatus ?? 'active',
    customer: r.customer_name || '',
    reference: r.customer_name || r.summary || '',
    expenses: [],
    payments: cloudMeta.payments ?? [],
    cloud: true,
  };
}

function mapCloudReceiptToToday(r) {
  return {
    id: r.id,
    label: r.merchant || 'Receipt',
    amount: Number(r.amount || 0),
    vat: Number(r.vat || 0),
    date: r.date,
    createdAt: r.created_at,
    invoiceNumber: r.invoice_number || null,
    imagePath: r.image_path || null,
    jobId: r.job_id || null,
    cloud: true,
  };
}

// --- WRITES ---

export async function addJobToCloud(payload) {
  const user_id = await getUserId();
  if (!user_id) throw new Error('Not signed in');

  // Preserve null/empty amount — don't coerce to 0. A blank amount means
  // "no price yet" (Lead state). Only parse when something meaningful was passed.
  const amount = (payload.amount == null || payload.amount === '') ? null : Number(payload.amount);
  const isPaid = payload.paid !== false;
  const today = localDateString();

  // Generate a client-side UUID so the offline queue can hold a stable ID
  // before the row reaches Supabase. Mirrors the pattern used in addReceiptToCloud.
  // If the caller already supplied an id (e.g. re-sync from queue), reuse it.
  const jobId = payload.id && typeof payload.id === 'string' ? payload.id : crypto.randomUUID();

  const row = {
    id: jobId,
    user_id,
    customer_name: payload.customer || payload.name || 'Job',
    date: today,
    summary: payload.name || 'Job',
    amount,
    paid: isPaid,
    phone: payload.phone || null,
    payment_type: payload.paymentType || (isPaid ? 'cash' : null),
    payment_date: isPaid ? today : null,
    source: payload.source || 'Quick add',
    status: isPaid ? 'paid' : 'lead',
    // Write empty array when no price — avoid a stray £0 line item
    line_items: amount != null ? [{ desc: payload.name || 'Job', cost: amount }] : [],
  };

  const { data, error } = await supabase
    .from('jobs')
    .insert(row)
    .select()
    .single();

  if (error) {
    console.error('addJobToCloud failed', error);
    throw error;
  }

  // Dual-write to localStorage for legacy Manage compatibility.
  // local id === cloudId === server UUID — no reconciliation needed.
  addTodayJob({
    ...payload,
    id: data.id,
    cloudId: data.id,
  });

  return mapCloudJobToToday(data);
}

export async function addReceiptToCloud(payload, photoFile) {
  const user_id = await getUserId();
  if (!user_id) throw new Error('Not signed in');

  // Deterministic ID — generate before upload so storage path is known
  const receiptId = crypto.randomUUID();
  let imagePath = null;

  // Upload photo if provided
  if (photoFile) {
    const ext = photoFile.type?.includes('png') ? 'png' : 'jpg';
    const path = `${user_id}/${receiptId}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from('receipts')
      .upload(path, photoFile, {
        contentType: photoFile.type || 'image/jpeg',
        upsert: false,
      });
    if (uploadErr) {
      console.error('Receipt photo upload failed', uploadErr);
      throw uploadErr;
    }
    imagePath = path;
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const row = {
    id: receiptId,
    user_id,
    job_id: payload.jobId || null,
    merchant: payload.label || 'Receipt',
    amount: Number(payload.amount || 0),
    vat: Number(payload.vat || 0),
    date: payload.date ? payload.date.slice(0, 10) : localDateString(),
    invoice_number: payload.invoiceNumber || null,
    payment_method: payload.paymentMethod || null,
    image_path: imagePath,
  };

  const { data: receiptRow, error } = await supabase
    .from('receipts')
    .insert(row)
    .select()
    .single();

  if (error) {
    // If row insert fails, clean up the uploaded photo
    if (imagePath) {
      await supabase.storage.from('receipts').remove([imagePath]);
    }
    console.error('addReceiptToCloud failed', error);
    throw error;
  }

  // Insert receipt items if any
  if (items.length > 0) {
    const itemRows = items
      .filter(i => i.desc?.trim())
      .map(i => ({
        receipt_id: receiptId,
        user_id,
        description: i.desc,
        cost: Number(i.cost || 0),
      }));
    if (itemRows.length > 0) {
      await supabase.from('receipt_items').insert(itemRows);
    }
  }

  // Dual-write to localStorage
  addTodayReceipt({
    ...payload,
    cloudId: receiptId,
    imagePath,
  });

  return mapCloudReceiptToToday(receiptRow);
}

export async function markJobPaidCloud(jobId) {
  const user_id = await getUserId();
  if (!user_id) throw new Error('Not signed in');

  const today = localDateString();
  const { error } = await supabase
    .from('jobs')
    .update({
      paid: true,
      payment_date: today,
      status: 'complete',
    })
    .eq('id', jobId);

  if (error) {
    console.error('markJobPaidCloud failed', error);
    throw error;
  }

  // Mirror to localStorage — find any legacy record linked via cloudId
  const data = read();
  data.jobs = data.jobs.map(j =>
    j.cloudId === jobId || j.id === jobId
      ? { ...j, paymentStatus: 'paid', paymentDate: today, jobStatus: 'complete' }
      : j
  );
  write(data);
}

export async function linkReceiptToJob(receiptId, jobId) {
  const user_id = await getUserId();
  if (!user_id) throw new Error('Not signed in');

  const { error } = await supabase
    .from('receipts')
    .update({ job_id: jobId || null })
    .eq('id', receiptId);

  if (error) {
    console.error('linkReceiptToJob failed', error);
    throw error;
  }

  // Mirror to localStorage
  const data = read();
  data.expenses = data.expenses.map(e =>
    e.cloudId === receiptId || e.id === receiptId
      ? { ...e, jobId: jobId || '' }
      : e
  );
  write(data);
}

export async function getReceiptSignedUrl(imagePath) {
  if (!imagePath) return null;
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(imagePath, 3600); // 1 hour
  if (error) {
    console.warn('Signed URL failed for', imagePath, error);
    return null;
  }
  return data?.signedUrl || null;
}

/**
 * Removes a photo file from the `job-photos` storage bucket.
 * Best-effort — failures are logged but do not throw so they never block the UI.
 * Called by handleDeletePhoto in JobDetailDrawer after removing the entry from
 * meta.photos[]. Only invoked for new-format entries ({ path, uploadedAt });
 * legacy base64 strings have nothing to clean up in storage.
 *
 * @param {string} storagePath – path in the job-photos bucket
 * @returns {Promise<void>}
 */
export async function deleteJobPhoto(storagePath) {
  if (!storagePath) return;
  try {
    await supabase.storage.from('job-photos').remove([storagePath]);
  } catch (err) {
    console.warn('deleteJobPhoto failed (best-effort)', storagePath, err?.message);
  }
}

/**
 * Returns a signed URL for a job photo stored in the `job-photos` bucket.
 * The bucket is private — all reads require a signed URL.
 *
 * @param {string} storagePath – path in the job-photos bucket (e.g. `<uid>/<jobId>/<ts>-file.jpg`)
 * @param {number} [ttlSec=3600] – URL lifetime in seconds (default 1 hour)
 * @returns {Promise<string|null>} – signed URL string, or null on error
 */
export async function getSignedPhotoUrl(storagePath, ttlSec = 3600) {
  if (!storagePath) return null;
  const { data, error } = await supabase.storage
    .from('job-photos')
    .createSignedUrl(storagePath, ttlSec);
  if (error) {
    console.warn('Signed photo URL failed for', storagePath, error);
    return null;
  }
  return data?.signedUrl || null;
}

/**
 * Uploads a job photo file to the private `job-photos` Supabase storage bucket.
 * Path scheme: `<user_id>/<job_id>/<timestamp>-<filename>`
 * The file is accepted as a Blob (the caller converts the compressed dataURL first).
 *
 * @param {Blob} blob        – compressed image blob
 * @param {string} jobId     – Supabase job UUID
 * @param {string} filename  – original filename (used for the suffix only)
 * @returns {Promise<{ path: string }|null>} – storage path object, or null on failure
 */
export async function uploadJobPhoto(blob, jobId, filename) {
  const user_id = await getUserId();
  if (!user_id) return null;

  const ts = Date.now();
  const safeName = (filename || 'photo.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${user_id}/${jobId}/${ts}-${safeName}`;

  const { error } = await supabase.storage
    .from('job-photos')
    .upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: false,
    });

  if (error) {
    console.error('uploadJobPhoto failed', error);
    return null;
  }
  return { path };
}

/**
 * Updates the `meta` jsonb column on a jobs row, and simultaneously keeps the
 * `line_items` column in sync when `metaObject.lineItems` is present.
 *
 * This is fire-and-forget from the caller's perspective — `writeJobMeta` in
 * jobMeta.js calls this without await after the localStorage write succeeds.
 *
 * Offline / no-auth handling: if the Supabase client is not authenticated or
 * the network is unavailable, returns `{ ok: false, error: 'offline' }` without
 * throwing. The localStorage write already happened; the next successful online
 * write for this job will sync the meta column.
 *
 * @param {string} jobId       – Supabase UUID for the job row
 * @param {object} metaObject  – the full meta object from extractJobMeta()
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function updateJobMetaInCloud(jobId, metaObject) {
  if (!jobId || !metaObject) return { ok: false, error: 'missing-args' };

  let user_id;
  try {
    user_id = await getUserId();
  } catch {
    return { ok: false, error: 'offline' };
  }

  if (!user_id) return { ok: false, error: 'offline' };

  // Build the UPDATE payload. Always write meta. When lineItems is present,
  // also keep the legacy line_items column in sync (Alan's decision #4).
  const updatePayload = { meta: metaObject };
  if (Array.isArray(metaObject.lineItems)) {
    updatePayload.line_items = metaObject.lineItems;
  }

  try {
    const { error } = await supabase
      .from('jobs')
      .update(updatePayload)
      .eq('id', jobId);

    if (error) {
      console.warn('updateJobMetaInCloud failed', jobId, error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    // Network-level failure — localStorage is the durable copy until next sync
    console.warn('updateJobMetaInCloud network error', jobId, err?.message);
    return { ok: false, error: 'offline' };
  }
}

/**
 * Fetches a single job by its publicAccessToken without authentication.
 *
 * Used exclusively by PublicQuoteView — the anon Supabase client can read
 * jobs that have a non-null publicAccessToken (RLS policy jobs_select_public_by_token).
 * The client-side filter on the specific token value is the capability gate.
 *
 * Returns the mapped job object on success, or null when the token does not
 * match any row (bogus URL, token rotated, or job deleted).
 *
 * @param {string} token – the publicAccessToken UUID from the URL
 * @returns {Promise<object|null>}
 */
export async function fetchPublicJob(token) {
  if (!token) return null;
  const { data, error } = await supabase
    .from('jobs')
    .select('id, customer_name, summary, amount, paid, line_items, meta, date, created_at')
    .eq('meta->>publicAccessToken', token)
    .single();

  if (error || !data) return null;
  return mapCloudJobToToday(data);
}

/**
 * Hard-deletes a job row from Supabase and removes its localStorage mirror entry.
 *
 * The `line_items` jsonb column goes away automatically with the row.
 * Storage objects referenced by `meta.photos[]` are intentionally NOT removed
 * here — that cleanup is a separate follow-up task (avoids complicating this PR).
 *
 * Falls back to localStorage-only removal when the user is not signed in (demo mode).
 *
 * @param {string} jobId – Supabase UUID for the job row
 * @returns {Promise<void>}
 */
export async function deleteJobFromCloud(jobId) {
  if (!jobId) return;

  const user_id = await getUserId();
  if (user_id) {
    const { error } = await supabase
      .from('jobs')
      .delete()
      .eq('id', jobId);

    if (error) {
      console.error('deleteJobFromCloud failed', error);
      throw error;
    }
  }

  // Mirror: remove from localStorage regardless of cloud outcome
  const data = read();
  data.jobs = data.jobs.filter(j => j.cloudId !== jobId && j.id !== jobId);
  write(data);
}

/**
 * Deletes a receipt by its cloud UUID (or legacy localStorage ID).
 *
 * Flow:
 *   1. Find the receipt in localStorage to retrieve imagePath (if any).
 *   2. Delete the storage object (best-effort — a missing file is not fatal).
 *   3. Delete the receipts row from Supabase (user owns their own rows via RLS).
 *   4. Mirror-remove from localStorage.
 *
 * If the user is not signed in, falls back to localStorage-only removal so the
 * delete still works offline / in the demo build.
 */
export async function deleteReceiptFromCloud(receiptId) {
  // Find legacy mirror entry so we can remove the storage file if present
  const data = read();
  const localEntry = data.expenses.find(
    e => e.cloudId === receiptId || e.id === receiptId
  );
  const imagePath = localEntry?.imagePath || null;

  const user_id = await getUserId();
  if (user_id) {
    // Attempt to remove the storage object (ignore 404s — file may not exist)
    if (imagePath) {
      await supabase.storage.from('receipts').remove([imagePath]);
    }

    // Delete the receipts row — RLS ensures the user can only delete their own rows
    const { error } = await supabase
      .from('receipts')
      .delete()
      .eq('id', receiptId);

    if (error) {
      console.error('deleteReceiptFromCloud failed', error);
      throw error;
    }
  }

  // Mirror: remove from localStorage regardless of cloud outcome
  data.expenses = data.expenses.filter(
    e => e.cloudId !== receiptId && e.id !== receiptId
  );
  write(data);
}
