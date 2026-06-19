/**
 * gen-drift-audit.mjs
 *
 * Reads supabase/migrations/APPLIED.md and the *.sql files in
 * supabase/migrations/ and emits a consolidated SQL query you paste into
 * Supabase Studio → SQL Editor to verify prod matches the repo.
 *
 * Usage:
 *   node scripts/gen-drift-audit.mjs
 *
 * The output is pure SQL — copy it, paste it into Supabase Studio, run it.
 * Every row in the result represents one migration. The `verified` column
 * tells you whether the thing the migration added (or removed) is present in
 * prod as expected.
 *
 * Run this whenever APPLIED.md changes (a new migration is merged or a
 * deferred migration is promoted to applied). The query never goes stale
 * because it is generated fresh from the actual migration files each time.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dir, '../supabase/migrations');
const ledgerPath = resolve(migrationsDir, 'APPLIED.md');

// ── 1. Parse APPLIED.md ───────────────────────────────────────────────────────

const ledgerText = readFileSync(ledgerPath, 'utf8');

/** @type {{ filename: string; status: string }[]} */
const ledger = [];

// Parse the markdown table rows (skip header rows).
// Format: | # | `filename` | status (year...) | Notes |
for (const line of ledgerText.split('\n')) {
  const m = line.match(/^\|\s*\d+\s*\|\s*`([^`]+)`\s*\|\s*([^\|]+?)\s*\|/);
  if (!m) continue;
  const filename = m[1].trim();
  const rawStatus = m[2].trim().toLowerCase();
  const status = rawStatus.startsWith('yes')
    ? 'applied'
    : rawStatus.startsWith('deferred')
    ? 'deferred'
    : 'unknown';
  ledger.push({ filename, status });
}

if (ledger.length === 0) {
  process.stderr.write('ERROR: Could not parse any rows from APPLIED.md\n');
  process.exit(1);
}

// ── 2. Scan SQL files ─────────────────────────────────────────────────────────

const sqlFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

// ── 3. Build per-migration check fragments ────────────────────────────────────

/**
 * Derive a minimal verification snippet for each migration.
 *
 * Strategy: scan the SQL for the first concrete DDL statement that is
 * unambiguous (CREATE TABLE, ALTER TABLE ADD COLUMN, CREATE POLICY, etc.) and
 * build an information_schema / pg_catalog query that returns TRUE when the
 * thing exists in prod (or FALSE for negative migrations that remove things).
 *
 * For anything we cannot pattern-match reliably, we emit a human-readable
 * placeholder so the DBA can fill in the check manually — the query still
 * runs; that row just returns 'manual-check-required'.
 */
function deriveCheck(filename, sql) {
  const isNegative =
    /DRIFT-CHECK:\s*negative migration/i.test(sql);

  // CREATE TABLE IF NOT EXISTS public.<table>
  const createTable = sql.match(
    /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(?:public\.)?(\w+)/i,
  );
  if (createTable) {
    const tbl = createTable[1];
    const exists = `EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${tbl}')`;
    return isNegative
      ? `NOT ${exists} AS verified, 'table ${tbl} should NOT exist' AS detail`
      : `${exists} AS verified, 'table public.${tbl} exists' AS detail`;
  }

  // ALTER TABLE public.<table> ADD COLUMN IF NOT EXISTS <col>
  // or ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <col>
  const addCol = sql.match(
    /ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i,
  );
  if (addCol) {
    const tbl = addCol[1];
    const col = addCol[2];
    const exists = `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${tbl}' AND column_name = '${col}')`;
    return isNegative
      ? `NOT ${exists} AS verified, 'column ${tbl}.${col} should NOT exist' AS detail`
      : `${exists} AS verified, 'column public.${tbl}.${col} exists' AS detail`;
  }

  // DROP DEFAULT — check column has no default (negative)
  // ALTER TABLE public.<table> ALTER COLUMN <col> DROP DEFAULT
  const dropDefault = sql.match(
    /ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ALTER\s+COLUMN\s+(\w+)\s+DROP\s+DEFAULT/i,
  );
  if (dropDefault) {
    const tbl = dropDefault[1];
    const col = dropDefault[2];
    return `NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${tbl}' AND column_name = '${col}' AND column_default IS NOT NULL) AS verified, 'column ${tbl}.${col} has no DEFAULT (expected after DROP DEFAULT)' AS detail`;
  }

  // DROP POLICY IF EXISTS "<name>" ON [schema.]<table>
  // If the file DROPs a policy and does NOT also CREATE it (i.e. it is a pure
  // removal migration), verify that the policy is absent from prod.
  //
  // Regex handles: ON public.tbl, ON storage.objects, ON tbl (defaults to public)
  const dropPolicy = sql.match(
    /DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"\s+ON\s+(?:(\w+)\.)?(\w+)/i,
  );
  const createPolicy = sql.match(
    /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:(\w+)\.)?(\w+)/i,
  );

  // A pure DROP-only file: the policy should no longer exist in prod.
  if (dropPolicy && !createPolicy) {
    const policy = dropPolicy[1];
    const schema = dropPolicy[2] || 'public';
    const tbl = dropPolicy[3];
    return `NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = '${schema}' AND tablename = '${tbl}' AND policyname = '${policy}') AS verified, 'policy ${policy} on ${schema}.${tbl} should NOT exist (was DROPped by this migration)' AS detail`;
  }

  // CREATE POLICY (with optional preceding DROP for idempotency) — policy should exist.
  if (createPolicy) {
    const policy = createPolicy[1];
    const schema = createPolicy[2] || 'public';
    const tbl = createPolicy[3];
    return `EXISTS (SELECT 1 FROM pg_catalog.pg_policies WHERE schemaname = '${schema}' AND tablename = '${tbl}' AND policyname = '${policy}') AS verified, 'RLS policy ${policy} on ${schema}.${tbl} exists' AS detail`;
  }

  // Realtime / publication
  if (/ALTER\s+PUBLICATION\s+supabase_realtime/i.test(sql)) {
    // Extract first table mentioned
    const pub = sql.match(/FOR\s+TABLE\s+(?:public\.)?(\w+)/i);
    const tbl = pub ? pub[1] : 'jobs';
    return `EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = '${tbl}') AS verified, 'table ${tbl} in supabase_realtime publication' AS detail`;
  }

  // SET DEFAULT gen_random_uuid() — positive: column now has a default
  const setDefault = sql.match(
    /ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ALTER\s+COLUMN\s+(\w+)\s+SET\s+DEFAULT/i,
  );
  if (setDefault) {
    const tbl = setDefault[1];
    const col = setDefault[2];
    return `EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${tbl}' AND column_name = '${col}' AND column_default IS NOT NULL) AS verified, 'column ${tbl}.${col} has a DEFAULT set' AS detail`;
  }

  // Fallback — emit a placeholder the DBA can manually verify
  return `'manual-check-required'::boolean AS verified, '${filename}: could not derive automated check — inspect manually' AS detail`;
}

