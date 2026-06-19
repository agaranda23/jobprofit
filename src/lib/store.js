// Unified store adapter.
// Cloud (Supabase) is authoritative. localStorage is a legacy mirror for the Manage/CRM tab.
//
// Old app uses localStorage key "jobprofit-app-data" with shape { jobs, expenses, invoices }.
// Today screen uses cloud-backed functions with localStorage dual-write.

import { supabase } from './supabase';
import { writeJobMeta } from './jobMeta';

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

  // Use the payload's booked date when provided (calendar-tap flow); fall back to
  // today for quick-add taps that don't carry an explicit date.
  const jobDate = payload.date ? payload.date.slice(0, 10) : today;

  const newJob = {
    id,
    customer: payload.name || 'Job',
    address: '',
    phone: '',
    email: '',
    date: jobDate,
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
  // F2: getUser() makes a network round-trip to validate the token. During a
  // transient refresh or connectivity blip it can return null even though the
  // session is still locally valid. Fall back to getSession() (localStorage-
  // backed, no network) so a brief network hiccup doesn't falsely signal
  // "Not signed in" and drop the job into the offline queue unnecessarily.
  // Only treat the user as genuinely signed out when BOTH calls yield no user.
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.id) return user.id;

  const { data: { session } } = await supabase.auth.getSession();
  return session?.user?.id || null;
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

  const job = {
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

  // Self-heal migration (price-reconciliation 2026-06-13):
  // Re-derive total from lineItems when they disagree and lines exist.
  // This corrects jobs where handleAmountSave wrote total=<free number> while
  // leaving existing line items at their old values (e.g. total=80, lines=£420).
  // Safe guard: only re-derive when lines are present — a job with total>0 but
  // no lines was legitimately saved via the seed path and must not be touched.
  // This is in-memory only: the DB is corrected the next time the user saves
  // any line item via handleSaveLiLine/handleSaveLiEdit.
  const healedLines = job.lineItems.filter(i => i.desc || i.cost > 0);
  if (healedLines.length > 0) {
    const lineSum = healedLines.reduce((s, i) => s + Number(i.cost || 0), 0);
    if (job.total !== lineSum) {
      job.total = lineSum;
      job.amount = lineSum;
    }
  }

  return job;
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
  // Derive the booked date from the payload (calendar taps carry a specific date).
  // Fall back to today only when the caller omits the date entirely.
  // payment_date is left as today — it records when the payment was received, not
  // when the job was scheduled.
  const jobDate = payload.date ? localDateString(new Date(payload.date)) : today;

  // Generate a client-side UUID so the offline queue can hold a stable ID
  // before the row reaches Supabase. Mirrors the pattern used in addReceiptToCloud.
  // If the caller already supplied an id (e.g. re-sync from queue), reuse it.
  const jobId = payload.id && typeof payload.id === 'string' ? payload.id : crypto.randomUUID();

  const row = {
    id: jobId,
    user_id,
    // Only write customer_name when a real customer is explicitly provided.
    // Defaulting to payload.name caused the "Job" string to leak into the
    // customer field when a job was created with no customer — on the next
    // sync, mapCloudJobToToday set job.customer = 'Job', which then propagated
    // back into customer_name via every extractJobMeta / updateJobMetaInCloud call.
    customer_name: payload.customer || null,
    date: jobDate,
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
    // Dedicated text columns — written at insert so they survive cloud sync
    // without needing a follow-up meta UPDATE.
    address: payload.address || null,
    email:   payload.email   || null,
    notes:   payload.notes   || null,
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

  // Write cost/deposit fields to the meta side-channel. These have no dedicated
  // DB columns so they live in the meta JSONB (via META_FIELDS in jobMeta.js).
  // Fire-and-forget via updateJobMetaInCloud is not used here because at insert
  // time there is no meta to preserve — a direct writeJobMeta is safe and avoids
  // an extra round-trip. The cloud meta column gets synced on the next
  // user action that triggers syncMetaToCloud (e.g. mark paid, edit a field).
  const metaPatch = {};
  if (payload.materialsCost != null) metaPatch.materialsCost = payload.materialsCost;
  if (payload.labourHours   != null) metaPatch.labourHours   = payload.labourHours;
  if (payload.deposit       != null) metaPatch.deposit       = payload.deposit;
  if (payload.notes         != null) metaPatch.notes         = payload.notes;
  if (Object.keys(metaPatch).length > 0) {
    writeJobMeta(data.id, metaPatch);
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
 * This is fire-and-forget from the caller's perspective — `syncMetaToCloud` in
 * AppShell.jsx calls this without await after the localStorage write succeeds.
 *
 * Offline / no-auth handling: if the network is unavailable or auth fails,
 * the update is enqueued in IndexedDB via enqueueMetaUpdate() so it is
 * retried automatically when the device comes back online (wireOnlineSync /
 * runSync). The localStorage write already happened so local state is correct.
 *
 * Idempotency: the cloud write is UPDATE SET meta=$1 — replaying the same
 * meta snapshot twice is safe (last-write-wins, same value).
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
    // Auth unavailable — enqueue and return
    await _enqueueMetaFallback(jobId, metaObject);
    return { ok: false, error: 'offline' };
  }

  if (!user_id) {
    await _enqueueMetaFallback(jobId, metaObject);
    return { ok: false, error: 'offline' };
  }

  // Build the UPDATE payload. Always write meta. When lineItems is present,
  // also keep the legacy line_items column in sync (Alan's decision #4).
  // When customer-editable column fields are present, mirror them to their
  // canonical DB columns — this is the fix for the customer-name-not-saved bug
  // (previously only meta was written; customer_name column was never updated,
  // so a cloud refresh would overwrite the edit with the stale column value).
  const updatePayload = { meta: metaObject };
  if (Array.isArray(metaObject.lineItems)) {
    updatePayload.line_items = metaObject.lineItems;
  }
  if ('customer' in metaObject) {
    updatePayload.customer_name = metaObject.customer || null;
  }
  if ('summary' in metaObject) {
    updatePayload.summary = metaObject.summary || null;
  }
  if ('address' in metaObject) {
    updatePayload.address = metaObject.address || null;
  }
  if ('email' in metaObject) {
    updatePayload.email = metaObject.email || null;
  }
  if ('description' in metaObject) {
    updatePayload.description = metaObject.description || null;
  }

  try {
    const { error } = await supabase
      .from('jobs')
      .update(updatePayload)
      .eq('id', jobId);

    if (error) {
      // Detect schema-drift: PostgREST returns code PGRST204 or Postgres 42703
      // when a column named in the UPDATE does not exist. A blind retry of the
      // same payload would loop forever — strip the mirror columns and retry
      // meta-only instead. Meta persistence is sufficient: mapCloudJobToToday
      // reads everything back via select('*') + meta on the next load.
      const isColumnNotFound =
        error.code === 'PGRST204' ||
        error.code === '42703'    ||
        (typeof error.message === 'string' && error.message.includes('column') && error.message.includes('does not exist'));

      if (isColumnNotFound) {
        console.warn('updateJobMetaInCloud: column-not-found — retrying meta-only', jobId, error.code, error.message);
        // Emit telemetry so drift is visible in PostHog without crashing the app.
        try {
          const { logTelemetry } = await import('./telemetry.js');
          logTelemetry('store_meta_column_drift', { jobId, code: error.code, message: error.message });
        } catch { /* telemetry unavailable — safe to swallow */ }

        // Retry with meta-only payload (no mirror columns). A genuine missing
        // meta column is pathological and would surface here as a second error.
        const { error: metaOnlyError } = await supabase
          .from('jobs')
          .update({ meta: metaObject })
          .eq('id', jobId);

        if (metaOnlyError) {
          console.warn('updateJobMetaInCloud meta-only retry failed', jobId, metaOnlyError.message);
          return { ok: false, error: metaOnlyError.message };
        }
        return { ok: true };
      }

      console.warn('updateJobMetaInCloud failed', jobId, error);
      // Other non-network Supabase error — do not queue; retrying won't help.
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (err) {
    // Network-level failure — enqueue so the update survives the session.
    console.warn('updateJobMetaInCloud network error — queuing', jobId, err?.message);
    await _enqueueMetaFallback(jobId, metaObject);
    return { ok: false, error: 'offline' };
  }
}

/**
 * Enqueues a meta update in IndexedDB for retry on reconnect.
 * Imported lazily to avoid a circular dependency at module load time
 * (offlineQueue imports store, so store must not import offlineQueue at the
 * top level).
 */
async function _enqueueMetaFallback(jobId, metaObject) {
  try {
    const { enqueueMetaUpdate } = await import('./offlineQueue.js');
    await enqueueMetaUpdate(jobId, metaObject);
  } catch (qErr) {
    console.warn('_enqueueMetaFallback failed (IndexedDB unavailable?)', qErr?.message);
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
  // Use maybeSingle() instead of single(): single() throws a PostgREST error on
  // zero matches (PGRST116), which is indistinguishable from a network failure in
  // error logs. maybeSingle() returns { data: null, error: null } on zero matches,
  // which is the correct semantic for "token not found yet".
  const { data, error } = await supabase
    .from('jobs')
    .select('id, customer_name, summary, amount, paid, line_items, meta, date, created_at')
    .eq('meta->>publicAccessToken', token)
    .maybeSingle();

  if (error) {
    console.warn('[fetchPublicJob] query error for token', token?.slice(0, 8), error?.message);
    return null;
  }
  if (!data) {
    console.warn('[fetchPublicJob] token not found in jobs.meta', token?.slice(0, 8));
    return null;
  }
  return mapCloudJobToToday(data);
}

/**
 * Writes the publicAccessToken (and any accompanying meta fields) to the cloud
 * jobs row and WAITS for the write to confirm before returning.
 *
 * This is the replacement for the fire-and-forget syncMetaToCloud path that was
 * used for token persistence. The quote/invoice/receipt link URL is embedded in
 * the PDF and the WhatsApp message — if the customer opens it before the cloud
 * write lands (even 200ms later), fetchPublicJob returns null and the customer
 * sees "Quote not found."
 *
 * Callers (ReviewSheet handleQuoteWhatsApp, handleInvoiceWhatsApp) must await
 * this before producing the shareable link or PDF.
 *
 * Offline handling: when the cloud write fails (no network), the meta is already
 * in localStorage (written by writeJobMeta before this call). The function
 * returns { ok: false, offline: true } so the caller can surface a warning to
 * the trader ("Link may not work yet — you're offline").
 *
 * @param {string} jobId    – Supabase UUID of the job row
 * @param {object} meta     – full meta object from extractJobMeta (includes publicAccessToken)
 * @returns {Promise<{ ok: boolean, offline?: boolean, error?: string }>}
 */
export async function persistPublicToken(jobId, meta) {
  const result = await updateJobMetaInCloud(jobId, meta);
  if (!result.ok) {
    if (result.error === 'offline') {
      return { ok: false, offline: true };
    }
    return { ok: false, error: result.error };
  }
  return { ok: true };
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
