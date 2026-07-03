/**
 * sampleData.js — "Load sample data" one-tap demo seed.
 *
 * Two jobs, one feature:
 *   1. A brand-new user with zero jobs sees a blank app — intimidating on a
 *      first open. Offering a realistic, clearly-tagged sample day lets them
 *      explore the Jobs pipeline / Today / Money screens with real numbers
 *      before they've logged a job of their own.
 *   2. Founders need repeatable, clean data for marketing screenshots and
 *      sales demos without hand-crafting jobs every time.
 *
 * Design decisions
 * ----------------
 * - Reuses the REAL creation paths (addJobToCloud, addReceiptToCloud) and the
 *   REAL stage model (stagePatch + updateJobMetaInCloud) — no parallel store.
 *   Seeded jobs flow through the exact same profit/pipeline/Money calculations
 *   as a job a trader logs by hand.
 * - Tagged via the jobs.`source` column — already a free-text column used for
 *   'Quick add' / 'trial_end' / 'drop_to_free' etc. No migration, no RLS
 *   change, and nothing in the UI displays `source` — an invisible, safe tag.
 * - clearSampleData looks up rows by that tag and deletes them via the SAME
 *   cascade (deleteJobWithData) a manual delete uses — photos, linked
 *   receipts, and the row itself. Any job without the tag (i.e. every real
 *   job) is never touched.
 * - The user's profile (business name / logo / bank details) is never
 *   written to — only jobs, customers-on-jobs, and one linked receipt per
 *   paid job.
 */

import { supabase } from './supabase';
import {
  addJobToCloud,
  addReceiptToCloud,
  deleteJobWithData,
  updateJobMetaInCloud,
  getJobsFromCloud,
} from './store';
import { writeJobMeta, clearPending } from './jobMeta';
import { stagePatch } from './jobStatus';
import { nextInvoiceNumber } from './invoiceNumber';

export const SAMPLE_DATA_SOURCE = 'Sample data';

// Canonical six pipeline stages (mirrors jobStatus.js / WorkScreen.STAGES).
export const PIPELINE_STAGES = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];

/** True when `job` was created by the sample-data seed. */
export function isSampleJob(job) {
  return !!job && job.source === SAMPLE_DATA_SOURCE;
}

/** Number of jobs that are NOT sample-tagged — i.e. the trader's own jobs. */
export function countRealJobs(jobs) {
  return Array.isArray(jobs) ? jobs.filter(j => !isSampleJob(j)).length : 0;
}

/** Number of sample-tagged jobs currently loaded. */
export function countSampleJobs(jobs) {
  return Array.isArray(jobs) ? jobs.filter(isSampleJob).length : 0;
}

/**
 * Gates the primary "Load sample data" empty-state CTA.
 * Shown only when the trader has zero real jobs — once any real job exists
 * (or the screen is otherwise non-empty), the offer to load a demo makes no
 * sense and is hidden. Settings always offers Load/Clear regardless of this.
 */
export function shouldOfferSampleData(jobs) {
  return countRealJobs(jobs) === 0;
}

// ── Date helpers (local, no timezone surprises for a same-day seed) ────────

