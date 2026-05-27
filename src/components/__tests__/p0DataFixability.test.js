/**
 * P0 data-fixability tests — pure logic only, no DOM, no React.
 *
 * Covers the three editability fixes shipped in feat/p0-data-fixability-receipts-notes-payments:
 *
 * E-P0-1: Receipt edit path — AddReceiptModal edit mode produces correct updatedReceipt shape
 * E-P0-2: Note edit path — mutating job.jobNotes via the handler pattern used in JobDetailDrawer
 * E-P0-3: Payment edit + delete — editPayment / deletePayment helpers (already tested in
 *         payments.test.js) are wired correctly through the JobDetailDrawer handler logic;
 *         we verify the handler-level transformations (method normalisation, amount coercion)
 *         that sit between the UI fields and the lib helpers.
 */

import { describe, it, expect } from 'vitest';
import { editPayment, deletePayment } from '../../lib/payments.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PAST_DATE = '2024-06-15';

function freshJob(overrides = {}) {
  return {
    id: 'j1',
    customer: 'Sarah Mitchell',
    amount: 500,
    status: 'awaiting',
    paymentStatus: 'awaiting',
    invoiceSentAt: '2026-05-01T10:00:00Z',
    payments: [],
    jobNotes: [],
    receipts: [],
    ...overrides,
  };
}

function paymentFixture(overrides = {}) {
  return {
    id: 'pay_abc',
    date: PAST_DATE,
    amount: 100,
    method: 'cash',
    note: '',
    createdAt: '2026-05-01T10:00:00Z',
    ...overrides,
  };
}

function receiptFixture(overrides = {}) {
  return {
    id: 999,
    label: 'Screwfix',
    amount: 42.5,
    vat: 7.08,
    date: PAST_DATE,
    invoiceNumber: 'INV-001',
    items: [{ desc: 'Drill bits', cost: 12 }],
    photo: null,
    jobId: 'j1',
    createdAt: '2026-05-01T10:00:00Z',
    ...overrides,
  };
}

function noteFixture(overrides = {}) {
  return {
    id: 'N-1716123456789',
    subject: 'Site visit',
    body: 'Customer confirmed go-ahead',
    date: '2026-05-10T09:00:00Z',
    ...overrides,
  };
}

// ─── E-P0-1: Receipt edit mode ───────────────────────────────────────────────

