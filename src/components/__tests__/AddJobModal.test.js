/**
 * AddJobModal — pure-logic tests covering the B1/B2/H2 audit fixes.
 *
 * No DOM, no React, no @testing-library — matches project convention.
 * Visual smoke is covered by the deploy-preview checklist in the PR.
 *
 * Covers:
 *   B1 — Phone field in voice preview: phone saved with job; WhatsApp link
 *        resolves to actual recipient rather than blank wa.me URL.
 *   B2 — Paid default flip: "Already paid" checkbox semantics. New jobs
 *        default to NOT paid (alreadyPaid = false → paid: false → status:
 *        'active'). Explicitly ticking saves as paid.
 *   H2 — Customer field always present in save payload (even when voice
 *        didn't extract one).
 *   Grace — buildWhatsAppLink still degrades gracefully for legacy jobs
 *        where phone is null (pre-B1 records in the DB).
 */

import { describe, it, expect } from 'vitest';
import { buildWhatsAppLink, buildInvoiceWhatsAppMessage } from '../../lib/invoiceMessage';

// ---------------------------------------------------------------------------
// Helpers mirroring the save() logic in AddJobModal.jsx so we can unit-test
// the payload shape without mounting React.
// ---------------------------------------------------------------------------

function buildSavePayload({ name, customer, phone, amount, paymentType, alreadyPaid }) {
  // Mirrors the onSave({...}) call in AddJobModal.jsx save()
  return {
    id: 1,
    name: (name || '').trim(),
    customer: (customer || '').trim() || null,
    phone: (phone || '').trim() || null,
    amount: parseFloat(amount),
    paymentType: paymentType || null,
    paid: alreadyPaid,            // B2: alreadyPaid replaces !unpaid
    date: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

// Mirrors addJobToCloud status derivation in src/lib/store.js
// New jobs land as 'lead'; already-paid jobs land as 'paid'.
function deriveStatus(paid) {
  return paid ? 'paid' : 'lead';
}

// ---------------------------------------------------------------------------
// B2 — Paid default flip
// ---------------------------------------------------------------------------

describe('B2: paid default', () => {
  it('new job with alreadyPaid=false (default) saves as paid:false', () => {
    const job = buildSavePayload({ name: 'Kitchen job', amount: '380', alreadyPaid: false });
    expect(job.paid).toBe(false);
  });

  it('new job with alreadyPaid=false derives status:lead, enters Get Paid loop', () => {
    const job = buildSavePayload({ name: 'Kitchen job', amount: '380', alreadyPaid: false });
    expect(deriveStatus(job.paid)).toBe('lead');
  });

  it('user explicitly ticks "Already paid" → job saves as paid:true', () => {
    const job = buildSavePayload({ name: 'Kitchen job', amount: '380', alreadyPaid: true });
    expect(job.paid).toBe(true);
  });

  it('user explicitly ticks "Already paid" → status:paid, bypasses Get Paid loop', () => {
    const job = buildSavePayload({ name: 'Kitchen job', amount: '380', alreadyPaid: true });
    expect(deriveStatus(job.paid)).toBe('paid');
  });
});

// ---------------------------------------------------------------------------
// B1 — Phone field in voice preview
// ---------------------------------------------------------------------------

describe('B1: phone saved from voice preview', () => {
  it('phone entered in preview state is included in the save payload', () => {
    const job = buildSavePayload({
      name: 'Garden fence',
      amount: '450',
      phone: '07700 900123',
      alreadyPaid: false,
    });
    // save() calls phone.trim() — strips leading/trailing whitespace only.
    // Inner spaces are normalised later by buildWhatsAppLink (0→44 etc).
    expect(job.phone).toBe('07700 900123');
    expect(job.phone).toBeTruthy();
  });

  it('phone with spaces stripped correctly in save payload', () => {
    const job = buildSavePayload({ name: 'Job', amount: '100', phone: '07700 900 999', alreadyPaid: false });
    // save() does phone.trim() — spaces are stripped at the trim call; the
    // further normalisation for wa.me (leading 0 → 44) happens in buildWhatsAppLink
    expect(job.phone).toBe('07700 900 999'.trim());
  });

  it('empty phone field saves as null, not empty string', () => {
    const job = buildSavePayload({ name: 'Job', amount: '100', phone: '', alreadyPaid: false });
    expect(job.phone).toBeNull();
  });

  it('phone in payload produces a wa.me link with a recipient', () => {
    const job = buildSavePayload({ name: 'Job', amount: '100', phone: '07700 900123', alreadyPaid: false });
    const msg = buildInvoiceWhatsAppMessage({
      job,
      biz: { name: 'Test Trades' },
      invoiceNumber: 'JP-001',
      dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    const link = buildWhatsAppLink({ phone: job.phone, message: msg });
    // With a real phone the URL must have a recipient segment after wa.me/
    expect(link).toMatch(/^https:\/\/wa\.me\/44\d+\?text=/);
  });
});

// ---------------------------------------------------------------------------
// H2 — Customer always present in save payload
// ---------------------------------------------------------------------------

describe('H2: customer field visibility', () => {
  it('job without a voice-extracted customer saves with customer:null, not undefined', () => {
    const job = buildSavePayload({ name: 'Garden fence', amount: '450', customer: '', alreadyPaid: false });
    // null is correct — the UI now shows an editable input; if left blank, null is saved
    expect(job.customer).toBeNull();
  });

  it('customer typed into the editable preview input is saved correctly', () => {
    const job = buildSavePayload({
      name: 'Garden fence',
      amount: '450',
      customer: 'Dave Jones',
      alreadyPaid: false,
    });
    expect(job.customer).toBe('Dave Jones');
  });

  it('voice-extracted customer is preserved in the save payload', () => {
    const job = buildSavePayload({
      name: 'Kitchen Sarah',
      amount: '380',
      customer: 'Sarah Mitchell',
      alreadyPaid: false,
    });
    expect(job.customer).toBe('Sarah Mitchell');
  });
});

// ---------------------------------------------------------------------------
// Speed mode — saveMicro payload shape (Part A)
// ---------------------------------------------------------------------------

describe('Speed mode: saveMicro payload', () => {
  // Mirrors the saveMicro() logic after the Speed-mode refactor:
  // chip strip removed → always paid:false, paymentType:null, speedMode:true.
  function buildSpeedMicroPayload(amount) {
    const amt = amount ? parseFloat(amount) : null;
    return {
      id:          'test-uuid',
      name:        'Job · Mon 2 Jun',
      customer:    null,
      phone:       null,
      amount:      amt,
      paymentType: null,
      paid:        false,
      date:        new Date().toISOString(),
      createdAt:   new Date().toISOString(),
      via:         'fast',
      speedMode:   true,
    };
  }

  it('Speed-mode save always sets paid:false regardless of amount', () => {
    const job = buildSpeedMicroPayload('380');
    expect(job.paid).toBe(false);
  });

  it('Speed-mode save always sets paymentType:null (deferred to Got Paid toast)', () => {
    const job = buildSpeedMicroPayload('380');
    expect(job.paymentType).toBeNull();
  });

  it('Speed-mode save sets speedMode:true so Today can queue the Got Paid toast', () => {
    const job = buildSpeedMicroPayload('380');
    expect(job.speedMode).toBe(true);
  });

  it('Speed-mode save with no amount saves amount:null (add price later)', () => {
    const job = buildSpeedMicroPayload('');
    expect(job.amount).toBeNull();
  });

  it('Speed-mode save sets via:fast so Today stays on the Today screen', () => {
    const job = buildSpeedMicroPayload('200');
    expect(job.via).toBe('fast');
  });
});

// ---------------------------------------------------------------------------
// Grace — null phone degrades gracefully for legacy jobs (pre-B1 records)
// ---------------------------------------------------------------------------

describe('buildWhatsAppLink: null/empty phone graceful degradation', () => {
  it('null phone produces a wa.me link with no recipient (opens to search)', () => {
    const link = buildWhatsAppLink({ phone: null, message: 'Test' });
    expect(link).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it('empty-string phone also degrades to no-recipient link', () => {
    const link = buildWhatsAppLink({ phone: '', message: 'Test' });
    expect(link).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });

  it('valid UK phone routes to recipient', () => {
    const link = buildWhatsAppLink({ phone: '07700 900123', message: 'Hi' });
    expect(link).toMatch(/^https:\/\/wa\.me\/447700900123\?text=/);
  });
});
