import { useEffect, useRef } from 'react';
import { saveDraft, clearDraft } from './draftAutosave';

const DEFAULT_DEBOUNCE_MS = 600;

/**
 * useDraftAutosave — debounced, crash-safe persistence for one in-progress
 * form session (see draftAutosave.js for the storage rationale).
 *
 * Writes happen:
 *   1. Debounced, `debounceMs` after the last change to `snapshot`.
 *   2. Immediately, the moment the tab is backgrounded (visibilitychange →
 *      hidden) or torn down (pagehide) — covers the "call comes in, phone
 *      locks, app gets killed" scenario without waiting on the debounce.
 *
 * @param {object}   snapshot        the current form state to persist
 * @param {object}   opts
 * @param {boolean}   opts.enabled    false disables all writes for this instance
 * @param {function}  opts.isEmpty    (snapshot) => boolean. When true, the
 *                                    draft is cleared instead of written —
 *                                    a blank/untouched form should never show
 *                                    up as a "resume?" prompt later.
 * @param {number}    opts.debounceMs override the debounce window (testing)
 * @param {object}    opts.store      { save, clear } pair to persist to —
 *                                    defaults to the shared quote/job draft
 *                                    store. Pass a different store (see
 *                                    createDraftStore in draftAutosave.js) so
 *                                    another form — e.g. OnboardingWizard —
 *                                    gets its own key and never collides with
 *                                    an in-progress quote draft.
 * @returns {{ clearNow: () => void }} clearNow — call synchronously right
 *   before the payload is actually saved/sent, so a debounce timer or an
 *   in-flight visibilitychange/pagehide flush can never resurrect the draft
 *   after it's been cleared (same no-resurrection discipline used elsewhere
 *   in this codebase, e.g. the offline-token guard).
 */
export function useDraftAutosave(snapshot, {
  enabled = true,
  isEmpty,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  store = { save: saveDraft, clear: clearDraft },
} = {}) {
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  // Once true, this session is done (saved/sent, or explicitly cleared) —
  // every write path below becomes a permanent no-op for this mount.
  const disabledRef = useRef(false);

  const writeIfDue = () => {
    if (disabledRef.current || !enabled) return;
    const current = snapshotRef.current;
    if (isEmpty?.(current)) store.clear();
    else store.save(current);
  };

  // Callers (AddJobModal) build a fresh object literal every render, so its
  // *identity* changes even when the content hasn't — comparing by identity
  // would reset the debounce timer on every unrelated re-render (a snackbar
  // tick, a sibling state update) and could delay the actual write past any
  // real pause in typing. Stringifying gives a dependency that only changes
  // when the content actually does.
  let depKey;
  try { depKey = JSON.stringify(snapshot); } catch { depKey = String(snapshot); }

  // 1. Debounced write on every snapshot content change.
  useEffect(() => {
    if (!enabled || disabledRef.current) return undefined;
    const t = setTimeout(writeIfDue, debounceMs);
    return () => clearTimeout(t);
    // writeIfDue reads from snapshotRef.current, so it doesn't need to be a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, enabled, debounceMs]);

  // 2. Immediate flush on backgrounding / teardown — no debounce, no gaps.
  useEffect(() => {
    if (!enabled) return undefined;
    const onVisibility = () => { if (document.visibilityState === 'hidden') writeIfDue(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', writeIfDue);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', writeIfDue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const clearNow = useRef(() => {
    disabledRef.current = true;
    store.clear();
  }).current;

  return { clearNow };
}
