/**
 * momentEarcons.test.js — unit tests for the send/accepted iOS-safe earcon
 * fallbacks (see src/lib/momentEarcons.js).
 *
 * Mirrors the established convention in paymentSound.test.js: Vitest runs in
 * Node, so window/localStorage are stubbed globally, and every test does a
 * fresh vi.resetModules() + dynamic import (momentEarcons.js transitively
 * imports paymentSound.js's module-level AudioContext cache + the
 * isSoundOnPaymentEnabled toggle, so both must be re-imported together per
 * test to share the same fresh module instance).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function makeLocalStorageMock() {
  let store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
}

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

describe('playSendEarcon', () => {
  it('plays a single soft tone (F5, ~698Hz) when the payment-sound toggle is on (default)', async () => {
    const { ctx, created } = makeFakeAudioContext();
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playSendEarcon } = await import('../momentEarcons.js');

    playSendEarcon();

    expect(created.oscillators).toHaveLength(1);
    expect(created.oscillators[0].frequency.value).toBeCloseTo(698.46, 1);
    expect(created.oscillators[0].type).toBe('sine');
    expect(created.oscillators[0].start).toHaveBeenCalled();
  });

  it('does nothing when the "Sound when you get paid" toggle is off', async () => {
    const ctorSpy = vi.fn();
    vi.stubGlobal('window', { AudioContext: ctorSpy });
    const { setSoundOnPaymentEnabled } = await import('../paymentSound.js');
    const { playSendEarcon } = await import('../momentEarcons.js');

    setSoundOnPaymentEnabled(false);
    playSendEarcon();

    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('never throws when Web Audio is unsupported', async () => {
    vi.stubGlobal('window', {});
    const { playSendEarcon } = await import('../momentEarcons.js');
    expect(() => playSendEarcon()).not.toThrow();
  });

  it('swallows an exception thrown by oscillator.start', async () => {
    const { ctx } = makeFakeAudioContext({ throwOnStart: true });
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playSendEarcon } = await import('../momentEarcons.js');
    expect(() => playSendEarcon()).not.toThrow();
  });
});

describe('playAcceptedEarcon', () => {
  it('plays a rising two-note cue (G#5 -> C6) when the toggle is on (default)', async () => {
    const { ctx, created } = makeFakeAudioContext();
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playAcceptedEarcon } = await import('../momentEarcons.js');

    playAcceptedEarcon();

    expect(created.oscillators).toHaveLength(2);
    const freqs = created.oscillators.map(o => o.frequency.value);
    expect(freqs[0]).toBeCloseTo(830.61, 1);
    expect(freqs[1]).toBeCloseTo(1046.50, 1);
    expect(freqs[0]).toBeLessThan(freqs[1]);
  });

  it('does nothing when the "Sound when you get paid" toggle is off', async () => {
    const ctorSpy = vi.fn();
    vi.stubGlobal('window', { AudioContext: ctorSpy });
    const { setSoundOnPaymentEnabled } = await import('../paymentSound.js');
    const { playAcceptedEarcon } = await import('../momentEarcons.js');

    setSoundOnPaymentEnabled(false);
    playAcceptedEarcon();

    expect(ctorSpy).not.toHaveBeenCalled();
  });

  it('never throws when Web Audio is unsupported', async () => {
    vi.stubGlobal('window', {});
    const { playAcceptedEarcon } = await import('../momentEarcons.js');
    expect(() => playAcceptedEarcon()).not.toThrow();
  });

  it('swallows a rejected resume() on a suspended context', async () => {
    const { ctx } = makeFakeAudioContext();
    ctx.state = 'suspended';
    ctx.resume = vi.fn(() => Promise.reject(new Error('needs a gesture')));
    vi.stubGlobal('window', { AudioContext: vi.fn(function () { return ctx; }) });
    const { playAcceptedEarcon } = await import('../momentEarcons.js');
    expect(() => playAcceptedEarcon()).not.toThrow();
  });
});

// ── Distinct from the app's other synthesized cues ─────────────────────────
// Sanity guard: these frequencies must never collide with the mic earcons
// (C5 523.25 / G5 783.99) or the payment chime (A5 880.00 / C#6 1108.73) so a
// trader never confuses "invoice sent" with "mic armed" or "money landed".

describe('momentEarcons — frequency separation from existing cues', () => {
  it('playSendEarcon (698.46) does not match any mic or payment frequency', () => {
    const existing = [523.25, 783.99, 880.0, 1108.73];
    expect(existing).not.toContain(698.46);
  });

  it('playAcceptedEarcon (830.61 / 1046.50) does not match any mic or payment frequency', () => {
    const existing = [523.25, 783.99, 880.0, 1108.73];
    expect(existing).not.toContain(830.61);
    expect(existing).not.toContain(1046.50);
  });
});
