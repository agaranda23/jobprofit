/**
 * paymentSound.js — the one "payment received" chime.
 *
 * Fires on exactly one moment: money landing (mark-paid / partial payment
 * clears the balance). Synthesized via the Web Audio API — no shipped audio
 * asset, no bundle weight, fully tunable without touching call sites.
 *
 * iOS Safari/PWA will not produce sound from an AudioContext until it has
 * been unlocked by a user gesture. unlockAudioContext() is called once, on
 * the app's first pointerdown/touchstart (see AppShell.jsx), so a later,
 * async mark-paid write can still play. If the context never unlocks — the
 * device is on silent (Web Audio generally won't sound through the iOS
 * hardware mute switch, which is expected and fine), the tab is backgrounded,
 * or the browser blocks it — playPaymentReceivedSound() fails silently. The
 * haptic + PaidCelebration overlay already carry this moment; sound is a
 * bonus, never a dependency, and must never throw into a payment flow.
 *
 * Exports:
 *   isSoundOnPaymentEnabled()      → boolean, reads 'jp.sound_on_payment' (default true)
 *   setSoundOnPaymentEnabled(bool) → persists the Settings toggle
 *   unlockAudioContext()           → call once on the first user gesture
 *   playPaymentReceivedSound()     → plays the chime if enabled; never throws
 */

const KEY = 'jp.sound_on_payment';

let audioCtx = null;

function getAudioCtx() {
  if (audioCtx) return audioCtx;
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

/**
 * Call once on the first user gesture (pointerdown/touchstart) so a later,
 * gesture-less call to playPaymentReceivedSound() (e.g. after an async
 * mark-paid write completes) is allowed to produce sound on iOS Safari.
 * Safe to call repeatedly — resuming an already-running context is a no-op.
 */
export function unlockAudioContext() {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    // Never let audio setup interfere with the rest of the app.
  }
}

export function isSoundOnPaymentEnabled() {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setSoundOnPaymentEnabled(enabled) {
  try {
    localStorage.setItem(KEY, enabled ? '1' : '0');
  } catch {
    // Private browsing may block localStorage writes — not fatal.
  }
}

function playTone(ctx, frequency, startTime, duration) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = frequency;

  // Soft attack, gentle exponential decay — a "ping", not a cash-register hit.
  const peak = 0.18;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

/**
 * Soft two-note "ping" — a rising major third (A5 → C#6), ~380ms total,
 * low gain. Plays only when the Settings toggle is on. Every failure mode
 * (no Web Audio support, a still-suspended context, an exception from the
 * browser) is swallowed here so this can never interrupt the mark-paid
 * flow that calls it.
 */
export function playPaymentReceivedSound() {
  if (!isSoundOnPaymentEnabled()) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      // Best-effort; if it stays suspended the tones below just produce no
      // audible output, which is still not an error.
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    playTone(ctx, 880.0, now, 0.22);          // A5
    playTone(ctx, 1108.73, now + 0.09, 0.28); // C#6 — a beat later, rising
  } catch {
    // Fail silently — the haptic + PaidCelebration overlay already cover
    // this moment.
  }
}
