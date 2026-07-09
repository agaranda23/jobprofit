/**
 * quoteAcceptedFeedbackTrigger.test.js — regression tests for WHEN AppShell's
 * realtime handler fires haptic('success') + playAcceptedEarcon() alongside
 * the "{customer} accepted your quote" toast (feat/premium-feel-moments).
 *
 * Mirrors the trigger condition inside AppShell.jsx's handleJobChange:
 *   payload.eventType === 'UPDATE'
 *   && incomingMeta.quoteStatus === 'accepted'
 *   && prevQuoteStatus !== 'accepted'   (isNewDecision — no re-fire on echo)
 *   && incoming.id
 *
 * Testing this inside a mounted AppShell would require the full render tree
 * (Supabase, Stripe, 50+ deps) — this file mirrors the exact boolean logic
 * instead, matching the established convention in paymentSoundTrigger.test.js
 * and realtimeDebounce.test.js. If this predicate is ever extracted into an
 * importable helper, replace the mirror with a real import and delete this
 * comment.
 */

import { describe, it, expect } from 'vitest';

function shouldPlayAcceptedFeedback(payload, prevQuoteStatus) {
  if (payload.eventType !== 'UPDATE' || !payload.new) return false;
  const incoming = payload.new;
  const incomingMeta = (incoming.meta && typeof incoming.meta === 'object') ? incoming.meta : {};
  const newQuoteStatus = incomingMeta.quoteStatus;
  if (newQuoteStatus !== 'accepted') return false;
  if (!incoming.id) return false;
  return prevQuoteStatus !== newQuoteStatus;
}

describe('quote-accepted feedback (haptic + earcon) — trigger logic', () => {
  it('fires on a genuinely new remote acceptance', () => {
    const payload = { eventType: 'UPDATE', new: { id: 'job1', meta: { quoteStatus: 'accepted' } } };
    expect(shouldPlayAcceptedFeedback(payload, 'sent')).toBe(true);
  });

  it('does NOT re-fire on a subsequent sync echo of the same acceptance', () => {
    const payload = { eventType: 'UPDATE', new: { id: 'job1', meta: { quoteStatus: 'accepted' } } };
    expect(shouldPlayAcceptedFeedback(payload, 'accepted')).toBe(false);
  });

  it('does NOT fire for a decline', () => {
    const payload = { eventType: 'UPDATE', new: { id: 'job1', meta: { quoteStatus: 'declined' } } };
    expect(shouldPlayAcceptedFeedback(payload, 'sent')).toBe(false);
  });

  it('does NOT fire for an INSERT or DELETE event', () => {
    const insertPayload = { eventType: 'INSERT', new: { id: 'job1', meta: { quoteStatus: 'accepted' } } };
    const deletePayload = { eventType: 'DELETE', new: null };
    expect(shouldPlayAcceptedFeedback(insertPayload, 'sent')).toBe(false);
    expect(shouldPlayAcceptedFeedback(deletePayload, 'sent')).toBe(false);
  });

  it('does NOT fire for an unrelated field update with no quoteStatus change', () => {
    const payload = { eventType: 'UPDATE', new: { id: 'job1', meta: { quoteStatus: 'sent' } } };
    expect(shouldPlayAcceptedFeedback(payload, 'sent')).toBe(false);
  });

  it('does NOT fire when the row has no id', () => {
    const payload = { eventType: 'UPDATE', new: { meta: { quoteStatus: 'accepted' } } };
    expect(shouldPlayAcceptedFeedback(payload, 'sent')).toBe(false);
  });
});
