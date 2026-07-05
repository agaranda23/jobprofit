// Customer Timeline — slice 1.
//
// There is no customer *entity* in this schema — a "customer" is just the
// customer_name text (job.customer) on jobs rows. So this file is a pure,
// client-side grouping of already-loaded jobs + receipts by that text field.
// No new table, no new query, no backend — works offline, entirely from
// state AppShell already holds (jobs[] + receipts[]).
//
// Slice-1 event fields (all already stored + timestamped — see
// src/lib/jobMeta.js META_FIELDS): createdAt, quoteSentAt, quoteLinkOpenedAt,
// acceptedAt, invoiceSentAt/invoiceLinkSentAt, payments[], paidAt, jobNotes[],
// and receipts matched by jobId/cloudId.
//
// Capture Layer — Slice A adds job.commsLog[] (call/whatsapp/sms tapped,
// review link sent — see src/lib/commsLog.js) so those touches now appear
// too, without the trader typing a note.
//
// Slice 2 adds:
//   - Visits (src/lib/visits.js, read via readVisits so legacy scheduledDate
//     jobs are folded in): a "Visit booked" event per dated visit, plus a
//     "Visit done" event for visits stamped with doneAt (added in this slice
//     — JobDetailDrawer now sets doneAt wherever a visit's status flips to
//     'done'). Visits marked done before doneAt existed have no timestamp to
//     place a "done" event at, so it's omitted — same rule as legacy photos.
//   - Photos (job.photos[], see src/lib/jobPhotos.js): a "Photo added" event
//     for each new-format { path, uploadedAt } entry. Legacy base64-string
//     entries carry no timestamp and are never guessed at — omitted.
//   - Chase summary (src/lib/chaseLadder.js — localStorage-backed and
//     already hydrated from job_chase_states on sign-in, so no new fetch is
//     needed): one summarised "Chased ×N · last {date}" row per job, not one
//     row per chase.
//
// Deliberately NOT emitted (later slice or never): email sends (deep-link
// only — never logged).

import { gbp } from './today';
import { computeAmountPaid } from './payments';
import { readVisits } from './visits';
import { isLegacyPhoto } from './jobPhotos';
import { getChaseState } from './chaseLadder';

/** Trims + lowercases a customer name for bucketing. Empty/null/whitespace → ''. */
export function normaliseCustomerName(name) {
  return (name || '').trim().toLowerCase();
}

/**
 * Buckets jobs by normalised customer name. Jobs with no customer name
 * (null/empty/whitespace-only) are skipped — they never appear as a
 * "customer" in this view since there is nothing to group them under.
 * Accepts typo/near-duplicate splitting as a known v1 trade-off (founder-
 * approved default — exact-name grouping, no fuzzy matching).
 *
 * Returns { [normalisedName]: Job[] }, each bucket in input order.
 */
export function groupByCustomer(jobs) {
  const buckets = {};
  for (const job of jobs || []) {
    const key = normaliseCustomerName(job?.customer);
    if (!key) continue;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(job);
  }
  return buckets;
}

/** Returns every job belonging to the same customer as `job` (job included). */
export function getCustomerJobs(job, jobs) {
  if (!job) return [];
  const key = normaliseCustomerName(job.customer);
  if (!key) return [job];
  return (jobs || []).filter(j => normaliseCustomerName(j?.customer) === key);
}

// ── Timeline event builder ───────────────────────────────────────────────

/** Parses an ISO datetime or a YYYY-MM-DD date-only string to epoch ms. */
function toTs(raw) {
  if (!raw) return null;
  const d = typeof raw === 'string' && raw.length === 10
    ? new Date(raw + 'T00:00:00')
    : new Date(raw);
  const ms = d.getTime();
  return Number.isNaN(ms) ? null : ms;
}

function jobLabel(job) {
  return (job?.summary || job?.name || '').trim();
}

/** Short en-GB date for inline summary text (e.g. "12 Jul") — mirrors the
 *  row's own fmtShort() in CustomerTimelineSheet so the two never disagree. */
