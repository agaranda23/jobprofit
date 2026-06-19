/**
 * Service-worker CACHE_NAME guard
 *
 * Catches the class of bug from PR #404: a bad merge conflict resolution that
 * deleted the `const CACHE_NAME =` declaration, leaving every use of
 * CACHE_NAME as a ReferenceError → SW fails to install for ALL users.
 *
 * This test runs in CI (npm test) and locally before every push. It does NOT
 * require building the app — it guards the SOURCE file public/sw.js so the
 * problem is caught before the build step.
 *
 * For what happens at build time (placeholder → real hash), see the
 * injectSwCacheId plugin in vite.config.js.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = fileURLToPath(new URL('.', import.meta.url));
// Walk up: src/lib/__tests__/ → src/lib/ → src/ → repo root
const repoRoot = resolve(__dir, '../../..');
const swPath = resolve(repoRoot, 'public/sw.js');

describe('public/sw.js — CACHE_NAME declaration guard', () => {
  it('public/sw.js exists', () => {
    expect(existsSync(swPath), `public/sw.js not found at ${swPath}`).toBe(true);
  });

  it('declares const CACHE_NAME exactly once', () => {
    const src = readFileSync(swPath, 'utf8');
    const declarations = src.match(/\bconst\s+CACHE_NAME\s*=/g) ?? [];
    expect(
      declarations.length,
      declarations.length === 0
        ? 'CACHE_NAME declaration is MISSING from public/sw.js — a bad merge likely deleted it. ' +
          'Without this line the SW throws ReferenceError and fails to install for all users. ' +
          'Restore the line: const CACHE_NAME = \'jobprofit-__BUILD_ID__\';'
        : `Found ${declarations.length} CACHE_NAME declarations — expected exactly 1.`,
    ).toBe(1);
  });

  it('every use of CACHE_NAME in sw.js is covered by the single declaration', () => {
    const src = readFileSync(swPath, 'utf8');

    // Count raw identifier references (any non-declaration use)
    const allRefs = (src.match(/\bCACHE_NAME\b/g) ?? []).length;
    const declarations = (src.match(/\bconst\s+CACHE_NAME\s*=/g) ?? []).length;

    // There must be at least one non-declaration reference (the SW must actually
    // USE the constant), and every reference must be backed by a declaration.
    expect(
      allRefs,
      'CACHE_NAME is declared but never referenced — the SW would silently use no cache name.',
    ).toBeGreaterThan(declarations);

    expect(
      declarations,
      `Found ${allRefs} references to CACHE_NAME but ${declarations} declarations. ` +
        'Every use of CACHE_NAME must be covered by the single const declaration at the top of the file.',
    ).toBeGreaterThanOrEqual(1);
  });

  it('CACHE_NAME value contains the build-id placeholder in source (not hand-bumped)', () => {
    const src = readFileSync(swPath, 'utf8');
    // The source file must use the placeholder. Injected values only appear
    // in dist/sw.js after `npm run build` — never in the source.
    const declarationLine = src.split('\n').find((l) => /\bconst\s+CACHE_NAME\s*=/.test(l));
    expect(
      declarationLine,
      'Could not find the CACHE_NAME declaration line.',
    ).toBeTruthy();

    expect(
      declarationLine,
      `CACHE_NAME in public/sw.js must use the placeholder 'jobprofit-__BUILD_ID__' — ` +
        `do NOT hand-bump the version. The build plugin injects the real hash automatically. ` +
        `Found: ${declarationLine?.trim()}`,
    ).toContain('__BUILD_ID__');
  });
});
