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
//
// CROSS-DEVICE SYNC (Fix A — fix/cross-device-job-sync-overlay):
// Problem: the old `return { ...job, ...meta }` overlay gave LOCAL unconditional
// precedence over CLOUD for ALL META_FIELDS. When Device A edited a job and the
// cloud confirmed the write, Device B's stale localStorage snapshot still masked
// the fresh cloud value on every reload — including after a full hard refresh.
//
// Fix: a PENDING-SET per job (`jp.jobMetaPending.<id>`) tracks which fields have
// been written locally but not yet confirmed synced to the cloud. Only pending
// fields override cloud. Non-pending fields (i.e. fields not edited on THIS
// device, or already confirmed synced) let the fresh cloud value win.
//
// clearPending(id, keys) is called by AppShell's syncMetaToCloud on success and
// by offlineQueue.js markMetaSynced path, so the pending set shrinks after each
// confirmed cloud write.
//
// The quoteStatus:'accepted' monotonic ratchet is intentionally preserved: once
// a quote is accepted, no stale event can silently un-accept it. That special-
// case writes directly into both meta and pending (via writeJobMeta) so it wins
// on the next overlay just like any locally-written field would.

const META_KEY_PREFIX         = 'jp.jobMeta.';
const META_PENDING_KEY_PREFIX = 'jp.jobMetaPending.';

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
//
// Side-effect: marks all META_FIELDS present in `partial` as pending. They
// stay pending until clearPending() is called after a confirmed cloud write.
export function writeJobMeta(id, partial) {
  if (!id || !partial) return null;
  try {
    const existing = readJobMeta(id);
    const next = { ...existing };
    const written = [];
    for (const key of META_FIELDS) {
      if (key in partial) {
        next[key] = partial[key];
        written.push(key);
      }
    }
    localStorage.setItem(META_KEY_PREFIX + id, JSON.stringify(next));
    // Mark fields as pending-sync so applyJobMeta knows to overlay them even
    // after a cloud refetch (until clearPending() confirms the write landed).
    if (written.length > 0) markPending(id, written);
    return next;
  } catch { /* localStorage may be blocked or full */ }
  return null;
}

export function clearJobMeta(id) {
  if (!id) return;
  try { localStorage.removeItem(META_KEY_PREFIX + id); } catch { /* ignore */ }
  try { localStorage.removeItem(META_PENDING_KEY_PREFIX + id); } catch { /* ignore */ }
}

// ── Pending-set helpers ───────────────────────────────────────────────────────
// The pending set is a plain object whose keys are META_FIELDS that have been
// written locally but NOT yet confirmed synced to the cloud.
//
// readPending / writePending are internal; the public surface is markPending,
// clearPending, and readPendingKeys.

function readPending(id) {
  if (!id) return {};
  try {
    const raw = localStorage.getItem(META_PENDING_KEY_PREFIX + id);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePending(id, pending) {
  if (!id) return;
  try {
    if (Object.keys(pending).length === 0) {
      localStorage.removeItem(META_PENDING_KEY_PREFIX + id);
    } else {
      localStorage.setItem(META_PENDING_KEY_PREFIX + id, JSON.stringify(pending));
    }
  } catch { /* ignore */ }
}

// Mark a set of keys as pending-sync for `id`. Adds to the existing pending set.
function markPending(id, keys) {
  if (!id || !keys?.length) return;
  const pending = readPending(id);
  for (const key of keys) { pending[key] = true; }
  writePending(id, pending);
}

/**
 * clearPending(id, keys)
 * Called by AppShell.syncMetaToCloud(..).then() on a successful cloud write and
 * by the offlineQueue runMetaSync markMetaSynced path. Removes the listed keys
 * from the pending set so subsequent applyJobMeta calls let cloud win for those
 * fields.
 *
 * Exported so AppShell and offlineQueue can call it without importing internal helpers.
 */
export function clearPending(id, keys) {
  if (!id || !keys?.length) return;
  const pending = readPending(id);
  for (const key of keys) { delete pending[key]; }
  writePending(id, pending);
}

/**
 * readPendingKeys(id) — returns array of currently-pending field names.
 * Used by tests; not needed at runtime.
 */
export function readPendingKeys(id) {
  return Object.keys(readPending(id));
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

// MERGE STRATEGY — pending-set arbitrated overlay.
//
// Previously: `return { ...job, ...meta }` — local always wins for ALL
// META_FIELDS. This caused cross-device staleness: Device B's stale snapshot
// masked Device A's fresh cloud edits on every reload.
//
// Now: LOCAL wins ONLY for fields that are currently in the pending set (written
// locally but not yet confirmed synced). For all other fields, the fresh CLOUD
// value wins. This means a reload that brings in Device A's edit will correctly
// surface it on Device B once Device B has no pending write for that field.
//
// quoteStatus:'accepted' RATCHET (intentional monotonic business rule):
// Once a customer accepts a quote, a stale event must never silently un-accept it.
// The ratchet is preserved as-is: when cloud carries 'accepted', we write it into
// BOTH meta AND the pending set (via writeJobMeta), so it wins on the next overlay
// the same way any local edit would — and it is one-way only.
export function applyJobMeta(job) {
  if (!job?.id) return job;

  // Ratchet: if the cloud object carries quoteStatus:'accepted', ensure localStorage
  // agrees before the overlay runs. One-way only — never downgrades local 'accepted'.
  //
  // Gap 2 fix: only write quoteStatus + acceptance metadata into the pending set.
  // Do NOT write status/jobStatus as pending — those are pipeline stage fields that
  // must remain free to sync cross-device (e.g. Device B moves the job to Invoiced
  // after acceptance; Device A must see that stage move). Instead, clearPending for
  // status/jobStatus so the fresh CLOUD values always win for those fields.
  // The cloud object already carries the correct current status alongside accepted.
  if (job.quoteStatus === 'accepted') {
    const local = readJobMeta(job.id);
    if (local.quoteStatus !== 'accepted') {
      writeJobMeta(job.id, {
        quoteStatus:    'accepted',
        acceptedAt:     job.acceptedAt     ?? null,
        acceptedName:   job.acceptedName   ?? null,
        acceptedSource: job.acceptedSource ?? null,
        ...(job.acceptedSignature ? { acceptedSignature: job.acceptedSignature } : {}),
      });
    }
    // Always clear status/jobStatus pending so they don't freeze the pipeline stage.
    // Cloud is authoritative for pipeline position; only quoteStatus needs the
    // monotonic ratchet to guard against stale 'sent' overwriting 'accepted'.
    clearPending(job.id, ['status', 'jobStatus']);
  }

  const meta    = readJobMeta(job.id);
  const pending = readPending(job.id);

  // Pending-aware merge: build the result starting from the fresh cloud job,
  // then overlay ONLY the fields that are currently pending (locally written,
  // not yet confirmed synced). Non-pending local fields are discarded so the
  // cloud value wins — this is the cross-device fix.
  const result = { ...job };
  for (const key of META_FIELDS) {
    if (pending[key] && key in meta) {
      result[key] = meta[key];
    }
    // Non-pending: cloud value already present in result (from { ...job }).
  }
  return result;
}

export function applyJobMetaToJobs(jobs) {
  return Array.isArray(jobs) ? jobs.map(applyJobMeta) : jobs;
}

