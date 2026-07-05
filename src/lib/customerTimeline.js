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
// Deliberately NOT emitted (later slice or never): email sends (deep-link
// only — never logged), visits, photos, chase events. Legacy base64 photos
// have no timestamp so they can't be placed on a timeline anyway.

import { gbp } from './today';
import { computeAmountPaid } from './payments';

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
      const text = (n.subject && n.subject !== 'Note') ? n.subject : (n.body || '').slice(0, 60);
      events.push({
        ts: toTs(n.date), type: 'note', icon: 'note',
        summary: `Note: "${text}"`, jobId: job.id, jobName: label, sub,
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
 * Today · This week · This month · {Month} · {Year}.
 * Returns [{ label, events }], preserving the incoming (descending) order —
 * so as long as `events` is sorted newest-first, the groups come out in the
 * right sequence with no extra sort needed.
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
      if (diffDays <= 0) {
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
