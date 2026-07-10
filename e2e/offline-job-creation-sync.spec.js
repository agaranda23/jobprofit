/**
 * offline-job-creation-sync.spec.js — IndexedDB offline queue, sync-on-
 * reconnect, and the structural guarantee that offline-queued jobs are never
 * chase-eligible until they've actually synced to Supabase.
 *
 * Flow: go offline → create a job → reload (must survive from IndexedDB,
 * not just in-memory React state) → confirm Supabase has NOT seen the job
 * yet → restore connectivity → sync fires automatically (wireOnlineSync()'s
 * 'online' listener, src/lib/offlineQueue.js) → SyncBadge count returns to 0
 * → job appears in Supabase.
 *
 * The "never chase-eligible while queued" guarantee is STRUCTURAL, not a
 * runtime check we can defeat in a test: chase-reminders.js and the chase
 * ladder both read exclusively from Supabase (getJobsFromCloud() / the
 * scheduled function's own query) — a row that only exists in IndexedDB is
 * physically absent from every query surface chase logic touches. This spec
 * proves that absence directly rather than asserting a negative UI state.
 *
 * MISSING INSTRUMENTATION: see the founder report for the job-creation-form
 * and SyncBadge selectors this file references.
 */
import { test, expect } from '@playwright/test';
import { seedTrader, loginAs, getAdminClient } from './fixtures/seeded-traders.js';

const UNIQUE_SUMMARY = `Offline sync test job ${Date.now()}`;

test.describe('Offline job creation + sync (Trader A)', () => {
  let admin;
  let trader;

  test.beforeAll(async () => {
    admin = getAdminClient();
    trader = await seedTrader('A');
  });

  test('job survives offline reload in IndexedDB, then syncs to Supabase on reconnect and is never chase-eligible while queued', async ({ page, context }) => {
    await loginAs(page, trader);
    await page.goto('/');
    // Let auth/profile load fully before going offline — the app's initial
    // profile/jobs fetch needs one real round-trip first.
    await page.waitForLoadState('networkidle');

    await context.setOffline(true);

    // TODO(testid): "+ New job" / "Log a job" entry point (WorkScreen.jsx /
    // TodayScreen.jsx both have variants of this CTA with no shared testid).
    await page.getByTestId('new-job-button').click();
    await page.getByTestId('job-customer-name-input').fill('Offline Sync Customer');
    await page.getByTestId('job-summary-input').fill(UNIQUE_SUMMARY);
    await page.getByTestId('job-save-button').click();

    // ── IndexedDB must hold the queued row ──────────────────────────────────
    const queuedCount = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open('jp-offline-queue');
          req.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction('jobs', 'readonly');
            const countReq = tx.objectStore('jobs').count();
            countReq.onsuccess = () => resolve(countReq.result);
            countReq.onerror = () => reject(countReq.error);
          };
          req.onerror = () => reject(req.error);
        })
    );
    expect(queuedCount).toBeGreaterThan(0);

    // ── Structural chase-exclusion proof: Supabase must not see it yet ─────
    const { data: preSyncRows } = await admin.from('jobs').select('id').eq('summary', UNIQUE_SUMMARY);
    expect(preSyncRows?.length ?? 0).toEqual(0);

    // ── Reload while still offline — IndexedDB (not React state) must be
    // what makes the job reappear ────────────────────────────────────────────
    await page.reload();
    await expect(page.getByText(UNIQUE_SUMMARY, { exact: false })).toBeVisible({ timeout: 15_000 });

    // ── Restore connectivity — wireOnlineSync()'s 'online' listener should
    // fire runSync() automatically ───────────────────────────────────────────
    await context.setOffline(false);

    // TODO(testid): SyncBadge's pending-count element. Falling back to
    // polling IndexedDB directly, which is slower to assert against but does
    // not depend on instrumentation.
    await expect
      .poll(
        async () =>
          page.evaluate(
            () =>
              new Promise((resolve, reject) => {
                const req = indexedDB.open('jp-offline-queue');
                req.onsuccess = (e) => {
                  const db = e.target.result;
                  const tx = db.transaction('jobs', 'readonly');
                  const countReq = tx.objectStore('jobs').count();
                  countReq.onsuccess = () => resolve(countReq.result);
                  countReq.onerror = () => reject(countReq.error);
                };
                req.onerror = () => reject(req.error);
              })
          ),
        { timeout: 20_000, intervals: [1000] }
      )
      .toEqual(0);

    // ── Job now exists in Supabase, and is a normal (non-offline-tagged) row ─
    const { data: postSyncRows } = await admin.from('jobs').select('id, user_id, summary').eq('summary', UNIQUE_SUMMARY);
    expect(postSyncRows?.length).toEqual(1);
    expect(postSyncRows[0].user_id).toEqual(trader.id);

    // Cleanup — this job isn't tagged with SEED_TAG (it went through the
    // real UI creation path, not seedJob()), so global-teardown.js won't
    // catch it. Remove it directly here.
    await admin.from('jobs').delete().eq('id', postSyncRows[0].id);
  });
});
