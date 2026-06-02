/**
 * autoStageTransition — unit tests for the two stage-transition bugs fixed in
 * fix/auto-stage-on-quote-send-and-sign.
 *
 * No DOM, no React — pure logic mirrors what ReviewSheet.jsx, JobDetailDrawer.jsx,
 * and accept-quote.js do when advancing the pipeline.
 *
 * Bug 1: Sending a quote from Lead didn't move the job to Quoted.
 *   Root cause: the old check `job.status === 'lead'` failed for legacy jobs
 *   where `status` is undefined, leaving the update as `status: undefined`.
 *   Fix: `isLead = job.status === 'lead' || !job.status` → spread `stagePatch('Quoted')`.
 *
 * Bug 2: Customer signing a quote didn't move the job to On (Active).
 *   Root cause: accept-quote.js set `jobStatus: 'active'` (legacy field) but not
 *   `status: 'active'` (canonical field read by mapCloudJobToToday as cloudMeta.status).
 *   Fix: write `status: 'active'` into meta when the job is currently Quoted.
 *
 * Test surface covers:
 *   A. isLead guard — all paths that correctly identify Lead
 *   B. Quote-send stage result — Lead→Quoted, others unchanged
 *   C. isCurrentlyQuoted guard — accept-quote.js server-side equivalent
 *   D. Quote-accept stage result — Quoted→On, others unchanged
 *   E. handleConvert / handleSignatureSave (trader-side) guard
 */

import { describe, it, expect } from 'vitest';
import { stagePatch } from '../jobStatus';

// ── Shared helpers mirroring the production logic ─────────────────────────────

/**
 * Mirrors ReviewSheet.jsx and JobDetailDrawer.handleMarkSent:
 *   const isLead = job.status === 'lead' || !job.status;
 *   return { ...job, ...(isLead ? stagePatch('Quoted') : {}), quoteStatus: 'sent', ... }
 */
function applyQuoteSendPatch(job) {
  const isLead = job.status === 'lead' || !job.status;
  return {
    ...job,
    ...(isLead ? stagePatch('Quoted') : {}),
    quoteStatus: 'sent',
    quoteSentAt: '2026-06-02T10:00:00.000Z',
  };
}

/**
 * Mirrors accept-quote.js step 8:
 *   const isCurrentlyQuoted = currentStatus === 'quoted' || !currentStatus;
 *   updatedMeta = { ...existingMeta, quoteStatus:'accepted', ...(isCurrentlyQuoted ? { status:'active', jobStatus:'active' } : {}) }
 */
function applyAcceptQuoteMeta(existingMeta) {
  const currentStatus = existingMeta.status;
  const isCurrentlyQuoted = currentStatus === 'quoted' || !currentStatus;
  return {
    ...existingMeta,
    quoteStatus: 'accepted',
    ...(isCurrentlyQuoted ? { status: 'active', jobStatus: 'active' } : {}),
  };
}

/**
 * Mirrors JobDetailDrawer.handleConvert and handleSignatureSave:
 *   const isQuoted = job.status === 'quoted';
 *   return { ...job, quoteStatus: 'accepted', ...(isQuoted ? stagePatch('On') : {}) }
 */
function applyConvertPatch(job) {
  const isQuoted = job.status === 'quoted';
  return {
    ...job,
    quoteStatus: 'accepted',
    ...(isQuoted ? stagePatch('On') : {}),
  };
}

// ── A. isLead guard ───────────────────────────────────────────────────────────

describe('A. isLead guard', () => {
  it('job.status === "lead" is treated as Lead', () => {
    const isLead = (s) => s === 'lead' || !s;
    expect(isLead('lead')).toBe(true);
  });

  it('job.status === undefined is treated as Lead (legacy job fix)', () => {
    const isLead = (s) => s === 'lead' || !s;
    expect(isLead(undefined)).toBe(true);
  });

  it('job.status === null is treated as Lead (null legacy path)', () => {
    const isLead = (s) => s === 'lead' || !s;
    expect(isLead(null)).toBe(true);
  });

  it('job.status === "quoted" is NOT treated as Lead', () => {
    const isLead = (s) => s === 'lead' || !s;
    expect(isLead('quoted')).toBe(false);
  });

  it('job.status === "active" is NOT treated as Lead', () => {
    const isLead = (s) => s === 'lead' || !s;
    expect(isLead('active')).toBe(false);
  });

  it('job.status === "paid" is NOT treated as Lead', () => {
    const isLead = (s) => s === 'lead' || !s;
    expect(isLead('paid')).toBe(false);
  });
});

// ── B. Quote-send stage result ─────────────────────────────────────────────────

describe('B. quote-send: Lead → Quoted', () => {
  it('canonical Lead job (status:"lead") moves to Quoted on send', () => {
    const job = { id: '1', status: 'lead' };
    const result = applyQuoteSendPatch(job);
    expect(result.status).toBe('quoted');
  });

  it('legacy Lead job (status:undefined) moves to Quoted on send', () => {
    const job = { id: '2' }; // no status field — old job format
    const result = applyQuoteSendPatch(job);
    expect(result.status).toBe('quoted');
  });

  it('legacy Lead job (status:null) moves to Quoted on send', () => {
    const job = { id: '3', status: null };
    const result = applyQuoteSendPatch(job);
    expect(result.status).toBe('quoted');
  });

  it('Quoted job re-sending quote stays Quoted (idempotent, no regression)', () => {
    const job = { id: '4', status: 'quoted' };
    const result = applyQuoteSendPatch(job);
    expect(result.status).toBe('quoted');
  });

  it('Active (On) job sending quote does not regress to Quoted', () => {
    const job = { id: '5', status: 'active' };
    const result = applyQuoteSendPatch(job);
    expect(result.status).toBe('active');
  });

  it('Done job sending quote is not moved (respects manual override)', () => {
    const job = { id: '6', status: 'complete' };
    const result = applyQuoteSendPatch(job);
    expect(result.status).toBe('complete');
  });

  it('Paid job sending quote is not moved (respects paid state)', () => {
    const job = { id: '7', status: 'paid' };
    const result = applyQuoteSendPatch(job);
    expect(result.status).toBe('paid');
  });

  it('quoteStatus is always set to "sent" regardless of stage', () => {
    const leadJob = { id: '8', status: 'lead' };
    const quotedJob = { id: '9', status: 'quoted' };
    expect(applyQuoteSendPatch(leadJob).quoteStatus).toBe('sent');
    expect(applyQuoteSendPatch(quotedJob).quoteStatus).toBe('sent');
  });
});

