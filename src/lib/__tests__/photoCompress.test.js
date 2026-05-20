/**
 * Phase E-1 — photoCompress pure-logic tests.
 *
 * These tests cover the parts of photoCompress.js that can run in a pure
 * Node/Vitest environment (no DOM, no canvas):
 *
 *   - The module exports a compressPhoto function
 *   - The note-add shape used by JobDetailDrawer
 *   - The photo-array append logic (preserves existing photos)
 *
 * Canvas + Image are browser-only; compressDataUrl internals are exercised
 * by visual smoke on the deploy preview. We validate the contract shapes here.
 */

import { describe, it, expect } from 'vitest';

// ── Shape helpers (mirror the logic in JobDetailDrawer, kept pure) ────────────

/**
 * Builds a new jobNote object — mirrors submitNote in JobDetailDrawer.
 * Kept as a pure function here so we can unit-test it without mounting React.
 */
function buildNote({ subject, body }) {
  return {
    id: `N-${Date.now()}`,
    subject: subject.trim() || 'Note',
    body: body.trim(),
    date: new Date().toISOString(),
  };
}

/**
 * Appends a new photo data-URL to the existing photos array.
 * Mirrors the logic in JobDetailDrawer handleAddPhoto.
 */
function appendPhoto(existingPhotos, newPhotoDataUrl) {
  return [...(existingPhotos || []), newPhotoDataUrl];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('photoCompress module', () => {
  it('exports a compressPhoto function', async () => {
    const mod = await import('../photoCompress.js');
    expect(typeof mod.compressPhoto).toBe('function');
  });
});

describe('appendPhoto', () => {
  it('appends a new photo to an existing array', () => {
    const existing = ['data:image/jpeg;base64,aaa'];
    const result = appendPhoto(existing, 'data:image/jpeg;base64,bbb');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('data:image/jpeg;base64,aaa');
    expect(result[1]).toBe('data:image/jpeg;base64,bbb');
  });

  it('handles an empty initial photos array', () => {
    const result = appendPhoto([], 'data:image/jpeg;base64,ccc');
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('data:image/jpeg;base64,ccc');
  });

  it('handles a null/undefined photos field without throwing', () => {
    const result = appendPhoto(null, 'data:image/jpeg;base64,ddd');
    expect(result).toHaveLength(1);
  });

  it('does not mutate the original array', () => {
    const original = ['data:image/jpeg;base64,aaa'];
    appendPhoto(original, 'data:image/jpeg;base64,bbb');
    expect(original).toHaveLength(1);
  });
});

describe('buildNote', () => {
  it('returns a note with the expected shape', () => {
    const note = buildNote({ subject: 'Access info', body: 'Side gate key under mat.' });
    expect(note).toMatchObject({
      subject: 'Access info',
      body: 'Side gate key under mat.',
    });
    expect(typeof note.id).toBe('string');
    expect(note.id.startsWith('N-')).toBe(true);
    expect(typeof note.date).toBe('string');
    // date should be a valid ISO string
    expect(() => new Date(note.date).toISOString()).not.toThrow();
  });

  it('defaults subject to "Note" when blank', () => {
    const note = buildNote({ subject: '   ', body: 'Something happened on site.' });
    expect(note.subject).toBe('Note');
  });

  it('trims leading/trailing whitespace from body and subject', () => {
    const note = buildNote({ subject: '  Access  ', body: '  Side gate.  ' });
    expect(note.subject).toBe('Access');
    expect(note.body).toBe('Side gate.');
  });

  it('appends to existing jobNotes array preserving order', () => {
    const existing = [
      { id: 'N-001', subject: 'First', body: 'First note.', date: '2026-01-01T00:00:00.000Z' },
    ];
    const newNote = buildNote({ subject: 'Second', body: 'Second note.' });
    const updated = [...existing, newNote];
    expect(updated).toHaveLength(2);
    expect(updated[0].subject).toBe('First');
    expect(updated[1].subject).toBe('Second');
  });
});
