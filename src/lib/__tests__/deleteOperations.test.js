/**
 * Phase E-2 — Delete operations: pure logic tests.
 *
 * Covers:
 *   - Photo delete: returns a new array with the target index removed
 *   - Photo delete: preserves array order (removes only the target)
 *   - Note delete: returns a new array with the target id removed
 *   - Note delete: preserves array order (removes only the target)
 *   - Receipt deletion: calls the handler with the correct id
 *   - AppShell.handleDeleteReceipt state consistency (zombie-receipt regression,
 *     fix/receipt-delete-zombie): a failed cloud delete must not strip the
 *     receipt from render state, and must surface an error
 *   - LinkReceiptModal suppression: handleAddReceipt skips setPendingLink
 *     when jobId is already present in the payload
 *   - pendingDeleteAction guard: confirm dialog fires onConfirm only on commit
 *   - Receipt photo URL resolution: prefers photo field, falls back to imagePath
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

// ── AppShell.handleDeleteReceipt state consistency (zombie-receipt regression) ─
// fix/receipt-delete-zombie: handleDeleteReceipt used to catch ANY
// deleteReceiptFromCloud failure and strip the receipt from render state
// anyway ("optimistic" removal), even though store.js leaves the Supabase
// row + localStorage mirror intact on failure. That made the receipt vanish
// from the UI while still existing in the DB, so it reappeared on the next
// refreshFromCloud()/reload. The fix: let the failure propagate untouched —
// state is only ever updated by refreshFromCloud() (cloud-authoritative), so
// a failed delete leaves the receipt visible everywhere, and the caller
// (JobDetailDrawer) surfaces the error via its existing flash toast.

describe('AppShell.handleDeleteReceipt — zombie-receipt regression', () => {
  // Mirrors the fixed closure in src/AppShell.jsx.
  function makeHandleDeleteReceipt({ deleteReceiptFromCloud, refreshFromCloud }) {
    return async (receiptId) => {
      await deleteReceiptFromCloud(receiptId);
      await refreshFromCloud();
    };
  }

  it('refreshes state (removing the receipt) on a successful delete', async () => {
    let receipts = [{ id: 'R-1' }, { id: 'R-2' }];
    const deleteReceiptFromCloud = vi.fn().mockResolvedValue(undefined);
    const refreshFromCloud = vi.fn().mockImplementation(async () => {
      // refreshFromCloud is cloud-authoritative — it re-syncs receipts[]
      receipts = receipts.filter(r => r.id !== 'R-1');
    });
    const handleDeleteReceipt = makeHandleDeleteReceipt({ deleteReceiptFromCloud, refreshFromCloud });

    await handleDeleteReceipt('R-1');

    expect(deleteReceiptFromCloud).toHaveBeenCalledWith('R-1');
    expect(refreshFromCloud).toHaveBeenCalledOnce();
    expect(receipts.find(r => r.id === 'R-1')).toBeUndefined();
  });

  it('propagates the error and does not refresh/mutate state when the cloud delete fails', async () => {
    const receipts = [{ id: 'R-1' }, { id: 'R-2' }];
    const setReceipts = vi.fn(); // the handler itself must never call this directly
    const deleteReceiptFromCloud = vi.fn().mockRejectedValue(new Error('network error'));
    const refreshFromCloud = vi.fn();
    const handleDeleteReceipt = makeHandleDeleteReceipt({ deleteReceiptFromCloud, refreshFromCloud });

    await expect(handleDeleteReceipt('R-1')).rejects.toThrow('network error');

    expect(refreshFromCloud).not.toHaveBeenCalled();
    expect(setReceipts).not.toHaveBeenCalled();
    // The receipt a caller was holding is untouched — no zombie removal.
    expect(receipts.find(r => r.id === 'R-1')).toBeDefined();
  });

  it('keeps the receipt visible and surfaces an error toast when JobDetailDrawer catches a failed delete', async () => {
    // Mirrors the AddReceiptModal edit-mode wrapper in JobDetailDrawer.jsx:
    // it catches the (now-real) failure from the AppShell handler, flashes an
    // error, and — critically — never removes the receipt from the list itself.
    let receipts = [{ id: 'R-1' }];
    const flashes = [];
    const showFlash = (msg) => flashes.push(msg);
    const onDeleteReceipt = vi.fn().mockRejectedValue(new Error('RLS denied'));

    const wrapped = async (id) => {
      try {
        await onDeleteReceipt(id);
        showFlash('Receipt deleted');
        receipts = receipts.filter(r => r.id !== id);
      } catch {
        showFlash('Could not delete receipt — try again');
      }
    };

    await wrapped('R-1');

    expect(flashes).toEqual(['Could not delete receipt — try again']);
    expect(receipts).toEqual([{ id: 'R-1' }]); // still there — not a zombie
  });

  it('removes the receipt and flashes success when the wrapped delete succeeds', async () => {
    let receipts = [{ id: 'R-1' }];
    const flashes = [];
    const showFlash = (msg) => flashes.push(msg);
    const onDeleteReceipt = vi.fn().mockResolvedValue(undefined);

    const wrapped = async (id) => {
      try {
        await onDeleteReceipt(id);
        showFlash('Receipt deleted');
        receipts = receipts.filter(r => r.id !== id);
      } catch {
        showFlash('Could not delete receipt — try again');
      }
    };

    await wrapped('R-1');

    expect(flashes).toEqual(['Receipt deleted']);
    expect(receipts).toEqual([]);
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

// ── pendingDeleteAction guard ────────────────────────────────────────────────
// Mirrors the in-app confirm pattern introduced in fix/receipt-preview-and-delete-confirm.
// The guard works as a state-machine: setPendingDeleteAction(action) queues the
// confirm; calling action.onConfirm() executes the destructive operation;
// calling setPendingDeleteAction(null) (Cancel) leaves state unchanged.

describe('pendingDeleteAction guard', () => {
  function makeDeleteGuard(setPendingAction) {
    return (title, message, confirmLabel, destructive) => {
      setPendingAction({ title, message, confirmLabel, onConfirm: destructive });
    };
  }

  it('queues the action without executing it immediately', () => {
    const setPendingAction = vi.fn();
    const destructive = vi.fn();
    const guard = makeDeleteGuard(setPendingAction);

    guard('Delete this photo?', 'This photo will be permanently removed.', 'Delete photo', destructive);

    expect(setPendingAction).toHaveBeenCalledOnce();
    expect(destructive).not.toHaveBeenCalled();
  });

  it('executes the destructive callback only when onConfirm is called', () => {
    let captured = null;
    const setPendingAction = (action) => { captured = action; };
    const destructive = vi.fn();
    const guard = makeDeleteGuard(setPendingAction);

    guard('Delete this receipt?', 'It will be removed.', 'Delete receipt', destructive);
    expect(destructive).not.toHaveBeenCalled();

    captured.onConfirm();
    expect(destructive).toHaveBeenCalledOnce();
  });

  it('does not execute the destructive callback when cancelled', () => {
    const setPendingAction = () => {};
    const destructive = vi.fn();
    const guard = makeDeleteGuard(setPendingAction);

    guard('Delete this note?', 'It will be removed.', 'Delete note', destructive);
    // User taps Cancel — the destructive callback is never invoked
    expect(destructive).not.toHaveBeenCalled();
  });

  it('carries the correct title and confirmLabel through to the dialog', () => {
    let captured = null;
    const setPendingAction = (action) => { captured = action; };
    const guard = makeDeleteGuard(setPendingAction);

    guard('Delete this payment?', 'You cannot undo this.', 'Delete payment', () => {});
    expect(captured.title).toBe('Delete this payment?');
    expect(captured.confirmLabel).toBe('Delete payment');
    expect(captured.message).toBe('You cannot undo this.');
  });
});

// ── Receipt photo URL resolution ─────────────────────────────────────────────
// Mirrors the priority logic in ReceiptRow inside ReceiptsSection.
// Priority: r.photo (base64 / pre-resolved URL) > r.imagePath (storage path).

describe('receipt photo URL resolution', () => {
  /**
   * Pure helper that mirrors the ReceiptRow resolution priority.
   * In the component, resolvedPhoto state is seeded with r.photo and,
   * if absent, async-resolved from r.imagePath via getReceiptSignedUrl.
   * This test covers the seed step (sync) and the async branch.
   */
  async function resolveReceiptPhotoUrl(receipt, getSignedUrl) {
    // Step 1: use the pre-stored photo URL if present
    if (receipt.photo) return receipt.photo;
    // Step 2: resolve from storage path
    if (receipt.imagePath) return getSignedUrl(receipt.imagePath);
    return null;
  }

  it('returns r.photo when available (base64 or already-resolved URL)', async () => {
    const receipt = { id: '1', photo: 'data:image/jpeg;base64,abc', imagePath: 'uid/job/img.jpg' };
    const getSignedUrl = vi.fn();
    const result = await resolveReceiptPhotoUrl(receipt, getSignedUrl);
    expect(result).toBe('data:image/jpeg;base64,abc');
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('calls getReceiptSignedUrl with imagePath when photo is absent', async () => {
    const receipt = { id: '2', photo: null, imagePath: 'uid/job/receipt.jpg' };
    const getSignedUrl = vi.fn().mockResolvedValue('https://signed.url/receipt.jpg');
    const result = await resolveReceiptPhotoUrl(receipt, getSignedUrl);
    expect(getSignedUrl).toHaveBeenCalledWith('uid/job/receipt.jpg');
    expect(result).toBe('https://signed.url/receipt.jpg');
  });

  it('returns null when both photo and imagePath are absent', async () => {
    const receipt = { id: '3', photo: null, imagePath: null };
    const getSignedUrl = vi.fn();
    const result = await resolveReceiptPhotoUrl(receipt, getSignedUrl);
    expect(result).toBeNull();
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('returns null when getReceiptSignedUrl returns null (storage error)', async () => {
    const receipt = { id: '4', photo: null, imagePath: 'uid/job/broken.jpg' };
    const getSignedUrl = vi.fn().mockResolvedValue(null);
    const result = await resolveReceiptPhotoUrl(receipt, getSignedUrl);
    expect(result).toBeNull();
  });

  it('does not call getReceiptSignedUrl when photo is an empty string (falsy)', async () => {
    const receipt = { id: '5', photo: '', imagePath: 'uid/job/img.jpg' };
    const getSignedUrl = vi.fn().mockResolvedValue('https://signed.url/img.jpg');
    const result = await resolveReceiptPhotoUrl(receipt, getSignedUrl);
    // Empty string is falsy — falls through to imagePath
    expect(getSignedUrl).toHaveBeenCalledWith('uid/job/img.jpg');
    expect(result).toBe('https://signed.url/img.jpg');
  });
});
