// @vitest-environment jsdom
/**
 * useDraftAutosave.test.jsx — the debounced autosave hook behind
 * "autosave in-progress work + Resume your quote?" (see useDraftAutosave.js
 * for the mechanism, draftAutosave.js for the storage rationale).
 *
 * Covers the three explicitly-required behaviours:
 *   1. Draft persists on change (debounced) — a burst of edits produces one
 *      write, `debounceMs` after the last one.
 *   2. Draft persists immediately on visibilitychange('hidden') and pagehide
 *      — the "call comes in, phone locks" scenario — without waiting for
 *      the debounce window.
 *   3. clearNow() permanently disables further writes for this mount, so a
 *      pending debounce timer or a same-tick visibilitychange/pagehide event
 *      can never resurrect a draft that's just been saved/sent.
 *
 * A minimal harness component (not the full AddJobModal — this is a unit
 * test of the hook's mechanics) renders the hook with a controllable snapshot
 * prop, matching the render-smoke convention used elsewhere in this project
 * for hooks/components that need real timers and DOM events.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useDraftAutosave } from '../useDraftAutosave.js';
import { loadDraft, saveDraft } from '../draftAutosave.js';

const DEBOUNCE_MS = 50; // short window so the tests run fast

function Harness({ snapshot, enabled = true, isEmpty, onClearNowReady }) {
  const { clearNow } = useDraftAutosave(snapshot, { enabled, isEmpty, debounceMs: DEBOUNCE_MS });
  onClearNowReady?.(clearNow);
  return null;
}

function setHidden(hidden) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
}

describe('useDraftAutosave', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it('1a. writes the snapshot after the debounce window elapses', () => {
    render(<Harness snapshot={{ summary: 'Kitchen tap' }} />);
    expect(loadDraft()).toBeNull(); // nothing yet — still debouncing

    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 10); });
    expect(loadDraft()?.summary).toBe('Kitchen tap');
  });

  it('1b. a burst of changes within the debounce window collapses to one write of the latest value', () => {
    const { rerender } = render(<Harness snapshot={{ summary: 'K' }} />);
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS / 2); });
    rerender(<Harness snapshot={{ summary: 'Ki' }} />);
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS / 2); });
    rerender(<Harness snapshot={{ summary: 'Kitchen tap' }} />);

    // Still within the debounce window since the last change — nothing written yet.
    expect(loadDraft()).toBeNull();

    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 10); });
    expect(loadDraft()?.summary).toBe('Kitchen tap');
  });

  it('2a. flushes immediately on visibilitychange → hidden, without waiting for the debounce', () => {
    render(<Harness snapshot={{ summary: 'Kitchen tap', quoteTranscript: 'fix the tap' }} />);
    expect(loadDraft()).toBeNull();

    setHidden(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(loadDraft()?.summary).toBe('Kitchen tap');
    expect(loadDraft()?.quoteTranscript).toBe('fix the tap');
  });

  it('2b. visibilitychange while still visible does NOT force a write', () => {
    render(<Harness snapshot={{ summary: 'Kitchen tap' }} />);
    setHidden(false);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(loadDraft()).toBeNull();
  });

  it('2c. flushes immediately on pagehide', () => {
    render(<Harness snapshot={{ summary: 'Kitchen tap' }} />);
    expect(loadDraft()).toBeNull();

    act(() => { window.dispatchEvent(new Event('pagehide')); });

    expect(loadDraft()?.summary).toBe('Kitchen tap');
  });

  it('3a. clearNow() clears storage and disables future debounced writes', () => {
    let clearNow;
    const { rerender } = render(
      <Harness snapshot={{ summary: 'Kitchen tap' }} onClearNowReady={(fn) => { clearNow = fn; }} />
    );
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 10); });
    expect(loadDraft()?.summary).toBe('Kitchen tap');

    act(() => { clearNow(); });
    expect(loadDraft()).toBeNull();

    // A subsequent change would normally schedule a write — clearNow() has
    // permanently disabled this mount, so it must not resurrect the draft.
    rerender(<Harness snapshot={{ summary: 'Kitchen tap' }} onClearNowReady={(fn) => { clearNow = fn; }} />);
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 10); });
    expect(loadDraft()).toBeNull();
  });

  it('3b. clearNow() also suppresses a same-tick visibilitychange/pagehide flush', () => {
    let clearNow;
    render(<Harness snapshot={{ summary: 'Kitchen tap' }} onClearNowReady={(fn) => { clearNow = fn; }} />);
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 10); });
    expect(loadDraft()).not.toBeNull();

    act(() => {
      clearNow();
      setHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(loadDraft()).toBeNull();
  });

  it('isEmpty(snapshot)=true clears the draft instead of writing a blank one', () => {
    saveDraft({ summary: 'Old content' }); // pretend a previous session left a draft
    render(
      <Harness
        snapshot={{ summary: '' }}
        isEmpty={(s) => !s.summary?.trim()}
      />
    );
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 10); });
    expect(loadDraft()).toBeNull();
  });

  it('enabled=false disables all writes for this instance', () => {
    render(<Harness snapshot={{ summary: 'Kitchen tap' }} enabled={false} />);
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 10); });
    setHidden(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(loadDraft()).toBeNull();
  });
});
