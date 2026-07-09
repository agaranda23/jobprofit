// @vitest-environment jsdom
/**
 * onboardingWizardDraftAutosave.test.jsx — OnboardingWizard's autosave wiring
 * (the hook mechanics themselves are unit tested in isolation in
 * src/lib/__tests__/useDraftAutosave.test.jsx / draftAutosave.test.js).
 *
 * The founder's #1 do-first trust item ("autosave EVERYTHING"): OnboardingWizard
 * used to hold trading name / first name / last name / sort code / account
 * number in useState only and persist them just once, on completion. A phone
 * call or the OS killing a backgrounded tab mid-signup lost the whole first
 * impression. It now reuses the same crash-safe draft mechanism AddJobModal
 * uses for "Resume your quote?", under its own key.
 *
 * Covers:
 *   1. Typing persists a draft (debounced) under the onboarding-specific key —
 *      distinct from, and never colliding with, the quote/job draft.
 *   2. A draft left by an earlier interrupted session is restored silently on
 *      remount — both the field values and the step the trader was on.
 *   3. The draft is cleared the moment the profile upsert to Supabase succeeds,
 *      so bank details (sort code / account number) never linger in
 *      localStorage once they're safely saved server-side.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('../../lib/telemetry', () => ({
  logTelemetry: vi.fn(),
}));

vi.mock('../../lib/store', () => ({
  addJobToCloud: vi.fn(),
}));

// The import step (SpreadsheetImporter) is irrelevant to draft-autosave
// behaviour — stub it out so mounting the wizard doesn't drag in xlsx parsing.
vi.mock('../../components/SpreadsheetImporter', () => ({
  default: () => null,
}));

const upsertSingle = vi.fn().mockResolvedValue({
  data: {
    id: 'u1',
    business_name: 'Smith Plumbing',
    first_name: 'Alan',
    last_name: 'Smith',
    sort_code: '12-34-56',
    account_number: '12345678',
  },
  error: null,
});

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: upsertSingle,
        })),
      })),
    })),
  },
}));

import OnboardingWizard from '../OnboardingWizard';
import { loadOnboardingDraft, saveOnboardingDraft, loadDraft } from '../../lib/draftAutosave';

const fakeSession = { user: { id: 'u1' } };

function clickContinue() {
  fireEvent.click(screen.getByRole('button', { name: /continue|finish/i }));
}

describe('OnboardingWizard — draft autosave', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('1. persists the trading name as the trader types (debounced), under its own key', () => {
    render(<OnboardingWizard session={fakeSession} profile={null} onComplete={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Trading name'), { target: { value: 'Smith Plumbing' } });

    // Nothing written yet — still inside the debounce window.
    expect(loadOnboardingDraft()).toBeNull();

    act(() => { vi.advanceTimersByTime(700); });

    const draft = loadOnboardingDraft();
    expect(draft.trading_name).toBe('Smith Plumbing');
    expect(draft.stepIndex).toBe(0);

    // Distinct key from the quote/job draft — the two never collide.
    expect(loadDraft()).toBeNull();
  });

  it('2. restores fields AND the step from an earlier interrupted session', () => {
    saveOnboardingDraft({
      trading_name: 'Smith Plumbing',
      first_name: 'Alan',
      last_name: '',
      sort_code: '',
      account_number: '',
      stepIndex: 2, // was on the "last name" step when the session was interrupted
    });

    render(<OnboardingWizard session={fakeSession} profile={null} onComplete={vi.fn()} />);

    // Resumed on step 3 of 5 (last name), not back at step 1.
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument();

    // Earlier steps' values were restored too.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Trading name').value).toBe('Smith Plumbing');
  });

  it('3. clears the draft the moment the profile save succeeds — bank details do not linger', async () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard session={fakeSession} profile={null} onComplete={onComplete} />);

    fireEvent.change(screen.getByLabelText('Trading name'), { target: { value: 'Smith Plumbing' } });
    clickContinue();
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alan' } });
    clickContinue();
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Smith' } });
    clickContinue();
    fireEvent.change(screen.getByLabelText('Sort code'), { target: { value: '123456' } });
    fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '12345678' } });

    // A debounced write may already be pending from the keystrokes above —
    // don't advance it; clearNow() must win regardless of timer ordering.
    await act(async () => {
      clickContinue(); // "Finish" — triggers saveAll(), which upserts to Supabase
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(upsertSingle).toHaveBeenCalledTimes(1);
    expect(loadOnboardingDraft()).toBeNull();

    // Any debounce timer still pending from earlier keystrokes must not
    // resurrect the draft once it fires (no-resurrection guarantee).
    act(() => { vi.advanceTimersByTime(700); });
    expect(loadOnboardingDraft()).toBeNull();
  });
});
