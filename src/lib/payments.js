// Pure helpers for the partial-payments data layer.
// No localStorage writes, no React, no DOM — UI layer (Phase B) wires these
// into AppShell which then persists to the jobMeta side-channel.
//
// Payment shape per PRD docs/partial-payments-prd.md Section 2:
//   {
//     id: 'pay_<timestamp>_<random>',
//     date: 'YYYY-MM-DD',
//     amount: number (positive, finite),
//     method: 'cash' | 'bank' | 'card' | 'other' | 'unknown',
//     note: string (may be empty),
//     createdAt: ISO datetime string (immutable after creation)
//   }

const VALID_METHODS = Object.freeze(['cash', 'bank', 'card', 'other', 'unknown']);

// Local-tz YYYY-MM-DD. Matches src/lib/store.js localDateString() to avoid
// UTC drift in evening hours (where new Date().toISOString().slice(0,10)
// returns tomorrow's date while the user is still on today's).
function todayLocalIsoDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function generatePaymentId() {
  return 'pay_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function assertJob(job) {
  if (!job || typeof job !== 'object') {
    throw new Error('job is required');
  }
}

// ─── Validators (exported per spec — Phase B may want to surface inline
// validation in form UIs) ────────────────────────────────────────────────

export function validateAmount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new Error('amount must be a positive number');
  }
}

export function validateDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error('date must be an ISO date string (YYYY-MM-DD)');
  }
  if (s > todayLocalIsoDate()) {
    throw new Error('date cannot be in the future');
  }
}

export function validateMethod(m) {
  if (!VALID_METHODS.includes(m)) {
    throw new Error("method must be one of: 'cash', 'bank', 'card', 'other', 'unknown'");
  }
}

// Internal helper — note isn't on the exported validator list, but a string
// check is still applied because the schema requires it. Caller may pass
// undefined and we'll default to '' in addPayment's destructuring.
function assertNote(note) {
  if (typeof note !== 'string') {
    throw new Error('note must be a string when provided');
  }
}

// ─── Mutating helpers — all pure, return new job, run applyAutoFlip ──────

/**
 * Append a payment to a job's payments[] array. Returns a new job.
 */
export function addPayment(job, { amount, date, method, note = '' } = {}) {
  assertJob(job);
  validateAmount(amount);
  validateDate(date);
  validateMethod(method);
  assertNote(note);
  const payment = {
    id: generatePaymentId(),
    date,
    amount,
    method,
    note,
    createdAt: new Date().toISOString(),
  };
  return applyAutoFlip({
    ...job,
    payments: [...(job.payments || []), payment],
  });
}

/**
 * Update fields on an existing payment by id. Throws if the payment isn't
 * found. `id` and `createdAt` are immutable — any attempt to set them via
 * `updates` is silently ignored (existing values are restored after the merge).
 */
export function editPayment(job, paymentId, updates) {
  assertJob(job);
  if (typeof paymentId !== 'string' || !paymentId) {
    throw new Error('paymentId is required');
  }
  const payments = job.payments || [];
  const idx = payments.findIndex(p => p.id === paymentId);
  if (idx === -1) {
    throw new Error('payment not found: ' + paymentId);
  }
  const existing = payments[idx];
  const u = updates || {};
  const merged = {
    ...existing,
    ...(u.amount !== undefined && { amount: u.amount }),
    ...(u.date !== undefined && { date: u.date }),
    ...(u.method !== undefined && { method: u.method }),
    ...(u.note !== undefined && { note: u.note }),
    // Immutable — restore after spread regardless of what was in updates.
    id: existing.id,
    createdAt: existing.createdAt,
  };
  validateAmount(merged.amount);
  validateDate(merged.date);
  validateMethod(merged.method);
  assertNote(merged.note);
  const nextPayments = [...payments];
  nextPayments[idx] = merged;
  return applyAutoFlip({ ...job, payments: nextPayments });
}

/**
 * Remove a payment by id. Throws if the payment isn't found.
 */
export function deletePayment(job, paymentId) {
  assertJob(job);
  if (typeof paymentId !== 'string' || !paymentId) {
    throw new Error('paymentId is required');
  }
  const payments = job.payments || [];
  if (!payments.some(p => p.id === paymentId)) {
    throw new Error('payment not found: ' + paymentId);
  }
  return applyAutoFlip({
    ...job,
    payments: payments.filter(p => p.id !== paymentId),
  });
}

// ─── Computed values ─────────────────────────────────────────────────────

export function computeAmountPaid(job) {
  if (!job || !Array.isArray(job.payments)) return 0;
  return job.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
}

export function computeBalance(job) {
  if (!job) return 0;
  return (job.amount || 0) - computeAmountPaid(job);
}

export function isFullyPaid(job) {
  return computeBalance(job) <= 0;
}

export function isOverpaid(job) {
  return computeBalance(job) < 0;
}

// ─── Auto-flip — 4-branch rule per PRD Section 3 ─────────────────────────

/**
 * Recomputes status / paymentStatus based on current payments. Pure.
 *
 * Branches:
 *   1. isFullyPaid                              → status='paid', paymentStatus='paid'
 *   2. balance > 0, was paid, invoiceSentAt set → 'awaiting' / 'awaiting'
 *   3. balance > 0, was paid, no invoice ever   → 'completed' / 'awaiting'
 *      (only way to be 'paid' without invoiceSentAt is the Mark-as-Paid
 *       shortcut from 'completed' — revert there)
 *   4. balance > 0, was never paid              → return job unchanged
 *      (partial payment recorded on pre-paid state — caller's status is correct)
 */
export function applyAutoFlip(job) {
  if (isFullyPaid(job)) {
    return { ...job, status: 'paid', paymentStatus: 'paid' };
  }
  const wasPaid = job.status === 'paid' || job.paymentStatus === 'paid';
  if (!wasPaid) {
    return job;
  }
  if (job.invoiceSentAt) {
    return { ...job, status: 'awaiting', paymentStatus: 'awaiting' };
  }
  return { ...job, status: 'completed', paymentStatus: 'awaiting' };
}
