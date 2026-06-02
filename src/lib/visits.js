/**
 * visits.js — multi-visit schedule helpers.
 *
 * Data model:
 *   Visit { id, date, start?, end?, status, note? }
 *   status: 'planned' | 'done' | 'cancelled'
 *
 * Reader: always returns Visit[] so downstream UI never sees the legacy shape.
 * Writer: returns a Partial<Job> patch to apply — does NOT delete legacy fields
 *         (kept for backwards-compat with older clients).
 */

/**
 * Compute the display status of a visit, overriding 'planned' based on date.
 * 'done' and 'cancelled' are always returned as-is.
 */
export function computeVisitStatus(visit) {
  if (visit.status === 'done' || visit.status === 'cancelled') return visit.status;
  const today = new Date();
  const todayStr = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
  if (!visit.date) return 'planned';
  if (visit.date === todayStr) return 'today';
  if (visit.date < todayStr) return 'missed';
  return 'planned';
}

/**
 * readVisits(job) → Visit[]
 *
 * Priority: job.visits (non-empty) > legacy scheduledDate > empty array.
 * Downstream UI must ALWAYS go through this function.
 */
export function readVisits(job) {
  if (!job) return [];

  if (Array.isArray(job.visits) && job.visits.length > 0) {
    return job.visits;
  }

  if (job.scheduledDate) {
    return [
      {
        id: 'legacy-0',
        date: job.scheduledDate,
        start: job.scheduledStart || undefined,
        end: job.scheduledEnd || undefined,
        status: 'planned',
        note: undefined,
      },
    ];
  }

  return [];
}

/**
 * writeVisits(job, visits) → Partial<Job>
 *
 * Returns the patch object to spread onto the job update call.
 * Preserves legacy scheduledDate fields so old clients keep reading correctly.
 */
export function writeVisits(job, visits) {
  const sorted = [...visits].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });

  // Keep legacy fields pointing to the first visit's date/time so Calendar tab
  // (which hasn't been updated yet) continues to work.
  const first = sorted[0];
  const legacyPatch = first
    ? {
        scheduledDate: first.date || null,
        scheduledStart: first.start || null,
        scheduledEnd: first.end || null,
      }
    : {
        scheduledDate: null,
        scheduledStart: null,
        scheduledEnd: null,
      };

  return {
    ...legacyPatch,
    visits: sorted,
  };
}

/**
 * generateVisitId() — tiny collision-safe ID without a library dep.
 */
export function generateVisitId() {
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * getScheduleMeta(visits) — the collapsed-card meta string.
 * Mirrors the spec:
 *   - No visits → 'Not scheduled'
 *   - All done/cancelled → 'All visits done · last {date}'
 *   - One visit (not done) → '{date} · {time}' (backwards-compat format)
 *   - Multi-visit → 'Next: {date} · +N more' or just 'Next: {date}'
 */
export function getScheduleMeta(visits, fmtDate) {
  if (!visits || visits.length === 0) return 'Not scheduled';

  const active = visits.filter(v => v.status !== 'done' && v.status !== 'cancelled');

  if (active.length === 0) {
    const last = visits[visits.length - 1];
    return `All visits done · last ${fmtDate(last.date)}`;
  }

  if (visits.length === 1) {
    const v = visits[0];
    const time = v.start && v.end ? ` · ${v.start}–${v.end}` : v.start ? ` · ${v.start}` : '';
    return `${fmtDate(v.date)}${time}`;
  }

  // Sort active by date to find the next upcoming
  const sorted = [...active].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const next = sorted[0];
  const remaining = active.length - 1;
  return remaining > 0
    ? `Next: ${fmtDate(next.date)} · +${remaining} more`
    : `Next: ${fmtDate(next.date)}`;
}

/**
 * isLastPlannedVisit(visits, visitId)
 * Returns true when marking visitId done would leave no more planned visits.
 */
export function isLastPlannedVisit(visits, visitId) {
  const remainingPlanned = visits.filter(
    v => v.id !== visitId && v.status !== 'done' && v.status !== 'cancelled',
  );
  return remainingPlanned.length === 0;
}

/**
 * tomorrowDateString() — YYYY-MM-DD string for tomorrow.
 */
export function tomorrowDateString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}
