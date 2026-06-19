/**
 * Migration ledger guard
 *
 * Fails when a *.sql file in supabase/migrations/ is not listed in
 * supabase/migrations/APPLIED.md, and when a ledger entry references
 * a file that no longer exists on disk.
 *
 * This is the dev / PR gate for the hand-apply workflow. Netlify's build
 * command is `npm run build` (not `npm test`), so this runs on dev machines
 * and in any CI step that calls `npm test`. The intent is:
 *   - You CANNOT merge a new migration without acknowledging it in the ledger.
 *   - You CANNOT let the ledger reference a file that was deleted.
 *
 * No prod access required — this is a pure filesystem reconciliation.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dir = fileURLToPath(new URL('.', import.meta.url));
// Walk up from src/lib/__tests__/ → src/lib/ → src/ → repo root
// (3 levels, not 4 — the worktree root is the repo root)
const repoRoot = resolve(__dir, '../../..');
const migrationsDir = resolve(repoRoot, 'supabase/migrations');
const ledgerPath = resolve(migrationsDir, 'APPLIED.md');

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseLedger(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    // Match markdown table data rows (not header or separator rows)
    const m = line.match(/^\|\s*\d+\s*\|\s*`([^`]+\.sql)`\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const filename = m[1].trim();
    const rawStatus = m[2].trim().toLowerCase();
    const status = rawStatus.startsWith('yes')
      ? 'applied'
      : rawStatus.startsWith('deferred')
      ? 'deferred'
      : 'unknown';
    entries.push({ filename, status });
  }
  return entries;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('supabase/migrations/APPLIED.md ledger', () => {
  it('APPLIED.md exists', () => {
    expect(existsSync(ledgerPath), `APPLIED.md not found at ${ledgerPath}`).toBe(true);
  });

  it('APPLIED.md contains at least one ledger entry', () => {
    const text = readFileSync(ledgerPath, 'utf8');
    const entries = parseLedger(text);
    expect(entries.length, 'No ledger entries parsed from APPLIED.md — check the table format').toBeGreaterThan(0);
  });

  it('every *.sql file in supabase/migrations/ is listed in APPLIED.md', () => {
    const text = readFileSync(ledgerPath, 'utf8');
    const entries = parseLedger(text);
    const ledgerFiles = new Set(entries.map((e) => e.filename));

    const sqlFiles = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const unlisted = sqlFiles.filter((f) => !ledgerFiles.has(f));

    expect(
      unlisted,
      [
        'The following migration files are NOT listed in APPLIED.md.',
        'Add them to the ledger before merging — set applied_to_prod: yes/deferred as appropriate.',
        '',
        ...unlisted.map((f) => `  • ${f}`),
      ].join('\n'),
    ).toHaveLength(0);
  });

  it('every ledger entry references an existing .sql file', () => {
    const text = readFileSync(ledgerPath, 'utf8');
    const entries = parseLedger(text);

    const orphaned = entries.filter(
      ({ filename }) => !existsSync(resolve(migrationsDir, filename)),
    );

    expect(
      orphaned,
      [
        'The following ledger entries reference files that do NOT exist on disk.',
        'Remove or rename the ledger entry to match the actual filename.',
        '',
        ...orphaned.map(({ filename }) => `  • ${filename}`),
      ].join('\n'),
    ).toHaveLength(0);
  });

  it('no ledger entry has status "unknown" — every entry must be yes/deferred', () => {
    const text = readFileSync(ledgerPath, 'utf8');
    const entries = parseLedger(text);

    const unknownEntries = entries.filter((e) => e.status === 'unknown');

    expect(
      unknownEntries,
      [
        'The following ledger entries have an unrecognised status (expected "yes (date)" or "deferred").',
        'Update APPLIED.md to reflect whether these migrations have been applied to prod.',
        '',
        ...unknownEntries.map(({ filename, status }) => `  • ${filename}: "${status}"`),
      ].join('\n'),
    ).toHaveLength(0);
  });
});

describe('scripts/gen-drift-audit.mjs', () => {
  const scriptPath = resolve(repoRoot, 'scripts/gen-drift-audit.mjs');

  it('generator script exists', () => {
    expect(existsSync(scriptPath), `gen-drift-audit.mjs not found at ${scriptPath}`).toBe(true);
  });

  it('generator produces non-empty SQL output without warnings', () => {
    // Run the generator as a child process so we capture real stdout/stderr
    // without Vite's module bundler interfering with the dynamic import.
    const result = spawnSync('node', [scriptPath], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 15000,
    });

    expect(
      result.status,
      `gen-drift-audit.mjs exited with code ${result.status}.\nstderr: ${result.stderr}`,
    ).toBe(0);

    const output = result.stdout;
    expect(output, 'Generator produced no SQL output').toContain('SELECT');
    expect(output, 'Generator output should contain VALUES').toContain('VALUES');

    // Warnings about missing files or unlisted migrations are treated as failures
    const warnings = (result.stderr || '')
      .split('\n')
      .filter((l) => l.startsWith('WARNING:'));
    expect(
      warnings,
      [
        'gen-drift-audit.mjs emitted warnings — fix the ledger before merging.',
        '',
        ...warnings.map((w) => `  ${w}`),
      ].join('\n'),
    ).toHaveLength(0);
  });
});