describe('E-P0-1 receipt edit — updatedReceipt shape', () => {
  // Simulates the merge logic inside AddReceiptModal save() in edit mode.
  // This is the same spread used in the component: { ...existingReceipt, ...fields }
  function simulateReceiptEditSave(existingReceipt, fields) {
    return {
      ...existingReceipt,
      label: (fields.label || '').trim() || 'Receipt',
      amount: parseFloat(fields.amount),
      vat: fields.vat === '' ? 0 : parseFloat(fields.vat),
      items: (fields.items || []).filter(i => i.desc?.trim()),
      invoiceNumber: (fields.invoiceNumber || '').trim() || null,
      date: fields.date,
      // Only replace photo if user picked a new file
      ...(fields.photoFile ? { photo: fields.photo } : {}),
    };
  }

  it('preserves id, jobId, createdAt, and imagePath from the original receipt', () => {
    const existing = receiptFixture({ imagePath: 'receipts/abc.jpg' });
    const result = simulateReceiptEditSave(existing, {
      label: 'B&Q',
      amount: '55.00',
      vat: '9.17',
      date: PAST_DATE,
      items: [],
      invoiceNumber: '',
      photo: null,
      photoFile: null,
    });
    expect(result.id).toBe(existing.id);
    expect(result.jobId).toBe(existing.jobId);
    expect(result.createdAt).toBe(existing.createdAt);
    expect(result.imagePath).toBe('receipts/abc.jpg');
  });

  it('updates label, amount, vat, date, invoiceNumber correctly', () => {
    const existing = receiptFixture();
    const result = simulateReceiptEditSave(existing, {
      label: 'Toolstation',
      amount: '88.00',
      vat: '14.67',
      date: '2024-07-01',
      items: [],
      invoiceNumber: 'INV-999',
      photo: null,
      photoFile: null,
    });
    expect(result.label).toBe('Toolstation');
    expect(result.amount).toBe(88);
    expect(result.vat).toBe(14.67);
    expect(result.date).toBe('2024-07-01');
    expect(result.invoiceNumber).toBe('INV-999');
  });

  it('keeps original photo when no new photoFile is provided', () => {
    const existing = receiptFixture({ photo: 'data:image/jpeg;base64,abc123' });
    const result = simulateReceiptEditSave(existing, {
      label: 'Screwfix',
      amount: '42.50',
      vat: '',
      date: PAST_DATE,
      items: [],
      invoiceNumber: '',
      photo: null,
      photoFile: null,
    });
    expect(result.photo).toBe('data:image/jpeg;base64,abc123');
  });

  it('replaces photo when a new photoFile is provided', () => {
    const existing = receiptFixture({ photo: 'data:image/jpeg;base64,old' });
    const result = simulateReceiptEditSave(existing, {
      label: 'Screwfix',
      amount: '42.50',
      vat: '',
      date: PAST_DATE,
      items: [],
      invoiceNumber: '',
      photo: 'data:image/jpeg;base64,newphoto',
      photoFile: new Blob(['fake'], { type: 'image/jpeg' }),
    });
    expect(result.photo).toBe('data:image/jpeg;base64,newphoto');
  });

  it('falls back to "Receipt" when label is blank', () => {
    const result = simulateReceiptEditSave(receiptFixture(), {
      label: '   ',
      amount: '10',
      vat: '',
      date: PAST_DATE,
      items: [],
      invoiceNumber: '',
      photo: null,
      photoFile: null,
    });
    expect(result.label).toBe('Receipt');
  });

  it('sets invoiceNumber to null when blank', () => {
    const result = simulateReceiptEditSave(receiptFixture(), {
      label: 'Screwfix',
      amount: '10',
      vat: '',
      date: PAST_DATE,
      items: [],
      invoiceNumber: '  ',
      photo: null,
      photoFile: null,
    });
    expect(result.invoiceNumber).toBeNull();
  });

  it('updates job.receipts array correctly when handleReceiptUpdate runs', () => {
    // Simulates the logic in handleReceiptUpdate in JobDetailDrawer
    const receipt1 = receiptFixture({ id: 1, label: 'Screwfix', amount: 42.5 });
    const receipt2 = receiptFixture({ id: 2, label: 'B&Q', amount: 100 });
    const job = freshJob({ receipts: [receipt1, receipt2] });

    const updatedReceipt = { ...receipt1, label: 'Screwfix Updated', amount: 55 };
    const updatedReceipts = job.receipts.map(r =>
      String(r.id) === String(updatedReceipt.id) ? updatedReceipt : r
    );

    expect(updatedReceipts).toHaveLength(2);
    expect(updatedReceipts[0].label).toBe('Screwfix Updated');
    expect(updatedReceipts[0].amount).toBe(55);
    expect(updatedReceipts[1]).toBe(receipt2); // untouched
  });
});

// ─── E-P0-2: Note edit ───────────────────────────────────────────────────────

describe('E-P0-2 note edit — handleSaveNoteEdit pattern', () => {
  // Mirrors the handleSaveNoteEdit logic in JobDetailDrawer
  function handleSaveNoteEdit(job, editingNote, patch) {
    const updated = (job.jobNotes || []).map(n =>
      n.id === editingNote.id ? { ...n, subject: patch.subject, body: patch.body } : n
    );
    return { ...job, jobNotes: updated };
  }

  it('updates the target note by id and returns a new job', () => {
    const note1 = noteFixture({ id: 'N-1' });
    const note2 = noteFixture({ id: 'N-2', subject: 'Other' });
    const job = freshJob({ jobNotes: [note1, note2] });

    const result = handleSaveNoteEdit(job, note1, {
      subject: 'Updated subject',
      body: 'Updated body',
    });

    expect(result).not.toBe(job); // new reference
    expect(result.jobNotes[0].subject).toBe('Updated subject');
    expect(result.jobNotes[0].body).toBe('Updated body');
  });

  it('preserves note id and date — only subject and body are mutated', () => {
    const note = noteFixture();
    const job = freshJob({ jobNotes: [note] });

    const result = handleSaveNoteEdit(job, note, {
      subject: 'New subject',
      body: 'New body',
    });

    expect(result.jobNotes[0].id).toBe(note.id);
    expect(result.jobNotes[0].date).toBe(note.date);
  });

  it('does not touch other notes in the array', () => {
    const note1 = noteFixture({ id: 'N-1' });
    const note2 = noteFixture({ id: 'N-2', subject: 'Untouched' });
    const job = freshJob({ jobNotes: [note1, note2] });

    const result = handleSaveNoteEdit(job, note1, { subject: 'Changed', body: 'New' });

    expect(result.jobNotes[1]).toEqual(note2);
  });

  it('does not mutate the original job', () => {
    const note = noteFixture();
    const job = freshJob({ jobNotes: [note] });
    const originalSubject = note.subject;

    handleSaveNoteEdit(job, note, { subject: 'Changed', body: 'New' });

    expect(job.jobNotes[0].subject).toBe(originalSubject);
  });

  it('handles job with no jobNotes field (treats as empty)', () => {
    const job = { id: 'j1' };
    const result = handleSaveNoteEdit(job, noteFixture(), { subject: 'X', body: 'Y' });
    expect(result.jobNotes).toEqual([]); // note not found = no-op, but safe
  });
});

