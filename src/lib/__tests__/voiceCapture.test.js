// @vitest-environment jsdom
/**
 * voiceCapture.test.js — Capture Layer, Slice B (Voice Notes).
 *
 * A fake SpeechRecognition constructor stands in for the real Web Speech
 * API so these tests are deterministic and don't depend on an actual
 * microphone/browser. The fake is driven manually (onresult/onerror/onend
 * called directly by the test) — mirrors the real API shape closely enough
 * to exercise startVoiceCapture's logic without a browser.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startVoiceCapture,
  isOnline,
  isVoiceCaptureSupported,
  MIC_BLOCKED_MESSAGE,
  OFFLINE_MESSAGE,
  UNSUPPORTED_MESSAGE,
  NO_SPEECH_MESSAGE,
} from '../voiceCapture';

class FakeSpeechRecognition {
  constructor() {
    this.lang = '';
    this.interimResults = false;
    this.continuous = false;
    this.maxAlternatives = 1;
    FakeSpeechRecognition.instances.push(this);
  }
  start() { this.started = true; }
  stop() { this.onend?.(); }
  abort() { this.onend?.(); }
}
FakeSpeechRecognition.instances = [];

function lastInstance() {
  return FakeSpeechRecognition.instances[FakeSpeechRecognition.instances.length - 1];
}

/** Builds one entry of a fake SpeechRecognitionResultList. */
function result(transcript, isFinal) {
  const r = { isFinal };
  r[0] = { transcript };
  return r;
}

function onlineSpy(value) {
  return vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(value);
}

describe('voiceCapture', () => {
  let originalSR;

  beforeEach(() => {
    originalSR = window.SpeechRecognition;
    FakeSpeechRecognition.instances = [];
  });

  afterEach(() => {
    window.SpeechRecognition = originalSR;
    delete window.webkitSpeechRecognition;
    vi.restoreAllMocks();
  });

  describe('isOnline / isVoiceCaptureSupported', () => {
    it('reflects navigator.onLine', () => {
      onlineSpy(true);
      expect(isOnline()).toBe(true);
      onlineSpy(false);
      expect(isOnline()).toBe(false);
    });

    it('is false with no SpeechRecognition constructor on window', () => {
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;
      expect(isVoiceCaptureSupported()).toBe(false);
    });

    it('is true when window.SpeechRecognition exists', () => {
      window.SpeechRecognition = FakeSpeechRecognition;
      expect(isVoiceCaptureSupported()).toBe(true);
    });
  });

  describe('startVoiceCapture — unsupported / offline guards', () => {
    it('calls onError("unsupported", ...) and returns null when there is no SpeechRecognition', () => {
      delete window.SpeechRecognition;
      delete window.webkitSpeechRecognition;
      onlineSpy(true);
      const onError = vi.fn();
      const controller = startVoiceCapture({ handlers: { onError } });
      expect(controller).toBeNull();
      expect(onError).toHaveBeenCalledWith('unsupported', UNSUPPORTED_MESSAGE);
    });

    it('calls onError("offline", ...) and returns null when navigator.onLine is false', () => {
      window.SpeechRecognition = FakeSpeechRecognition;
      onlineSpy(false);
      const onError = vi.fn();
      const controller = startVoiceCapture({ handlers: { onError } });
      expect(controller).toBeNull();
      expect(onError).toHaveBeenCalledWith('offline', OFFLINE_MESSAGE);
      // Never even constructs a recognizer when offline.
      expect(FakeSpeechRecognition.instances).toHaveLength(0);
    });
  });

  describe('startVoiceCapture — transcript streaming', () => {
    beforeEach(() => {
      window.SpeechRecognition = FakeSpeechRecognition;
      onlineSpy(true);
    });

    it('streams interim + final transcript via onTranscript, trimmed', () => {
      const onTranscript = vi.fn();
      const controller = startVoiceCapture({ handlers: { onTranscript } });
      expect(controller).not.toBeNull();

      const r = lastInstance();
      expect(r.started).toBe(true);

      // Interim result while still speaking.
      r.onresult({ resultIndex: 0, results: [result('turn off the ', false)] });
      expect(onTranscript).toHaveBeenLastCalledWith('turn off the');

      // Finalised segment, followed by a new interim segment.
      r.onresult({ resultIndex: 0, results: [result('turn off the stopcock ', true)] });
      r.onresult({ resultIndex: 1, results: [result('turn off the stopcock ', true), result('before you leave', false)] });
      expect(onTranscript).toHaveBeenLastCalledWith('turn off the stopcock  before you leave');
    });

    it('onEnd fires with only the finalised transcript, trimmed', () => {
      const onEnd = vi.fn();
      const controller = startVoiceCapture({ handlers: { onEnd } });
      const r = lastInstance();

      r.onresult({ resultIndex: 0, results: [result('key is under the mat', true)] });
      controller.stop();

      expect(onEnd).toHaveBeenCalledWith('key is under the mat');
    });

    it('onEnd fires with an empty string when nothing was said', () => {
      const onEnd = vi.fn();
      const controller = startVoiceCapture({ handlers: { onEnd } });
      controller.stop();
      expect(onEnd).toHaveBeenCalledWith('');
    });
  });

  describe('startVoiceCapture — error mapping', () => {
    beforeEach(() => {
      window.SpeechRecognition = FakeSpeechRecognition;
      onlineSpy(true);
    });

    it('maps "not-allowed" to the mic-blocked copy', () => {
      const onError = vi.fn();
      startVoiceCapture({ handlers: { onError } });
      lastInstance().onerror({ error: 'not-allowed' });
      expect(onError).toHaveBeenCalledWith('not-allowed', MIC_BLOCKED_MESSAGE);
    });

    it('maps "no-speech" to the no-speech hint', () => {
      const onError = vi.fn();
      startVoiceCapture({ handlers: { onError } });
      lastInstance().onerror({ error: 'no-speech' });
      expect(onError).toHaveBeenCalledWith('no-speech', NO_SPEECH_MESSAGE);
    });

    it('maps "network" to the offline copy', () => {
      const onError = vi.fn();
      startVoiceCapture({ handlers: { onError } });
      lastInstance().onerror({ error: 'network' });
      expect(onError).toHaveBeenCalledWith('network', OFFLINE_MESSAGE);
    });

    it('passes through an unrecognised error code with a generic message', () => {
      const onError = vi.fn();
      startVoiceCapture({ handlers: { onError } });
      lastInstance().onerror({ error: 'audio-capture' });
      expect(onError).toHaveBeenCalledWith('audio-capture', 'Mic error: audio-capture');
    });

    it('reports "start-failed" when the SpeechRecognition constructor throws', () => {
      window.SpeechRecognition = class {
        constructor() { throw new Error('boom'); }
      };
      const onError = vi.fn();
      const controller = startVoiceCapture({ handlers: { onError } });
      expect(controller).toBeNull();
      expect(onError).toHaveBeenCalledWith('start-failed', "Couldn't start mic: boom");
    });
  });

  describe('controller.stop / abort', () => {
    beforeEach(() => {
      window.SpeechRecognition = FakeSpeechRecognition;
      onlineSpy(true);
    });

    it('stop() ends the session and triggers onEnd', () => {
      const onEnd = vi.fn();
      const controller = startVoiceCapture({ handlers: { onEnd } });
      controller.stop();
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    it('abort() does not throw even if the recognizer has no abort behaviour wired', () => {
      const controller = startVoiceCapture({ handlers: {} });
      expect(() => controller.abort()).not.toThrow();
    });
  });
});
