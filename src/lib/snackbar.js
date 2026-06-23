/**
 * snackbar.js — priority-queue snackbar manager (JP-LU2)
 *
 * Single source of truth for all floating transient notifications.
 * Replaces the ~10 independent useState + setTimeout surfaces that
 * previously scattered across AppShell and TodayScreen.
 *
 * Architecture
 * ────────────
 * The queue logic lives in a PURE JS reducer (snackbarReducer / applyAction)
 * so it can be unit-tested without a React harness (see __tests__/snackbar.test.js).
 * useSnackbar() wraps the reducer in useState + useEffect for React consumption.
 *
 * Priority scale (higher = shown sooner / preempts lower):
 *   10  realtime    — quote accepted / declined (remote event while app is open)
 *    8  toast       — job saved, mark-paid confirmation, error
 *    6  got-paid    — "Got paid?" chip row after Speed-mode save
 *    4  cost        — post-paid cost-capture nudge
 *    2  nudge       — pay-now soft prompt (non-blocking)
 *    1  nav         — one-time orientation toast
 *
 * Only ONE descriptor renders at a time (the queue head by priority desc).
 * FIFO within the same priority.
 *
 * Preemption: enqueuing a higher-priority item while a lower one is active
 * cancels the active item's dwell timer and requeues it behind the newcomer.
 *
 * Session-one gate: the push-permission prompt (lives outside the snackbar —
 * it's a role="dialog") should not interrupt an active snackbar during a
 * first session. Use isSession1Done() to check before showing it.
 * Call markSession1Done() on the first markPaid or first job save.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────

export const PRIORITY = {
  realtime: 10,
  toast:     8,
  'got-paid': 6,
  cost:      4,
  nudge:     2,
  nav:       1,
};

const SESSION1_KEY = 'jp.snackbar.session1.done';

// ── Session-one gate ──────────────────────────────────────────────────────────

export function isSession1Done() {
  try { return !!localStorage.getItem(SESSION1_KEY); } catch { return false; }
}

export function markSession1Done() {
  try { localStorage.setItem(SESSION1_KEY, '1'); } catch {}
}

// ── Pure reducer ──────────────────────────────────────────────────────────────
// All state transitions are pure functions so they can be tested without React.
// State shape: { queue: Descriptor[], activeId: string|null }
// Descriptor: { id, type, message, action, chips, dwell, priority }

/**
 * Insert a descriptor into a sorted queue (desc priority, then FIFO by insertion).
 * Returns a new array; does not mutate the input.
 */
export function insertSorted(queue, descriptor) {
  const idx = queue.findIndex(d => d.priority < descriptor.priority);
  if (idx === -1) return [...queue, descriptor];
  return [...queue.slice(0, idx), descriptor, ...queue.slice(idx)];
}

/**
 * Apply an action to the snackbar state, returning the next state.
 * Actions: ENQUEUE | DISMISS | DISMISS_ALL | DWELL_EXPIRED
 */
export function applyAction(state, action) {
  const { queue, activeId } = state;

  if (action.type === 'ENQUEUE') {
    const descriptor = {
      dwell: 2400,
      ...action.descriptor,
      priority: action.descriptor.priority ?? PRIORITY[action.descriptor.type] ?? 8,
    };

    // If incoming priority is higher than the active item — preempt.
    // The active item is the head of the queue (queue[0]) while it is being shown.
    // We reinsert it after the newcomer so it still gets shown.
    if (queue.length > 0 && descriptor.priority > queue[0].priority) {
      const [active, ...rest] = queue;
      const reinserted = insertSorted(rest, active);
      return { queue: [descriptor, ...reinserted], activeId: descriptor.id, preempted: active.id };
    }

    const newQueue = insertSorted(queue, descriptor);
    // If nothing is currently active, the newcomer will become head.
    const newActiveId = newQueue.length === 1 ? descriptor.id : activeId;
    return { queue: newQueue, activeId: newActiveId, preempted: null };
  }

  if (action.type === 'DISMISS' || action.type === 'DWELL_EXPIRED') {
    const id = action.id ?? (queue[0]?.id);
    const newQueue = queue.filter(d => d.id !== id);
    return { queue: newQueue, activeId: newQueue[0]?.id ?? null, preempted: null };
  }

  if (action.type === 'DISMISS_ALL') {
    return { queue: [], activeId: null, preempted: null };
  }

  return state;
}

// ── React hook ────────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId() { return `snack-${++_idCounter}`; }

/**
 * useSnackbar() — React binding for the snackbar queue.
 *
 * Returns:
 *   active     — the current head descriptor (or null)
 *   enqueue(d) — add a descriptor; auto-assigns id if omitted
 *   dismiss(id)— remove by id (or head if id omitted)
 *   dismissAll — clear the entire queue
 */
export function useSnackbar() {
  const [state, setState] = useState({ queue: [], activeId: null, preempted: null });
  const dwellTimerRef = useRef(null);

  const dispatch = useCallback((action) => {
    setState(prev => applyAction(prev, action));
  }, []);

  const enqueue = useCallback((descriptor) => {
    dispatch({
      type: 'ENQUEUE',
      descriptor: { id: nextId(), ...descriptor },
    });
  }, [dispatch]);

  const dismiss = useCallback((id) => {
    dispatch({ type: 'DISMISS', id });
  }, [dispatch]);

  const dismissAll = useCallback(() => {
    dispatch({ type: 'DISMISS_ALL' });
  }, [dispatch]);

  // Drive the dwell timer off the active head.
  // When preemption happens the previous timer is cleared by the effect cleanup.
  const active = state.queue[0] ?? null;

  useEffect(() => {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    if (!active) return;

    const ms = active.dwell ?? 2400;
    dwellTimerRef.current = setTimeout(() => {
      dispatch({ type: 'DWELL_EXPIRED', id: active.id });
    }, ms);

    return () => {
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    };
  }, [active?.id, active?.dwell, dispatch]);

  return { active, enqueue, dismiss, dismissAll };
}