// ─── E-P0-3: Payment edit + delete handler logic ────────────────────────────

describe('E-P0-3 payment edit — handleEditPaymentSave method normalisation', () => {
  // Mirrors the normalisation in handleEditPaymentSave in JobDetailDrawer
  function normaliseMethod(raw) {
    return (raw || '').trim().toLowerCase() || 'unknown';
  }

  it('passes "bank transfer" → normalises to "bank transfer" (text input, stored as-is)', () => {
    expect(normaliseMethod('bank transfer')).toBe('bank transfer');
  });

  it('trims whitespace from method input', () => {
    expect(normaliseMethod('  cash  ')).toBe('cash');
  });

  it('lowercases method input', () => {
    expect(normaliseMethod('CARD')).toBe('card');
  });

  it('defaults empty method to "unknown"', () => {
    expect(normaliseMethod('')).toBe('unknown');
    expect(normaliseMethod(undefined)).toBe('unknown');
  });

  it('amount coercion: parseFloat handles string "120.50" correctly', () => {
    expect(parseFloat('120.50')).toBe(120.5);
  });

  it('amount coercion: rejects blank or non-numeric strings', () => {
    expect(isNaN(parseFloat(''))).toBe(true);
    expect(isNaN(parseFloat('abc'))).toBe(true);
  });
});

describe('E-P0-3 payment edit — editPayment integration', () => {
  it('editPayment with amount + method patch returns updated job', () => {
    const job = freshJob({
      payments: [paymentFixture()],
    });
    // Simulate handleEditPaymentSave: normalise method, coerce amount, call lib
    const patch = { amount: '150', date: PAST_DATE, method: 'card', note: 'amended' };
    const amt = parseFloat(patch.amount);
    const method = (patch.method || '').trim().toLowerCase() || 'unknown';

    const result = editPayment(job, 'pay_abc', {
      amount: amt,
      date: patch.date,
      method,
      note: patch.note,
    });

    expect(result.payments[0].amount).toBe(150);
    expect(result.payments[0].method).toBe('card');
    expect(result.payments[0].note).toBe('amended');
    expect(result.payments[0].id).toBe('pay_abc'); // immutable
    expect(result.payments[0].createdAt).toBe('2026-05-01T10:00:00Z'); // immutable
  });

  it('editPayment auto-flips to paid when edited amount clears the balance', () => {
    const job = freshJob({
      amount: 150,
      payments: [paymentFixture({ amount: 100 })],
    });
    const result = editPayment(job, 'pay_abc', { amount: 150, date: PAST_DATE, method: 'cash', note: '' });
    expect(result.status).toBe('paid');
    expect(result.paymentStatus).toBe('paid');
  });
});

describe('E-P0-3 payment delete — deletePayment integration', () => {
  it('deletePayment removes entry and returns new job (input not mutated)', () => {
    const job = freshJob({
      amount: 200,
      payments: [
        paymentFixture({ id: 'pay_abc', amount: 100 }),
        paymentFixture({ id: 'pay_def', amount: 80 }),
      ],
    });
    const result = deletePayment(job, 'pay_abc');
    expect(result).not.toBe(job);
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].id).toBe('pay_def');
    expect(job.payments).toHaveLength(2); // original untouched
  });

  it('deletePayment auto-flips back to awaiting on a paid job', () => {
    const job = {
      id: 'j1', amount: 100, status: 'paid', paymentStatus: 'paid',
      invoiceSentAt: '2026-05-01T10:00:00Z',
      payments: [paymentFixture({ amount: 100 })],
    };
    const result = deletePayment(job, 'pay_abc');
    expect(result.status).toBe('awaiting');
    expect(result.paymentStatus).toBe('awaiting');
  });
});
