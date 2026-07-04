/**
 * paymentSound.test.js — unit tests for the payment-received chime utility.
 *
 * Vitest runs in Node (see vitest.config.js) — neither `window` nor
 * `localStorage` exist by default. We stub both globally, matching the
 * established localStorage-mock convention used in chaseLadder.test.js.
 *
 * paymentSound.js caches its AudioContext in a module-level variable (so
 * production code only ever opens one). That means tests must NOT import it
 * at the top level (matching haptics.test.js's rationale) — we use
 * vi.resetModules() + a per-test dynamic import so each test gets an
 * uncached module and its own fake AudioContext.
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
// "shape" of the chime without depending on real audio output.

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

describe('isSoundOnPaymentEnabled / setSoundOnPaymentEnabled', () => {
  it('defaults to enabled when nothing has been stored', async () => {
    const { isSoundOnPaymentEnabled } = await import('../paymentSound.js');
    expect(isSoundOnPaymentEnabled()).toBe(true);
  });

  it('setSoundOnPaymentEnabled(false) persists and is read back as disabled', async () => {
    const { isSoundOnPaymentEnabled, setSoundOnPaymentEnabled } = await import('../paymentSound.js');
    setSoundOnPaymentEnabled(false);
    expect(isSoundOnPaymentEnabled()).toBe(false);
    expect(localStorageMock.setItem).toHaveBeenCalledWith('jp.sound_on_payment', '0');
  });

  it('setSoundOnPaymentEnabled(true) re-enables after being turned off', async () => {
    const { isSoundOnPaymentEnabled, setSoundOnPaymentEnabled } = await import('../paymentSound.js');
    setSoundOnPaymentEnabled(false);
    setSoundOnPaymentEnabled(true);
    expect(isSoundOnPaymentEnabled()).toBe(true);
  });

  it('a thrown localStorage read (private browsing) defaults to enabled, not a crash', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: vi.fn(),
    });
    const { isSoundOnPaymentEnabled } = await import('../paymentSound.js');
    expect(() => isSoundOnPaymentEnabled()).not.toThrow();
    expect(isSoundOnPaymentEnabled()).toBe(true);
  });

  it('a thrown localStorage write (private browsing) does not throw', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: () => { throw new Error('blocked'); },
    });
    const { setSoundOnPaymentEnabled } = await import('../paymentSound.js');
    expect(() => setSoundOnPaymentEnabled(false)).not.toThrow();
  });
});

// ── Toggle gating: off means no Web Audio interaction at all ──────────────

describe('playPaymentReceivedSound — Settings toggle gating', () => {
  it('does nothing when the toggle is off — no AudioContext is ever constructed', async () => {
    const ctorSpy = vi.fn();
    vi.stubGlobal('window', { AudioContext: ctorSpy });
    const { setSoundOnPaymentEnabled, playPaymentReceivedSound } = await import('../paymentSound.js');
    setSoundOnPaymentEnabled(false);
    playPaymentReceivedSound();
    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('plays when the toggle is on (default) and Web Audio is available', async () => {
    const { ctx, created } = makeFakeAudioContext();
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playPaymentReceivedSound } = await import('../paymentSound.js');

    playPaymentReceivedSound();

    // Two-note chime: exactly two oscillators, each with its own gain envelope.
    expect(created.oscillators).toHaveLength(2);
    expect(created.gains).toHaveLength(2);
    created.oscillators.forEach(osc => {
      expect(osc.type).toBe('sine');
      expect(osc.start).toHaveBeenCalled();
    });
    // Rising two-note interval (A5 → C#6), not a single flat tone.
    const freqs = created.oscillators.map(o => o.frequency.value);
    expect(freqs[0]).toBeLessThan(freqs[1]);
  });
});

// ── Never throws — the payment flow must never be interrupted ────────────

describe('playPaymentReceivedSound — never throws (payment flow safety)', () => {
  it('is a silent no-op when window.AudioContext does not exist', async () => {
    vi.stubGlobal('window', {});
    const { playPaymentReceivedSound } = await import('../paymentSound.js');
    expect(() => playPaymentReceivedSound()).not.toThrow();
  });

  it('swallows an exception from the AudioContext constructor', async () => {
    vi.stubGlobal('window', {
      AudioContext: vi.fn(function () { throw new Error('not allowed here'); }),
    });
    const { playPaymentReceivedSound } = await import('../paymentSound.js');
    expect(() => playPaymentReceivedSound()).not.toThrow();
  });

  it('swallows an exception thrown by oscillator.start (blocked/suspended context)', async () => {
    const { ctx } = makeFakeAudioContext({ throwOnStart: true });
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playPaymentReceivedSound } = await import('../paymentSound.js');
    expect(() => playPaymentReceivedSound()).not.toThrow();
  });

  it('swallows a rejected resume() on a suspended context and still does not throw', async () => {
    const { ctx } = makeFakeAudioContext();
    ctx.state = 'suspended';
    ctx.resume = vi.fn(() => Promise.reject(new Error('needs a gesture')));
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playPaymentReceivedSound } = await import('../paymentSound.js');
    expect(() => playPaymentReceivedSound()).not.toThrow();
  });
});

// ── unlockAudioContext ─────────────────────────────────────────────────────

describe('unlockAudioContext', () => {
  it('is a no-op when Web Audio is unsupported', async () => {
    vi.stubGlobal('window', {});
    const { unlockAudioContext } = await import('../paymentSound.js');
    expect(() => unlockAudioContext()).not.toThrow();
  });

  it('calls resume() on a suspended context', async () => {
    const { ctx } = makeFakeAudioContext();
    ctx.state = 'suspended';
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { unlockAudioContext } = await import('../paymentSound.js');
    unlockAudioContext();
    expect(ctx.resume).toHaveBeenCalled();
  });

  it('does not call resume() on an already-running context', async () => {
    const { ctx } = makeFakeAudioContext();
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { unlockAudioContext } = await import('../paymentSound.js');
    unlockAudioContext();
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('swallows a constructor exception', async () => {
    vi.stubGlobal('window', {
      AudioContext: vi.fn(function () { throw new Error('nope'); }),
    });
    const { unlockAudioContext } = await import('../paymentSound.js');
    expect(() => unlockAudioContext()).not.toThrow();
  });
});
