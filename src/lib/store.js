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
  } catch {}
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
  const amount = Number(payload.amount || 0);
  const isPaid = payload.paid !== false;

  const newJob = {
    id,
    customer: payload.name || 'Job',
    address: '',
    phone: '',
    email: '',
    date: today,
    summary: payload.name || 'Job',
    lineItems: [{ desc: payload.name || 'Job', cost: amount }],
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
  return {
    id: r.id, // Supabase UUID (source of truth)
    legacyId: r.customer_name ? null : null, // populated on dual-write if needed
    name: r.customer_name || r.summary?.slice(0, 40) || 'Job',
    amount: Number(r.amount || 0),
    paid: r.paid === true,
    paymentType: r.payment_type || null,
    date: r.payment_date || r.date,
    createdAt: r.created_at,
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

  const amount = Number(payload.amount || 0);
  const isPaid = payload.paid !== false;
  const today = localDateString();

  const row = {
    user_id,
    customer_name: payload.name || 'Job',
    date: today,
    summary: payload.name || 'Job',
    amount,
    paid: isPaid,
    payment_type: payload.paymentType || (isPaid ? 'cash' : null),
    payment_date: isPaid ? today : null,
    source: payload.source || 'Quick add',
    status: isPaid ? 'complete' : 'active',
    line_items: [{ desc: payload.name || 'Job', cost: amount }],
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

  // Dual-write to localStorage for legacy Manage compatibility
  addTodayJob({
    ...payload,
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
