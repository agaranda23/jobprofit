/**
 * voiceCapture.js — Capture Layer, Slice B (Voice Notes).
 *
 * A thin, framework-agnostic wrapper around the Web Speech API for
 * free-form transcript capture — no job/quote parsing (see voiceParse.js
 * for that). It deliberately mirrors the offline / not-allowed / no-speech
 * fallback behaviour of the voice-quote flow in AddJobModal.jsx
 * (~L295-352 startListening, ~L512-599 startQuoteListening) so both mic
 * experiences feel identical — but it is a standalone module, not an
 * extraction, so AddJobModal's existing 10-second-signature flow is
 * completely untouched by this PR.
 *
 * No React here — plain callbacks — so this is unit-testable without
 * @testing-library/react, matching the project convention of keeping
 * hook-adjacent logic as pure functions (see useKeyboardInset.test.js).
 * The React side (JobDetailDrawer.jsx) wires this to a few useState calls.
 */

function getSpeechRecognitionCtor() {
  return typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
}

export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

export function isVoiceCaptureSupported() {
  return !!getSpeechRecognitionCtor();
}

// Matches AddJobModal.jsx's mic-blocked copy exactly, so the two voice
// entry points read as one product, not two half-built ones.
export const MIC_BLOCKED_MESSAGE = 'Microphone blocked. Allow it in the address bar, then try again.';
export const OFFLINE_MESSAGE = 'No signal — type a note instead.';
export const UNSUPPORTED_MESSAGE = "Voice isn't supported on this browser — type a note instead.";
export const NO_SPEECH_MESSAGE = "Didn't catch that — try again.";

/**
 * Starts a recognition session and streams results back through `handlers`:
 *   onTranscript(text)      — fired on every interim+final update with the
 *                             running transcript so far (trimmed)
 *   onEnd(finalText)        — fired once the session ends, with only the
 *                             finalised (non-interim) transcript, trimmed
 *   onError(code, message)  — fired for 'unsupported' | 'offline' |
 *                             'not-allowed' | 'no-speech' | 'network' |
 *                             'start-failed' | any other SpeechRecognition
 *                             error code
 *
 * Returns a controller { stop(), abort() } used to end the session (e.g. a
 * "tap to stop" button), or `null` if it never started — in that case
 * onError has already been called synchronously (offline/unsupported).
 */
export function startVoiceCapture({ lang, handlers } = {}) {
  const { onTranscript = () => {}, onEnd = () => {}, onError = () => {} } = handlers || {};
  const SR = getSpeechRecognitionCtor();

  if (!SR) {
    onError('unsupported', UNSUPPORTED_MESSAGE);
    return null;
  }
  if (!isOnline()) {
    onError('offline', OFFLINE_MESSAGE);
    return null;
  }

  let finalText = '';

  try {
    const r = new SR();
    r.lang = lang
      || (typeof localStorage !== 'undefined' && localStorage.getItem('jp.voiceLang'))
      || 'en-GB';
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript + ' ';
        else interim += res[0].transcript;
      }
      onTranscript((finalText + interim).trim());
    };

    r.onerror = (e) => {
      if (e.error === 'not-allowed') {
        onError('not-allowed', MIC_BLOCKED_MESSAGE);
      } else if (e.error === 'no-speech') {
        onError('no-speech', NO_SPEECH_MESSAGE);
      } else if (e.error === 'network') {
        onError('network', OFFLINE_MESSAGE);
      } else {
        onError(e.error, `Mic error: ${e.error}`);
      }
    };

    // onend always fires last (after onerror, if any) — the single place
    // that reliably means "recognition has stopped", whether that's a
    // manual tap-to-stop, a silence timeout, or an error.
    r.onend = () => onEnd(finalText.trim());

    r.start();
    return {
      stop: () => { try { r.stop(); } catch { /* already stopped */ } },
      abort: () => { try { r.abort(); } catch { /* already stopped */ } },
    };
  } catch (err) {
    onError('start-failed', `Couldn't start mic: ${err.message}`);
    return null;
  }
}
