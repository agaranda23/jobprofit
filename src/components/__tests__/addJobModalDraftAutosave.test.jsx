// @vitest-environment jsdom
/**
 * addJobModalDraftAutosave.test.jsx — AddJobModal's real wiring to the
 * autosave-drafts-resume feature (the hook mechanics themselves are unit
 * tested in isolation in src/lib/__tests__/useDraftAutosave.test.jsx).
 *
 * Covers, through the real component (not a stand-in harness):
 *   1. Typing into the manual quote form persists a draft after the
 *      debounce window — proves the snapshot passed to useDraftAutosave
 *      actually reflects live form state.
 *   2. resumeDraft restores the job description, customer, total, and the
 *      voice transcription onto the glanceable confirm card.
 *   3. Saving clears the draft immediately — and a debounce timer that was
 *      already pending from earlier keystrokes does NOT resurrect it once
 *      it fires (no-resurrection guarantee).
 *
 * Mocking strategy matches componentSmoke.test.jsx's "AddJobModal render
 * smoke" block — jsdom has no SpeechRecognition, so AddJobModal's own
 * `SR` constant is null and the 'quote' view lands straight on 'manual'
 * (or 'confirm', when resumeDraft already has content) without ever trying
 * to touch the mic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../lib/telemetry', () => ({
  logTelemetry: vi.fn(),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      unsubscribe: vi.fn(),
    })),
  },
}));

vi.mock('../../lib/voiceParse', () => ({
  parseJobFromSpeech: vi.fn().mockResolvedValue({ customer: 'Test', amount: 100 }),
}));

import AddJobModal from '../AddJobModal';
import { loadDraft } from '../../lib/draftAutosave';

const NOOP = () => {};

describe('AddJobModal — draft autosave wiring', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('1. persists a draft (with debounce) as the trader types into the manual quote form', () => {
    render(
      <AddJobModal onClose={NOOP} onSave={NOOP} onOpenDetailed={NOOP} defaultMode="quote" onSaveAndSend={NOOP} />
    );

    // jsdom has no SpeechRecognition — lands straight on the manual form.
    const jobInput = screen.getByPlaceholderText('e.g. Bathroom tiling');
    const customerInput = screen.getByPlaceholderText('e.g. Dave Williams (optional)');

    fireEvent.change(jobInput, { target: { value: 'Kitchen tap' } });
    fireEvent.change(customerInput, { target: { value: 'Dave Jones' } });

    // Nothing written yet — still inside the debounce window.
    expect(loadDraft()).toBeNull();

    act(() => { vi.advanceTimersByTime(700); });

    const draft = loadDraft();
    expect(draft.summary).toBe('Kitchen tap');
    expect(draft.customer).toBe('Dave Jones');
    expect(draft.view).toBe('quote');
  });

  it('2. resumeDraft restores summary, customer, total, and the voice transcript', () => {
    render(
      <AddJobModal
        onClose={NOOP}
        onSave={NOOP}
        onOpenDetailed={NOOP}
        defaultMode="quote"
        onSaveAndSend={NOOP}
        resumeDraft={{
          view: 'quote',
          summary: 'Kitchen tap',
          customer: 'Dave Jones',
          qTotal: '450',
          quoteTranscript: 'fix the kitchen tap for dave four fifty',
        }}
      />
    );

    // Lands on the glanceable confirm card (qTotal/summary already present).
    expect(screen.getByText('Kitchen tap')).toBeInTheDocument();
    expect(screen.getByText('Dave Jones')).toBeInTheDocument();
    expect(screen.getByText('£450')).toBeInTheDocument();
    expect(screen.getByText(/fix the kitchen tap for dave four fifty/i)).toBeInTheDocument();
  });

  it('3. saving clears the draft immediately, and a pending debounce timer cannot resurrect it', () => {
    const onSave = vi.fn();
    render(
      <AddJobModal onClose={NOOP} onSave={onSave} onOpenDetailed={NOOP} defaultMode="quote" onSaveAndSend={NOOP} />
    );

    const jobInput = screen.getByPlaceholderText('e.g. Bathroom tiling');
    fireEvent.change(jobInput, { target: { value: 'Kitchen tap' } });

    // A debounce timer is now pending (has not fired yet) — do NOT advance it.
    expect(loadDraft()).toBeNull();

    fireEvent.click(screen.getByText('Save quote'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(loadDraft()).toBeNull(); // cleared synchronously by clearNow()

    // Let the earlier keystroke's debounce timer actually fire — it must be a no-op.
    act(() => { vi.advanceTimersByTime(700); });
    expect(loadDraft()).toBeNull();
  });
});
