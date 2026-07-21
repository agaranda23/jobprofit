/**
 * Archived Jobs view — pure logic (feat/archived-jobs-view).
 *
 * Kept separate from WorkScreen.jsx so the load-bearing bits (the archived
 * predicate, sort order, restore payload, and relative-time formatting) are
 * CI-testable without mounting the screen. See src/lib/__tests__/archivedJobs.test.js.
 */

/** True when a job is archived and not (also) hard-deleted. */
export function isArchived(job) {
  return !!(job?.archived || job?.meta?.archived) && !job?.deleted && !job?.meta?.deleted;
}

/** Timestamp used for sorting; legacy/missing meta.archivedAt sorts last (0). */
function archivedTs(job) {
  const t = job?.meta?.archivedAt;
  const n = t ? new Date(t).getTime() : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Archived jobs, newest-archived first. Legacy/missing archivedAt sorts last. */
export function selectArchivedJobs(jobs = []) {
  return jobs.filter(isArchived).sort((a, b) => archivedTs(b) - archivedTs(a));
}

/**
 * Restore payload — clears archived + meta.archived, keeps meta.archivedAt
 * (audit trail), stamps meta.unarchivedAt. Deliberately does NOT touch
 * job.status: archive never changed it, so the job re-derives to its
 * original stage automatically via deriveDisplayStatus.
 */
export function applyRestore(job, now = new Date()) {
  if (!job) return job;
  return {
    ...job,
    archived: false,
    meta: { ...(job.meta || {}), archived: false, unarchivedAt: now.toISOString() },
  };
}

/**
 * Relative "time ago" for the archived-tile sub-line. Returns null when the
 * timestamp is missing/invalid (legacy jobs archived before meta.archivedAt
 * existed) — callers fall back to a plain "{stage} · Archived" label.
 * Absolute fallback (e.g. "on 3 Jul") kicks in past ~4 weeks.
 */
export function formatArchivedAgo(iso, now = new Date()) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const s = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  if (d < 35) {
    const w = Math.floor(d / 7);
    return `${w} ${w === 1 ? 'week' : 'weeks'} ago`;
  }
  const dt = new Date(then);
  const day = dt.getDate();
  const mon = dt.toLocaleString('en-GB', { month: 'short' });
  return dt.getFullYear() === now.getFullYear() ? `on ${day} ${mon}` : `on ${day} ${mon} ${dt.getFullYear()}`;
}
