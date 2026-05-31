/**
 * Vitest global test setup — loaded before ALL test files.
 *
 * This file is referenced in vitest.config.js via test.setupFiles.
 *
 * Two responsibilities:
 *   1. Extends vitest's expect with @testing-library/jest-dom matchers
 *      (toBeInTheDocument, toHaveTextContent, etc.) for the jsdom-env
 *      render smoke tests. Pure-logic node-env tests are unaffected.
 *
 *   2. Stubs browser APIs that jsdom does not implement but our components
 *      call at render time:
 *        - window.matchMedia  — used by src/lib/theme.js and CollapsedSectionRow
 *        - window.ResizeObserver — used by some chart/animation code
 *        - window.IntersectionObserver — defensive stub
 *
 *      These stubs only matter in the jsdom environment. They are no-ops in
 *      the node environment (window is undefined, typeof window === 'undefined').
 */
import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// ── Browser API stubs for jsdom ───────────────────────────────────────────────
// jsdom does not implement matchMedia, ResizeObserver, or IntersectionObserver.
// Stub them so components that call these at mount time don't crash in tests.

if (typeof window !== 'undefined') {
  // matchMedia — used by theme.js (system theme detection) and CollapsedSectionRow
  // (prefers-reduced-motion check). The stub returns a minimal MediaQueryList-like
  // object: always matches=false, addEventListener/removeEventListener are no-ops.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  // ResizeObserver — used by some chart libraries and animation hooks.
  if (typeof window.ResizeObserver === 'undefined') {
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  // IntersectionObserver — defensive stub for any scroll/visibility hooks.
  if (typeof window.IntersectionObserver === 'undefined') {
    window.IntersectionObserver = class IntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}
