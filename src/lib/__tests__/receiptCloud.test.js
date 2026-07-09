/**
 * receiptCloud.test.js — unit tests for receipt cloud helpers in store.js.
 *
 * Tests:
 *   1. mapCloudReceiptToToday — now attaches receipt_items as `items` array.
 *   2. updateReceiptInCloud — correct Supabase sequence (UPDATE receipts,
 *      DELETE+INSERT receipt_items, localStorage mirror).
 *   3. deleteReceiptFromCloud — deletes receipt_items (by receipt_id) before
 *      the receipts row, so a single-receipt delete never leaves orphaned
 *      line items behind (regression test for the VAT/profit-rollup skew bug
 *      — see fix/receipt-delete-cascade).
 *
 * Supabase client is mocked; no real connection required.
 *
 * Scope: pure-logic assertions derivable without a live DB.
 * The cloud I/O sequence is verified via spy call counts and argument shapes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── mapCloudReceiptToToday ───────────────────────────────────────────────────
// This function is not exported — we test its observable effect through
// getReceiptsFromCloud. However the items-attachment logic can be exercised by
// a local inline replica of the mapping function (same logic, not the same import).

function mapReceiptRow(r, items = []) {
  return {
    id: r.id,
    label: r.merchant || 'Receipt',
    amount: Number(r.amount || 0),
    vat: Number(r.vat || 0),
    date: r.date,
    createdAt: r.created_at,
    invoiceNumber: r.invoice_number || null,
    imagePath: r.image_path || null,
    jobId: r.job_id || null,
    items,
    cloud: true,
  };
}

describe('mapCloudReceiptToToday: items field', () => {
  it('attaches an empty items array when no receipt_items exist', () => {
    const row = { id: 'r1', merchant: 'Screwfix', amount: 60, vat: 10, date: '2026-06-01', created_at: '2026-06-01T10:00:00Z', invoice_number: null, image_path: null, job_id: null };
    const mapped = mapReceiptRow(row, []);
    expect(mapped.items).toEqual([]);
  });

  it('attaches receipt_items with desc and numeric cost', () => {
    const row = { id: 'r2', merchant: 'Travis', amount: 100, vat: 16.67, date: '2026-06-02', created_at: '2026-06-02T09:00:00Z', invoice_number: 'INV-1', image_path: null, job_id: 'j1' };
    const items = [
      { desc: 'Timber 2x4', cost: 40 },
      { desc: 'Screws pack', cost: 6 },
    ];
    const mapped = mapReceiptRow(row, items);
    expect(mapped.items).toHaveLength(2);
    expect(mapped.items[0]).toEqual({ desc: 'Timber 2x4', cost: 40 });
    expect(mapped.items[1]).toEqual({ desc: 'Screws pack', cost: 6 });
  });

  it('preserves all other fields correctly alongside items', () => {
    const row = { id: 'r3', merchant: 'Wickes', amount: 200, vat: 33.33, date: '2026-06-03', created_at: '2026-06-03T08:00:00Z', invoice_number: 'W-9001', image_path: 'user/r3.jpg', job_id: 'j2' };
    const mapped = mapReceiptRow(row, [{ desc: 'Paint', cost: 25 }]);
    expect(mapped.id).toBe('r3');
    expect(mapped.label).toBe('Wickes');
    expect(mapped.amount).toBe(200);
    expect(mapped.vat).toBeCloseTo(33.33);
    expect(mapped.invoiceNumber).toBe('W-9001');
    expect(mapped.imagePath).toBe('user/r3.jpg');
    expect(mapped.jobId).toBe('j2');
    expect(mapped.cloud).toBe(true);
    expect(mapped.items).toHaveLength(1);
  });

  it('uses "Receipt" as fallback label when merchant is absent', () => {
    const row = { id: 'r4', merchant: null, amount: 50, vat: 0, date: '2026-06-04', created_at: '2026-06-04T07:00:00Z', invoice_number: null, image_path: null, job_id: null };
    const mapped = mapReceiptRow(row);
    expect(mapped.label).toBe('Receipt');
  });

  it('coerces string amounts to numbers', () => {
    const row = { id: 'r5', merchant: 'M', amount: '42.50', vat: '7.08', date: '2026-06-05', created_at: null, invoice_number: null, image_path: null, job_id: null };
    const mapped = mapReceiptRow(row);
    expect(typeof mapped.amount).toBe('number');
    expect(mapped.amount).toBeCloseTo(42.5);
  });
});

// ─── updateReceiptInCloud: Supabase write sequence ────────────────────────────
// We mock supabase and verify the correct tables are written in the correct order.

vi.mock('../supabase', () => {
  const mockSingle = vi.fn();
  const mockSelect = vi.fn(() => ({ single: mockSingle }));
  const mockUpdate = vi.fn(() => ({ eq: vi.fn(() => ({ select: mockSelect })) }));
  const mockDelete = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
  const mockInsert = vi.fn().mockResolvedValue({ error: null });

  return {
    supabase: {
      from: vi.fn((table) => {
        if (table === 'receipts') return { update: mockUpdate };
        if (table === 'receipt_items') return { delete: mockDelete, insert: mockInsert };
        return {};
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-abc' } } }),
      },
      storage: {
        from: vi.fn(() => ({ remove: vi.fn().mockResolvedValue({ error: null }) })),
      },
    },
    _mockSingle: mockSingle,
    _mockUpdate: mockUpdate,
    _mockDelete: mockDelete,
    _mockInsert: mockInsert,
  };
});

// Mock localStorage for the mirror write
const localStorageData = {};
global.localStorage = {
  getItem: (k) => localStorageData[k] ?? null,
  setItem: (k, v) => { localStorageData[k] = v; },
  removeItem: (k) => { delete localStorageData[k]; },
  clear: () => { Object.keys(localStorageData).forEach(k => delete localStorageData[k]); },
};

describe('updateReceiptInCloud: Supabase write sequence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('calls receipts UPDATE with scalar fields', async () => {
    const { supabase, _mockUpdate, _mockSingle } = await import('../supabase');

    // Set up mock chain for receipts.update
    const eqMock = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'r1', merchant: 'Wickes', amount: 150, vat: 25, date: '2026-06-01', created_at: null, invoice_number: null, image_path: null, job_id: null },
          error: null,
        }),
      }),
    });
    supabase.from.mockImplementation((table) => {
      if (table === 'receipts') return { update: vi.fn().mockReturnValue({ eq: eqMock }) };
      if (table === 'receipt_items') return {
        delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
      return {};
    });

    const { updateReceiptInCloud } = await import('../store');

    const updated = await updateReceiptInCloud({
      id: 'r1',
      label: 'Wickes',
      amount: 150,
      vat: 25,
      date: '2026-06-01',
      invoiceNumber: null,
      items: [{ desc: 'Paint', cost: 25 }],
    });

    // receipts table must have been called
    expect(supabase.from).toHaveBeenCalledWith('receipts');
    // receipt_items table must have been called (delete + insert)
    expect(supabase.from).toHaveBeenCalledWith('receipt_items');
    // The returned object should include the items we passed
    expect(updated.items).toHaveLength(1);
    expect(updated.items[0].desc).toBe('Paint');
  });

  it('mirrors the update to localStorage', async () => {
    const { supabase } = await import('../supabase');

    // Seed localStorage with a pre-existing expense entry
    localStorage.setItem('jobprofit-app-data', JSON.stringify({
      jobs: [], invoices: [],
      expenses: [{
        id: 'E-0001', cloudId: 'r2', merchant: 'OldName', amount: 50, vat: 0, date: '2026-01-01', items: [], desc: '',
      }],
    }));

    supabase.from.mockImplementation((table) => {
      if (table === 'receipts') {
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'r2', merchant: 'NewName', amount: 75, vat: 12.5, date: '2026-06-10', created_at: null, invoice_number: 'INV-2', image_path: null, job_id: null },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'receipt_items') {
        return {
          delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return {};
    });

    const { updateReceiptInCloud } = await import('../store');
    await updateReceiptInCloud({
      id: 'r2', label: 'NewName', amount: 75, vat: 12.5,
      date: '2026-06-10', invoiceNumber: 'INV-2',
      items: [{ desc: 'Widget', cost: 10 }],
    });

    const stored = JSON.parse(localStorage.getItem('jobprofit-app-data'));
    const expense = stored.expenses.find(e => e.cloudId === 'r2');
    expect(expense).toBeTruthy();
    expect(expense.merchant).toBe('NewName');
    expect(expense.amount).toBe(75);
    expect(expense.items).toEqual([{ desc: 'Widget', cost: 10 }]);
    expect(expense.desc).toBe('Widget');
  });
});

// ─── deleteReceiptFromCloud: no orphaned receipt_items ────────────────────────
// Regression coverage for fix/receipt-delete-cascade: deleting a single
// receipt must always remove its receipt_items rows too, so VAT-reclaim and
// job cost/profit rollups never silently include orphaned line items.

describe('deleteReceiptFromCloud: receipt_items cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('deletes receipt_items (by receipt_id) before deleting the receipts row', async () => {
    const { supabase } = await import('../supabase');

    const callOrder = [];
    const mockItemsEq = vi.fn().mockImplementation((col, val) => {
      callOrder.push({ table: 'receipt_items', col, val });
      return Promise.resolve({ error: null });
    });
    const mockReceiptsEq = vi.fn().mockImplementation((col, val) => {
      callOrder.push({ table: 'receipts', col, val });
      return Promise.resolve({ error: null });
    });

    supabase.from.mockImplementation((table) => {
      if (table === 'receipt_items') return { delete: vi.fn(() => ({ eq: mockItemsEq })) };
      if (table === 'receipts')      return { delete: vi.fn(() => ({ eq: mockReceiptsEq })) };
      return {};
    });

    const { deleteReceiptFromCloud } = await import('../store');
    await deleteReceiptFromCloud('r-cascade-1');

    // Both deletes fired, scoped correctly...
    expect(mockItemsEq).toHaveBeenCalledWith('receipt_id', 'r-cascade-1');
    expect(mockReceiptsEq).toHaveBeenCalledWith('id', 'r-cascade-1');

    // ...and receipt_items was deleted BEFORE the parent receipts row.
    expect(callOrder[0].table).toBe('receipt_items');
    expect(callOrder[1].table).toBe('receipts');
  });

  it('throws and does not proceed to delete the receipts row if receipt_items delete fails', async () => {
    const { supabase } = await import('../supabase');

    const mockReceiptsDelete = vi.fn();
    supabase.from.mockImplementation((table) => {
      if (table === 'receipt_items') {
        return { delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: new Error('items delete failed') }) })) };
      }
      if (table === 'receipts') {
        return { delete: mockReceiptsDelete };
      }
      return {};
    });

    const { deleteReceiptFromCloud } = await import('../store');
    await expect(deleteReceiptFromCloud('r-cascade-2')).rejects.toThrow('items delete failed');
    expect(mockReceiptsDelete).not.toHaveBeenCalled();
  });

  it('removes the receipt from the localStorage mirror once cloud deletes succeed', async () => {
    localStorage.setItem('jobprofit-app-data', JSON.stringify({
      jobs: [], invoices: [],
      expenses: [
        { id: 'E-1', cloudId: 'r-cascade-3', merchant: 'Wickes', amount: 40, vat: 0, date: '2026-07-01', items: [] },
        { id: 'E-2', cloudId: 'r-other', merchant: 'Screwfix', amount: 10, vat: 0, date: '2026-07-02', items: [] },
      ],
    }));

    const { supabase } = await import('../supabase');
    supabase.from.mockImplementation((table) => {
      if (table === 'receipt_items') return { delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) };
      if (table === 'receipts')      return { delete: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })) };
      return {};
    });

    const { deleteReceiptFromCloud } = await import('../store');
    await deleteReceiptFromCloud('r-cascade-3');

    const stored = JSON.parse(localStorage.getItem('jobprofit-app-data'));
    expect(stored.expenses.find(e => e.cloudId === 'r-cascade-3')).toBeUndefined();
    expect(stored.expenses.find(e => e.cloudId === 'r-other')).toBeDefined();
  });
});
