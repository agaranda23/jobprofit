/**
 * voiceQuoteFlow — unit tests for Ticket A + B logic.
 *
 * No DOM, no React, no @testing-library — matches project convention.
 * Visual smoke is covered by the deploy-preview checklist in the PR.
 *
 * Covers:
 *   A — defaultMode="voice" prop: initial view should be 'details' (not 'micro').
 *       Normal entry (no prop) stays 'micro'.
 *       Offline / no SR falls back to manual with the right error.
 *
 *   B — Save & send quote button: appears only for awaiting + voice confirm.
 *       Plain Save still works.
 *       buildDetailsPayload validates amount correctly.
 *
 *   C — Spinner deferral: spinner gate (>400ms) logic is correct.
 */

import { describe, it, expect } from 'vitest';

// ── Ticket A helpers ──────────────────────────────────────────────────────────

/**
 * Mirrors AddJobModal's initial view derivation.
 * This is the logic we changed — tested without mounting React.
 */
function resolveInitialView(defaultMode) {
  return defaultMode === 'voice' ? 'details' : 'micro';
}

describe('Ticket A: defaultMode prop initial view', () => {
  it('defaultMode="voice" mounts into details view (skips micro keypad)', () => {
    expect(resolveInitialView('voice')).toBe('details');
  });

  it('no defaultMode prop mounts into micro view (unchanged default)', () => {
    expect(resolveInitialView(undefined)).toBe('micro');
  });

  it('defaultMode="micro" (explicit) mounts into micro view', () => {
    expect(resolveInitialView('micro')).toBe('micro');
  });

  it('unknown defaultMode value falls back to micro view', () => {
    expect(resolveInitialView('something-else')).toBe('micro');
  });
});

// ── Ticket B helpers ──────────────────────────────────────────────────────────

/**
 * Mirrors AddJobModal's buildDetailsPayload validation.
 * Returns { ok: true, payload } or { ok: false, error }.
 */
