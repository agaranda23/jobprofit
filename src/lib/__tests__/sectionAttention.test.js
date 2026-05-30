/**
 * sectionAttention.test.js
 *
 * Unit tests for sectionsNeedingAttention() — one test per attention rule
 * as specified in the Step 2 PRD (2026-05-30, page 3), plus the "all clear" case.
 */

import { describe, it, expect } from 'vitest';
import { sectionsNeedingAttention } from '../sectionAttention';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function baseJob(overrides = {}) {
  return {
    id: 'j1',
    status: 'active',
    quoteStatus: 'accepted',
    customer: 'Dave Whitlock',
    customerPhone: '07700 900123',
    email: 'dave@example.com',
    date: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days ago
    ...overrides,
  };
}

function noopNextStep(action = 'noop') {
  return { primaryCta: { action } };
}

const emptyReceipts = [];
const oneReceipt = [{ id: 'r1', jobId: 'j1', amount: 50, label: 'Screwfix' }];

// ── All clear ────────────────────────────────────────────────────────────────

describe('sectionsNeedingAttention — all clear case', () => {
  it('returns all false for a healthy job with phone, email, sent quote, receipts', () => {
    const job = baseJob({ status: 'invoice_sent', quoteStatus: 'sent' });
    const result = sectionsNeedingAttention(job, noopNextStep('noop'), oneReceipt);
    expect(result).toEqual({ quote: false, costs: false, customer: false });
  });
});

// ── Quote attention ───────────────────────────────────────────────────────────

describe('sectionsNeedingAttention — Quote rule', () => {
  it('flags quote when draft AND job is past Lead (status = active)', () => {
    const job = baseJob({ quoteStatus: 'draft', status: 'active' });
    const result = sectionsNeedingAttention(job, noopNextStep(), emptyReceipts);
    expect(result.quote).toBe(true);
  });

  it('flags quote when quoteStatus is absent (defaults to draft) AND past Lead', () => {
    const job = baseJob({ quoteStatus: undefined, status: 'quoted' });
    const result = sectionsNeedingAttention(job, noopNextStep(), emptyReceipts);
    expect(result.quote).toBe(true);
  });

  it('does NOT flag quote when quoteStatus is sent', () => {
    const job = baseJob({ quoteStatus: 'sent', status: 'quoted' });
    const result = sectionsNeedingAttention(job, noopNextStep(), emptyReceipts);
    expect(result.quote).toBe(false);
  });

  it('does NOT flag quote when quoteStatus is accepted', () => {
    const job = baseJob({ quoteStatus: 'accepted', status: 'active' });
    const result = sectionsNeedingAttention(job, noopNextStep(), emptyReceipts);
    expect(result.quote).toBe(false);
  });

  it('does NOT flag quote when status is lead (quote not yet needed)', () => {
    const job = baseJob({ quoteStatus: 'draft', status: 'lead' });
    const result = sectionsNeedingAttention(job, noopNextStep(), emptyReceipts);
    expect(result.quote).toBe(false);
  });
});

// ── Costs attention ───────────────────────────────────────────────────────────

describe('sectionsNeedingAttention — Costs rule', () => {
  it('flags costs when past Active + zero receipts + job older than 3 days', () => {
    const job = baseJob({ status: 'invoice_sent' }); // past Active, date = 4 days ago
    const result = sectionsNeedingAttention(job, noopNextStep(), emptyReceipts);
    expect(result.costs).toBe(true);
  });

  it('does NOT flag costs when there are receipts (even if old and past Active)', () => {
    const job = baseJob({ status: 'invoice_sent' });
    const result = sectionsNeedingAttention(job, noopNextStep(), oneReceipt);
    expect(result.costs).toBe(false);
  });

  it('does NOT flag costs when job is only Active (not yet past Active)', () => {
    const job = baseJob({ status: 'active' }); // Active = current stage, not past
    const result = sectionsNeedingAttention(job, noopNextStep(), emptyReceipts);
    expect(result.costs).toBe(false);
  });

  it('does NOT flag costs when job is recent (less than 3 days old)', () => {
    const freshDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
    const job = baseJob({ status: 'invoice_sent', date: freshDate });
    const result = sectionsNeedingAttention(job, noopNextStep(), emptyReceipts);
    expect(result.costs).toBe(false);
  });

  it('flags costs when status is complete + zero receipts + old job', () => {
    const job = baseJob({ status: 'complete' });
    const result = sectionsNeedingAttention(job, noopNextStep(), emptyReceipts);
    expect(result.costs).toBe(true);
  });
});

// ── Customer attention ────────────────────────────────────────────────────────

describe('sectionsNeedingAttention — Customer rule', () => {
  it('flags customer when next step is openInvoiceModal AND no email', () => {
    const job = baseJob({ email: undefined, customerEmail: undefined });
    const result = sectionsNeedingAttention(job, noopNextStep('openInvoiceModal'), emptyReceipts);
    expect(result.customer).toBe(true);
  });

  it('does NOT flag customer when next step is openInvoiceModal AND email is present', () => {
    const job = baseJob({ email: 'dave@example.com' });
    const result = sectionsNeedingAttention(job, noopNextStep('openInvoiceModal'), emptyReceipts);
    expect(result.customer).toBe(false);
  });

  it('uses customerEmail as fallback when email is absent', () => {
    const job = baseJob({ email: undefined, customerEmail: 'dave@example.com' });
    const result = sectionsNeedingAttention(job, noopNextStep('openInvoiceModal'), emptyReceipts);
    expect(result.customer).toBe(false);
  });

  it('flags customer when next step is handleChase AND no phone', () => {
    const job = baseJob({ customerPhone: undefined, phone: undefined, mobile: undefined });
    const result = sectionsNeedingAttention(job, noopNextStep('handleChase'), emptyReceipts);
    expect(result.customer).toBe(true);
  });

  it('does NOT flag customer when next step is handleChase AND phone is present', () => {
    const job = baseJob({ customerPhone: '07700 900123' });
    const result = sectionsNeedingAttention(job, noopNextStep('handleChase'), emptyReceipts);
    expect(result.customer).toBe(false);
  });

  it('uses job.phone as fallback for phone when customerPhone absent', () => {
    const job = baseJob({ customerPhone: undefined, phone: '07700 900123' });
    const result = sectionsNeedingAttention(job, noopNextStep('handleChase'), emptyReceipts);
    expect(result.customer).toBe(false);
  });

  it('does NOT flag customer when next step is unrelated (e.g. noop)', () => {
    const job = baseJob({ email: undefined, customerPhone: undefined });
    const result = sectionsNeedingAttention(job, noopNextStep('noop'), emptyReceipts);
    expect(result.customer).toBe(false);
  });

  it('handles null nextStepContent gracefully (returns all false)', () => {
    const result = sectionsNeedingAttention(baseJob(), null, emptyReceipts);
    expect(result.customer).toBe(false);
  });
});
