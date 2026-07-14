/**
 * Service-worker auto-update registration guard
 *
 * WHY: The SW (public/sw.js) already calls skipWaiting() on install and
 * clients.claim() on activate, which means a freshly deployed SW will take
 * over immediately. But without a 'controllerchange' listener on the page,
 * the page keeps running old JS/CSS until the user manually refreshes.
 * This caused repeated "nothing changed" confusion after deploys.
 *
 * The fix (feat/sw-auto-update): AppShell.jsx registers a 'controllerchange'
 * listener that reloads the page ONCE when a new SW takes control. A
 * module-level `swReloaded` flag prevents reload loops.
 *
 * FOLLOW-UP (splash-reappears-on-navigation bug): that reload used to fire
 * the INSTANT a new SW took control, even mid-session with the app fully
 * foregrounded — remounting the whole tree, resetting authReady/
 * splashMinElapsed to false, and replaying the full branded Splash. From the
 * trader's seat that read as "the app randomly kicked me back to the splash
 * screen while I was using it". The fix: (1) defer the reload until the tab
 * is backgrounded (invisible either way), and (2) flag the reload via
 * sessionStorage so the very next boot skips the artificial splash dwell
 * floor instead of replaying it.
 *
 * WHY NOT a JSDOM/RTL integration test:
 * navigator.serviceWorker is a browser-only API (ServiceWorkerContainer).
 * JSDOM stubs it inconsistently, and mocking the full lifecycle would test
 * the mock, not the code. A source-level structural guard — the same approach
 * as swCacheName.test.js and swNavigation.test.js — catches the regression at
 * CI time with zero browser-API mocking overhead.
 *
 * WHAT this test guards:
 *   - A module-level `swReloaded` flag exists (loop-guard present in source)
 *   - A 'controllerchange' event listener is registered on navigator.serviceWorker
 *   - The handler checks `swReloaded` before reloading (loop-guard is used)
 *   - `swReloaded = true` is set BEFORE window.location.reload() (set-before-reload order)
 *   - The listener is cleaned up (removeEventListener in the effect return)
 *   - The reload is deferred (via a 'visibilitychange' → hidden check) rather
 *     than firing unconditionally while the tab may be foregrounded
 *   - The same sessionStorage key is written before the reload AND read by
 *     splashMinElapsed's initialiser, so the next boot skips the splash dwell
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = fileURLToPath(new URL('.', import.meta.url));
// Walk up: src/lib/__tests__/ → src/lib/ → src/ → repo root
const repoRoot = resolve(__dir, '../../..');
const appShellPath = resolve(repoRoot, 'src/AppShell.jsx');

describe('AppShell.jsx — SW auto-update registration guard', () => {
  let src;

  it('AppShell.jsx exists', () => {
    expect(existsSync(appShellPath), `AppShell.jsx not found at ${appShellPath}`).toBe(true);
    src = readFileSync(appShellPath, 'utf8');
  });

  it('declares a module-level swReloaded flag (loop guard)', () => {
    src = src ?? readFileSync(appShellPath, 'utf8');
    const hasFlag = src.includes('let swReloaded') || src.includes('var swReloaded');
    expect(
      hasFlag,
      'No module-level `let swReloaded` found in AppShell.jsx. ' +
        'The loop-guard flag must be declared at module scope (outside any function) so it ' +
        'survives React re-renders and prevents a second controllerchange from firing a second reload. ' +
        'Add: `let swReloaded = false;` at module level.',
    ).toBe(true);
  });

  it('swReloaded flag is declared OUTSIDE any function (module scope)', () => {
    src = src ?? readFileSync(appShellPath, 'utf8');
    // A simple heuristic: the declaration must not be inside a function body.
    // We check that it appears at column 0 / minimal indentation (no leading spaces on its line).
    const lines = src.split('\n');
    const flagLine = lines.find(l => /^let swReloaded/.test(l) || /^var swReloaded/.test(l));
    expect(
      flagLine,
      '`let swReloaded` must be declared at module scope with no leading indentation. ' +
        'If it is inside a function or useEffect it resets on every render and cannot guard against loops.',
    ).toBeTruthy();
  });

  it('registers a controllerchange listener on navigator.serviceWorker', () => {
    src = src ?? readFileSync(appShellPath, 'utf8');
    const hasListener =
      src.includes("'controllerchange'") || src.includes('"controllerchange"');
    expect(
      hasListener,
      'No controllerchange event listener found in AppShell.jsx. ' +
        "Add: navigator.serviceWorker.addEventListener('controllerchange', handler) " +
        'inside the SW registration useEffect so the page reloads when a new SW takes control.',
    ).toBe(true);
  });

  it('handler checks swReloaded before reloading (loop-guard is used)', () => {
    src = src ?? readFileSync(appShellPath, 'utf8');
    // Anchor on the addEventListener call (not a comment). The call must contain
    // the string literal 'controllerchange' as an argument — look for the pattern
    // addEventListener('controllerchange' or addEventListener("controllerchange".
    const addListenerPattern = /addEventListener\(\s*['"]controllerchange['"]/;
    const addListenerMatch = addListenerPattern.exec(src);
    expect(
      addListenerMatch,
      "No addEventListener('controllerchange', ...) call found in AppShell.jsx. " +
        'The SW registration useEffect must register a controllerchange listener.',
    ).toBeTruthy();

    // The handler function assigned to the listener must guard with swReloaded.
    // Check: swReloaded guard appears somewhere between the module flag declaration
    // and the addEventListener call.
    const hasGuardCheck =
      src.includes('if (swReloaded)') || src.includes('if(swReloaded)');
    expect(
      hasGuardCheck,
      'The controllerchange handler must check `if (swReloaded) return;` before reloading. ' +
        'Without this guard, two rapid controllerchange events (e.g. two near-simultaneous deploys) ' +
        'could cause an infinite reload loop.',
    ).toBe(true);
  });

  it('sets swReloaded = true BEFORE calling window.location.reload() (order matters)', () => {
    src = src ?? readFileSync(appShellPath, 'utf8');
    // Use lastIndexOf to find the LAST occurrence so we anchor on the real code,
    // not on comment text that might mention the same tokens earlier in the file.
    const setIdx = src.lastIndexOf('swReloaded = true');
    // For reload(), we want the occurrence that is actual code (not in a comment).
    // Find all occurrences of window.location.reload() and pick the last one.
    const reloadIdx = src.lastIndexOf('window.location.reload()');
    expect(
      setIdx,
      '`swReloaded = true` not found in AppShell.jsx. ' +
        'The flag must be set to true before calling window.location.reload() so a ' +
        'controllerchange fired during the reload cycle cannot trigger a second reload.',
    ).toBeGreaterThan(-1);
    expect(
      reloadIdx,
      '`window.location.reload()` not found in AppShell.jsx. ' +
        'The controllerchange handler must call window.location.reload() to apply the new SW.',
    ).toBeGreaterThan(-1);
    expect(
      setIdx,
      '`swReloaded = true` must appear BEFORE `window.location.reload()` in the source. ' +
        `swReloaded set at char ${setIdx}, reload() called at char ${reloadIdx}. ` +
        'If reload() is called first, a controllerchange during the reload can bypass the guard.',
    ).toBeLessThan(reloadIdx);
  });

  it('removes the controllerchange listener on cleanup (no listener leak)', () => {
    src = src ?? readFileSync(appShellPath, 'utf8');
    const hasCleanup =
      src.includes("removeEventListener('controllerchange'") ||
      src.includes('removeEventListener("controllerchange"');
    expect(
      hasCleanup,
      'No removeEventListener for controllerchange found in AppShell.jsx. ' +
        "Add: navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange) " +
        'in the useEffect cleanup return so the listener is removed if the component unmounts ' +
        '(prevents a listener accumulation on HMR / strict-mode double-mounts in development).',
    ).toBe(true);
  });

  // ── Splash-reappears-on-navigation regression coverage ──────────────────────
  // These guard the fix for the bug where an in-flight SW update reloaded the
  // page (and replayed the full Splash) at any point mid-session, including
  // while the app was foregrounded and the user was actively navigating.

  it('does not reload immediately while the tab may be visible — defers via visibilitychange', () => {
    src = src ?? readFileSync(appShellPath, 'utf8');
    const hasVisibilityGate = src.includes("document.visibilityState === 'hidden'");
    expect(
      hasVisibilityGate,
      "No `document.visibilityState === 'hidden'` check found in AppShell.jsx. " +
        'The controllerchange handler must only reload immediately when the tab is already ' +
        'hidden, and otherwise wait for the user to background it — an unconditional reload ' +
        'can fire while the app is foregrounded mid-session, unmounting the tree and replaying ' +
        'the full Splash on top of whatever the user was doing.',
    ).toBe(true);

    const hasDeferredListener =
      src.includes("addEventListener('visibilitychange'") ||
      src.includes('addEventListener("visibilitychange"');
    expect(
      hasDeferredListener,
      "No 'visibilitychange' listener found in AppShell.jsx. " +
        'The controllerchange handler must arm a visibilitychange listener to defer the reload ' +
        'until the tab is backgrounded, rather than reloading the instant the SW takes control.',
    ).toBe(true);

    const cleansUpDeferredListener =
      src.includes("removeEventListener('visibilitychange'") ||
      src.includes('removeEventListener("visibilitychange"');
    expect(
      cleansUpDeferredListener,
      'No removeEventListener for visibilitychange found in AppShell.jsx. ' +
        'The deferred hidden-listener must be removed once it fires (and on effect cleanup) ' +
        'to avoid a listener leak.',
    ).toBe(true);
  });

  it('flags the SW-triggered reload via sessionStorage so the next boot can skip the splash dwell', () => {
    src = src ?? readFileSync(appShellPath, 'utf8');

    // The reload path and the splashMinElapsed initialiser must reference the
    // SAME sessionStorage key, or the flag written before reload is never read.
    const keyDeclMatch = /const\s+(\w+)\s*=\s*['"][\w.]*swReload[\w.]*['"]/i.exec(src);
    expect(
      keyDeclMatch,
      'No sessionStorage key constant for the SW-reload splash-skip flag found in AppShell.jsx ' +
        "(expected something like `const SW_RELOAD_SPLASH_SKIP_KEY = 'ohnar.swReload.skipSplashDwell';`).",
    ).toBeTruthy();
    const keyName = keyDeclMatch[1];

    const setCount = src.split(`sessionStorage.setItem(${keyName}`).length - 1;
    expect(
      setCount,
      `Expected \`sessionStorage.setItem(${keyName}, ...)\` to be called once, right before ` +
        'window.location.reload() in the controllerchange handler, so the next boot can detect ' +
        'this was an SW-triggered reload rather than a genuine cold start.',
    ).toBeGreaterThan(0);

    const getCount = src.split(`sessionStorage.getItem(${keyName}`).length - 1;
    expect(
      getCount,
      `Expected \`sessionStorage.getItem(${keyName})\` to be read by splashMinElapsed's useState ` +
        'initialiser, so a boot immediately following the SW reload skips the artificial splash ' +
        'dwell floor instead of replaying the full ~1.2s branded animation.',
    ).toBeGreaterThan(0);
  });
});
