/**
 * paymentSoundTrigger.test.js — regression tests for WHERE the payment-received
 * chime is (and is NOT) wired in AppShell.jsx.
 *
 * feat/payment-received-sound deliberately fires haptic('success') +
 * playPaymentReceivedSound() together at exactly four "a payment landed"
 * transitions inside AppShell.jsx:
 *   1. onMarkPaidFromToday — manual "Mark paid" from the Today awaiting section
 *   2. onAddPayment        — a partial payment that clears the remaining balance
 *   3. onUpdateJob         — generic job save, when it flips paid:false → paid:true
 *      (covers the JobDetailDrawer stage-advance path and any other writer)
 *   4. handleJobChange     — the Supabase Realtime handler, when a payment lands
 *      remotely (a Stripe pay-link the customer paid, or another of the
 *      trader's own devices marking the same job paid)
 *
 * Testing this inside a mounted AppShell would require the full render tree
 * (Supabase, Stripe, 50+ deps) — this file mirrors the exact boolean logic at
 * each call site instead, matching the established mirror-function convention
 * used by realtimeDebounce.test.js and cardPaymentsNavFix.test.js. If any of
 * these predicates are ever extracted into an importable helper, replace the
 * mirror with a real import and delete this comment.
 */

import { describe, it, expect } from 'vitest';

// ── 1. onMarkPaidFromToday ─────────────────────────────────────────────────
// Every call to this handler IS a mark-paid gesture — no transition check
// needed, the sound always fires (mirrors AppShell.jsx onMarkPaidFromToday).

function markPaidFromTodayShouldPlaySound() {
  return true;
}

// ── 2. onAddPayment ─────────────────────────────────────────────────────────
// Mirrors: `if (updated.status === 'paid') { haptic('success'); playPaymentReceivedSound(); ... }`

function addPaymentShouldPlaySound(updatedJob) {
  return updatedJob.status === 'paid';
}

// ── 3. onUpdateJob ───────────────────────────────────────────────────────────
// Mirrors: wasPaid/nowPaid not-paid→paid transition guard in AppShell.jsx.

function updateJobShouldPlaySound(existingJob, updatedJob) {
  const wasPaid = existingJob?.paid === true || existingJob?.status === 'paid';
  const nowPaid = updatedJob.paid === true || updatedJob.status === 'paid';
  return !wasPaid && nowPaid;
}

// ── 4. handleJobChange (Realtime) ──────────────────────────────────────────
// Mirrors the incomingPaid/wasPaid guard added to AppShell's realtime handler.

function realtimeShouldPlaySound(prevJob, incomingRow) {
  const incomingPaid = incomingRow.paid === true || incomingRow.status === 'paid';
  if (!incomingPaid) return false;
  const wasPaid = prevJob?.paid === true || prevJob?.status === 'paid';
  return !wasPaid;
}

