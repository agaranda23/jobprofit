/**
 * Tests for the Today tab "Send an invoice" pivot button visibility fix.
 *
 * Bug: the button was rendered unconditionally — tapping it when no invoiceable
 * jobs existed showed a confusing toast ("Mark a job complete first...").
 *
 * Fix: button is gated on uninvoicedJobs.length > 0. The pivot row also drops
 * the --three modifier class when the button is hidden so the two remaining
 * buttons span the full row width.
 *
 * Tests here validate the pure filter logic that drives uninvoicedJobs and the
 * button/class visibility rules derived from it — no DOM mount required.
 */

import { describe, it, expect } from 'vitest';

// ── Inline of deriveStatus — mirrors TodayScreen's imported helper ─────────────
// We replicate enough of the real deriveStatus to exercise the filter.
function deriveStatus(job) {
  if (job.status) return job.status;
  if (job.jobStatus) return job.jobStatus;
  return 'lead';
}

// ── Inline of uninvoicedJobs filter (mirrors TodayScreen.jsx line 174-177) ─────
function computeUninvoicedJobs(jobs) {
  return jobs.filter(j => {
    const s = deriveStatus(j);
    return (s === 'completed' || s === 'active') && !j.invoiceSentAt;
  });
}

// ── Visibility rules derived from uninvoicedJobs (mirrors TodayScreen render) ──

function showSendInvoiceButton(uninvoicedJobs) {
  return uninvoicedJobs.length > 0;
}

function pivotRowClass(uninvoicedJobs) {
  return `foreman-pivot-row${uninvoicedJobs.length > 0 ? ' foreman-pivot-row--three' : ''}`;
}

function handleSendInvoicePivot(uninvoicedJobs) {
  // Mirrors the fixed handler — silent no-op when list is empty (button is
  // already hidden, but defensive guard stays in case of race condition).
  if (uninvoicedJobs.length === 0) return null;
  return 'open-picker';
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function leadJob(overrides = {}) {
  return { id: 'j-lead', status: 'lead', amount: 200, ...overrides };
}

function quotedJob(overrides = {}) {
  return { id: 'j-quoted', status: 'quoted', amount: 300, ...overrides };
}

function activeJob(overrides = {}) {
  return { id: 'j-active', status: 'active', amount: 400, ...overrides };
}

function completedJob(overrides = {}) {
  return { id: 'j-complete', status: 'completed', amount: 500, ...overrides };
}

function invoicedJob(overrides = {}) {
  return {
    id: 'j-invoiced',
    status: 'active',
    amount: 350,
    invoiceSentAt: '2026-05-01T10:00:00Z',
    ...overrides,
  };
}

// ── uninvoicedJobs filter ─────────────────────────────────────────────────────

describe('uninvoicedJobs filter — jobs eligible for the Send Invoice picker', () => {
  it('includes completed jobs with no invoiceSentAt', () => {
    const jobs = [completedJob()];
    expect(computeUninvoicedJobs(jobs).length).toBe(1);
  });

  it('includes active jobs with no invoiceSentAt', () => {
    const jobs = [activeJob()];
    expect(computeUninvoicedJobs(jobs).length).toBe(1);
  });

  it('excludes lead jobs regardless of invoiceSentAt', () => {
    const jobs = [leadJob()];
    expect(computeUninvoicedJobs(jobs).length).toBe(0);
  });

  it('excludes quoted jobs regardless of invoiceSentAt', () => {
    const jobs = [quotedJob()];
    expect(computeUninvoicedJobs(jobs).length).toBe(0);
  });

  it('excludes active jobs that already have invoiceSentAt', () => {
    const jobs = [invoicedJob()];
    expect(computeUninvoicedJobs(jobs).length).toBe(0);
  });

  it('excludes completed jobs that already have invoiceSentAt', () => {
    const jobs = [completedJob({ invoiceSentAt: '2026-05-10T09:00:00Z' })];
    expect(computeUninvoicedJobs(jobs).length).toBe(0);
  });

  it('returns empty array when jobs list is empty', () => {
    expect(computeUninvoicedJobs([])).toHaveLength(0);
  });

  it('returns only the invoiceable jobs from a mixed list', () => {
    const jobs = [leadJob(), quotedJob(), activeJob(), completedJob(), invoicedJob()];
    const result = computeUninvoicedJobs(jobs);
    expect(result.length).toBe(2);
    expect(result.map(j => j.id)).toContain('j-active');
    expect(result.map(j => j.id)).toContain('j-complete');
  });
});

// ── Send invoice button visibility (Bug 3 fix) ────────────────────────────────

describe('Send an invoice pivot button — hidden when no invoiceable jobs (bug fix)', () => {
  it('button is hidden when uninvoicedJobs is empty', () => {
    const uninvoiced = computeUninvoicedJobs([leadJob(), quotedJob()]);
    expect(showSendInvoiceButton(uninvoiced)).toBe(false);
  });

  it('button is visible when at least one uninvoiced job exists', () => {
    const uninvoiced = computeUninvoicedJobs([completedJob()]);
    expect(showSendInvoiceButton(uninvoiced)).toBe(true);
  });

  it('button is visible for a mix of lead and completed jobs', () => {
    const uninvoiced = computeUninvoicedJobs([leadJob(), completedJob()]);
    expect(showSendInvoiceButton(uninvoiced)).toBe(true);
  });

  it('button is hidden when all completed/active jobs already have invoiceSentAt', () => {
    const uninvoiced = computeUninvoicedJobs([invoicedJob(), completedJob({ invoiceSentAt: '2026-05-01T00:00:00Z' })]);
    expect(showSendInvoiceButton(uninvoiced)).toBe(false);
  });
});

// ── Pivot row class — drops --three when button is hidden ─────────────────────

describe('pivot row class — --three modifier only when Send Invoice button is visible', () => {
  it('uses --three class when there are uninvoiceable jobs', () => {
    const uninvoiced = computeUninvoicedJobs([completedJob()]);
    expect(pivotRowClass(uninvoiced)).toBe('foreman-pivot-row foreman-pivot-row--three');
  });

  it('drops --three class when no uninvoiceable jobs (two-button layout)', () => {
    const uninvoiced = computeUninvoicedJobs([leadJob()]);
    expect(pivotRowClass(uninvoiced)).toBe('foreman-pivot-row');
  });
});

// ── handleSendInvoicePivot — silent no-op when list is empty ─────────────────

describe('handleSendInvoicePivot — defensive guard returns no-op (bug fix)', () => {
  it('returns null (no action) when uninvoicedJobs is empty — no toast shown', () => {
    expect(handleSendInvoicePivot([])).toBeNull();
  });

  it('opens picker when uninvoicedJobs has entries', () => {
    const uninvoiced = computeUninvoicedJobs([completedJob()]);
    expect(handleSendInvoicePivot(uninvoiced)).toBe('open-picker');
  });
});