// ── 4. Cross-reference ledger vs SQL files ────────────────────────────────────

const ledgerMap = new Map(ledger.map((r) => [r.filename, r.status]));
const sqlSet = new Set(sqlFiles);

const warnings = [];
for (const entry of ledger) {
  if (!sqlSet.has(entry.filename)) {
    warnings.push(`WARNING: ledger references ${entry.filename} but no such .sql file exists`);
  }
}
for (const f of sqlFiles) {
  if (!ledgerMap.has(f)) {
    warnings.push(`WARNING: ${f} exists in migrations/ but is NOT in APPLIED.md — add it to the ledger`);
  }
}

// ── 4b. Pre-pass: find policies that are created then later DROPped ───────────
// A migration that CREATEs a policy is superseded if a later applied migration
// DROPs the same policy name on the same table. The earlier migration's audit
// check would incorrectly fail (policy gone = false even though both ran), so
// we mark those rows as "superseded" to skip the redundant check.

/** @type {Set<string>} filenames whose primary check is superseded */
const superseded = new Set();

// Build a map of policy→filename for all CREATE POLICY migrations (applied only)
// Key: "schema/tablename/policyname", Value: filename
/** @type {Map<string, string>} */
const policyCreatedBy = new Map();

for (const { filename, status } of ledger) {
  if (status !== 'applied' || !sqlSet.has(filename)) continue;
  const sql = readFileSync(resolve(migrationsDir, filename), 'utf8');
  const m = sql.match(/CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:(\w+)\.)?(\w+)/i);
  if (m) {
    const schema = m[2] || 'public';
    const tbl = m[3];
    const policy = m[1];
    policyCreatedBy.set(`${schema}/${tbl}/${policy}`, filename);
  }
}