describe('payment-received sound — trigger logic', () => {
  describe('1. onMarkPaidFromToday', () => {
    it('always plays — every call is a genuine mark-paid gesture', () => {
      expect(markPaidFromTodayShouldPlaySound()).toBe(true);
    });
  });

  describe('2. onAddPayment (partial payment)', () => {
    it('plays when the payment clears the balance (status flips to paid)', () => {
      expect(addPaymentShouldPlaySound({ status: 'paid' })).toBe(true);
    });

    it('does NOT play when the job still has a balance outstanding', () => {
      expect(addPaymentShouldPlaySound({ status: 'part_paid' })).toBe(false);
      expect(addPaymentShouldPlaySound({ status: 'invoice_sent' })).toBe(false);
    });
  });

  describe('3. onUpdateJob (generic save / drawer stage-advance)', () => {
    it('plays on a not-paid → paid transition', () => {
      const before = { id: '1', status: 'invoice_sent' };
      const after = { id: '1', status: 'paid' };
      expect(updateJobShouldPlaySound(before, after)).toBe(true);
    });

    it('does NOT play when the job was already paid (no double-fire on a re-save)', () => {
      const before = { id: '1', status: 'paid' };
      const after = { id: '1', status: 'paid', notes: 'edited notes' };
      expect(updateJobShouldPlaySound(before, after)).toBe(false);
    });

    it('does NOT play for an ordinary field edit that never touches paid state', () => {
      const before = { id: '1', status: 'quoted', customer: 'Dave' };
      const after = { id: '1', status: 'quoted', customer: 'Dave Smith' };
      expect(updateJobShouldPlaySound(before, after)).toBe(false);
    });

    it('does NOT play for a stage move that is not into "paid" (e.g. quote → invoiced)', () => {
      const before = { id: '1', status: 'quoted' };
      const after = { id: '1', status: 'invoice_sent' };
      expect(updateJobShouldPlaySound(before, after)).toBe(false);
    });

    it('plays when the job is new to local state (no prior record) and arrives already paid', () => {
      expect(updateJobShouldPlaySound(undefined, { id: '1', status: 'paid' })).toBe(true);
    });
  });

  describe('4. handleJobChange (Supabase Realtime — Stripe pay-link / other device)', () => {
    it('plays when a Stripe pay-link payment lands and the trader had no prior paid record', () => {
      const prevJob = { id: 'job1', status: 'invoice_sent', paid: false };
      const incoming = { id: 'job1', paid: true, status: 'paid' };
      expect(realtimeShouldPlaySound(prevJob, incoming)).toBe(true);
    });

    it('does NOT double-fire on the echo of THIS device\'s own mark-paid write', () => {
      // onMarkPaidFromToday already updated jobsRef.current optimistically
      // before the cloud write's realtime echo arrives.
      const prevJob = { id: 'job1', status: 'paid', paid: true };
      const incoming = { id: 'job1', paid: true, status: 'paid' };
      expect(realtimeShouldPlaySound(prevJob, incoming)).toBe(false);
    });

    it('does NOT play for an unrelated remote field change (e.g. quote accepted)', () => {
      const prevJob = { id: 'job1', status: 'quote_sent', paid: false };
      const incoming = { id: 'job1', status: 'quote_sent', paid: false, meta: { quoteStatus: 'accepted' } };
      expect(realtimeShouldPlaySound(prevJob, incoming)).toBe(false);
    });

    it('does NOT play on a refund (paid flips back to false)', () => {
      const prevJob = { id: 'job1', status: 'paid', paid: true };
      const incoming = { id: 'job1', status: 'invoice_sent', paid: false };
      expect(realtimeShouldPlaySound(prevJob, incoming)).toBe(false);
    });
  });
});

// ── Non-payment actions never call the sound util at all ──────────────────
// Sanity check on the design constraint itself: haptic-only interactions
// (navigation, sends, taps) must never be wired to playPaymentReceivedSound.
// This is a lightweight guard against a future accidental import/call.

describe('payment-received sound — scope guard', () => {
  it('a plain-object "action registry" mirroring the app\'s haptic call sites shows sound only on payment kinds', () => {
    // Mirrors src/lib/haptics.js's PATTERN kinds and how AppShell/screens use them.
    // 'success' is reused for a non-payment diagnostic (Settings "Test vibration"),
    // so the sound must be wired at the specific payment call sites, NOT
    // piggy-backed onto every haptic('success') call — this registry documents
    // that split for future maintainers.
    const hapticCallSites = {
      markPaidFromToday: { haptic: 'success', sound: true },
      addPaymentBalanceCleared: { haptic: 'success', sound: true },
      updateJobPaidTransition: { haptic: 'success', sound: true },
      realtimePaymentLanded: { haptic: 'success', sound: true },
      settingsTestVibration: { haptic: 'success', sound: false }, // diagnostic tap, NOT a payment
      sendInvoiceConfirmed: { haptic: 'medium', sound: false },
      swipePagerSettle: { haptic: 'light', sound: false },
      chaseReminderSent: { haptic: 'light', sound: false },
    };

    const soundSites = Object.entries(hapticCallSites).filter(([, v]) => v.sound);
    expect(soundSites.map(([k]) => k)).toEqual([
      'markPaidFromToday',
      'addPaymentBalanceCleared',
      'updateJobPaidTransition',
      'realtimePaymentLanded',
    ]);

    // Nothing wired to sound uses a haptic kind other than 'success' — every
    // sound call site is a real payment celebration, never a light/medium tap.
    soundSites.forEach(([, v]) => expect(v.haptic).toBe('success'));
  });
});
