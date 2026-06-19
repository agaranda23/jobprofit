# Supabase migrations — apply process

JobProfit uses Supabase. Migrations are written as SQL files in
`supabase/migrations/` and applied **by hand** via the Supabase Studio SQL
Editor. There is no `supabase/config.toml` and no `supabase db push` step yet.

---

## The apply rule (non-negotiable)

> Every migration that is merged to `main` must be pasted into the Supabase
> Studio SQL Editor **on the same day it merges**, and `supabase/migrations/APPLIED.md`
> updated to `yes (YYYY-MM-DD)` **before you close the Studio tab**.

This is the only rule. If you follow it, the prod schema stays in sync.

If a migration must be deferred (e.g. waiting on a feature branch that is not
yet live in prod), set it to `deferred` in APPLIED.md **and add a one-line
note** explaining what it is waiting on. Revisit it when the feature ships.

---

## Step-by-step apply process

1. Open [Supabase Studio](https://supabase.com) → your project → SQL Editor.
2. Open the `.sql` file from `supabase/migrations/` in your editor.
3. Copy the entire contents. Paste into the SQL Editor.
4. Click **Run**. If the migration is idempotent (all files in this repo use
   `IF NOT EXISTS` / `IF EXISTS` guards), running it twice is safe.
5. Check the Results panel — look for any errors. A green "Success" means it
   applied cleanly.
6. Open `supabase/migrations/APPLIED.md`.
7. Find the row for the migration you just ran.
8. Change `applied_to_prod: deferred` (or `no`) to `yes (YYYY-MM-DD)` where the
   date is today.
9. Commit the APPLIED.md update to the branch (or directly to main if you are
   just updating the ledger after the code PR already merged).

---

## Running the drift-audit query

The drift-audit query is a generated SQL block that you paste into Supabase
Studio to check whether prod matches the repo.

**Generate a fresh copy:**

```
node scripts/gen-drift-audit.mjs
```

Copy the entire SQL output. Paste it into Supabase Studio → SQL Editor → Run.

Each row in the result shows:

| column | meaning |
|--------|---------|
| `seq` | migration number (ordered) |
| `filename` | the `.sql` file |
| `status` | `applied` / `deferred` |
| `verified` | `true` = prod matches expectation; `false` = DRIFT — migration not applied (or not reverted, for negative migrations); `NULL` = deferred or superseded (no check needed) |
| `detail` | human-readable explanation of what was checked |

Any row with `verified = false` is a drift you need to fix by applying (or
re-applying) the migration.

Regenerate this query whenever `APPLIED.md` changes — it never goes stale
because it reads the actual SQL files each time.

---

## Negative migrations

Some migrations **remove** something (DROP POLICY, DROP DEFAULT, DROP COLUMN).
For these, "applied" means the thing no longer exists in prod.

The drift-audit generator handles negative migrations automatically:

- `DROP POLICY` only (no `CREATE POLICY` in the same file) → verifies the
  policy is **absent**.
- `ALTER COLUMN DROP DEFAULT` → verifies the column has **no DEFAULT**.

If you write a new negative migration, you do not need to add a special
annotation — the generator detects the pattern. If you want to be explicit for
human readers, add this comment near the top of the SQL file:

```sql
-- DRIFT-CHECK: negative migration — verifies ABSENCE of <thing>
```

---

## The CI guard

`src/lib/__tests__/migrationLedger.test.js` is a Vitest test that:

- Fails if a `*.sql` file in `supabase/migrations/` is **not listed in
  APPLIED.md** (you cannot merge a new migration without acknowledging it).
- Fails if a ledger entry references a file that **no longer exists on disk**.
- Fails if any entry has an unrecognised status (typo in the `applied_to_prod`
  field).
- Fails if `gen-drift-audit.mjs` emits warnings about out-of-sync files.

Run it locally:

```
npm test -- --reporter=verbose src/lib/__tests__/migrationLedger.test.js
```

Or run the full suite:

```
npm test
```

**Note:** Netlify's build command is `npm run build`, not `npm test`. The guard
runs on developer machines and in any CI step that runs `npm test`. It is your
PR gate, not a Netlify deploy gate.

---

## Long-term fix: adopt `supabase db push`

The hand-apply workflow works but has a human error surface. The proper fix is
to link the repo to the Supabase project via the CLI and let `supabase db push`
apply migrations automatically (in CI, on branch deploy, or on merge to main).

**This is a founder decision** — it requires:

1. Install the Supabase CLI locally: `brew install supabase/tap/supabase`
2. Run `supabase login` and authenticate.
3. Link the project: `supabase link --project-ref <YOUR_PROJECT_REF>`
   (find the ref in Supabase Dashboard → Settings → General).
4. Test locally: `supabase db push --dry-run` — check it would apply the right
   migrations.
5. Add a CI step (GitHub Actions or Netlify build plugin) that runs
   `supabase db push` on merge to main, using `SUPABASE_ACCESS_TOKEN` and
   `SUPABASE_PROJECT_ID` secrets.
6. At that point, `APPLIED.md` becomes the historical record (not the
   operational gate) and the Vitest guard can be relaxed.

Supabase CLI docs: https://supabase.com/docs/reference/cli/supabase-db-push

Until this is set up, the hand-apply process above is the workflow.
