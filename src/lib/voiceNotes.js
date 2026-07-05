/**
 * voiceNotes.js — Capture Layer, Slice B.
 *
 * Model (founder-locked): transcript-first, no stored audio. A trade taps
 * the mic in the job drawer's Notes section, speaks, and the transcript
 * from voiceCapture.js is saved as a normal jobNote —
 * { id, subject: 'Voice note', body, date, source: 'voice' } — appended to
 * job.jobNotes[] via the same onUpdateJob path handleSubmitNote
 * (JobDetailDrawer.jsx) already uses. jobNotes is already a whitelisted
 * META_FIELD (jobMeta.js) so no migration is needed — `source` just rides
 * along inside each note object, same JSONB blob.
 *
 * Storing real audio (upload to a Supabase bucket + RLS + playback) is a
 * deferred B2 slice — only build it if users actually ask for the recording
 * itself, not just the words.
 *
 * customerTimeline.js reads `source === 'voice'` to render a mic icon +
 * "Voice note: ..." prefix instead of the default "Note: ...".
 */

/** Builds a new voice-note entry. Exported so tests can assert its shape. */
export function buildVoiceNote(transcript, now = Date.now()) {
  return {
    id: `N-${now}`,
    subject: 'Voice note',
    body: (transcript || '').trim(),
    date: new Date(now).toISOString(),
    source: 'voice',
  };
}

/**
 * Appends a voice note to job.jobNotes[] and writes through onUpdateJob.
 * No-ops — and returns false — when job/onUpdateJob is missing or the
 * transcript is empty/whitespace-only: a recording where the mic caught
 * nothing must never save a blank note. Returns true when a note was saved.
 */
export function appendVoiceNote(job, transcript, onUpdateJob, now = Date.now()) {
  const body = (transcript || '').trim();
  if (!job || !onUpdateJob || !body) return false;
  const note = buildVoiceNote(body, now);
  onUpdateJob({ ...job, jobNotes: [...(job.jobNotes || []), note] });
  return true;
}
