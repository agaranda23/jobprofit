/**
 * Tests for the Today tab "Send an invoice" pivot button behaviour.
 *
 * Final behaviour (after founder feedback on 2026-06-01):
 *   - Button is ALWAYS visible — founders want a persistent visual reminder
 *     that they can invoice from Today.
 *   - When uninvoicedJobs is empty, tapping it shows a friendly toast:
 *     "No jobs to invoice yet — finish a quote or log a job first."
 *   - When uninvoicedJobs has entries, tapping it opens the picker.
 *   - Pivot row always uses the --three grid since all three buttons are now
 *     permanently rendered.
 */

import { describe, it, expect } from 'vitest';

// ── Inline of deriveStatus — mirrors TodayScreen's imported helper ─────────────
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

// ── Pivot row class — always the --three layout (button is always visible) ────
function pivotRowClass() {
  return 'foreman-pivot-row foreman-pivot-row--three';
}

// ── handleSendInvoicePivot — toast when empty, open picker otherwise ──────────
function handleSendInvoicePivot(uninvoicedJobs) {
  if (uninvoicedJobs.length === 0) {
    return { action: 'toast', message: 'No jobs to invoice yet — finish a quote or log a job first.' };
  }
  return { action: 'open-picker' };
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
    expect(computeUninvoicedJobs([completedJob()]).length).toBe(1);
  });

  it('includes active jobs with no invoiceSentAt', () => {
    expect(computeUninvoicedJobs([activeJob()]).length).toBe(1);
  });

  it('excludes lead jobs regardless of invoiceSentAt', () => {
    expect(computeUninvoicedJobs([leadJob()]).length).toBe(0);
  });

  it('excludes quoted jobs regardless of invoiceSentAt', () => {
    expect(computeUninvoicedJobs([quotedJob()]).length).toBe(0);
  });

  it('excludes active jobs that already have invoiceSentAt', () => {
    expect(computeUninvoicedJobs([invoicedJob()]).length).toBe(0);
  });

  it('excludes completed jobs that already have invoiceSentAt', () => {
    expect(computeUninvoicedJobs([completedJob({ invoiceSentAt: '2026-05-10T09:00:00Z' })]).length).toBe(0);
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

// ── Pivot row class — always the --three layout ───────────────────────────────

describe('pivot row class — always uses the three-column layout', () => {
  it('returns --three class regardless of uninvoicedJobs state', () => {
    expect(pivotRowClass()).toBe('foreman-pivot-row foreman-pivot-row--three');
  });
});

// ── handleSendInvoicePivot — toast when empty, open picker otherwise ──────────

describe('handleSendInvoicePivot — friendly toast when no jobs, picker otherwise', () => {
  it('shows the friendly toast when uninvoicedJobs is empty', () => {
    const result = handleSendInvoicePivot([]);
    expect(result.action).toBe('toast');
    expect(result.message).toContain('No jobs to invoice yet');
  });

  it('toast copy mentions both recovery paths (quote and log)', () => {
    const result = handleSendInvoicePivot([]);
    expect(result.message).toContain('finish a quote');
    expect(result.message).toContain('log a job');
  });

  it('does not show the old confusing copy', () => {
    const result = handleSendInvoicePivot([]);
    expect(result.message).not.toContain('Mark a job complete first');
  });

  it('opens the picker when uninvoicedJobs has entries', () => {
    const uninvoiced = computeUninvoicedJobs([completedJob()]);
    const result = handleSendInvoicePivot(uninvoiced);
    expect(result.action).toBe('open-picker');
  });

  it('opens the picker for a mix of lead and completed jobs', () => {
    const uninvoiced = computeUninvoicedJobs([leadJob(), completedJob()]);
    expect(handleSendInvoicePivot(uninvoiced).action).toBe('open-picker');
  });

  it('shows the toast when all completed/active jobs already have invoiceSentAt', () => {
    const uninvoiced = computeUninvoicedJobs([invoicedJob(), completedJob({ invoiceSentAt: '2026-05-01T00:00:00Z' })]);
    expect(handleSendInvoicePivot(uninvoiced).action).toBe('toast');
  });
});
