// global-teardown.js — runs once after the full Playwright run finishes.
//
// Wipes anything the suite seeded so repeat runs against the same shared
// Supabase project don't accumulate garbage jobs/tokens/traders over time.
//
// Deliberately scoped to rows tagged with the e2e marker (see
// fixtures/seeded-traders.js SEED_TAG) rather than a blanket delete — this
// suite runs against a real Supabase project (per QAE's plan: real Supabase,
// only Stripe is stubbed), so an untagged wipe would be destructive to any
// other data living in that project (e.g. a shared dev/staging DB).
//
// Does NOT delete the six seeded trader auth users themselves — recreating
// Supabase auth users on every run is slow and re-triggers Stripe Connect
// onboarding state for A. seedTestUsers() is idempotent (upsert-by-email), so
// leaving the users in place is the intended steady state. If a founder wants
// a full reset, delete rows manually in Supabase Studio filtered by email
// LIKE 'e2e-trader-%@ohnar-test.local' (see seeded-traders.js).
import { createClient } from '@supabase/supabase-js';
import { SEED_TAG, TEST_TRADER_EMAIL_DOMAIN } from './fixtures/seeded-traders.js';

export default async function globalTeardown() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      '[global-teardown] SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_URL not set — skipping cleanup. ' +
        'Seeded e2e rows (tag: ' + SEED_TAG + ') were left in place.'
    );
    return;
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  try {
    // Jobs written by seedJob() carry meta.e2eSeedTag === SEED_TAG.
    const { data: staleJobs, error: jobsErr } = await adminClient
      .from('jobs')
      .select('id')
      .eq('meta->>e2eSeedTag', SEED_TAG);

    if (!jobsErr && staleJobs?.length) {
      const ids = staleJobs.map((j) => j.id);

      // invoice_payment_tokens rows reference jobs via invoice_id — delete
      // children before parents to respect the FK constraint.
      await adminClient.from('invoice_payment_tokens').delete().in('invoice_id', ids);
      await adminClient.from('jobs').delete().in('id', ids);
      console.log(`[global-teardown] removed ${ids.length} seeded job(s)`);
    }
  } catch (err) {
    // Teardown must never fail the CI run over cleanup — log and move on.
    console.warn('[global-teardown] job cleanup failed (non-fatal):', err?.message);
  }

  try {
    // Belt-and-braces: any invoice_payment_tokens rows seeded directly (not
    // via a job, e.g. payment-link-expiry.spec.js's terminal-state fixtures)
    // are tagged by trader_user_id belonging to a seeded test trader AND a
    // token prefixed with the seed tag so we never touch a real trader's rows.
    await adminClient
      .from('invoice_payment_tokens')
      .delete()
      .like('token', `${SEED_TAG}-%`);
  } catch (err) {
    console.warn('[global-teardown] token cleanup failed (non-fatal):', err?.message);
  }

  console.log(
    `[global-teardown] done. Seeded trader accounts (@${TEST_TRADER_EMAIL_DOMAIN}) were left in place ` +
      'for the next run — see the file header for how to fully reset them.'
  );

  // IndexedDB (offline queue) lives in the browser context, not in Supabase —
  // each Playwright test uses a fresh browser context per QAE's fixture
  // strategy, so there is nothing cross-run to wipe there. offline-job-creation-sync.spec.js
  // is the only spec that writes to it, and it runs in an isolated context.
}