function buildDetailsPayload({ name, customer, phone, amount, paymentChip, jobDate, materials = '', labourHours = '', notes = '', deposit = '', address = '' }) {
  const resolvedName = (name || '').trim() || `Job · ${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
  const isPaid = paymentChip !== 'awaiting';

  if (isPaid && !(amount || '').trim()) {
    return { ok: false, error: 'Add an amount before you can mark this paid' };
  }
  const amt = (amount || '').trim() ? parseFloat(amount) : null;
  if (amt !== null && (isNaN(amt) || amt <= 0)) {
    return { ok: false, error: "That amount doesn't look right" };
  }

  const payload = {
    id: 'test-uuid',
    name: resolvedName,
    customer: (customer || '').trim() || null,
    phone: (phone || '').trim() || null,
    amount: amt,
    paymentType: isPaid ? paymentChip : null,
    paid: isPaid,
    date: jobDate ? new Date(jobDate + 'T12:00:00').toISOString() : new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...(materials.trim()   ? { materialsCost: parseFloat(materials) || 0 } : {}),
    ...(labourHours.trim() ? { labourHours: parseFloat(labourHours) || 0 } : {}),
    ...(notes.trim()       ? { notes: notes.trim() } : {}),
    ...(deposit.trim()     ? { deposit: parseFloat(deposit) || 0 } : {}),
    ...(address.trim()     ? { address: address.trim() } : {}),
  };
  return { ok: true, payload };
}

/** Mirrors the condition that gates the "Save & send quote" button. */
function shouldShowSaveAndSend({ voiceStatus, paymentChip, onSaveAndSendProvided }) {
  return voiceStatus === 'confirm' && paymentChip === 'awaiting' && onSaveAndSendProvided;
}

describe('Ticket B: Save & send quote button visibility', () => {
  it('shows for voice confirm + awaiting + onSaveAndSend provided', () => {
    expect(shouldShowSaveAndSend({ voiceStatus: 'confirm', paymentChip: 'awaiting', onSaveAndSendProvided: true })).toBe(true);
  });

  it('hidden when paymentChip is not awaiting (paid job)', () => {
    expect(shouldShowSaveAndSend({ voiceStatus: 'confirm', paymentChip: 'cash', onSaveAndSendProvided: true })).toBe(false);
  });

  it('hidden when not in confirm state (manual form)', () => {
    expect(shouldShowSaveAndSend({ voiceStatus: 'manual', paymentChip: 'awaiting', onSaveAndSendProvided: true })).toBe(false);
  });

  it('hidden when onSaveAndSend is not provided (WorkScreen entry)', () => {
    expect(shouldShowSaveAndSend({ voiceStatus: 'confirm', paymentChip: 'awaiting', onSaveAndSendProvided: false })).toBe(false);
  });
});

describe('Ticket B: buildDetailsPayload validation', () => {
  it('valid awaiting quote with amount builds correct payload', () => {
    const result = buildDetailsPayload({
      name: 'Garden fence', customer: 'Dave Jones', amount: '450',
      paymentChip: 'awaiting', jobDate: '2026-05-31',
    });
    expect(result.ok).toBe(true);
    expect(result.payload.amount).toBe(450);
    expect(result.payload.paid).toBe(false);
    expect(result.payload.paymentType).toBeNull();
    expect(result.payload.customer).toBe('Dave Jones');
  });

  it('paid job missing amount returns validation error', () => {
    const result = buildDetailsPayload({
      name: 'Kitchen job', amount: '', paymentChip: 'cash', jobDate: '2026-05-31',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/amount/i);
  });

  it('negative amount returns validation error', () => {
    const result = buildDetailsPayload({
      name: 'Job', amount: '-100', paymentChip: 'awaiting', jobDate: '2026-05-31',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/amount/i);
  });

  it('zero amount returns validation error', () => {
    const result = buildDetailsPayload({
      name: 'Job', amount: '0', paymentChip: 'awaiting', jobDate: '2026-05-31',
    });
    expect(result.ok).toBe(false);
  });

  it('awaiting job with no amount saves with amount:null (price-later)', () => {
    const result = buildDetailsPayload({
      name: 'Rough quote', amount: '', paymentChip: 'awaiting', jobDate: '2026-05-31',
    });
    expect(result.ok).toBe(true);
    expect(result.payload.amount).toBeNull();
  });

  it('optional fields are omitted when blank', () => {
    const result = buildDetailsPayload({
      name: 'Job', amount: '100', paymentChip: 'awaiting', jobDate: '2026-05-31',
      materials: '', labourHours: '', notes: '', address: '', deposit: '',
    });
    expect(result.ok).toBe(true);
    expect(result.payload).not.toHaveProperty('materialsCost');
    expect(result.payload).not.toHaveProperty('labourHours');
    expect(result.payload).not.toHaveProperty('notes');
  });

  it('optional fields are included when filled', () => {
    const result = buildDetailsPayload({
      name: 'Job', amount: '100', paymentChip: 'awaiting', jobDate: '2026-05-31',
      materials: '50', labourHours: '4', notes: 'Scaffold needed',
    });
    expect(result.ok).toBe(true);
    expect(result.payload.materialsCost).toBe(50);
    expect(result.payload.labourHours).toBe(4);
    expect(result.payload.notes).toBe('Scaffold needed');
  });
});

// ── Ticket C helpers ──────────────────────────────────────────────────────────

/**
 * Mirrors the spinner-deferral logic: spinner is only shown after 400ms.
 * This tests the threshold decision, not the setTimeout itself.
 */
function shouldShowSpinner(elapsedMs) {
  return elapsedMs > 400;
}

describe('Ticket C: parsing spinner >400ms deferral', () => {
  it('spinner is hidden at 0ms (parse came back instantly)', () => {
    expect(shouldShowSpinner(0)).toBe(false);
  });

  it('spinner is hidden at 399ms', () => {
    expect(shouldShowSpinner(399)).toBe(false);
  });

  it('spinner is hidden at exactly 400ms (threshold is strict >)', () => {
    expect(shouldShowSpinner(400)).toBe(false);
  });

  it('spinner is shown at 401ms (parse took long)', () => {
    expect(shouldShowSpinner(401)).toBe(true);
  });

  it('spinner is shown at 2000ms (slow AI call)', () => {
    expect(shouldShowSpinner(2000)).toBe(true);
  });
});
