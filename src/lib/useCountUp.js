/**
 * useCountUp — animates a numeric value from 0 (first appearance) to target
 * over ~650ms with an ease-out curve via requestAnimationFrame.
 *
 * Rules:
 * - First mount: always starts from 0.
 * - Target change: re-animates from the current displayed value to the new target.
 * - prefers-reduced-motion: skips animation entirely, returns target immediately.
 * - Cleans up the pending rAF on unmount so no setState fires after unmount.
 * - enabled (default true): while false, holds displayed at 0 and resets all
 *   refs so that when enabled flips true a fresh 0→target animation runs.
 *   Use this to gate the animation behind async data (e.g. profile load) so
 *   the count-up is always visible rather than firing behind a skeleton.
 *
 * @param {number} target — the number to count up to
 * @param {{ enabled?: boolean }} options
 * @returns {number} — the current animated value (use this in render)
 */
import { useState, useEffect, useRef } from 'react';

const DURATION_MS = 650;

// ease-out quad: starts fast, decelerates toward the end
function easeOut(t) {
  return 1 - (1 - t) * (1 - t);
}

function prefersReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function useCountUp(target, { enabled = true } = {}) {
  const numericTarget = Number(target) || 0;
  // Start at 0 — the startValueRef===null guard makes the first animation run
  // from 0, so seeding to the target would cause a reverse flash on first mount.
  const [displayed, setDisplayed] = useState(0);

  // Track the start value and start time for each animation run.
  // Using refs avoids stale closure issues inside the rAF loop.
  const rafRef = useRef(null);
  const startValueRef = useRef(null);
  const startTimeRef = useRef(null);
  const prevTargetRef = useRef(numericTarget);

  useEffect(() => {
    // While disabled: cancel any in-flight animation, reset state + refs to
    // zero so the next enable always kicks off a clean 0→target run.
    if (!enabled) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      startValueRef.current = null;
      prevTargetRef.current = numericTarget;
      setDisplayed(0);
      return;
    }

    // Skip animation for users who prefer reduced motion
    if (prefersReducedMotion()) {
      setDisplayed(numericTarget);
      prevTargetRef.current = numericTarget;
      return;
    }

    // No animation needed if target hasn't changed
    if (numericTarget === prevTargetRef.current && startValueRef.current !== null) {
      return;
    }

    // Cancel any in-flight animation before starting a new one
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    // Start from 0 on first mount (startValueRef.current is null),
    // or from the current displayed value on target changes.
    const fromValue = startValueRef.current === null ? 0 : displayed;
    startValueRef.current = fromValue;
    startTimeRef.current = null;
    prevTargetRef.current = numericTarget;

    function tick(ts) {
      if (startTimeRef.current === null) {
        startTimeRef.current = ts;
      }
      const elapsed = ts - startTimeRef.current;
      const progress = Math.min(elapsed / DURATION_MS, 1);
      const eased = easeOut(progress);
      const current = fromValue + (numericTarget - fromValue) * eased;

      setDisplayed(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Snap to exact target at end to avoid floating-point residue
        setDisplayed(numericTarget);
        rafRef.current = null;
      }
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  // displayed is intentionally excluded: we capture fromValue in the closure
  // at effect start time. Including displayed would restart the animation on
  // every frame, creating an infinite loop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericTarget, enabled]);

  return displayed;
}
