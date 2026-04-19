// Unified store adapter.
// Old app uses localStorage key "jobprofit-app-data" with shape { jobs, expenses, invoices }.
// Today screen used "jp.jobs" / "jp.receipts" — we now translate to/from the old schema.

const KEY = 'jobprofit-app-data';

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

// === Reads: return Today-friendly projections ===

export function getJobs() {
  // Return every job that represents money coming in
  return read().jobs;
}

export function getReceipts() {
  // "expenses" in old schema = receipts in new
  return read().expenses;
}

// Today's UI expects { id, name, amount, paid, date, createdAt }
// We project the old schema to that shape.
export function getTodayJobs() {
  const { jobs } = read();
  return jobs.map(j => ({
    id: j.id,
    name: j.customer || j.summary?.slice(0, 40) || 'Job',
    amount: Number(j.total || 0),
    paid: j.paymentStatus === 'paid',
    paymentType: j.paymentMethod || null,
    date: j.paymentDate || j.date || j.scheduledDate || new Date().toISOString().slice(0, 10),
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
    date: e.date || new Date().toISOString().slice(0, 10),
    createdAt: e.createdAt || e.date || new Date().toISOString(),
  }));
}

// === Writes: accept Today payloads, translate to old schema ===

export function addTodayJob(payload) {
  const data = read();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const id = nextJobId(data.jobs);
  const amount = Number(payload.amount || 0);
  const isPaid = payload.paid !== false; // default paid unless marked unpaid

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
    source: 'Quick add',
    jobNotes: [],
    photos: [],
    invoiceId: '',
    createdAt: now.toISOString(),
  };

  data.jobs = [newJob, ...data.jobs];
  write(data);
  return newJob;
}

export function addTodayReceipt(payload) {
  const data = read();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const id = nextExpenseId(data.expenses);

  const items = Array.isArray(payload.items) ? payload.items : [];
  const desc = items.length > 0
    ? items.map(i => i.desc).filter(Boolean).join(', ')
    : '';
  const expDate = payload.date ? payload.date.slice(0, 10) : today;
  const newExp = {
    id,
    jobId: '',
    merchant: payload.label || 'Receipt',
    date: expDate,
    amount: Number(payload.amount || 0),
    vat: Number(payload.vat || 0),
    desc,
    items,
    invoiceNumber: payload.invoiceNumber || null,
    photo: payload.photo || null,
    createdAt: now.toISOString(),
  };

  data.expenses = [newExp, ...data.expenses];
  write(data);
  return newExp;
}

export function markJobPaid(jobId) {
  const data = read();
  const today = new Date().toISOString().slice(0, 10);
  data.jobs = data.jobs.map(j =>
    j.id === jobId
      ? { ...j, paymentStatus: 'paid', paymentDate: today, jobStatus: 'complete', paymentMethod: j.paymentMethod || 'cash' }
      : j
  );
  write(data);
}
