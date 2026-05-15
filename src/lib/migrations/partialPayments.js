// One-off migration: ensure every job has a payments[] array.
//
// For each job:
//   - If `payments` key already exists (any value), return job unchanged
//     — caller has already migrated or set the field. Idempotent.
//   - Else if paymentStatus === 'paid', append a synthetic payment entry
//     preserving the original amount + date as historical record.
//   - Else (not paid, no payments yet), set payments: [] so the schema is
//     consistent across all jobs.
//
// Pure and idempotent: safe to call on every AppShell mount. The per-job
// "skip if payments exists" check means already-migrated jobs aren't touched.
// Returns a new array (input array not mutated, input job objects not mutated).
//
// Synthetic entries bypass payments.js validators by design — they
// represent historical records that may pre-date strict schema enforcement.
// The migration normalises `date` to YYYY-MM-DD via paidAt.slice(0,10) so
// downstream consumers don't see ISO datetimes leaking into a date field.

export function runMigration(jobs) {
  if (!Array.isArray(jobs)) return jobs;
  return jobs.map(migrateOne);
}

function migrateOne(job) {
  if (!job || typeof job !== 'object') return job;
  // Idempotent: any existing `payments` key (empty array, populated array,
  // even unexpected null/undefined) means we don't touch it. Caller owns it.
  if ('payments' in job) return job;

  if (job.paymentStatus !== 'paid') {
    return { ...job, payments: [] };
  }

  // Legacy paid job — append synthetic entry for the full amount.
  // paidAt is an ISO datetime ('2026-05-14T10:00:00Z'); slice to YYYY-MM-DD
  // so the synthetic conforms to the payment schema (date, no time).
  // Fallback chain: paidAt → date → epoch ('we don't know'). Migration must
  // not throw on malformed legacy data.
  const slicedPaidAt = job.paidAt ? job.paidAt.slice(0, 10) : null;
  const synthetic = {
    id: 'pay_migration_' + job.id,
    date: slicedPaidAt || job.date || '1970-01-01',
    amount: job.amount,
    method: 'unknown',
    note: 'Pre-partial-payments migration',
    createdAt: new Date().toISOString(),
  };
  return { ...job, payments: [synthetic] };
}
