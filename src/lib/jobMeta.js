// Side-channel localStorage layer for PRD-3 fields that the Supabase schema
// doesn't carry yet. Each job's payment-flow state is mirrored to its own
// `jp.jobMeta.<id>` key, so a cloud-sync stomp (which strips the new fields
// because mapCloudJobToToday doesn't know them) can be reversed by re-overlaying
// the meta on top of the cloud-mapped job.
//
// Cloud sync: after every writeJobMeta call, updateJobMetaInCloud (store.js)
// is fired async so the meta column on the Supabase jobs row is kept in sync.
// The localStorage write always succeeds first; the cloud write is best-effort.
// On app load, mapCloudJobToToday spreads r.meta onto the job object before
// applyJobMetaToJobs overlays localStorage on top — so cloud is the baseline
// and any unsynced offline edits win until the next successful online write.

const META_KEY_PREFIX = 'jp.jobMeta.';

const META_FIELDS = [
  'status', 'invoiceSentAt', 'invoiceNumber', 'invoiceDueDate',
  'completedAt', 'paidAt', 'customerPhone', 'paymentMethod',
  'paymentStatus', 'paymentDate',
  'payments', // Phase A of partial-payments PRD
  // Phase F — quote acceptance signature
  'acceptedSignature', // PNG dataURL ~5 KB (kept in meta — acceptable at scale for now)
  'acceptedAt',        // ISO timestamp of acceptance
  'quoteStatus',       // mirrored so acceptance flip survives cloud-sync stomp
  // Fields that were previously silently dropped by extractJobMeta (single-device bug fix):
  'photos',     // array of photo entries: legacy base64 strings OR { path, uploadedAt } objects
  'jobNotes',   // array of { id, subject, body, date } note objects
  'lineItems',  // array of { desc, cost } — also written to line_items column in same UPDATE
  'total',      // numeric — recomputed from lineItems on every edit
  'amount',     // numeric — kept in sync with total
  // Phase G-1 — public quote share link
  'publicAccessToken', // UUID; lazily generated when trader first taps "Send link"
  // Hosted invoice page — reuses publicAccessToken for the /i/<token> URL.
  // invoiceLinkSentAt records when the hosted invoice link was first included
  // in a WhatsApp send so the trader can see the customer received a real doc.
  'invoiceLinkSentAt', // ISO timestamp — set on first send that includes a hosted invoice URL
  // Phase G-1 open-tracking — written server-side by track-quote-open Netlify function
  'quoteLinkOpenedAt',     // ISO timestamp of first open by customer
  'quoteLinkLastOpenedAt', // ISO timestamp of most recent open (every load)
  // Review sheet draft flags — set when trader dismisses the sheet without sending
  'quoteDraft',   // boolean — tile shows amber "Draft ready" meta line
  'invoiceDraft', // boolean — tile shows amber "Draft ready" meta line
  // B2B flag — enables statutory late-payment interest copy at Tier 3 chase
  'isBusinessCustomer', // boolean — trader marks this as a commercial (B2B) customer
  // Phase G-3 — accepted-quote in-app notification
  'acceptedSeenAt', // ISO timestamp; set when trader first views this accepted quote
  'acceptedName',   // customer name stored by accept-quote Netlify function (mirrored here)
  // Manual-overdue flag — set to true by stagePatch('Overdue') so a trader can
  // manually mark a job Overdue before the due date passes. Without this the flag
  // survives in-memory but is silently dropped on cloud write/reload (not in
  // META_FIELDS → not written to meta JSONB → lost on next refresh).
  'overdue', // boolean — true = manually promoted to Overdue stage

  // CIS-4 — per-job CIS fields (stored in meta, no DB migration needed)
  'cis',     // boolean — whether this job has CIS deducted by the contractor
  'cisRate', // int (20 | 30 | 0) — the rate applied to this job's labour portion
  // CIS-5 — exclude from tax pot (all users)
  'excludeFromTax', // boolean — removes this job from all tax calculations
  // Customer-editable columns — mirrored into meta so edits survive offline and
  // cloud-sync stomps. updateJobMetaInCloud writes these back to the DB columns
  // (customer_name, summary, address, email, description) in the same UPDATE.
  'customer',     // maps to customer_name column — the bug: missing here meant name was never persisted
  'summary',      // maps to summary column — job name / description line
  'address',      // maps to address column
  'email',        // maps to email column
  'description',  // maps to description column (added 2026-05-30 migration)
  // Per-job cost fields — no dedicated DB columns; persisted in meta JSONB only.
  // materialsCost and labourHours feed true-profit calculations.
  // deposit is the deposit amount taken at booking (not the Stripe deposit flow).
  // notes is a plain-text string note; separate from jobNotes[] (structured notes).
  'materialsCost', // number — materials/supplies cost for this job
  'labourHours',   // number — hours worked on this job
  'deposit',       // number — deposit amount taken at booking
  'notes',         // string — free-text note logged at job creation
  // Quote deposit fields — set by ReviewSheet at send time and read by
  // fetch-public-job to render the deposit block on the public quote page.
  // Previously absent from META_FIELDS so they were silently stripped on
  // every meta write and never reached the public page (deposit_percent always
  // read as 0). No DB column migration needed — JSONB meta is schema-free.
  'deposit_percent',      // number (0–100) — percentage of total requested as deposit
  'deposit_amount_pence', // number — locked pence value computed at send time
  // Schedule fields — drawer handleScheduleSave and App.jsx saveSchedule both
  // route through onUpdateJob → writeJobMeta. Without these entries the schedule
  // date/time would appear saved in-memory but be silently stripped on reload.
  'scheduledDate',  // ISO date string e.g. "2026-06-10"
  'scheduledStart', // time string e.g. "09:00"
  'scheduledEnd',   // time string e.g. "11:30"
  'targetFinishDate', // YYYY-MM-DD optional target finish date
  'visits',           // Visit[]
  // Document record accordion fields (Design 1, 2026-06).
  // Not previously in whitelist — added so Sent/Signed audit states survive cloud-sync.
  'quoteSentAt',    // ISO timestamp — set when trader sends the quote link/WhatsApp
  'acceptedSource', // 'remote' | 'deposit_payment' | absent — how the quote was accepted
  // Public-link revoke (stress-test finding #10).
  // When set, fetch-public-{job,quote-profile,invoice,receipt} return 404 so the
  // customer's bookmarked link stops working immediately. The value is an ISO timestamp
  // recording when the trader revoked. Stored in JSONB meta only — no DB column migration
  // needed. A new token can be generated by re-sharing (sends a fresh UUID, overwriting
  // publicAccessToken; revokedAt is cleared at that point).
  'publicTokenRevokedAt', // ISO timestamp | undefined — present = link killed
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
//
// Returns the full merged meta object so callers that also need to fire the
// cloud write (e.g. onUpdateJob in AppShell) can pass it directly to
// updateJobMetaInCloud without a second readJobMeta call.
export function writeJobMeta(id, partial) {
  if (!id || !partial) return null;
  try {
    const existing = readJobMeta(id);
    const next = { ...existing };
    for (const key of META_FIELDS) {
      if (key in partial) next[key] = partial[key];
    }
    localStorage.setItem(META_KEY_PREFIX + id, JSON.stringify(next));
    return next;
  } catch { /* localStorage may be blocked or full */ }
  return null;
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

// Load-time heal: walks a cloud jobs array and corrects any localStorage entries
// that hold a stale quoteStatus:'sent' (or stale status:'quoted') for jobs the
// cloud already records as accepted. Must be called BEFORE applyJobMetaToJobs so
// the overlay picks up the corrected values.
//
// This is a one-way ratchet — once the cloud says 'accepted', localStorage is
// updated to agree. It never downgrades: if localStorage already says 'accepted',
// nothing is touched. Normal still-quoted jobs are not affected.
//
// Both quoteStatus AND status are written so that deriveDisplayStatus sees
// status:'active' and returns "On" correctly. The existing ratchet in
// refreshFromCloud only wrote quoteStatus, leaving status:'quoted' in localStorage
// to win the overlay — this function corrects that gap.
export function healAcceptedMeta(cloudJobs) {
  if (!Array.isArray(cloudJobs)) return;
  for (const cloudJob of cloudJobs) {
    if (cloudJob.quoteStatus !== 'accepted' || !cloudJob.id) continue;
    const local = readJobMeta(cloudJob.id);
    // Already healed — skip.
    if (local.quoteStatus === 'accepted' && local.status === 'active') continue;
    // Ratchet up: overwrite stale local state with cloud-accepted truth.
    writeJobMeta(cloudJob.id, {
      quoteStatus:    'accepted',
      status:         cloudJob.status         ?? 'active',
      jobStatus:      cloudJob.jobStatus      ?? 'active',
      acceptedAt:     cloudJob.acceptedAt     ?? null,
      acceptedName:   cloudJob.acceptedName   ?? null,
      acceptedSource: cloudJob.acceptedSource ?? null,
      ...(cloudJob.acceptedSignature
        ? { acceptedSignature: cloudJob.acceptedSignature }
        : {}),
    });
  }
}
