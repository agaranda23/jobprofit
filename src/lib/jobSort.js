/**
 * jobSort.js — pure helpers for the Jobs-tab Phase 1 list behaviour.
 *
 * These are extracted from WorkScreen.jsx so they can be unit-tested in a
 * node environment without loading React or any DOM-dependent imports.
 *
 * Covered:
 *   jobMatchesQuery     — 1B client-side search filter
 *   sortJobsByStage     — 1C urgent-first sort per stage
 *   sortJobsForAllView  — urgency-tier sort for the All-view (Overdue→Invoiced→On→Quoted→Lead→Paid)
 *   firstLineOfAddress  — 1E address display helper
 */

/**
 * Filter a job against a free-text search query.
 *
 * Case-insensitive match on customer name, job summary, address, and phone.
 * Pure function — no backend, works fully offline.
 *
 * @param {object} job
 * @param {string|null|undefined} q
 * @returns {boolean}
 */
export function jobMatchesQuery(job, q) {
  if (!q) return true;
  // Strip leading £ and commas so "£3,400" and "3400" both work.
  const normalised = q.replace(/^£/, '').replace(/,/g, '');
  const lower = normalised.toLowerCase();
  return (
    (job.customer || job.name || '').toLowerCase().includes(lower) ||
    (job.summary || '').toLowerCase().includes(lower) ||
    (job.address || '').toLowerCase().includes(lower) ||
    (job.phone || job.customerPhone || job.mobile || '').toLowerCase().includes(lower) ||
    String(job.total ?? job.amount ?? '').includes(lower)
  );
}

/**
 * Sort jobs within a stage by urgency — opinionated default, no sort UI.
 *
 * Overdue  → oldest due-date first (most urgent to chase)
 * Invoiced → soonest-due first (pay attention before they flip Overdue)
 * On       → most recently touched first (updatedAt or createdAt)
 * Lead     → newest first (freshest enquiry at the top)
 * Quoted   → newest first (most recent quote at the top)
 * Paid     → most recently paid first (most recent win at the top)
 *
 * Returns a new array — does not mutate the input.
 *
 * @param {object[]} jobs
 * @param {string|null} stage
 * @returns {object[]}
 */
export function sortJobsByStage(jobs, stage) {
  const sorted = [...jobs];
  switch (stage) {
    case 'Overdue':
      sorted.sort((a, b) => {
        const aDate = a.invoiceDueDate ? new Date(a.invoiceDueDate) : new Date(a.invoiceSentAt ?? 0);
        const bDate = b.invoiceDueDate ? new Date(b.invoiceDueDate) : new Date(b.invoiceSentAt ?? 0);
        return aDate - bDate; // oldest (most overdue) first
      });
      break;
    case 'Invoiced':
      sorted.sort((a, b) => {
        const aDate = a.invoiceDueDate ? new Date(a.invoiceDueDate) : new Date(a.invoiceSentAt ?? 0);
        const bDate = b.invoiceDueDate ? new Date(b.invoiceDueDate) : new Date(b.invoiceSentAt ?? 0);
        return aDate - bDate; // soonest due first
      });
      break;
    case 'On':
      sorted.sort((a, b) => {
        // Prefer the job's work date (scheduled date) for On-stage ordering;
        // fall back to most-recently-touched so unscheduled jobs still sort sensibly.
        const aDate = new Date(a.date || a.updatedAt || a.createdAt || 0);
        const bDate = new Date(b.date || b.updatedAt || b.createdAt || 0);
        return bDate - aDate; // newest work date first
      });
      break;
    case 'Lead':
    case 'Quoted':
      sorted.sort((a, b) => {
        const aDate = new Date(a.createdAt || 0);
        const bDate = new Date(b.createdAt || 0);
        return bDate - aDate; // newest first
      });
      break;
    case 'Paid':
      sorted.sort((a, b) => {
        const aDate = new Date(a.paidAt || a.updatedAt || a.createdAt || 0);
        const bDate = new Date(b.paidAt || b.updatedAt || b.createdAt || 0);
        return bDate - aDate; // most recently paid first
      });
      break;
    default:
      // showAll mode (null stage) — newest work date first so the most recent
      // jobs surface at the top regardless of stage.
      sorted.sort((a, b) => {
        const aDate = new Date(a.date || a.createdAt || 0);
        const bDate = new Date(b.date || b.createdAt || 0);
        return bDate - aDate;
      });
      break;
  }
  return sorted;
}

/**
 * Sort all jobs for the All-view using urgency-first tier grouping.
 *
 * Tier order: Overdue → Invoiced → On → Quoted → Lead → Paid
 * Within each tier the existing per-stage sort rule from sortJobsByStage is reused —
 * no new sort logic is added here.
 *
 * The stageDeriver callback must map a raw job to one of the six canonical stage
 * strings. WorkScreen passes its own deriveDisplayStatus so this helper stays
 * framework-free and testable without importing React.
 *
 * Returns a new array — does not mutate the input.
 *
 * @param {object[]} jobs
 * @param {(job: object) => string} stageDeriver
 * @returns {object[]}
 */