// Now find DROP-only migrations and mark the creator as superseded
for (const { filename, status } of ledger) {
  if (status !== 'applied' || !sqlSet.has(filename)) continue;
  const sql = readFileSync(resolve(migrationsDir, filename), 'utf8');
  const hasCreate = /CREATE\s+POLICY/i.test(sql);
  const dropM = sql.match(/DROP\s+POLICY\s+IF\s+EXISTS\s+"([^"]+)"\s+ON\s+(?:(\w+)\.)?(\w+)/i);
  if (dropM && !hasCreate) {
    const schema = dropM[2] || 'public';
    const tbl = dropM[3];
    const policy = dropM[1];
    const key = `${schema}/${tbl}/${policy}`;
    const creatorFile = policyCreatedBy.get(key);
    if (creatorFile) superseded.add(creatorFile);
  }
}

// ── 5. Emit SQL ───────────────────────────────────────────────────────────────

const lines = [
  '-- ============================================================',
  '-- JobProfit migration drift-audit query',
  `-- Generated: ${new Date().toISOString()}`,
  '-- Paste into Supabase Studio → SQL Editor and run.',
  '-- "verified = true" means prod matches the repo expectation.',
  '-- "verified = false" means the migration was NOT applied (or',
  '--   for a negative migration, the thing was not removed).',
  '-- NULL verified = deferred (not applied yet) or superseded by a later migration.',
  '-- ============================================================',
  '',
  'SELECT',
  "  seq,",
  "  filename,",
  "  status,",
  "  verified,",
  "  detail",
  'FROM (',
  '  VALUES',
];

const rows = [];

for (const { filename, status } of ledger) {
  if (!sqlSet.has(filename)) {
    rows.push(
      `    (${rows.length + 1}, '${filename}', '${status}', NULL::boolean, 'SQL file not found in repo')`,
    );
    continue;
  }

  if (status === 'deferred') {
    // Deferred migrations: don't check prod — just report as skipped.
    rows.push(
      `    (${rows.length + 1}, '${filename}', 'deferred', NULL, 'intentionally not applied to prod yet')`,
    );
    continue;
  }

  if (superseded.has(filename)) {
    // This migration's primary DDL was superseded by a later DROP-only migration.
    // Checking it against prod would give a false negative. Skip the check.
    rows.push(
      `    (${rows.length + 1}, '${filename}', '${status}', NULL, 'superseded — a later migration reverts the primary DDL of this one; skipping check')`,
    );
    continue;
  }

  const sql = readFileSync(resolve(migrationsDir, filename), 'utf8');
  const check = deriveCheck(filename, sql);
  rows.push(
    `    (${rows.length + 1}, '${filename}', '${status}', ${check})`,
  );
}

lines.push(rows.join(',\n'));
lines.push(') AS t(seq, filename, status, verified, detail)');
lines.push('ORDER BY seq;');
lines.push('');

if (warnings.length > 0) {
  process.stderr.write('\n' + warnings.join('\n') + '\n\n');
}

process.stdout.write(lines.join('\n') + '\n');
