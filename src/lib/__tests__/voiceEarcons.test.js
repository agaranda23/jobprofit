/**
 * voiceEarcons.test.js — unit tests for the voice-to-quote mic start/stop
 * earcons.
 *
 * Mirrors paymentSound.test.js's conventions: Vitest runs in Node, so
 * `window` and `localStorage` are stubbed globally, and the module is
 * re-imported per test (vi.resetModules() + dynamic import) because it
 * caches its AudioContext in a module-level variable via getAudioCtx().
 *
 * getAudioCtx() itself lives in paymentSound.js (shared singleton — see that
 * file's docblock) and is also reset between tests for the same reason.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── localStorage mock ─────────────────────────────────────────────────────

function makeLocalStorageMock() {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
}

// ── Fake Web Audio graph ──────────────────────────────────────────────────
// Records every oscillator/gain node created so tests can assert on the
// "shape" of each earcon without depending on real audio output.

function makeFakeAudioContext({ throwOnStart = false } = {}) {
  const created = { oscillators: [], gains: [] };
  const ctx = {
    state: 'running',
    currentTime: 0,
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(() => {
      const osc = {
        type: null,
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(() => {
          if (throwOnStart) throw new Error('start blocked');
        }),
        stop: vi.fn(),
      };
      created.oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => {
      const gain = {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
      created.gains.push(gain);
      return gain;
    }),
    destination: {},
  };
  return { ctx, created };
}

let localStorageMock;

beforeEach(() => {
  vi.resetModules();
  localStorageMock = makeLocalStorageMock();
  vi.stubGlobal('localStorage', localStorageMock);
  vi.stubGlobal('window', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

// ── Settings toggle persistence ────────────────────────────────────────────

describe('isVoiceSoundEnabled / setVoiceSoundEnabled', () => {
  it('defaults to enabled when nothing has been stored', async () => {
    const { isVoiceSoundEnabled } = await import('../voiceEarcons.js');
    expect(isVoiceSoundEnabled()).toBe(true);
  });

  it('setVoiceSoundEnabled(false) persists and is read back as disabled', async () => {
    const { isVoiceSoundEnabled, setVoiceSoundEnabled } = await import('../voiceEarcons.js');
    setVoiceSoundEnabled(false);
    expect(isVoiceSoundEnabled()).toBe(false);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('jp.sound_on_voice', '0');
  });

  it('setVoiceSoundEnabled(true) re-enables after being turned off', async () => {
    const { isVoiceSoundEnabled, setVoiceSoundEnabled } = await import('../voiceEarcons.js');
    setVoiceSoundEnabled(false);
    setVoiceSoundEnabled(true);
    expect(isVoiceSoundEnabled()).toBe(true);
  });

  it('is a setting distinct from the payment-sound toggle (different key)', async () => {
    const { setVoiceSoundEnabled } = await import('../voiceEarcons.js');
    setVoiceSoundEnabled(false);
    // Only the voice key was written — payment sound's key is untouched.
    expect(localStorageMock.setItem).toHaveBeenCalledWith('jp.sound_on_voice', '0');
    expect(localStorageMock.setItem).not.toHaveBeenCalledWith('jp.sound_on_payment', expect.anything());
  });

  it('a thrown localStorage read (private browsing) defaults to enabled, not a crash', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: vi.fn(),
    });
    const { isVoiceSoundEnabled } = await import('../voiceEarcons.js');
    expect(() => isVoiceSoundEnabled()).not.toThrow();
    expect(isVoiceSoundEnabled()).toBe(true);
  });

  it('a thrown localStorage write (private browsing) does not throw', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: () => { throw new Error('blocked'); },
    });
    const { setVoiceSoundEnabled } = await import('../voiceEarcons.js');
    expect(() => setVoiceSoundEnabled(false)).not.toThrow();
  });
});

// ── Toggle gating: muted means no Web Audio interaction at all ────────────

describe('playMicStartEarcon / playMicStopEarcon — Settings toggle gating', () => {
  it('start earcon does nothing when muted — no AudioContext is ever constructed', async () => {
    const ctorSpy = vi.fn();
    vi.stubGlobal('window', { AudioContext: ctorSpy });
    const { setVoiceSoundEnabled, playMicStartEarcon } = await import('../voiceEarcons.js');
    setVoiceSoundEnabled(false);
    playMicStartEarcon();
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('stop earcon does nothing when muted — no AudioContext is ever constructed', async () => {
    const ctorSpy = vi.fn();
    vi.stubGlobal('window', { AudioContext: ctorSpy });
    const { setVoiceSoundEnabled, playMicStopEarcon } = await import('../voiceEarcons.js');
    setVoiceSoundEnabled(false);
    playMicStopEarcon();
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('plays the start earcon when the toggle is on (default) and Web Audio is available', async () => {
    const { ctx, created } = makeFakeAudioContext();
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playMicStartEarcon } = await import('../voiceEarcons.js');

    playMicStartEarcon();

    // Two-note earcon: exactly two oscillators, each with its own gain envelope.
    expect(created.oscillators).toHaveLength(2);
    expect(created.gains).toHaveLength(2);
    created.oscillators.forEach(osc => {
      expect(osc.type).toBe('sine');
      expect(osc.start).toHaveBeenCalled();
    });
    // Rising: C5 → G5.
    const freqs = created.oscillators.map(o => o.frequency.value);
    expect(freqs[0]).toBeLessThan(freqs[1]);
  });

  it('plays the stop earcon as the mirror of the start earcon (falling)', async () => {
    const { ctx, created } = makeFakeAudioContext();
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playMicStopEarcon } = await import('../voiceEarcons.js');

    playMicStopEarcon();

    expect(created.oscillators).toHaveLength(2);
    const freqs = created.oscillators.map(o => o.frequency.value);
    expect(freqs[0]).toBeGreaterThan(freqs[1]);
  });

  it('the stop earcon uses the same two frequencies as the start earcon, reversed', async () => {
    const { ctx, created } = makeFakeAudioContext();
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playMicStartEarcon, playMicStopEarcon } = await import('../voiceEarcons.js');

    playMicStartEarcon();
    const startFreqs = created.oscillators.map(o => o.frequency.value);
    playMicStopEarcon();
    const stopFreqs = created.oscillators.slice(2).map(o => o.frequency.value);

    expect(stopFreqs).toEqual([...startFreqs].reverse());
  });
});

// ── Never throws — must never interrupt the voice-quote flow ─────────────

describe('playMicStartEarcon / playMicStopEarcon — never throw (voice flow safety)', () => {
  it('start earcon is a silent no-op when window.AudioContext does not exist', async () => {
    vi.stubGlobal('window', {});
    const { playMicStartEarcon } = await import('../voiceEarcons.js');
    expect(() => playMicStartEarcon()).not.toThrow();
  });

  it('stop earcon is a silent no-op when window.AudioContext does not exist', async () => {
    vi.stubGlobal('window', {});
    const { playMicStopEarcon } = await import('../voiceEarcons.js');
    expect(() => playMicStopEarcon()).not.toThrow();
  });

  it('swallows an exception from the AudioContext constructor', async () => {
    vi.stubGlobal('window', {
      AudioContext: vi.fn(function () { throw new Error('not allowed here'); }),
    });
    const { playMicStartEarcon, playMicStopEarcon } = await import('../voiceEarcons.js');
    expect(() => playMicStartEarcon()).not.toThrow();
    expect(() => playMicStopEarcon()).not.toThrow();
  });

  it('swallows an exception thrown by oscillator.start (blocked/suspended context)', async () => {
    const { ctx } = makeFakeAudioContext({ throwOnStart: true });
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playMicStartEarcon, playMicStopEarcon } = await import('../voiceEarcons.js');
    expect(() => playMicStartEarcon()).not.toThrow();
    expect(() => playMicStopEarcon()).not.toThrow();
  });

  it('swallows a rejected resume() on a suspended context and still does not throw', async () => {
    const { ctx } = makeFakeAudioContext();
    ctx.state = 'suspended';
    ctx.resume = vi.fn(() => Promise.reject(new Error('needs a gesture')));
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playMicStartEarcon } = await import('../voiceEarcons.js');
    expect(() => playMicStartEarcon()).not.toThrow();
  });
});
