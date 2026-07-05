/**
 * voiceNotes.test.js — Capture Layer, Slice B.
 *
 * Pure-function tests, mirroring commsLog.test.js: appendVoiceNote's only
 * side effect is calling the onUpdateJob callback it's given, so these
 * tests spy on that callback rather than touching localStorage/Supabase.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildVoiceNote, appendVoiceNote } from '../voiceNotes';

describe('buildVoiceNote', () => {
  it('builds { id, subject, body, date, source } from a transcript', () => {
    const note = buildVoiceNote('Dave wants the render done first', 1_000_000);
    expect(note).toEqual({
      id: 'N-1000000',
      subject: 'Voice note',
      body: 'Dave wants the render done first',
      date: new Date(1_000_000).toISOString(),
      source: 'voice',
    });
  });

  it('trims the transcript', () => {
    const note = buildVoiceNote('  spaced out  ', 1_000_000);
    expect(note.body).toBe('spaced out');
  });
});

describe('appendVoiceNote', () => {
  it('appends a new voice note via onUpdateJob for a job with no jobNotes yet', () => {
    const job = { id: 'j1', customer: 'Dave' };
    const onUpdateJob = vi.fn();
    const saved = appendVoiceNote(job, 'key is under the mat', onUpdateJob);

    expect(saved).toBe(true);
    expect(onUpdateJob).toHaveBeenCalledTimes(1);
    const updated = onUpdateJob.mock.calls[0][0];
    expect(updated.jobNotes).toHaveLength(1);
    expect(updated.jobNotes[0]).toMatchObject({
      subject: 'Voice note',
      body: 'key is under the mat',
      source: 'voice',
    });
    expect(updated.jobNotes[0].id).toMatch(/^N-\d+$/);
    expect(updated.jobNotes[0].date).toBeTruthy();
  });

  it('appends onto an existing jobNotes array without mutating the original', () => {
    const existing = [{ id: 'N-1', subject: 'Note', body: 'Typed earlier', date: '2026-07-01T09:00:00Z' }];
    const job = { id: 'j1', jobNotes: existing };
    const onUpdateJob = vi.fn();
    appendVoiceNote(job, 'a new voice note', onUpdateJob);

    const updated = onUpdateJob.mock.calls[0][0];
    expect(updated.jobNotes).toHaveLength(2);
    expect(updated.jobNotes[0]).toBe(existing[0]);
    expect(updated.jobNotes[1].source).toBe('voice');
    expect(existing).toHaveLength(1); // original untouched
  });

  it('does NOT save — and returns false — for an empty transcript', () => {
    const job = { id: 'j1' };
    const onUpdateJob = vi.fn();
    expect(appendVoiceNote(job, '', onUpdateJob)).toBe(false);
    expect(appendVoiceNote(job, '   ', onUpdateJob)).toBe(false);
    expect(appendVoiceNote(job, null, onUpdateJob)).toBe(false);
    expect(onUpdateJob).not.toHaveBeenCalled();
  });

  it('no-ops when job or onUpdateJob is missing', () => {
    const onUpdateJob = vi.fn();
    expect(appendVoiceNote(null, 'hello', onUpdateJob)).toBe(false);
    expect(appendVoiceNote({ id: 'j1' }, 'hello', null)).toBe(false);
    expect(onUpdateJob).not.toHaveBeenCalled();
  });
});
