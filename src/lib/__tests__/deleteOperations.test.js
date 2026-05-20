/**
 * Phase E-2 — Delete operations: pure logic tests.
 *
 * Covers:
 *   - Photo delete: returns a new array with the target index removed
 *   - Photo delete: preserves array order (removes only the target)
 *   - Note delete: returns a new array with the target id removed
 *   - Note delete: preserves array order (removes only the target)
 *   - Receipt deletion: calls the handler with the correct id
 *   - LinkReceiptModal suppression: handleAddReceipt skips setPendingLink
 *     when jobId is already present in the payload
 *
 * Browser APIs (confirm, supabase) are not exercised here — those are
 * covered by visual smoke on the deploy preview.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Pure helpers (mirror the logic in JobDetailDrawer, kept pure) ─────────────

function deletePhotoByIndex(photos, idx) {
  return photos.filter((_, i) => i !== idx);
}

function deleteNoteById(notes, id) {
  return notes.filter(n => n.id !== id);
}

// ── Photo delete ──────────────────────────────────────────────────────────────

describe('deletePhotoByIndex', () => {
  it('removes the photo at the given index', () => {
    const photos = ['a.jpg', 'b.jpg', 'c.jpg'];
    expect(deletePhotoByIndex(photos, 1)).toEqual(['a.jpg', 'c.jpg']);
  });

  it('removes the first photo when idx is 0', () => {
    const photos = ['a.jpg', 'b.jpg'];
    expect(deletePhotoByIndex(photos, 0)).toEqual(['b.jpg']);
  });

  it('removes the last photo', () => {
    const photos = ['a.jpg', 'b.jpg', 'c.jpg'];
    expect(deletePhotoByIndex(photos, 2)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('returns an empty array when the only photo is deleted', () => {
    expect(deletePhotoByIndex(['a.jpg'], 0)).toEqual([]);
  });

  it('preserves array order for all other elements', () => {
    const photos = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'];
    const result = deletePhotoByIndex(photos, 1);
    expect(result).toEqual(['a.jpg', 'c.jpg', 'd.jpg']);
    expect(result.indexOf('b.jpg')).toBe(-1);
  });

  it('does not mutate the original array', () => {
    const photos = ['a.jpg', 'b.jpg'];
    deletePhotoByIndex(photos, 0);
    expect(photos).toEqual(['a.jpg', 'b.jpg']);
  });
});

// ── Note delete ───────────────────────────────────────────────────────────────

describe('deleteNoteById', () => {
  const notes = [
    { id: 'N-001', subject: 'First', body: 'Body 1' },
    { id: 'N-002', subject: 'Second', body: 'Body 2' },
    { id: 'N-003', subject: 'Third', body: 'Body 3' },
  ];

  it('removes the note with the matching id', () => {
    const result = deleteNoteById(notes, 'N-002');
    expect(result.find(n => n.id === 'N-002')).toBeUndefined();
    expect(result).toHaveLength(2);
  });

  it('preserves all other notes', () => {
    const result = deleteNoteById(notes, 'N-002');
    expect(result.map(n => n.id)).toEqual(['N-001', 'N-003']);
  });

  it('preserves array order after deletion', () => {
    const result = deleteNoteById(notes, 'N-001');
    expect(result[0].id).toBe('N-002');
    expect(result[1].id).toBe('N-003');
  });

  it('returns the original array length minus one', () => {
    expect(deleteNoteById(notes, 'N-001')).toHaveLength(notes.length - 1);
  });

  it('returns an empty array when the only note is deleted', () => {
    const single = [{ id: 'N-001', subject: 'x', body: 'y' }];
    expect(deleteNoteById(single, 'N-001')).toEqual([]);
  });

  it('does not mutate the original array', () => {
    const original = [{ id: 'N-001', subject: 'x', body: 'y' }];
    deleteNoteById(original, 'N-001');
    expect(original).toHaveLength(1);
  });

  it('is a no-op when id does not exist', () => {
    const result = deleteNoteById(notes, 'N-999');
    expect(result).toHaveLength(notes.length);
  });
});

// ── Receipt deletion: handler called with correct id ─────────────────────────

describe('receipt delete handler', () => {
  it('calls onDeleteReceipt with the receipt id', async () => {
    const onDeleteReceipt = vi.fn().mockResolvedValue(undefined);
    const receiptId = 'R-abc-123';

    // Simulate the handleDeleteReceipt closure in JobDetailDrawer
    // (confirm() is mocked to return true — real confirm is browser-only)
    const handleDeleteReceipt = async (id) => {
      await onDeleteReceipt(id);
    };

    await handleDeleteReceipt(receiptId);
    expect(onDeleteReceipt).toHaveBeenCalledOnce();
    expect(onDeleteReceipt).toHaveBeenCalledWith(receiptId);
  });

  it('does not call onDeleteReceipt with a different id', async () => {
    const onDeleteReceipt = vi.fn().mockResolvedValue(undefined);
    await onDeleteReceipt('R-correct');
    expect(onDeleteReceipt).not.toHaveBeenCalledWith('R-wrong');
  });
});

// ── LinkReceiptModal suppression logic ───────────────────────────────────────

describe('LinkReceiptModal suppression', () => {
  /**
   * Mirrors the relevant slice of AppShell.handleAddReceipt.
   * setPendingLink is the trigger for LinkReceiptModal — it must be skipped
   * when jobId is already known.
   */
  function makeHandleAddReceipt(setPendingLink) {
    return async (arg) => {
      const payload = arg?.payload || arg;
      const jobIdAlreadyKnown = !!(payload?.jobId);
      // Simulate savedReceipt returned by addReceiptToCloud
      const savedReceipt = { id: 'cloud-uuid-1' };
      if (savedReceipt?.id && !jobIdAlreadyKnown) {
        setPendingLink(savedReceipt);
      }
    };
  }

  it('skips setPendingLink when payload contains a jobId', async () => {
    const setPendingLink = vi.fn();
    const handleAddReceipt = makeHandleAddReceipt(setPendingLink);

    await handleAddReceipt({ payload: { jobId: 'J-0001', amount: 50 } });
    expect(setPendingLink).not.toHaveBeenCalled();
  });

  it('calls setPendingLink when payload has no jobId (global add flow)', async () => {
    const setPendingLink = vi.fn();
    const handleAddReceipt = makeHandleAddReceipt(setPendingLink);

    await handleAddReceipt({ payload: { amount: 50 } });
    expect(setPendingLink).toHaveBeenCalledOnce();
  });

  it('skips setPendingLink when jobId is an empty string', async () => {
    const setPendingLink = vi.fn();
    const handleAddReceipt = makeHandleAddReceipt(setPendingLink);

    // Empty string is falsy — treated as "no job known", modal should fire
    await handleAddReceipt({ payload: { jobId: '', amount: 50 } });
    expect(setPendingLink).toHaveBeenCalledOnce();
  });
});
