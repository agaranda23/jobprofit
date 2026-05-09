// Side-channel localStorage layer for PRD-3 fields that the Supabase schema
// doesn't carry yet. Each job's payment-flow state is mirrored to its own
// `jp.jobMeta.<id>` key, so a cloud-sync stomp (which strips the new fields
// because mapCloudJobToToday doesn't know them) can be reversed by re-overlaying
// the meta on top of the cloud-mapped job.
//
// Single-device only. Cross-device sync is a follow-up PRD.

const META_KEY_PREFIX = 'jp.jobMeta.';

const META_FIELDS = [
  'status', 'invoiceSentAt', 'invoiceNumber', 'invoiceDueDate',
  'completedAt', 'paidAt', 'customerPhone', 'paymentMethod',
  'paymentStatus', 'paymentDate',
];

export function readJobMeta(id) {
  if (!id) return {};
  try {
    const raw = localStorage.getItem(META_KEY_PREFIX + id);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Merges `partial` into the stored meta. Uses `key in partial` so callers can
// clear a field by passing it as undefined (JSON.stringify drops it; on next
// read the field is absent → effectively cleared). Null and '' survive
// serialisation and overlay as cleared values, matching what markUnpaid writes.
export function writeJobMeta(id, partial) {
  if (!id || !partial) return;
  try {
    const existing = readJobMeta(id);
    const next = { ...existing };
    for (const key of META_FIELDS) {
      if (key in partial) next[key] = partial[key];
    }
    localStorage.setItem(META_KEY_PREFIX + id, JSON.stringify(next));
  } catch { /* localStorage may be blocked or full */ }
}

export function clearJobMeta(id) {
  if (!id) return;
  try { localStorage.removeItem(META_KEY_PREFIX + id); } catch { /* ignore */ }
}

// Pulls the 10 meta fields off a job object so they can be written to the
// side-channel. Includes fields that are present even if their value is
// undefined, so that callers like markUnpaid (which sets status: undefined)
// propagate the clear correctly.
export function extractJobMeta(job) {
  if (!job) return {};
  const meta = {};
  for (const key of META_FIELDS) {
    if (key in job) meta[key] = job[key];
  }
  return meta;
}

export function applyJobMeta(job) {
  if (!job?.id) return job;
  const meta = readJobMeta(job.id);
  return { ...job, ...meta };
}

export function applyJobMetaToJobs(jobs) {
  return Array.isArray(jobs) ? jobs.map(applyJobMeta) : jobs;
}
