/**
 * Chase-caller Pay-now wiring tests (PR 2 deferred item).
 *
 * Verifies that the wiring from the pre-fetched payNowUrl → buildChaseLink
 * produces a WhatsApp URL containing the Pay-now line for connected traders
 * on chase-eligible jobs.
 *
 * Tests mirror the exact logic from WorkScreen.chaseJobTiered and
 * JobDetailDrawer.handleChase rather than rendering those components, because:
 *  - Both callers delegate entirely to buildChaseLink with payNowUrl threaded in.
 *  - The fetch / supabase pre-fetch logic is already tested in
 *    src/lib/__tests__/chaseMessagePayNow.test.js (E, F sections).
 *  - Component-render tests for WorkScreen would require heavy mocking of
 *    supabase, fetch, and window.open for modest signal gain.
 *
 * What these tests actually assert:
 *  G. When payNowUrl is in the Map and passed to buildChaseLink, the WhatsApp
 *     URL encodes the Pay-now line (connected trader path).
 *  H. When payNowUrl is absent from the Map (Map.get returns undefined),
 *     passing '' to buildChaseLink produces an unmodified URL (unconnected trader
 *     or pre-fetch not yet resolved).
 *  I. handlePreDueChase equivalent (tier 0) includes Pay-now when connected.
 *  J. JobDetailDrawer handleChase equivalent includes Pay-now when connected.
 *  K. job.isBusinessCustomer → isB2B threading (feat/chase-b2b-customer-tag).
 *     Every real call site reads `!!job.isBusinessCustomer` (or
 *     `!!promptJob.isBusinessCustomer` in TodayScreen) rather than hardcoding
 *     `isB2B: false` — a regression here would silently keep sending B2C
 *     copy to a tagged business customer's final chase. Mirrors
 *     WorkScreen.chaseJobTiered, WorkScreen.handlePreDueChase, and
 *     TodayScreen's whatsapp/email handlePrimaryCta branches.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildChaseLink, buildChaseMessage } from '../../lib/chaseLadder.js';

// Stub localStorage (chaseLadder reads it for double-send guard)
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
vi.stubGlobal('localStorage', localStorageMock);

const BASE_JOB = {
  id: 'job-abc-123',
  customer: 'Dave Brown',
  summary: 'Bathroom re-tile',
  total: 540,
  customerPhone: '07900123456',
  invoiceDueDate: '2026-05-20', // past — overdue
  invoiceSentAt: '2026-05-13',
};

const BIZ = {
  name: 'Murphy Tiling',
  sortCode: '12-34-56',
  accountNumber: '12345678',
};

const PAY_NOW_URL = 'https://app.jobprofit.co.uk/p/tok_abc123';

// ── G. Connected trader: payNowUrls Map lookup → Pay-now in WhatsApp URL ───

describe('G. Connected trader (batch chase) — Pay-now line in WhatsApp URL', () => {
  it('WorkScreen.chaseJobTiered equivalent passes payNowUrl to buildChaseLink', () => {
    // Simulate the Map.get lookup that chaseJobTiered does:
    const payNowUrls = new Map([[BASE_JOB.id, PAY_NOW_URL]]);
    const payNowUrl = payNowUrls.get(BASE_JOB.id) ?? '';

    const link = buildChaseLink({
      phone: BASE_JOB.customerPhone,
      customerName: BASE_JOB.customer,
      amount: '£540.00',
      jobSummary: BASE_JOB.summary,
      dueDate: BASE_JOB.invoiceDueDate,
      daysOverdue: 11,
      tier: 1,
      amountPaid: 0,
      paymentDetails: 'Sort: 12-34-56 · Acc: 12345678',
      businessName: BIZ.name,
      isB2B: false,
      payNowUrl,
    });

    expect(link).not.toBeNull();
    const decoded = decodeURIComponent(link);
    expect(decoded).toContain(`Pay by card here: ${PAY_NOW_URL}`);
  });

  it('Pay-now line sits above the existing chase copy in the decoded message', () => {
    const payNowUrls = new Map([[BASE_JOB.id, PAY_NOW_URL]]);
    const payNowUrl = payNowUrls.get(BASE_JOB.id) ?? '';

    const link = buildChaseLink({
      phone: BASE_JOB.customerPhone,
      customerName: BASE_JOB.customer,
      amount: '£540.00',
      jobSummary: BASE_JOB.summary,
      dueDate: BASE_JOB.invoiceDueDate,
      daysOverdue: 11,
      tier: 1,
      amountPaid: 0,
      paymentDetails: 'Sort: 12-34-56',
      businessName: BIZ.name,
      isB2B: false,
      payNowUrl,
    });

    const decoded = decodeURIComponent(link);
    const payNowIndex = decoded.indexOf('Pay by card here:');
    // buildChaseMessage greets with first-name-only (Dave), not the full
    // "Dave Brown" passed in — see the 2026-07-03 "Hi Sam doors" name-glitch fix.
    const chaseIndex = decoded.indexOf('Hi Dave');
    // Pay-now line precedes the customer name in the chase copy
    expect(payNowIndex).toBeGreaterThanOrEqual(0);
    expect(chaseIndex).toBeGreaterThan(payNowIndex);
  });
});

// ── H. Unconnected trader: Map.get returns undefined → bare URL unchanged ───

describe('H. Unconnected trader — no Pay-now in WhatsApp URL', () => {
  it('WorkScreen.chaseJobTiered equivalent with empty Map produces bare URL', () => {
    const payNowUrls = new Map(); // no entry for this job
    const payNowUrl = payNowUrls.get(BASE_JOB.id) ?? '';

    const link = buildChaseLink({
      phone: BASE_JOB.customerPhone,
      customerName: BASE_JOB.customer,
      amount: '£540.00',
      jobSummary: BASE_JOB.summary,
      dueDate: BASE_JOB.invoiceDueDate,
      daysOverdue: 11,
      tier: 1,
      amountPaid: 0,
      paymentDetails: '',
      businessName: BIZ.name,
      isB2B: false,
      payNowUrl,
    });

    expect(link).not.toBeNull();
    expect(decodeURIComponent(link)).not.toContain('Pay by card here:');
  });

  it('pre-fetch error path (payNowUrl stays empty string) degrades gracefully', () => {
    // Simulate the fallback: prefetch threw, payNowUrl was never set
    const payNowUrl = '';

    const link = buildChaseLink({
      phone: BASE_JOB.customerPhone,
      customerName: BASE_JOB.customer,
      amount: '£540.00',
      jobSummary: BASE_JOB.summary,
      dueDate: BASE_JOB.invoiceDueDate,
      daysOverdue: 11,
      tier: 1,
      amountPaid: 0,
      paymentDetails: '',
      businessName: BIZ.name,
      isB2B: false,
      payNowUrl,
    });

    expect(link).not.toBeNull();
    expect(decodeURIComponent(link)).not.toContain('Pay by card here:');
  });
});

// ── I. handlePreDueChase equivalent (tier 0, pre-due) ───────────────────────

describe('I. Pre-due chase (tier 0) — Pay-now included when connected', () => {
  it('tier 0 message includes Pay-now when payNowUrl is in the Map', () => {
    const preDueJob = {
      ...BASE_JOB,
      invoiceDueDate: '2026-06-02', // 2 days out
    };
    const payNowUrls = new Map([[preDueJob.id, PAY_NOW_URL]]);
    const payNowUrl = payNowUrls.get(preDueJob.id) ?? '';

    const link = buildChaseLink({
      phone: preDueJob.customerPhone,
      customerName: preDueJob.customer,
      amount: '£540.00',
      jobSummary: preDueJob.summary,
      dueDate: preDueJob.invoiceDueDate,
      daysOverdue: 0,
      tier: 0,
      amountPaid: 0,
      paymentDetails: '',
      businessName: BIZ.name,
      isB2B: false,
      payNowUrl,
    });

    expect(link).not.toBeNull();
    expect(decodeURIComponent(link)).toContain(`Pay by card here: ${PAY_NOW_URL}`);
  });
});

// ── J. JobDetailDrawer.handleChase equivalent ───────────────────────────────

describe('J. JobDetailDrawer handleChase equivalent — Pay-now when connected', () => {
  it('drawer chase with pre-fetched payNowUrl encodes Pay-now in WhatsApp link', () => {
    // Simulate: drawer opened, prefetch resolved, user taps Chase
    const payNowUrl = PAY_NOW_URL; // set by the useEffect on drawer mount

    const link = buildChaseLink({
      phone: BASE_JOB.customerPhone,
      customerName: BASE_JOB.customer,
      amount: '£540.00',
      jobSummary: BASE_JOB.summary,
      dueDate: BASE_JOB.invoiceDueDate,
      daysOverdue: 11,
      tier: 2,
      amountPaid: 0,
      paymentDetails: 'Sort: 12-34-56',
      businessName: BIZ.name,
      isB2B: false,
      payNowUrl,
    });

    expect(link).not.toBeNull();
    expect(decodeURIComponent(link)).toContain(`Pay by card here: ${PAY_NOW_URL}`);
  });

  it('drawer chase without prefetch (unconnected) produces bare link', () => {
    const payNowUrl = ''; // drawer in JobDetailDrawer initialises to ''

    const link = buildChaseLink({
      phone: BASE_JOB.customerPhone,
      customerName: BASE_JOB.customer,
      amount: '£540.00',
      jobSummary: BASE_JOB.summary,
      dueDate: BASE_JOB.invoiceDueDate,
      daysOverdue: 11,
      tier: 2,
      amountPaid: 0,
      paymentDetails: '',
      businessName: BIZ.name,
      isB2B: false,
      payNowUrl,
    });

    expect(link).not.toBeNull();
    expect(decodeURIComponent(link)).not.toContain('Pay by card here:');
  });
});

// ── K. job.isBusinessCustomer → isB2B threading across every chase call site ──

describe('K. job.isBusinessCustomer tag flows into isB2B at every chase call site', () => {
  const B2B_JOB = { ...BASE_JOB, isBusinessCustomer: true };
  const B2C_JOB = { ...BASE_JOB, isBusinessCustomer: false };
  const UNTAGGED_JOB = BASE_JOB; // no isBusinessCustomer key at all — legacy job shape

  it('WorkScreen.chaseJobTiered equivalent: untagged job at tier 3 → B2C copy', () => {
    const link = buildChaseLink({
      phone: UNTAGGED_JOB.customerPhone,
      customerName: UNTAGGED_JOB.customer,
      amount: '£540.00',
      jobSummary: UNTAGGED_JOB.summary,
      dueDate: UNTAGGED_JOB.invoiceDueDate,
      daysOverdue: 20,
      tier: 3,
      amountPaid: 0,
      paymentDetails: '',
      businessName: BIZ.name,
      isB2B: !!UNTAGGED_JOB.isBusinessCustomer,
      payNowUrl: '',
    });
    const decoded = decodeURIComponent(link);
    expect(decoded).not.toContain('Late Payment of Commercial Debts');
    expect(decoded).toContain('last one from me on this');
  });

  it('WorkScreen.chaseJobTiered equivalent: tagged job at tier 3 → B2B statutory-interest copy', () => {
    const link = buildChaseLink({
      phone: B2B_JOB.customerPhone,
      customerName: B2B_JOB.customer,
      amount: '£540.00',
      jobSummary: B2B_JOB.summary,
      dueDate: B2B_JOB.invoiceDueDate,
      daysOverdue: 20,
      tier: 3,
      amountPaid: 0,
      paymentDetails: '',
      businessName: BIZ.name,
      isB2B: !!B2B_JOB.isBusinessCustomer,
      payNowUrl: '',
    });
    const decoded = decodeURIComponent(link);
    expect(decoded).toContain('Late Payment of Commercial Debts Act 1998');
    expect(decoded).not.toContain('last one from me on this');
  });

  it('WorkScreen.handleBatchChaseStep equivalent (delegates to chaseJobTiered): tagged job at tier 3 → B2B copy', () => {
    // Batch chase calls chaseJobTiered(job, biz, null, payNowUrl) with no override —
    // same isB2B derivation as the direct per-job Chase button.
    const link = buildChaseLink({
      phone: B2B_JOB.customerPhone,
      customerName: B2B_JOB.customer,
      amount: '£540.00',
      jobSummary: B2B_JOB.summary,
      dueDate: B2B_JOB.invoiceDueDate,
      daysOverdue: 20,
      tier: 3,
      amountPaid: 0,
      paymentDetails: '',
      businessName: BIZ.name,
      isB2B: !!B2B_JOB.isBusinessCustomer,
      payNowUrl: PAY_NOW_URL,
    });
    const decoded = decodeURIComponent(link);
    expect(decoded).toContain('Late Payment of Commercial Debts Act 1998');
  });

  it('WorkScreen.handlePreDueChase equivalent (tier 0): tagged job never surfaces B2B copy below tier 3', () => {
    const preDueJob = { ...B2B_JOB, invoiceDueDate: '2026-06-02' };
    const link = buildChaseLink({
      phone: preDueJob.customerPhone,
      customerName: preDueJob.customer,
      amount: '£540.00',
      jobSummary: preDueJob.summary,
      dueDate: preDueJob.invoiceDueDate,
      daysOverdue: 0,
      tier: 0,
      amountPaid: 0,
      paymentDetails: '',
      businessName: BIZ.name,
      isB2B: !!preDueJob.isBusinessCustomer,
      payNowUrl: '',
    });
    const decoded = decodeURIComponent(link);
    expect(decoded).not.toContain('Late Payment of Commercial Debts');
  });

  it('TodayScreen handlePrimaryCta (whatsapp) equivalent: tagged promptJob at tier 3 → B2B copy', () => {
    const msg = buildChaseMessage({
      customerName: B2B_JOB.customer,
      amount: '£540.00',
      jobSummary: B2B_JOB.summary,
      invoiceNumber: '',
      daysOverdue: 20,
      tier: 3,
      paymentDetails: '',
      businessName: BIZ.name,
      isB2B: !!B2B_JOB.isBusinessCustomer,
    });
    expect(msg).toContain('Late Payment of Commercial Debts Act 1998');
  });

  it('TodayScreen handlePrimaryCta (email) equivalent: untagged promptJob at tier 3 → B2C copy, no statutory clause', () => {
    const msg = buildChaseMessage({
      customerName: B2C_JOB.customer,
      amount: '£540.00',
      jobSummary: B2C_JOB.summary,
      invoiceNumber: '',
      daysOverdue: 20,
      tier: 3,
      isB2B: !!B2C_JOB.isBusinessCustomer,
    });
    expect(msg).not.toContain('Late Payment of Commercial Debts');
  });

  it('JobDetailDrawer.handleChase equivalent: tagged job below tier 3 (tier 2) never emits B2B copy', () => {
    const link = buildChaseLink({
      phone: B2B_JOB.customerPhone,
      customerName: B2B_JOB.customer,
      amount: '£540.00',
      jobSummary: B2B_JOB.summary,
      dueDate: B2B_JOB.invoiceDueDate,
      daysOverdue: 10,
      tier: 2,
      amountPaid: 0,
      paymentDetails: '',
      businessName: BIZ.name,
      isB2B: !!B2B_JOB.isBusinessCustomer,
      payNowUrl: '',
    });
    const decoded = decodeURIComponent(link);
    expect(decoded).not.toContain('Late Payment of Commercial Debts');
  });
});
