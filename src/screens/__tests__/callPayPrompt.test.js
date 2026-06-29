/**
 * Unit tests for the call-pay prompt logic (feat/call-then-mark-paid).
 *
 * Scope: pure functions from src/lib/callPayPrompt.js.
 * No DOM render, no React, no Supabase.
 *
 * shouldShowCallPayPrompt — the core guard tested here — is the function
 * that decides whether the "Did [customer] pay?" snackbar appears.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldShowCallPayPrompt,
  isMarkableUnpaid,
  isAlreadyPaid,
  MIN_AWAY_MS,
  MAX_AWAY_MS,
} from '../../lib/callPayPrompt';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return {
    id: 'job-1',
    summary: 'Boiler service',
    customer: 'Alice',
    status: 'overdue',
    invoiceStatus: 'sent',
    total: 250,
    paid: false,
    paymentStatus: null,
    ...overrides,
  };
}

function makeRecord(overrides = {}) {
  return {
    jobId: 'job-1',
    calledAt: Date.now() - 5000, // 5 seconds ago — within the valid window
    ...overrides,
  };
}

// ── isAlreadyPaid ────────────────────────────────────────────────────────────

describe('isAlreadyPaid', () => {
  it('returns true when paid flag is true', () => {
    expect(isAlreadyPaid(makeJob({ paid: true }))).toBe(true);
  });

  it('returns true when status is "paid"', () => {
    expect(isAlreadyPaid(makeJob({ status: 'paid', paid: false }))).toBe(true);
  });

  it('returns true when paymentStatus is "paid"', () => {
    expect(isAlreadyPaid(makeJob({ paymentStatus: 'paid', paid: false }))).toBe(true);
  });

  it('returns false for an unpaid overdue job', () => {
    expect(isAlreadyPaid(makeJob())).toBe(false);
  });

  it('returns true when job is null', () => {
    expect(isAlreadyPaid(null)).toBe(true);
  });
});

// ── isMarkableUnpaid ─────────────────────────────────────────────────────────

describe('isMarkableUnpaid', () => {
  it('returns true for an overdue job', () => {
    expect(isMarkableUnpaid(makeJob({ status: 'overdue' }))).toBe(true);
  });

  it('returns true for an invoiced job (status=active, invoiceStatus=sent)', () => {
    expect(isMarkableUnpaid(makeJob({ status: 'active', invoiceStatus: 'sent' }))).toBe(true);
  });

  it('returns true for an On-stage job with a price', () => {
    expect(isMarkableUnpaid(makeJob({ status: 'active', invoiceStatus: null, total: 200 }))).toBe(true);
  });

  it('returns false for an On-stage job with no price', () => {
    expect(isMarkableUnpaid(makeJob({ status: 'active', invoiceStatus: null, total: 0, amount: 0 }))).toBe(false);
  });

  it('returns false for a Lead job', () => {
    expect(isMarkableUnpaid(makeJob({ status: 'lead', invoiceStatus: null }))).toBe(false);
  });

  it('returns false for a Quoted job', () => {
    expect(isMarkableUnpaid(makeJob({ status: 'quoted', invoiceStatus: null }))).toBe(false);
  });

  it('returns false for an already-paid job', () => {
    expect(isMarkableUnpaid(makeJob({ paid: true }))).toBe(false);
  });

  it('returns false when job is null', () => {
    expect(isMarkableUnpaid(null)).toBe(false);
  });
});

// ── shouldShowCallPayPrompt — happy path ─────────────────────────────────────

describe('shouldShowCallPayPrompt — shows for unpaid job after call', () => {
  const returnedAt = Date.now();

  it('shows for an overdue job returned to within the valid window', () => {
    const record = makeRecord({ calledAt: returnedAt - 5000 });
    const job = makeJob({ id: 'job-1', status: 'overdue' });
    expect(shouldShowCallPayPrompt({ record, job, returnedAt })).toBe(true);
  });

  it('shows for an invoiced job (invoiceStatus=sent)', () => {
    const record = makeRecord({ calledAt: returnedAt - 10000 });
    const job = makeJob({ id: 'job-1', status: 'active', invoiceStatus: 'sent' });
    expect(shouldShowCallPayPrompt({ record, job, returnedAt })).toBe(true);
  });

  it('shows for an On-stage job with a price', () => {
    const record = makeRecord({ calledAt: returnedAt - 3000 });
    const job = makeJob({ id: 'job-1', status: 'active', invoiceStatus: null, total: 500 });
    expect(shouldShowCallPayPrompt({ record, job, returnedAt })).toBe(true);
  });
});

// ── shouldShowCallPayPrompt — guard conditions ────────────────────────────────

describe('shouldShowCallPayPrompt — does NOT show', () => {
  const returnedAt = Date.now();

  it('does not show when record is null (no call was recorded)', () => {
    const job = makeJob();
    expect(shouldShowCallPayPrompt({ record: null, job, returnedAt })).toBe(false);
  });

  it('does not show when job is null (job no longer in list)', () => {
    const record = makeRecord({ calledAt: returnedAt - 5000 });
    expect(shouldShowCallPayPrompt({ record, job: null, returnedAt })).toBe(false);
  });

  it('does not show when the job is already paid', () => {
    const record = makeRecord({ calledAt: returnedAt - 5000 });
    const job = makeJob({ paid: true });
    expect(shouldShowCallPayPrompt({ record, job, returnedAt })).toBe(false);
  });

  it('does not show when the job is paymentStatus=paid', () => {
    const record = makeRecord({ calledAt: returnedAt - 5000 });
    const job = makeJob({ paymentStatus: 'paid', paid: false });
    expect(shouldShowCallPayPrompt({ record, job, returnedAt })).toBe(false);
  });

  it('does not show when away time is below MIN_AWAY_MS (too quick — probably a tab switch)', () => {
    const record = makeRecord({ calledAt: returnedAt - (MIN_AWAY_MS - 1) });
    const job = makeJob();
    expect(shouldShowCallPayPrompt({ record, job, returnedAt })).toBe(false);
  });

  it('does not show when away time exceeds MAX_AWAY_MS (too long ago)', () => {
    const record = makeRecord({ calledAt: returnedAt - (MAX_AWAY_MS + 1000) });
    const job = makeJob();
    expect(shouldShowCallPayPrompt({ record, job, returnedAt })).toBe(false);
  });

  it('does not show for a Lead-stage job (not markable)', () => {
    const record = makeRecord({ calledAt: returnedAt - 5000 });
    const job = makeJob({ status: 'lead', invoiceStatus: null });
    expect(shouldShowCallPayPrompt({ record, job, returnedAt })).toBe(false);
  });

  it('does not show for a Quoted-stage job (not markable)', () => {
    const record = makeRecord({ calledAt: returnedAt - 5000 });
    const job = makeJob({ status: 'quoted', invoiceStatus: null });
    expect(shouldShowCallPayPrompt({ record, job, returnedAt })).toBe(false);
  });

  it('does not show for an On-stage job with no price', () => {
    const record = makeRecord({ calledAt: returnedAt - 5000 });
    const job = makeJob({ status: 'active', invoiceStatus: null, total: null, amount: null });
    expect(shouldShowCallPayPrompt({ record, job, returnedAt })).toBe(false);
  });

  it('fires only once — after consuming the record a second call returns false', () => {
    // shouldShowCallPayPrompt is pure (takes record as param); consuming is done
    // by the caller via consumeCallRecord(). Simulate the "already consumed" case
    // by passing null record on the second check.
    const record = makeRecord({ calledAt: returnedAt - 5000 });
    const job = makeJob();
    expect(shouldShowCallPayPrompt({ record, job, returnedAt })).toBe(true);
    // After consuming, record would be null
    expect(shouldShowCallPayPrompt({ record: null, job, returnedAt })).toBe(false);
  });
});
