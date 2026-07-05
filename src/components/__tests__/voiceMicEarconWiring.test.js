/**
 * voiceMicEarconWiring.test.js — regression tests for WHEN the voice-quote
 * mic start/stop earcons + haptic fire in AddJobModal.jsx's
 * startQuoteListening().
 *
 * Mounting AddJobModal would require the full modal dependency tree
 * (materials, estimator quota, draft autosave, a Supabase-backed profile,
 * etc.) — this file mirrors the exact r.onstart / r.onend wiring instead,
 * matching the established mirror-function convention used by
 * paymentSoundTrigger.test.js. If this wiring is ever extracted into an
 * importable helper, replace the mirror with a real import and delete this
 * comment.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mirrors the r.onstart / r.onend assignments inside startQuoteListening()
// in src/components/AddJobModal.jsx.
function attachRecognitionEarcons(r, { playMicStartEarcon, playMicStopEarcon, haptic, manualOverrideRef, onRealEnd }) {
  r.onstart = () => {
    playMicStartEarcon();
    haptic('light');
  };
  r.onend = () => {
    playMicStopEarcon();
    haptic('light');
    if (manualOverrideRef.current) { manualOverrideRef.current = false; return; }
    onRealEnd?.();
  };
}

describe('voice-quote mic earcon + haptic wiring', () => {
  let playMicStartEarcon, playMicStopEarcon, haptic;

  beforeEach(() => {
    playMicStartEarcon = vi.fn();
    playMicStopEarcon = vi.fn();
    haptic = vi.fn();
  });

  it('fires the start earcon + a light haptic on recognition onstart (mic truly armed)', () => {
    const r = {};
    attachRecognitionEarcons(r, { playMicStartEarcon, playMicStopEarcon, haptic, manualOverrideRef: { current: false } });
    r.onstart();
    expect(playMicStartEarcon).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith('light');
    expect(playMicStopEarcon).not.toHaveBeenCalled();
  });

  it('fires the stop earcon + a light haptic on recognition onend (silence auto-stop / natural end)', () => {
    const r = {};
    const onRealEnd = vi.fn();
    attachRecognitionEarcons(r, { playMicStartEarcon, playMicStopEarcon, haptic, manualOverrideRef: { current: false }, onRealEnd });
    r.onend();
    expect(playMicStopEarcon).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith('light');
    expect(onRealEnd).toHaveBeenCalledTimes(1); // the real parse/status logic still runs
  });

  it('fires the stop earcon + haptic on a manual "Done" tap too (manualOverride path)', () => {
    const r = {};
    const onRealEnd = vi.fn();
    const manualOverrideRef = { current: true };
    attachRecognitionEarcons(r, { playMicStartEarcon, playMicStopEarcon, haptic, manualOverrideRef, onRealEnd });
    r.onend();
    expect(playMicStopEarcon).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith('light');
    // manualOverride short-circuits the parse/status logic below the cue,
    // but the cue itself still fires — it must always match true mic state.
    expect(onRealEnd).not.toHaveBeenCalled();
    expect(manualOverrideRef.current).toBe(false); // flag reset for the next session
  });

  it('onstart never triggers the stop cue, and onend never re-triggers the start cue', () => {
    const r = {};
    attachRecognitionEarcons(r, { playMicStartEarcon, playMicStopEarcon, haptic, manualOverrideRef: { current: false } });
    r.onstart();
    expect(playMicStopEarcon).not.toHaveBeenCalled();
    r.onend();
    expect(playMicStartEarcon).toHaveBeenCalledTimes(1); // still just the one call from onstart
  });
});

// ── Real module integration: mute gates sound only, haptic + safety hold ──

describe('voice-quote mic earcon wiring — mute gates sound only, never the haptic', () => {
  // Each test below dynamically imports ../../lib/voiceEarcons.js with a
  // stubbed window/localStorage — reset after every test so the module-level
  // AudioContext singleton and the stub never leak into other test files.
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('muted: playMicStartEarcon plays no sound, but the call site haptic still fires', async () => {
    vi.resetModules();
    const audioCtorSpy = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => '0', setItem: vi.fn() }); // jp.sound_on_voice = muted
    vi.stubGlobal('window', { AudioContext: audioCtorSpy });
    const { playMicStartEarcon } = await import('../../lib/voiceEarcons.js');
    const hapticSpy = vi.fn();

    const r = {};
    attachRecognitionEarcons(r, {
      playMicStartEarcon,
      playMicStopEarcon: vi.fn(),
      haptic: hapticSpy,
      manualOverrideRef: { current: false },
    });
    r.onstart();

    expect(audioCtorSpy).not.toHaveBeenCalled(); // no sound
    expect(hapticSpy).toHaveBeenCalledWith('light'); // haptic still fires
  });

  it('a real Web Audio failure inside playMicStopEarcon never throws into onend, and the haptic still fires', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() }); // enabled (default)
    vi.stubGlobal('window', {
      AudioContext: vi.fn(function () { throw new Error('not allowed here'); }),
    });
    const { playMicStopEarcon } = await import('../../lib/voiceEarcons.js');
    const hapticSpy = vi.fn();
    const onRealEnd = vi.fn();

    const r = {};
    attachRecognitionEarcons(r, {
      playMicStartEarcon: vi.fn(),
      playMicStopEarcon,
      haptic: hapticSpy,
      manualOverrideRef: { current: false },
      onRealEnd,
    });

    expect(() => r.onend()).not.toThrow();
    expect(hapticSpy).toHaveBeenCalledWith('light');
    expect(onRealEnd).toHaveBeenCalledTimes(1); // parse/status logic is unaffected by the audio failure
  });
});
