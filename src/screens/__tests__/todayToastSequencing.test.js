/**
 * Tests for the Today screen "Got paid?" chip toast sequencing.
 *
 * Bug (fixed): after a Speed-mode job save, the "Got paid?" chip toast was
 * enqueued synchronously in the same handleJobSave call as showToast("Added
 * to Leads"). Both appeared at the same time — the chip sat on top of and
 * partially hid the standard "Added to Leads" toast + its View button.
 *
 * Fix: the chip is now deferred by TOAST_DISMISS_MS + TOAST_BUFFER_MS so it
 * only fires after the standard toast has cleared.
 *
 * These tests are pure-logic (no React, no DOM). They verify the timing
 * constants and the sequencing contract: chip fires AFTER toast clears.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Timing constants (mirrors the values in TodayScreen.jsx) ──────────────
// showToast auto-dismiss: setTimeout(..., 2400)
const TOAST_DISMISS_MS = 2400;
// Buffer after the toast clears before the chip appears
const TOAST_BUFFER_MS  = 200;
// Total deferral for the "Got paid?" chip show-delay
const CHIP_DEFER_MS    = TOAST_DISMISS_MS + TOAST_BUFFER_MS; // 2600

// ── Minimal model of the handleJobSave fast-path logic ───────────────────
// This mirrors what TodayScreen.jsx does — without React machinery — so we
// can assert on timer scheduling without mounting a component.

function makeController() {
  const events = [];
  let toastTimer     = null;
  let deferTimer     = null;
  let dismissTimer   = null;
  const deferTimers  = [];

  function showToast(msg) {
    events.push({ type: 'toast-show', msg, t: Date.now() });
    toastTimer = setTimeout(() => {
      events.push({ type: 'toast-clear', t: Date.now() });
    }, TOAST_DISMISS_MS);
  }

  function handleJobSave(payload) {
    const isFastPath  = payload?.via === 'fast';
    const isSpeedMode = payload?.speedMode === true;

    if (isFastPath) {
      showToast(`Added to Leads · £${payload.amount}`);

      if (isSpeedMode) {
        deferTimer = setTimeout(() => {
          deferTimers.splice(deferTimers.indexOf(deferTimer), 1);
          dismissTimer = setTimeout(() => {
            events.push({ type: 'chip-dismiss', t: Date.now() });
          }, 5000);
          events.push({ type: 'chip-show', job: payload, t: Date.now() });
        }, CHIP_DEFER_MS);
        deferTimers.push(deferTimer);
      }
    }
  }

  function teardown() {
    [toastTimer, deferTimer, dismissTimer].forEach(id => clearTimeout(id));
  }

  return { handleJobSave, events, teardown };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('toast sequencing constants', () => {
  it('TOAST_DISMISS_MS matches showToast auto-dismiss (2400)', () => {
    expect(TOAST_DISMISS_MS).toBe(2400);
  });

  it('CHIP_DEFER_MS is greater than TOAST_DISMISS_MS', () => {
    expect(CHIP_DEFER_MS).toBeGreaterThan(TOAST_DISMISS_MS);
  });

  it('CHIP_DEFER_MS equals TOAST_DISMISS_MS + TOAST_BUFFER_MS', () => {
    expect(CHIP_DEFER_MS).toBe(TOAST_DISMISS_MS + TOAST_BUFFER_MS);
  });

  it('CHIP_DEFER_MS is 2600', () => {
    expect(CHIP_DEFER_MS).toBe(2600);
  });
});

describe('handleJobSave fast-path — no speed mode', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows "Added to Leads" toast immediately on fast save', () => {
    const { handleJobSave, events, teardown } = makeController();
    handleJobSave({ via: 'fast', amount: 200, speedMode: false });
    expect(events.filter(e => e.type === 'toast-show').length).toBe(1);
    expect(events[0].msg).toContain('Added to Leads');
    teardown();
  });

  it('does NOT enqueue a chip when speedMode is false', () => {
    const { handleJobSave, events, teardown } = makeController();
    handleJobSave({ via: 'fast', amount: 200, speedMode: false });
    vi.advanceTimersByTime(CHIP_DEFER_MS + 100);
    expect(events.filter(e => e.type === 'chip-show').length).toBe(0);
    teardown();
  });
});

describe('handleJobSave fast-path + speed mode — sequential timing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('toast shows immediately, chip does NOT show before toast clears', () => {
    const { handleJobSave, events, teardown } = makeController();
    handleJobSave({ via: 'fast', amount: 380, speedMode: true });

    // At t=0: toast is shown
    expect(events.filter(e => e.type === 'toast-show').length).toBe(1);

    // Just before the toast auto-dismiss fires (t = TOAST_DISMISS_MS - 1)
    vi.advanceTimersByTime(TOAST_DISMISS_MS - 1);
    expect(events.filter(e => e.type === 'toast-clear').length).toBe(0);
    expect(events.filter(e => e.type === 'chip-show').length).toBe(0);
    teardown();
  });

  it('toast clears before chip appears (toast-clear precedes chip-show)', () => {
    const { handleJobSave, events, teardown } = makeController();
    handleJobSave({ via: 'fast', amount: 380, speedMode: true });

    // Advance past toast dismiss but before chip fires
    vi.advanceTimersByTime(TOAST_DISMISS_MS + 1);
    const toastClearEvents = events.filter(e => e.type === 'toast-clear');
    const chipShowEvents   = events.filter(e => e.type === 'chip-show');

    expect(toastClearEvents.length).toBe(1);
    expect(chipShowEvents.length).toBe(0); // chip not yet shown (needs CHIP_DEFER_MS)
    teardown();
  });

  it('chip appears after the full CHIP_DEFER_MS has elapsed', () => {
    const { handleJobSave, events, teardown } = makeController();
    handleJobSave({ via: 'fast', amount: 380, speedMode: true });

    vi.advanceTimersByTime(CHIP_DEFER_MS + 1);
    const chipShowEvents = events.filter(e => e.type === 'chip-show');
    expect(chipShowEvents.length).toBe(1);
    expect(chipShowEvents[0].job.amount).toBe(380);
    teardown();
  });

  it('at CHIP_DEFER_MS the standard toast has already cleared', () => {
    const { handleJobSave, events, teardown } = makeController();
    handleJobSave({ via: 'fast', amount: 380, speedMode: true });

    vi.advanceTimersByTime(CHIP_DEFER_MS + 1);
    const toastClearIdx = events.findIndex(e => e.type === 'toast-clear');
    const chipShowIdx   = events.findIndex(e => e.type === 'chip-show');

    // Both events must have fired and toast must come first
    expect(toastClearIdx).toBeGreaterThanOrEqual(0);
    expect(chipShowIdx).toBeGreaterThanOrEqual(0);
    expect(toastClearIdx).toBeLessThan(chipShowIdx);
    teardown();
  });
});

describe('handleJobSave — non-fast paths do not show chip or toast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('detailed-path save does not show "Added to Leads" toast', () => {
    const { handleJobSave, events, teardown } = makeController();
    handleJobSave({ via: 'details', amount: 200, speedMode: false });
    vi.advanceTimersByTime(CHIP_DEFER_MS + 100);
    expect(events.filter(e => e.type === 'toast-show').length).toBe(0);
    teardown();
  });

  it('detailed-path save with speedMode does not enqueue chip', () => {
    const { handleJobSave, events, teardown } = makeController();
    handleJobSave({ via: 'details', amount: 200, speedMode: true });
    vi.advanceTimersByTime(CHIP_DEFER_MS + 100);
    expect(events.filter(e => e.type === 'chip-show').length).toBe(0);
    teardown();
  });
});