function daysAgoDate(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function isoDaysAgo(n) {
  return daysAgoDate(n).toISOString();
}

function dateStrDaysAgo(n) {
  const d = daysAgoDate(n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateStrDaysAhead(n) {
  return dateStrDaysAgo(-n);
}

/**
 * Pure data — the sample day's jobs, one per canonical pipeline stage (three
 * Paid so Money/profit numbers look genuinely populated). No side effects —
 * exported so tests can assert stage coverage and amounts without touching
 * Supabase.
 *
 * Every non-Lead job carries an amount in the £300–£1,250 band. The Lead has
 * no price yet — that's the real, honest shape of an enquiry that hasn't been
 * quoted (the app explicitly supports pricing later).
 */
export function buildSampleJobSpecs() {
  return [
    {
      stage: 'Lead',
      customer: 'Priya Shah',
      name: 'Consumer unit replacement',
      amount: null,
      phone: '07700 900111',
      address: '14 Elm Grove, Ealing, London',
      date: dateStrDaysAgo(0),
    },
    {
      stage: 'Quoted',
      customer: 'Dave Wilson',
      name: 'EV charger install',
      amount: 850,
      phone: '07700 900222',
      address: '2 Oak Close, Acton, London',
      date: dateStrDaysAgo(2),
      quoteSentAt: isoDaysAgo(2),
      depositPercent: 25,
      depositDueDate: dateStrDaysAhead(3),
    },
    {
      stage: 'On',
      customer: 'Lisa Green',
      name: 'Kitchen sink install',
      amount: 420,
      phone: '07700 900333',
      address: '9 Birch Road, Chiswick, London',
      date: dateStrDaysAgo(4),
      quoteSentAt: isoDaysAgo(4),
      acceptedAt: isoDaysAgo(3),
    },
    {
      stage: 'Invoiced',
      customer: 'Tom Hughes',
      name: 'Garden lighting',
      amount: 560,
      phone: '07700 900444',
      address: '21 Willow Way, Hanwell, London',
      date: dateStrDaysAgo(6),
      quoteSentAt: isoDaysAgo(6),
      acceptedAt: isoDaysAgo(5),
      invoiceSentAt: isoDaysAgo(3),
      invoiceDueDate: dateStrDaysAhead(4),
    },
    {
      stage: 'Overdue',
      customer: 'Sam Patel',
      name: 'Boiler service',
      amount: 310,
      phone: '07700 900555',
      address: '5 Maple Drive, Southall, London',
      date: dateStrDaysAgo(23),
      quoteSentAt: isoDaysAgo(23),
      acceptedAt: isoDaysAgo(22),
      invoiceSentAt: isoDaysAgo(20),
      invoiceDueDate: dateStrDaysAgo(13),
    },
    {
      stage: 'Paid',
      customer: 'Rachel Ng',
      name: 'Bathroom tap replacement',
      amount: 300,
      phone: '07700 900666',
      address: '33 Cedar Street, Northolt, London',
      date: dateStrDaysAgo(13),
      quoteSentAt: isoDaysAgo(13),
      acceptedAt: isoDaysAgo(12),
      invoiceSentAt: isoDaysAgo(11),
      invoiceDueDate: dateStrDaysAgo(4),
      paidDate: dateStrDaysAgo(10),
      paymentMethod: 'card',
      deposit: 50,
      materialsCost: 80,
    },
    {
      stage: 'Paid',
      customer: 'Mark O’Connor',
      name: 'Fuse board upgrade',
      amount: 1250,
      phone: '07700 900777',
      address: '48 Poplar Avenue, Greenford, London',
      date: dateStrDaysAgo(22),
      quoteSentAt: isoDaysAgo(23),
      acceptedAt: isoDaysAgo(22),
      invoiceSentAt: isoDaysAgo(21),
      invoiceDueDate: dateStrDaysAgo(14),
      paidDate: dateStrDaysAgo(20),
      paymentMethod: 'bank_transfer',
      materialsCost: 340,
    },
    {
      stage: 'Paid',
      customer: 'Emma Clarke',
      name: 'Extractor fan install',
      amount: 380,
      phone: '07700 900888',
      address: '6 Rowan Close, Perivale, London',
      date: dateStrDaysAgo(6),
      quoteSentAt: isoDaysAgo(7),
      acceptedAt: isoDaysAgo(6),
      invoiceSentAt: isoDaysAgo(6),
      invoiceDueDate: dateStrDaysAhead(1),
      paidDate: dateStrDaysAgo(5),
      paymentMethod: 'cash',
      materialsCost: 95,
    },
  ];
}

/**
 * Builds the jobMeta patch for one spec, layering stage-specific fields on
 * top of the canonical stagePatch(). Mirrors exactly what moveToStage() in
 * WorkScreen does for a real job — the only difference is we also backfill
 * the history fields (quoteSentAt, acceptedAt, invoiceSentAt…) a real trader
 * would have accumulated over several real actions.
 *
 * `claimInvoiceNumber` is injected so the caller can thread a single running
 * pool of existing invoice numbers (own jobs + already-created sample jobs)
 * through every job that needs one — avoids colliding with a trader's real
 * JP-XXXX series.
 */
function buildMetaPatch(spec, claimInvoiceNumber) {
  const patch = { ...stagePatch(spec.stage) };

  if (spec.stage === 'Quoted') {
    patch.quoteStatus = 'sent';
    patch.quoteSentAt = spec.quoteSentAt;
    if (spec.depositPercent) {
      patch.deposit_percent = spec.depositPercent;
      patch.deposit_amount_pence = Math.round(spec.amount * 100 * (spec.depositPercent / 100));
      patch.deposit_due_date = spec.depositDueDate;
    }
    return patch;
  }

  // On, Invoiced, Overdue, Paid all imply the quote was accepted first —
  // set acceptedSeenAt alongside acceptedAt so the "just accepted!" banner
  // (acceptedNotification.js) never fires for backfilled history.
  patch.quoteStatus = 'accepted';
  patch.quoteSentAt = spec.quoteSentAt;
  patch.acceptedAt = spec.acceptedAt;
  patch.acceptedSeenAt = spec.acceptedAt;
  patch.acceptedName = spec.customer;

  if (spec.stage === 'On') return patch;

  // Invoiced, Overdue, Paid all have a sent invoice.
  patch.invoiceNumber = claimInvoiceNumber();
  patch.invoiceSentAt = spec.invoiceSentAt;
  patch.invoiceDueDate = spec.invoiceDueDate;

  if (spec.stage === 'Paid') {
    patch.paymentMethod = spec.paymentMethod;
    patch.paymentStatus = 'paid';
    patch.paymentDate = spec.paidDate;
    patch.paidAt = new Date(spec.paidDate + 'T12:00:00').toISOString();
    if (spec.deposit) patch.deposit = spec.deposit;
  }

  return patch;
}

/**
 * Writes a meta patch through the same localStorage-then-cloud path every
 * other job update in the app uses (writeJobMeta → updateJobMetaInCloud →
 * clearPending on confirmed write). Awaited here (unlike the fire-and-forget
 * syncMetaToCloud in AppShell) so the caller can rely on the cloud write
 * having landed before the next refreshFromCloud().
 */
async function patchJobMeta(jobId, patch) {
  const merged = writeJobMeta(jobId, patch) || patch;
  const result = await updateJobMetaInCloud(jobId, merged);
  if (result?.ok) clearPending(jobId, Object.keys(patch));
  return result;
}

/**
 * Seeds a coherent sample day: one job per canonical pipeline stage (three
 * Paid), realistic customers/amounts, a deposit-requested quote, a deposit
 * taken at booking, and a materials receipt on every paid job so the profit
 * math is real (not a hard-coded display number).
 *
 * Idempotent: if sample jobs already exist for this user, does nothing —
 * the calling UI is expected to hide "Load sample data" once loaded, but this
 * guards against a double-tap / race from doing it twice.
 *
 * Never touches profiles — only inserts jobs/receipts.
 *
 * @returns {Promise<{ created: number, alreadyLoaded?: boolean }>}
 */
export async function seedSampleData() {
  const { data: existing, error: existingErr } = await supabase
    .from('jobs')
    .select('id')
    .eq('source', SAMPLE_DATA_SOURCE)
    .limit(1);
  if (existingErr) throw existingErr;
  if (existing && existing.length > 0) {
    return { created: 0, alreadyLoaded: true };
  }

  // Seed the invoice-number pool with the trader's real jobs so sample
  // invoice numbers continue their real JP-XXXX series instead of colliding.
  const ownJobs = await getJobsFromCloud();
  const invoiceNumberPool = [...ownJobs];
  function claimInvoiceNumber() {
    const num = nextInvoiceNumber(invoiceNumberPool);
    invoiceNumberPool.push({ invoiceNumber: num });
    return num;
  }

  const specs = buildSampleJobSpecs();
  const created = [];

  for (const spec of specs) {
    const isPaid = spec.stage === 'Paid';
    const newJob = await addJobToCloud({
      name: spec.name,
      customer: spec.customer,
      amount: spec.amount,
      phone: spec.phone,
      address: spec.address,
      date: spec.date,
      paid: isPaid,
      source: SAMPLE_DATA_SOURCE,
    });

    const patch = buildMetaPatch(spec, claimInvoiceNumber);
    await patchJobMeta(newJob.id, patch);

    // addJobToCloud always stamps payment_date = today for paid-at-creation
    // rows (it's the "mark paid right now" path). Sample data needs a
    // realistic spread of historical dates so the cashflow / margin-trend
    // charts show a trading history, not everything landing on "today".
    // payment_date isn't meta-shadowed (updateJobMetaInCloud doesn't mirror
    // it), so it's patched directly here — the same "mirror column" pattern
    // updateJobMetaInCloud itself uses for customer_name/summary/etc.
    if (isPaid) {
      const { error } = await supabase
        .from('jobs')
        .update({ payment_date: spec.paidDate })
        .eq('id', newJob.id);
      if (error) console.warn('seedSampleData: payment_date backfill failed', newJob.id, error.message);
    }

    // A materials receipt makes the profit math real: getJobProfit() sums
    // receipts linked to the job, it does NOT read a materialsCost meta
    // field. Without a receipt every paid sample job would show 100% margin.
    if (spec.materialsCost) {
      await addReceiptToCloud({
        jobId: newJob.id,
        label: 'Materials',
        amount: spec.materialsCost,
        date: spec.date,
      });
    }

    created.push(newJob);
  }

  return { created: created.length };
}

/**
 * Removes every sample-tagged job (and, via deleteJobWithData's existing
 * cascade, their linked receipts + any photo storage objects) — nothing
 * without `source === 'Sample data'` is touched, so real jobs and the
 * business profile are never at risk.
 *
 * @returns {Promise<{ removed: number }>}
 */
export async function clearSampleData() {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, meta')
    .eq('source', SAMPLE_DATA_SOURCE);
  if (error) throw error;

  const rows = data || [];
  for (const row of rows) {
    await deleteJobWithData({ id: row.id, meta: row.meta });
  }

  return { removed: rows.length };
}
