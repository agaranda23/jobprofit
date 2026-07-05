/**
 * commsLog.js — Capture Layer, Slice A.
 *
 * Auto-logs "touches" with a customer (call/whatsapp/sms tapped, review
 * link sent) onto job.commsLog[] so every contact lives on the Customer
 * Timeline (customerTimeline.js) — not just the things the trader
 * remembers to type a note about.
 *
 * Model (founder-locked): auto-log-on-tap, no confirm. Copy on the
 * timeline is soft-true — "Called Dave" — because tapping Call is treated
 * as intent-to-contact, not proof the call connected.
 *
 * No new storage: commsLog rides the existing jobMeta.js JSONB side-channel
 * (add to META_FIELDS there), so it's cloud-synced + offline-safe the same
 * way jobNotes already is.
 */

const DEDUP_WINDOW_MS = 90 * 1000; // swallows a rage double-tap on the same chip

/**
 * True when the LAST entry in commsLog is the same `type` and landed within
 * DEDUP_WINDOW_MS of `now`. Only the most recent entry is checked (not any
 * same-type entry in history) — a call, then a WhatsApp, then a second call
 * seconds later is 3 real touches; two taps on the same Call button a
 * second apart is 1.
 */
export function shouldDedupComms(commsLog, type, now = Date.now()) {
  const list = commsLog || [];
  const last = list[list.length - 1];
  if (!last || last.type !== type) return false;
  const lastTs = new Date(last.date).getTime();
  if (Number.isNaN(lastTs)) return false;
  return (now - lastTs) < DEDUP_WINDOW_MS;
}

/** Builds a new commsLog entry. Exported so tests can assert its shape. */
export function buildCommsEntry(type, now = Date.now()) {
  return { id: `C-${now}`, type, date: new Date(now).toISOString() };
}

/**
 * Appends a comms touch to job.commsLog[] and writes through onUpdateJob,
 * mirroring handleSubmitNote (JobDetailDrawer.jsx). No-ops — does not call
 * onUpdateJob — when the 90s dedup guard swallows a repeat tap, or when
 * job/type/onUpdateJob is missing.
 */
export function logComms(job, type, onUpdateJob) {
  if (!job || !type || !onUpdateJob) return;
  const commsLog = job.commsLog || [];
  if (shouldDedupComms(commsLog, type)) return;
  onUpdateJob({ ...job, commsLog: [...commsLog, buildCommsEntry(type)] });
}

/** Pure filter — removes one entry by id. Mirrors the note-delete filter
 *  (JobDetailDrawer.jsx handleDeleteNote). */
export function filterCommsLog(commsLog, commsId) {
  return (commsLog || []).filter(c => c.id !== commsId);
}

/**
 * Removes one commsLog entry by id from `job` and writes through
 * onUpdateJob. Used by the timeline's long-press-to-delete action, for the
 * rare phantom touch (e.g. a chip mis-tap).
 */
export function removeComms(job, commsId, onUpdateJob) {
  if (!job || !onUpdateJob) return;
  onUpdateJob({ ...job, commsLog: filterCommsLog(job.commsLog, commsId) });
}
