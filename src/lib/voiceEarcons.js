/**
 * voiceEarcons.js — start/stop earcons for the voice-to-quote mic.
 *
 * Voice-to-quote is used eyes-off — the trade is talking to a customer, not
 * looking at the screen — so a short, subtle cue on mic-open and mic-close
 * makes the TRUE SpeechRecognition state obvious without looking:
 *   - playMicStartEarcon() — soft rising two-note (C5 → G5), ~200ms.
 *   - playMicStopEarcon()  — soft falling two-note (G5 → C5), the exact
 *     mirror of the start cue, ~200ms.
 * Both are quieter (lower peak gain) and pitched differently from the
 * payment-received chime (A5 → C#6, see paymentSound.js) so the two never
 * get confused — this reads as a professional voice-memo cue, not a
 * "cha-ching" or a game sound.
 *
 * Shares the payment chime's AudioContext singleton (getAudioCtx(), see
 * paymentSound.js) instead of opening a second context — that context is
 * the one unlocked by the app's first-gesture listener in AppShell.jsx, so
 * reusing it means these earcons can play without needing their own
 * separate unlock step.
 *
 * Gated by its own Settings toggle ('jp.sound_on_voice', default on) so a
 * trade can mute mic earcons independently of the payment chime — e.g. kept
 * on in a noisy van, muted in a quiet client's front room. The haptic that
 * accompanies these cues at the call site (see AddJobModal.jsx) is NOT
 * gated by this toggle and always fires — it's the functional half of the
 * cue, the sound is the decorative half.
 *
 * Exports:
 *   isVoiceSoundEnabled()      → boolean, reads 'jp.sound_on_voice' (default true)
 *   setVoiceSoundEnabled(bool) → persists the Settings toggle
 *   playMicStartEarcon()       → plays the rising cue if enabled; never throws
 *   playMicStopEarcon()        → plays the falling cue if enabled; never throws
 */

import { getAudioCtx } from './paymentSound.js';

const KEY = 'jp.sound_on_voice';

// Quieter than the payment chime's 0.18 peak — a cue, not a celebration.
const PEAK = 0.12;

export function isVoiceSoundEnabled() {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setVoiceSoundEnabled(enabled) {
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

  // Soft attack, gentle exponential decay — matches paymentSound.js's "ping"
  // shape so every synthesized UI sound in the app shares one sonic language.
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(PEAK, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function playEarcon(freqs) {
  if (!isVoiceSoundEnabled()) return;
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      // Best-effort; if it stays suspended the tones below just produce no
      // audible output, which is still not an error.
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    playTone(ctx, freqs[0], now, 0.10);
    playTone(ctx, freqs[1], now + 0.09, 0.11);
  } catch {
    // Fail silently — never interrupt the voice-quote flow. The haptic at
    // the call site already carries this moment functionally.
  }
}

/**
 * Soft rising two-note (C5 523.25Hz → G5 783.99Hz), ~200ms total, low gain.
 * Call this from SpeechRecognition's real `onstart` — the mic has actually
 * armed, not just the button tap — so the cue always matches true mic state.
 */
export function playMicStartEarcon() {
  playEarcon([523.25, 783.99]);
}

/**
 * Soft falling two-note (G5 783.99Hz → C5 523.25Hz) — the exact mirror of
 * the start cue, ~200ms total. Call this from SpeechRecognition's real
 * `onend`, whatever caused it (silence auto-stop, the "Done" tap, or an
 * error that ends the session) — `onend` always fires when a recognition
 * session truly terminates, so this always matches true mic state.
 */
export function playMicStopEarcon() {
  playEarcon([783.99, 523.25]);
}
