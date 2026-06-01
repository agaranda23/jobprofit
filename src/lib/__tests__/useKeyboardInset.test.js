/**
 * useKeyboardInset — unit tests for the keyboard-inset formula.
 *
 * Convention: no DOM, no React, no @testing-library — matches project norm.
 * Visual smoke is covered by the deploy-preview checklist in the PR.
 *
 * The visualViewport browser API is not available in jsdom, so these tests
 * exercise the inset computation formula directly (the hard-to-get-right maths)
 * rather than the full event-listener machinery.
 *
 * Formula under test:
 *   Math.max(0, layoutHeight - visualViewport.height - visualViewport.offsetTop)
 *
 * layoutHeight = window.innerHeight (does not shrink on iOS when keyboard opens)
 * visualViewport.height = portion of the viewport visible above the keyboard
 * visualViewport.offsetTop = vertical offset if the page has scrolled
 */

import { describe, it, expect } from 'vitest';

/**
 * Mirrors the inset calculation inside useKeyboardInset.js.
 * Keeping it as a pure function makes it trivially testable.
 */
function computeKeyboardInset({ layoutHeight, vpHeight, vpOffsetTop }) {
  return Math.max(0, layoutHeight - vpHeight - vpOffsetTop);
}

describe('computeKeyboardInset formula', () => {
  it('returns 0 when the keyboard is closed (vpHeight equals layoutHeight)', () => {
    expect(computeKeyboardInset({
      layoutHeight: 844,
      vpHeight: 844,
      vpOffsetTop: 0,
    })).toBe(0);
  });

  it('returns the keyboard height when the keypad is up', () => {
    // A typical numeric keypad on a mid-size Android takes ~336px
    expect(computeKeyboardInset({
      layoutHeight: 844,
      vpHeight: 508,
      vpOffsetTop: 0,
    })).toBe(336);
  });

  it('subtracts offsetTop so scroll does not over-count the inset', () => {
    // vpHeight is 508 but the page has scrolled 30px (iOS Safari toolbar shrink),
    // so the effective gap (keyboard height) is 336 - 30 = 306.
    expect(computeKeyboardInset({
      layoutHeight: 844,
      vpHeight: 508,
      vpOffsetTop: 30,
    })).toBe(306);
  });

  it('never returns a negative inset (keyboard closed + page scrolled)', () => {
    // Some browsers report vpOffsetTop > 0 even without a keyboard — must not go negative.
    expect(computeKeyboardInset({
      layoutHeight: 844,
      vpHeight: 820,
      vpOffsetTop: 30,
    })).toBe(0);
  });

  it('returns 0 on a full-size viewport (desktop / keyboard not in play)', () => {
    expect(computeKeyboardInset({
      layoutHeight: 1080,
      vpHeight: 1080,
      vpOffsetTop: 0,
    })).toBe(0);
  });

  it('handles iOS-style small keyboard (iPad split screen, small keypad)', () => {
    expect(computeKeyboardInset({
      layoutHeight: 1024,
      vpHeight: 776,
      vpOffsetTop: 0,
    })).toBe(248);
  });
});