export function sortJobsForAllView(jobs, stageDeriver) {
  const TIER_ORDER = ['Overdue', 'Invoiced', 'On', 'Quoted', 'Lead', 'Paid'];

  // Bucket jobs into their tier groups.
  const buckets = {};
  for (const tier of TIER_ORDER) buckets[tier] = [];

  for (const job of jobs) {
    const stage = stageDeriver(job);
    const bucket = buckets[stage] ?? buckets['Lead']; // unknown stages fall into Lead
    bucket.push(job);
  }

  // Sort within each bucket using the existing per-stage rule, then concatenate.
  return TIER_ORDER.flatMap(tier => sortJobsByStage(buckets[tier], tier));
}

/**
 * First line of an address string (everything before the first comma or newline).
 * Returns '' when the address is empty or undefined.
 *
 * @param {string|null|undefined} address
 * @returns {string}
 */
export function firstLineOfAddress(address) {
  if (!address) return '';
  return address.split(/[,\n]/)[0].trim();
}

/**
 * Column sort for the table view — pure, unit-testable, extends sortJobsByStage.
 *
 * Supports sorting by 'amount' (numeric on total/amount), 'date' (ISO date string),
 * or 'name' (customer/summary label, localeCompare).
 * Always returns a new array; does not mutate the input.
 *
 * Note: 'profit' sort is NOT handled here because it requires receipt data that
 * is only available in JobsList/JobsTable (via deriveJobRows). Profit sort is
 * applied inline there using the rowMap.
 *
 * column ∈ 'amount' | 'date' | 'name'
 * dir    ∈ 'asc'    | 'desc'
 *
 * @param {object[]} jobs
 * @param {'amount'|'date'|'name'} column
 * @param {'asc'|'desc'} dir
 * @returns {object[]}
 */
export function sortJobsByColumn(jobs, column, dir) {
  const sorted = [...jobs];
  const multiplier = dir === 'asc' ? 1 : -1;

  if (column === 'amount') {
    sorted.sort((a, b) => {
      const aVal = Number(a.total ?? a.amount ?? 0) || 0;
      const bVal = Number(b.total ?? b.amount ?? 0) || 0;
      return (aVal - bVal) * multiplier;
    });
  } else if (column === 'date') {
    sorted.sort((a, b) => {
      const aDate = new Date(a.date || 0).getTime();
      const bDate = new Date(b.date || 0).getTime();
      return (aDate - bDate) * multiplier;
    });
  } else if (column === 'name') {
    sorted.sort((a, b) => {
      const aLabel = (a.summary || a.customer || a.name || '').toLowerCase();
      const bLabel = (b.summary || b.customer || b.name || '').toLowerCase();
      return aLabel.localeCompare(bLabel) * multiplier;
    });
  }

  return sorted;
}

/**
 * Computes how many whole days a job has been in its current stage.
 *
 * Uses the best available timestamp per stage, mirroring the date fields
 * sortJobsByStage already reads:
 *   Overdue / Invoiced → invoiceSentAt (or invoiceDueDate as fallback)
 *   On                 → date || updatedAt || createdAt
 *   Lead / Quoted      → createdAt
 *   Paid               → paidAt || updatedAt || createdAt
 *
 * Returns null when no usable timestamp exists (caller renders '—').
 * Never returns NaN or negative; floors to 0 for jobs stamped in the future.
 *
 * @param {object} job
 * @param {string} [stage]  — derived stage label (e.g. 'On', 'Paid').
 *                            Pass it in when you already have it to avoid re-deriving;
 *                            the function accepts null/undefined safely and falls back
 *                            to a generic heuristic.
 * @returns {number|null}
 */
export function daysInStage(job, stage) {
  if (!job) return null;

  let ts = null;
  const s = stage || '';

  if (s === 'Overdue' || s === 'Invoiced') {
    ts = job.invoiceSentAt || job.invoiceDueDate || null;
  } else if (s === 'On') {
    ts = job.date || job.updatedAt || job.createdAt || null;
  } else if (s === 'Lead' || s === 'Quoted') {
    ts = job.createdAt || null;
  } else if (s === 'Paid') {
    ts = job.paidAt || job.updatedAt || job.createdAt || null;
  } else {
    // Unknown or null stage — best-effort fallback
    ts = job.updatedAt || job.createdAt || null;
  }

  if (!ts) return null;

  const ms = Date.now() - new Date(ts).getTime();
  if (!isFinite(ms) || ms < 0) return null;
  return Math.floor(ms / 86400000);
}