// ── C. isCurrentlyQuoted guard (accept-quote.js server-side) ─────────────────

describe('C. isCurrentlyQuoted guard', () => {
  it('meta.status === "quoted" is treated as Quoted', () => {
    const isCurrentlyQuoted = (s) => s === 'quoted' || !s;
    expect(isCurrentlyQuoted('quoted')).toBe(true);
  });

  it('meta.status === undefined is treated as Quoted (legacy job — safe to advance)', () => {
    const isCurrentlyQuoted = (s) => s === 'quoted' || !s;
    expect(isCurrentlyQuoted(undefined)).toBe(true);
  });

  it('meta.status === "active" is NOT treated as Quoted (already On)', () => {
    const isCurrentlyQuoted = (s) => s === 'quoted' || !s;
    expect(isCurrentlyQuoted('active')).toBe(false);
  });

  it('meta.status === "invoice_sent" is NOT treated as Quoted (Invoiced)', () => {
    const isCurrentlyQuoted = (s) => s === 'quoted' || !s;
    expect(isCurrentlyQuoted('invoice_sent')).toBe(false);
  });

  it('meta.status === "paid" is NOT treated as Quoted', () => {
    const isCurrentlyQuoted = (s) => s === 'quoted' || !s;
    expect(isCurrentlyQuoted('paid')).toBe(false);
  });
});

// ── D. Quote-accept stage result (accept-quote.js + trader-side) ──────────────

describe('D. quote-accept: Quoted → On (server-side meta patch)', () => {
  it('Quoted job (status:"quoted") moves to On (status:"active") when customer signs', () => {
    const meta = { status: 'quoted', quoteStatus: 'sent' };
    const result = applyAcceptQuoteMeta(meta);
    expect(result.status).toBe('active');
  });

  it('legacy Quoted job (no status field) moves to On when customer signs', () => {
    const meta = { quoteStatus: 'sent' }; // no status — old format
    const result = applyAcceptQuoteMeta(meta);
    expect(result.status).toBe('active');
  });

  it('already-On job (status:"active") signing again does not change status', () => {
    const meta = { status: 'active', quoteStatus: 'sent' };
    const result = applyAcceptQuoteMeta(meta);
    expect(result.status).toBe('active'); // unchanged (isCurrentlyQuoted false → no patch)
  });

  it('Invoiced job (status:"invoice_sent") signing does not regress to On', () => {
    const meta = { status: 'invoice_sent', quoteStatus: 'sent' };
    const result = applyAcceptQuoteMeta(meta);
    expect(result.status).toBe('invoice_sent');
  });

  it('Paid job (status:"paid") signing does not time-travel backwards', () => {
    const meta = { status: 'paid', quoteStatus: 'sent' };
    const result = applyAcceptQuoteMeta(meta);
    expect(result.status).toBe('paid');
  });

  it('quoteStatus is always set to "accepted" regardless of stage guard', () => {
    const quoted = { status: 'quoted', quoteStatus: 'sent' };
    const paid   = { status: 'paid',   quoteStatus: 'sent' };
    expect(applyAcceptQuoteMeta(quoted).quoteStatus).toBe('accepted');
    expect(applyAcceptQuoteMeta(paid).quoteStatus).toBe('accepted');
  });

  it('jobStatus is also set to "active" for legacy compat when Quoted', () => {
    const meta = { status: 'quoted' };
    const result = applyAcceptQuoteMeta(meta);
    expect(result.jobStatus).toBe('active');
  });
});

// ── E. Trader-side convert / signature (handleConvert, handleSignatureSave) ───

describe('E. trader-side quote accept: Quoted → On', () => {
  it('Quoted job (status:"quoted") moves to On via handleConvert', () => {
    const job = { id: '1', status: 'quoted' };
    const result = applyConvertPatch(job);
    expect(result.status).toBe('active');
  });

  it('On job (status:"active") convert does not change status (already moved)', () => {
    const job = { id: '2', status: 'active' };
    const result = applyConvertPatch(job);
    // stagePatch('On') not applied — job stays at whatever status it has
    expect(result.status).toBe('active');
  });

  it('Lead job (status:"lead") convert does not move to On (not Quoted yet)', () => {
    const job = { id: '3', status: 'lead' };
    const result = applyConvertPatch(job);
    expect(result.status).toBe('lead');
  });

  it('Paid job convert does not regress', () => {
    const job = { id: '4', status: 'paid' };
    const result = applyConvertPatch(job);
    expect(result.status).toBe('paid');
  });

  it('quoteStatus is set to "accepted" in all cases', () => {
    const job = { id: '5', status: 'quoted' };
    expect(applyConvertPatch(job).quoteStatus).toBe('accepted');
  });

  it('stagePatch("On") sets status:"active" — regression guard', () => {
    const patch = stagePatch('On');
    expect(patch.status).toBe('active');
  });
});
