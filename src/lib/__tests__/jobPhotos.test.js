/**
 * jobPhotos.test.js — pure-logic tests for photo-entry helpers.
 *
 * Covers: isLegacyPhoto, makePhotoEntry, getCaption, setCaption,
 *         reorderPhotos, canHaveCaption.
 *
 * No DOM, no Supabase — pure unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  isLegacyPhoto,
  makePhotoEntry,
  getCaption,
  setCaption,
  reorderPhotos,
  canHaveCaption,
} from '../jobPhotos.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const LEGACY = 'data:image/jpeg;base64,/9j/abc123';
const NEW_ENTRY = { path: 'uid/job1/ts-photo.jpg', uploadedAt: '2026-05-31T10:00:00.000Z' };
const CAPTIONED = { path: 'uid/job1/ts-photo.jpg', uploadedAt: '2026-05-31T10:00:00.000Z', caption: 'Before work' };

// ── isLegacyPhoto ─────────────────────────────────────────────────────────────

describe('isLegacyPhoto', () => {
  it('returns true for a base64 data-URL string', () => {
    expect(isLegacyPhoto(LEGACY)).toBe(true);
  });

  it('returns false for a new-format { path, uploadedAt } object', () => {
    expect(isLegacyPhoto(NEW_ENTRY)).toBe(false);
  });

  it('returns false for a captioned entry (also an object)', () => {
    expect(isLegacyPhoto(CAPTIONED)).toBe(false);
  });
});

// ── makePhotoEntry ────────────────────────────────────────────────────────────

describe('makePhotoEntry', () => {
  it('returns an object with path and uploadedAt', () => {
    const entry = makePhotoEntry('uid/job1/ts-photo.jpg');
    expect(entry.path).toBe('uid/job1/ts-photo.jpg');
    expect(typeof entry.uploadedAt).toBe('string');
    expect(() => new Date(entry.uploadedAt).toISOString()).not.toThrow();
  });

  it('does NOT include caption when none is provided', () => {
    const entry = makePhotoEntry('uid/job1/ts-photo.jpg');
    expect('caption' in entry).toBe(false);
  });

  it('includes caption when a non-empty caption is provided', () => {
    const entry = makePhotoEntry('uid/job1/ts-photo.jpg', 'Damp patch on wall');
    expect(entry.caption).toBe('Damp patch on wall');
  });

  it('trims whitespace from the caption', () => {
    const entry = makePhotoEntry('uid/job1/ts-photo.jpg', '  Damp patch  ');
    expect(entry.caption).toBe('Damp patch');
  });

  it('omits caption when the caption is blank/whitespace only', () => {
    const entry = makePhotoEntry('uid/job1/ts-photo.jpg', '   ');
    expect('caption' in entry).toBe(false);
  });
});

// ── canHaveCaption ────────────────────────────────────────────────────────────

describe('canHaveCaption', () => {
  it('returns false for a legacy base64 entry', () => {
    expect(canHaveCaption(LEGACY)).toBe(false);
  });

  it('returns true for a new-format object entry', () => {
    expect(canHaveCaption(NEW_ENTRY)).toBe(true);
  });

  it('returns true for an already-captioned entry', () => {
    expect(canHaveCaption(CAPTIONED)).toBe(true);
  });
});

// ── getCaption ────────────────────────────────────────────────────────────────

describe('getCaption', () => {
  it('returns empty string for a legacy entry', () => {
    expect(getCaption(LEGACY)).toBe('');
  });

  it('returns empty string for a new-format entry with no caption', () => {
    expect(getCaption(NEW_ENTRY)).toBe('');
  });

  it('returns the caption string for a captioned entry', () => {
    expect(getCaption(CAPTIONED)).toBe('Before work');
  });
});

// ── setCaption ────────────────────────────────────────────────────────────────

describe('setCaption', () => {
  it('adds a caption to a new-format entry that has none', () => {
    const updated = setCaption(NEW_ENTRY, 'After work');
    expect(updated.caption).toBe('After work');
  });

  it('replaces an existing caption', () => {
    const updated = setCaption(CAPTIONED, 'After work');
    expect(updated.caption).toBe('After work');
  });

  it('removes caption when set to an empty string', () => {
    const updated = setCaption(CAPTIONED, '');
    expect('caption' in updated).toBe(false);
  });

  it('removes caption when set to whitespace only', () => {
    const updated = setCaption(CAPTIONED, '   ');
    expect('caption' in updated).toBe(false);
  });

  it('does not mutate the original entry', () => {
    setCaption(CAPTIONED, 'Changed');
    expect(CAPTIONED.caption).toBe('Before work');
  });

  it('returns the legacy entry unchanged (cannot caption legacy entries)', () => {
    const result = setCaption(LEGACY, 'A caption');
    expect(result).toBe(LEGACY);
  });

  it('preserves all other fields on the entry', () => {
    const updated = setCaption(NEW_ENTRY, 'New caption');
    expect(updated.path).toBe(NEW_ENTRY.path);
    expect(updated.uploadedAt).toBe(NEW_ENTRY.uploadedAt);
  });
});

// ── reorderPhotos ─────────────────────────────────────────────────────────────

describe('reorderPhotos', () => {
  const photos = [
    { path: 'a.jpg', uploadedAt: '2026-05-01T00:00:00.000Z' },
    { path: 'b.jpg', uploadedAt: '2026-05-01T00:00:00.000Z' },
    { path: 'c.jpg', uploadedAt: '2026-05-01T00:00:00.000Z' },
  ];

  it('moves an item forward in the array', () => {
    const result = reorderPhotos(photos, 0, 2);
    expect(result.map(p => p.path)).toEqual(['b.jpg', 'c.jpg', 'a.jpg']);
  });

  it('moves an item backward in the array', () => {
    const result = reorderPhotos(photos, 2, 0);
    expect(result.map(p => p.path)).toEqual(['c.jpg', 'a.jpg', 'b.jpg']);
  });

  it('moves an adjacent item one step forward (up arrow)', () => {
    const result = reorderPhotos(photos, 1, 2);
    expect(result.map(p => p.path)).toEqual(['a.jpg', 'c.jpg', 'b.jpg']);
  });

  it('moves an adjacent item one step backward (down arrow)', () => {
    const result = reorderPhotos(photos, 1, 0);
    expect(result.map(p => p.path)).toEqual(['b.jpg', 'a.jpg', 'c.jpg']);
  });

  it('is a no-op when fromIdx equals toIdx', () => {
    const result = reorderPhotos(photos, 1, 1);
    expect(result.map(p => p.path)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('does not mutate the original array', () => {
    const original = [...photos];
    reorderPhotos(photos, 0, 2);
    expect(photos.map(p => p.path)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(original.map(p => p.path)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('returns array unchanged for out-of-bounds fromIdx', () => {
    const result = reorderPhotos(photos, 5, 0);
    expect(result.map(p => p.path)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('returns array unchanged for out-of-bounds toIdx', () => {
    const result = reorderPhotos(photos, 0, 5);
    expect(result.map(p => p.path)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('returns the array as-is when passed a non-array', () => {
    expect(reorderPhotos(null, 0, 1)).toBeNull();
    expect(reorderPhotos(undefined, 0, 1)).toBeUndefined();
  });

  it('handles a two-photo array correctly', () => {
    const two = [{ path: 'x.jpg' }, { path: 'y.jpg' }];
    expect(reorderPhotos(two, 0, 1).map(p => p.path)).toEqual(['y.jpg', 'x.jpg']);
    expect(reorderPhotos(two, 1, 0).map(p => p.path)).toEqual(['y.jpg', 'x.jpg']);
  });

  it('handles mixed legacy + new-format entries', () => {
    const mixed = [LEGACY, { path: 'b.jpg' }, { path: 'c.jpg' }];
    const result = reorderPhotos(mixed, 0, 2);
    expect(result[0]).toEqual({ path: 'b.jpg' });
    expect(result[2]).toBe(LEGACY);
  });
});

// ── Multi-attach: photo array append (mirrors handlePhotoFiles loop) ──────────

describe('photo array append — multi-file logic', () => {
  function appendEntries(existing, newEntries) {
    return [...(existing || []), ...newEntries];
  }

  it('appends multiple new entries to an existing photos array', () => {
    const existing = [LEGACY];
    const result = appendEntries(existing, [NEW_ENTRY, CAPTIONED]);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(LEGACY);
    expect(result[1]).toBe(NEW_ENTRY);
    expect(result[2]).toBe(CAPTIONED);
  });

  it('handles empty existing array', () => {
    const result = appendEntries([], [NEW_ENTRY]);
    expect(result).toHaveLength(1);
  });

  it('handles null existing array (first photo ever added)', () => {
    const result = appendEntries(null, [NEW_ENTRY, CAPTIONED]);
    expect(result).toHaveLength(2);
  });

  it('does not mutate the original array', () => {
    const original = [LEGACY];
    appendEntries(original, [NEW_ENTRY]);
    expect(original).toHaveLength(1);
  });
});
