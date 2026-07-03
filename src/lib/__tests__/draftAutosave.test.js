/**
 * draftAutosave.test.js — the plain storage layer behind the
 * "autosave in-progress work + Resume your quote?" feature.
 *
 * Node env, localStorage stubbed — matches the convention used by
 * chaseLadder.test.js / chaseMessageDeposit.test.js etc.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

function makeLocalStorageMock() {
  let store = {};
  return {
    getItem: vi.fn(key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null)),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    removeItem: vi.fn(key => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    _store: () => store,
  };
}

const localStorageMock = makeLocalStorageMock();
vi.stubGlobal('localStorage', localStorageMock);

beforeEach(() => {
  localStorageMock.clear();
  vi.clearAllMocks();
});

import { saveDraft, loadDraft, clearDraft } from '../draftAutosave.js';

describe('draftAutosave: saveDraft / loadDraft / clearDraft', () => {
  it('loadDraft returns null when nothing has been saved', () => {
    expect(loadDraft()).toBeNull();
  });

  it('saveDraft then loadDraft round-trips the given fields', () => {
    saveDraft({ summary: 'Kitchen tap', customer: 'Dave Jones', qTotal: '450' });
    const draft = loadDraft();
    expect(draft.summary).toBe('Kitchen tap');
    expect(draft.customer).toBe('Dave Jones');
    expect(draft.qTotal).toBe('450');
  });

  it('saveDraft stamps the snapshot with savedAt', () => {
    const before = Date.now();
    saveDraft({ summary: 'Job' });
    const draft = loadDraft();
    expect(typeof draft.savedAt).toBe('number');
    expect(draft.savedAt).toBeGreaterThanOrEqual(before);
  });

  it('a later saveDraft call overwrites the earlier one (single slot)', () => {
    saveDraft({ summary: 'First quote' });
    saveDraft({ summary: 'Second quote' });
    expect(loadDraft().summary).toBe('Second quote');
  });

  it('clearDraft removes the saved draft', () => {
    saveDraft({ summary: 'Kitchen tap' });
    expect(loadDraft()).not.toBeNull();
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('loadDraft returns null for corrupt JSON rather than throwing', () => {
    localStorageMock.setItem('jobprofit:draft:v1', '{not valid json');
    expect(() => loadDraft()).not.toThrow();
    expect(loadDraft()).toBeNull();
  });

  it('saveDraft swallows a quota/storage error instead of throwing', () => {
    localStorageMock.setItem.mockImplementationOnce(() => { throw new Error('QuotaExceededError'); });
    expect(() => saveDraft({ summary: 'Job' })).not.toThrow();
  });

  it('clearDraft swallows a storage error instead of throwing', () => {
    localStorageMock.removeItem.mockImplementationOnce(() => { throw new Error('SecurityError'); });
    expect(() => clearDraft()).not.toThrow();
  });

  it('preserves a voice transcription field through the round trip', () => {
    saveDraft({
      view: 'quote',
      summary: 'Kitchen tap',
      quoteTranscript: 'fix the kitchen tap for dave four fifty',
    });
    expect(loadDraft().quoteTranscript).toBe('fix the kitchen tap for dave four fifty');
  });
});
