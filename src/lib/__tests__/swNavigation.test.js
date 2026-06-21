/**
 * Service-worker navigation-first fetch strategy guard
 *
 * WHY: The blank-page-on-deploy bug (fixed in fix/sw-navigation-network-first)
 * was caused by the SW's fetch handler serving the HTML document via
 * stale-while-revalidate. At a deploy boundary the old cached index.html
 * references old content-hashed asset URLs; when the new SW activates and
 * deletes the old cache those assets 404 → blank page until a refresh.
 *
 * The fix: a navigation-request branch (request.mode === 'navigate') that runs
 * BEFORE the static-assets branch and fetches the HTML document network-first.
 *
 * WHY NOT a real SW fetch-handler unit test:
 * The fetch handler runs inside the SW runtime (browser ServiceWorkerGlobalScope)
 * with browser-only globals (self, caches, fetch, Response, FetchEvent). This
 * Vitest harness runs in Node/jsdom — neither provides a ServiceWorker execution
 * context. The `service-worker-mock` package is not in this repo's dependencies.
 * Adding it would be the correct long-term approach, but a source-level
 * structural guard (like swCacheName.test.js guards the CACHE_NAME declaration)
 * is faster to ship, runs in CI with no new dependencies, and directly prevents
 * the regression it is named for.
 *
 * WHAT this test guards:
 *   - The navigation branch exists in public/sw.js source
 *   - It uses request.mode === 'navigate' to identify navigation requests
 *   - It contains an async fetch() call (network-first)
 *   - It appears BEFORE the static-assets (section 5) branch
 *   - It handles the offline case (caches.match fallback present)
 *   - It never calls respondWith(undefined) — always resolves to a Response
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = fileURLToPath(new URL('.', import.meta.url));
// Walk up: src/lib/__tests__/ → src/lib/ → src/ → repo root
const repoRoot = resolve(__dir, '../../..');
const swPath = resolve(repoRoot, 'public/sw.js');

describe('public/sw.js — navigation-first fetch strategy guard', () => {
  let src;

  it('public/sw.js exists', () => {
    expect(existsSync(swPath), `public/sw.js not found at ${swPath}`).toBe(true);
    src = readFileSync(swPath, 'utf8');
  });

  it('has a navigation branch that checks request.mode === "navigate"', () => {
    src = src ?? readFileSync(swPath, 'utf8');
    // Accept both quote styles
    const hasNavigateCheck =
      src.includes("request.mode === 'navigate'") ||
      src.includes('request.mode === "navigate"');
    expect(
      hasNavigateCheck,
      'No request.mode === "navigate" check found in public/sw.js. ' +
        'The navigation-first branch is required to prevent blank-page-on-deploy. ' +
        'See fix/sw-navigation-network-first for the correct implementation.',
    ).toBe(true);
  });

  it('navigation branch calls fetch() (network-first pattern)', () => {
    src = src ?? readFileSync(swPath, 'utf8');
    // Confirm fetch(request) appears after the navigate check
    const navigateIdx = src.indexOf("request.mode === 'navigate'") !== -1
      ? src.indexOf("request.mode === 'navigate'")
      : src.indexOf('request.mode === "navigate"');
    const fetchAfterNavigate = src.slice(navigateIdx).includes('await fetch(request)');
    expect(
      fetchAfterNavigate,
      'No await fetch(request) found after the navigate check — ' +
        'the navigation branch must be network-first (fetch before cache).',
    ).toBe(true);
  });

  it('navigation branch has a caches.match fallback (offline support)', () => {
    src = src ?? readFileSync(swPath, 'utf8');
    const navigateIdx = src.indexOf("request.mode === 'navigate'") !== -1
      ? src.indexOf("request.mode === 'navigate'")
      : src.indexOf('request.mode === "navigate"');
    // Find the end of the navigate if-block by looking for the next top-level `if (`
    // after the navigate check — the fallback must be inside the navigate block
    const navigateBlock = src.slice(navigateIdx, navigateIdx + 2000);
    const hasFallback = navigateBlock.includes('caches.match(');
    expect(
      hasFallback,
      'No caches.match() fallback found in the navigation branch. ' +
        'Offline users must still get the cached shell.',
    ).toBe(true);
  });

  it('navigation branch comes BEFORE the static-assets branch in the file', () => {
    src = src ?? readFileSync(swPath, 'utf8');
    const navigateIdx = src.indexOf("request.mode === 'navigate'") !== -1
      ? src.indexOf("request.mode === 'navigate'")
      : src.indexOf('request.mode === "navigate"');
    // Anchor on the section-5 in-handler comment header (not the routing table at
    // the top of the fetch handler, which also mentions "Static assets" but is just
    // a description block, not the actual branch code).
    // '── 5.' only appears in the real code comment at the start of the assets branch.
    const assetsMarkers = ['── 5.', 'section 5 (assets)'];
    let assetsIdx = -1;
    for (const marker of assetsMarkers) {
      const idx = src.indexOf(marker);
      if (idx !== -1) { assetsIdx = idx; break; }
    }
    expect(
      navigateIdx,
      'Could not find the navigation branch (request.mode === "navigate") in public/sw.js.',
    ).toBeGreaterThan(-1);
    expect(
      assetsIdx,
      'Could not find the static-assets branch marker in public/sw.js. ' +
        'Expected one of: ' + assetsMarkers.join(', '),
    ).toBeGreaterThan(-1);
    expect(
      navigateIdx,
      'The navigation branch must appear BEFORE the static-assets branch. ' +
        `Navigate branch at char ${navigateIdx}, assets branch at char ${assetsIdx}.`,
    ).toBeLessThan(assetsIdx);
  });

  it('navigation branch returns a real Response on network failure (no undefined)', () => {
    src = src ?? readFileSync(swPath, 'utf8');
    const navigateIdx = src.indexOf("request.mode === 'navigate'") !== -1
      ? src.indexOf("request.mode === 'navigate'")
      : src.indexOf('request.mode === "navigate"');
    // Extract roughly the navigate block (up to 2500 chars to cover the whole handler)
    const navigateBlock = src.slice(navigateIdx, navigateIdx + 2500);
    // The catch block must construct a new Response as last-resort — never return undefined
    const hasResponseFallback = navigateBlock.includes('new Response(');
    expect(
      hasResponseFallback,
      'The navigation branch catch block must return a new Response() as a last resort. ' +
        'Returning undefined from respondWith() causes a network error instead of a graceful degradation.',
    ).toBe(true);
  });
});
