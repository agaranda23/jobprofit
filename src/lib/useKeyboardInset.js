/**
 * useKeyboardInset
 *
 * Listens to window.visualViewport resize/scroll events and writes the current
 * on-screen keyboard height as a CSS custom property --kb-inset on :root.
 * Default value is 0px (keyboard closed, or browser lacks visualViewport API).
 *
 * Usage: call once at the app root (AppShell) — the CSS variable is then
 * available to every bottom-sheet modal automatically.
 *
 *   import { useKeyboardInset } from './lib/useKeyboardInset';
 *   function AppShell() { useKeyboardInset(); ... }
 *
 * The keyboard height is computed as:
 *   Math.max(0, layoutViewportHeight - visualViewport.height - visualViewport.offsetTop)
 *
 * visualViewport.offsetTop accounts for browser chrome that may shift the
 * viewport (e.g. iOS Safari address bar shrink). Subtracting it avoids
 * over-counting on scroll.
 *
 * Throttled with requestAnimationFrame — no more than one update per frame.
 * Listeners are cleaned up on unmount.
 */

import { useEffect } from 'react';

export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return; // browser without visualViewport (rare, but guard it)

    let rafId = null;

    function update() {
      if (rafId !== null) return; // already queued
      rafId = requestAnimationFrame(() => {
        rafId = null;
        // layoutViewportHeight is window.innerHeight — the full layout
        // viewport that does NOT shrink when the keyboard opens (on iOS
        // Safari it may shrink slightly for the toolbar, but the visual
        // viewport drops further, so the difference is still the keypad).
        const layoutHeight = window.innerHeight;
        const inset = Math.max(
          0,
          layoutHeight - vv.height - vv.offsetTop,
        );
        document.documentElement.style.setProperty(
          '--kb-inset',
          `${inset}px`,
        );
      });
    }

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);

    // Set initial value in case the keyboard is already up on mount
    update();

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      if (rafId !== null) cancelAnimationFrame(rafId);
      // Reset to 0 when the hook unmounts so nothing inherits a stale value
      document.documentElement.style.setProperty('--kb-inset', '0px');
    };
  }, []);
}