function formatShortDate(raw) {
  const ts = toTs(raw);
  if (ts == null) return '';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Voice-note summary length — long enough to be useful at a glance on the
// timeline row, short enough not to wrap onto 3+ lines on a phone screen.
const NOTE_SUMMARY_MAX = 60;

/** Trims a voice-note body to ~60 chars for the timeline row, ellipsis only when cut. */
function truncateNoteSummary(body) {
  const text = (body || '').trim();
  return text.length > NOTE_SUMMARY_MAX ? text.slice(0, NOTE_SUMMARY_MAX - 1) + '…' : text;
}

function methodLabel(method) {
  switch (method) {
    case 'cash': return 'cash';
    case 'bank': return 'bank transfer';
    case 'card': return 'card';
    case 'other': return 'other';
    default: return 'payment';
  }
}

/** Jobs matter for receipt attribution via both job.id (local) and job.cloudId. */
function receiptsForJob(job, receipts) {
  return (receipts || []).filter(r => r?.jobId &&
    (String(r.jobId) === String(job.id) || String(r.jobId) === String(job.cloudId)));
}

/**
 * Builds a flat, descending-by-time event list for one customer's jobs +
 * the global receipts array. Each event:
 *   { ts, type, icon, summary, jobId, jobName, sub, amount? }
 * `sub` is the quiet job-name sub-label, only populated when the customer
 * has more than one job (so context is never lost, but single-job customers
 * don't see redundant repetition of the job name on every row).
 */
export function buildTimeline(customerJobs, receipts) {
  const jobs = customerJobs || [];
  const multiJob = jobs.length > 1;
  const events = [];

  for (const job of jobs) {
    if (!job) continue;
    const label = jobLabel(job);
    const sub = multiJob ? label : '';
    const amount = job.total ?? job.amount ?? 0;

    if (job.createdAt) {
      events.push({
        ts: toTs(job.createdAt), type: 'created', icon: 'job',
        summary: 'Job created', jobId: job.id, jobName: label, sub,
      });
    }

    if (job.quoteSentAt) {
      events.push({
        ts: toTs(job.quoteSentAt), type: 'quote_sent', icon: 'send',
        summary: `Quote sent — ${gbp(amount)}`,
        jobId: job.id, jobName: label, sub, amount,
      });
    }

    if (job.quoteLinkOpenedAt) {
      const first = (job.customer || '').trim().split(/\s+/)[0] || '';
      events.push({
        ts: toTs(job.quoteLinkOpenedAt), type: 'quote_opened', icon: 'eye',
        summary: `${first || 'They'} opened your quote`,
        jobId: job.id, jobName: label, sub,
      });
    }

    if (job.acceptedAt) {
      events.push({
        ts: toTs(job.acceptedAt), type: 'accepted', icon: 'check',
        summary: 'Quote accepted', jobId: job.id, jobName: label, sub,
      });
    }

    const invoiceSentTs = job.invoiceSentAt || job.invoiceLinkSentAt;
    if (invoiceSentTs) {
      events.push({
        ts: toTs(invoiceSentTs), type: 'invoice_sent', icon: 'invoice',
        summary: `Invoice sent — ${gbp(amount)}`,
        jobId: job.id, jobName: label, sub, amount,
      });
    }

    for (const p of (job.payments || [])) {
      if (!p?.date) continue;
      const isDeposit = p.type === 'deposit';
      events.push({
        ts: toTs(p.date), type: 'payment', icon: 'price',
        summary: `Paid ${gbp(p.amount)}${isDeposit ? ' deposit' : ''} — ${methodLabel(p.method)}`,
        jobId: job.id, jobName: label, sub, amount: p.amount,
      });
    }

    if (job.paidAt) {
      events.push({
        ts: toTs(job.paidAt), type: 'paid_in_full', icon: 'paid',
        summary: `Paid in full — ${gbp(amount)}`,
        jobId: job.id, jobName: label, sub, amount,
      });
    }

    for (const n of (job.jobNotes || [])) {
      if (!n?.date) continue;
      // Capture Layer — Slice B: voice notes (source:'voice') get a mic icon
      // and always summarise from the transcript body (subject is always the
      // fixed 'Voice note' label, so it carries no extra info to show).
      const isVoice = n.source === 'voice';
      const summary = isVoice
        ? `Voice note: "${truncateNoteSummary(n.body)}"`
        : `Note: "${(n.subject && n.subject !== 'Note') ? n.subject : (n.body || '').slice(0, 60)}"`;
      events.push({
        ts: toTs(n.date), type: 'note', icon: isVoice ? 'mic' : 'note',
        summary, jobId: job.id, jobName: label, sub,
      });
    }

    // Capture Layer — Slice A: auto-logged comms touches (commsLog.js).
    // `type` is kept as the raw touch type ('call'|'whatsapp'|'sms'|'review')
    // so it doubles as the event type; commsId is set so the timeline can
    // offer delete-by-id for the rare phantom tap.
    const first = (job.customer || '').trim().split(/\s+/)[0] || 'them';
    const COMMS_COPY = {
      call:     { icon: 'phone',    summary: `Called ${first}` },
      whatsapp: { icon: 'whatsapp', summary: `Messaged ${first} on WhatsApp` },
      sms:      { icon: 'text',     summary: `Texted ${first}` },
      review:   { icon: 'review',   summary: `Asked ${first} for a review` },
    };
    for (const c of (job.commsLog || [])) {
      if (!c?.date) continue;
      const copy = COMMS_COPY[c.type];
      if (!copy) continue; // unknown/future type — skip defensively
      events.push({
        ts: toTs(c.date), type: c.type, icon: copy.icon,
        summary: copy.summary, jobId: job.id, jobName: label, sub,
        commsId: c.id,
      });
    }

    for (const r of receiptsForJob(job, receipts)) {
      if (!r?.date) continue;
      events.push({
        ts: toTs(r.date), type: 'receipt', icon: 'receipt',
        summary: `Receipt added — ${r.label || 'Receipt'} ${gbp(r.amount)}`,
        jobId: job.id, jobName: label, sub, amount: r.amount,
      });
    }

    // Slice 2 — visits. readVisits() folds in the legacy single-scheduledDate
    // shape so old jobs get a "Visit booked" event too.
    for (const v of readVisits(job)) {
      if (!v?.date) continue;
      events.push({
        ts: toTs(v.date), type: 'visit_booked', icon: 'date',
        summary: `Visit booked — ${formatShortDate(v.date)}`,
        jobId: job.id, jobName: label, sub,
      });

      // Only visits stamped with doneAt (this slice's addition) get a "done"
      // event — a visit marked done before doneAt existed has no timestamp
      // to place it at, so it's left off rather than guessed.
      if (v.status === 'done' && v.doneAt) {
        events.push({
          ts: toTs(v.doneAt), type: 'visit_done', icon: 'complete',
          summary: 'Visit done', jobId: job.id, jobName: label, sub,
        });
      }
    }

    // Slice 2 — photos. Legacy base64-string entries carry no uploadedAt and
    // are skipped rather than placed on a guessed date (isLegacyPhoto()).
    for (const p of (job.photos || [])) {
      if (isLegacyPhoto(p) || !p?.uploadedAt) continue;
      events.push({
        ts: toTs(p.uploadedAt), type: 'photo', icon: 'photos',
        summary: 'Photo added', jobId: job.id, jobName: label, sub,
      });
    }

    // Slice 2 — chase summary. One row per job, not one per chase tap.
    // getChaseState is a synchronous localStorage read (already hydrated
    // from job_chase_states on sign-in), so this needs no new fetch.
    const chase = getChaseState(job.id);
    if (chase?.count > 0) {
      events.push({
        ts: toTs(chase.lastChasedAt), type: 'chase_summary', icon: 'chase',
        summary: `Chased ×${chase.count} · last ${formatShortDate(chase.lastChasedAt)}`,
        jobId: job.id, jobName: label, sub,
      });
    }
  }

  events.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
  return events;
}

// ── Date-group bucketing ──────────────────────────────────────────────────

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function startOfDay(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Groups an already-descending event list into date-group headers:
 * Upcoming · Today · This week · This month · {Month} · {Year}.
 * Returns [{ label, events }], preserving the incoming (descending) order —
 * so as long as `events` is sorted newest-first, the groups come out in the
 * right sequence with no extra sort needed.
 *
 * "Upcoming" (diffDays < 0) exists for Slice 2's "Visit booked" events,
 * which — unlike every slice-1 event — can be dated in the future (a visit
 * scheduled for next week). Before slice 2 no event ever carried a future
 * ts, so this branch was unreachable; without it a future date's negative
 * diffDays would wrongly satisfy `diffDays <= 0` and land under "Today".
 */
export function bucketEvents(events, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayMs = 86400000;
  const order = [];
  const map = {};

  for (const ev of (events || [])) {
    let label;
    if (ev.ts == null) {
      label = 'Earlier';
    } else {
      const diffDays = Math.floor((startOfToday - startOfDay(ev.ts)) / dayMs);
      if (diffDays < 0) {
        label = 'Upcoming';
      } else if (diffDays === 0) {
        label = 'Today';
      } else if (diffDays <= 6) {
        label = 'This week';
      } else {
        const d = new Date(ev.ts);
        if (d.getFullYear() === now.getFullYear()) {
          label = d.getMonth() === now.getMonth() ? 'This month' : MONTH_NAMES[d.getMonth()];
        } else {
          label = String(d.getFullYear());
        }
      }
    }
    if (!map[label]) { map[label] = []; order.push(label); }
    map[label].push(ev);
  }

  return order.map(label => ({ label, events: map[label] }));
}

// ── Lifetime figures ───────────────────────────────────────────────────────

/** { billed, paid, owed, jobCount } across every job for this customer. */
export function computeLifetime(customerJobs) {
  const jobs = customerJobs || [];
  let billed = 0;
  let paid = 0;
  for (const job of jobs) {
    billed += Number(job.total ?? job.amount ?? 0);
    paid += computeAmountPaid(job);
  }
  const owed = Math.max(0, billed - paid);
  return { billed, paid, owed, jobCount: jobs.length };
}
