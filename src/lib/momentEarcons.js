/**
 * momentEarcons.js — iOS-safe sound partners for the app's "money keeps
 * moving" haptic-only moments (send invoice/quote, chase reminder sent,
 * customer accepted a quote).
 *
 * Why this file exists: src/lib/haptics.js's navigator.vibrate() is a no-op
 * on iOS Safari/PWA (documented there). Before this file, "send invoice",
 * "chase sent" and "quote accepted" fired a haptic and NOTHING ELSE — on an
 * iPhone that's zero feedback, which reads as broken/unresponsive on the
 * exact device premium is judged on. These earcons are the fallback layer
 * that plays alongside (never instead of) the existing haptic() calls.
 *
 * Sonic language: shares the Web Audio plumbing + soft-attack/exponential-
 * decay "ping" shape already established by paymentSound.js (mark-paid) and
 * voiceEarcons.js (mic start/stop), but uses its own frequencies so none of
 * the app's synthesized cues are confusable with each other:
 *   mic cues        — C5 523.25 / G5 783.99   (voiceEarcons.js)
 *   payment chime    — A5 880.00 / C#6 1108.73 (paymentSound.js)
 *   send earcon      — F5 698.46 (single tone, this file)
 *   accepted earcon  — G#5 830.61 / C6 1046.50 (this file)
 *
 * Gating: reuses the existing "Sound when you get paid" toggle
 * (isSoundOnPaymentEnabled, see paymentSound.js) rather than adding a new
 * Settings row — every sound in this file is part of the same money
 * lifecycle the toggle already governs (quote accepted → invoice sent →
 * paid), so a trader who mutes "sound when you get paid" most likely wants
 * the whole family quiet, not just the final chime.
 *
 * Exports:
 *   playSendEarcon()     — a job/quote/chase reminder just went out
 *   playAcceptedEarcon() — a customer just said yes to a quote
 * Both are enabled/disabled together by isSoundOnPaymentEnabled() and never throw.
 */

import { getAudioCtx, isSoundOnPaymentEnabled } from './paymentSound.js';

function playTone(ctx, frequency, startTime, duration, peak) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;

  // Soft attack, gentle exponential decay — matches paymentSound.js/voiceEarcons.js
  // so every synthesized UI sound in the app shares one sonic language.
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

/**
 * Soft single "F5" tone (698.46Hz), ~110ms, low gain (0.10) — a quiet, quick
 * "that went out" confirm. Deliberately a single note (not a two-note cue
 * like the mic/payment sounds) so it reads as lighter and doesn't compete
 * with them, and stays tasteful when fired often (send invoice, send quote,
 * chase reminder sent can all happen several times in one session).
 */
export function playSendEarcon() {
  if (!isSoundOnPaymentEnabled()) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    playTone(ctx, 698.46, ctx.currentTime, 0.14, 0.10);
  } catch {
    // Fail silently — the haptic at the call site already carries this
    // moment functionally; sound is a bonus, never a dependency.
  }
}

/**
 * Soft rising two-note (G#5 830.61Hz → C6 1046.50Hz), ~180ms total, gain 0.14
 * — brighter and a touch louder than playSendEarcon (this is good news
 * arriving, not an outbound action) but still clearly a notch below the
 * mark-paid chime (peak 0.18) so money-in stays the biggest moment.
 */
export function playAcceptedEarcon() {
  if (!isSoundOnPaymentEnabled()) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    playTone(ctx, 830.61, now, 0.13, 0.14);
    playTone(ctx, 1046.50, now + 0.07, 0.15, 0.14);
  } catch {
    // Fail silently — never interrupt the realtime notification flow.
  }
}
