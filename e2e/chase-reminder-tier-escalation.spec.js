/**
 * chase-reminder-tier-escalation.spec.js — API-level test (no browser
 * interaction, per QAE's plan) of chase-reminders.js's tier logic and its
 * anti-double-fire guard.
 *
 * Tier thresholds (netlify/functions/_lib/chaseTierHelpers.js — single
 * source of truth, shared by both the client chase ladder and this scheduled
 * function): tier 1 = 1–6 days past due, tier 2 = 7–13, tier 3 = 14+.
 *
 * ⚠️ ENVIRONMENT CAVEAT (flagged in the founder report): chase-reminders.js
 * is a Netlify SCHEDULED function (`export const config = { schedule: '0 8
 * * * *' }`). In production, Netlify's scheduled-function endpoints are
 * normally invoked only by Netlify's internal cron infrastructure — an
 * external direct HTTP call may be rejected there even though the exact
 * behaviour isn't publicly documented in detail. This spec assumes the
 * endpoint is reachable directly via `netlify dev` (the Netlify CLI
 * explicitly supports ad hoc local invocation of scheduled functions) or a
 * deploy preview configured to allow manual triggers. If this spec 401/404s
 * against a real deploy preview, that is very likely this constraint, not a
 * bug in the function.
 */
import { test, expect } from '@playwright/test';
import { seedTrader, seedPushSubscription, getAdminClient } from './fixtures/seeded-traders.js';
import { seedJob, waitForSupabaseWrite } from './fixtures/helpers.js';

const CHASE_ENDPOINT = '/.netlify/functions/chase-reminders';

function isoDueDateDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

test.describe('chase-reminders — tier escalation + no double-fire (Trader F)', () => {
  let admin;
  let trader;
  let jobTier1;
  let jobTier2;
  let jobTier3;

  test.beforeAll(async () => {
    admin = getAdminClient();
    trader = await seedTrader('F');
    await seedPushSubscription(trader.id);
  });

  test.beforeEach(async () => {
    // invoiceDueDate takes priority over invoiceSentAt+net-terms in
    // daysPastDueShared(), so setting it directly gives exact, deterministic
    // tiers regardless of DEFAULT_PAYMENT_TERMS_DAYS.
    const invoiceSentAt = new Date(Date.now() - 25 * 86_400_000).toISOString();
    const commonMeta = { status: 'invoice_sent', invoiceSentAt };

    jobTier1 = await seedJob(admin, trader, {
      status: 'invoice_sent',
      amount: 100,
      meta: { ...commonMeta, invoiceDueDate: isoDueDateDaysAgo(3), total: 100 }, // tier 1: 1–6 days
    });
    jobTier2 = await seedJob(admin, trader, {
      status: 'invoice_sent',
      amount: 200,
      meta: { ...commonMeta, invoiceDueDate: isoDueDateDaysAgo(10), total: 200 }, // tier 2: 7–13 days
    });
    jobTier3 = await seedJob(admin, trader, {
      status: 'invoice_sent',
      amount: 300,
      meta: { ...commonMeta, invoiceDueDate: isoDueDateDaysAgo(20), total: 300 }, // tier 3: 14+ days
    });
  });

  test('writes the correct chaseRemindedTier per job, then does not double-fire on immediate re-invoke', async ({ request }) => {
    const firstRun = await request.get(CHASE_ENDPOINT);
    expect(firstRun.ok()).toEqual(true);

    const t1 = await waitForSupabaseWrite(admin, 'jobs', (r) => r.meta?.chaseRemindedTier != null, {
      baseFilter: { id: jobTier1.id },
      timeoutMs: 20_000,
    });
    const t2 = await waitForSupabaseWrite(admin, 'jobs', (r) => r.meta?.chaseRemindedTier != null, {
      baseFilter: { id: jobTier2.id },
      timeoutMs: 20_000,
    });
    const t3 = await waitForSupabaseWrite(admin, 'jobs', (r) => r.meta?.chaseRemindedTier != null, {
      baseFilter: { id: jobTier3.id },
      timeoutMs: 20_000,
    });

    expect(t1.meta.chaseRemindedTier).toEqual(1);
    expect(t2.meta.chaseRemindedTier).toEqual(2);
    expect(t3.meta.chaseRemindedTier).toEqual(3);
    expect(t1.meta.chaseRemindedAt).toBeDefined();

    const firstRemindedAt = { t1: t1.meta.chaseRemindedAt, t2: t2.meta.chaseRemindedAt, t3: t3.meta.chaseRemindedAt };

    // ── Immediate re-invoke — shouldSendChaseReminder() must return false
    // for all three (tier unchanged since last reminder; tier-3's weekly
    // re-remind window has not elapsed) ─────────────────────────────────────
    const secondRun = await request.get(CHASE_ENDPOINT);
    expect(secondRun.ok()).toEqual(true);

    // Give a wrongful second write a moment to land, if the bug exists.
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const { data: recheck } = await admin
      .from('jobs')
      .select('id, meta')
      .in('id', [jobTier1.id, jobTier2.id, jobTier3.id]);

    const byId = Object.fromEntries(recheck.map((r) => [r.id, r]));
    expect(byId[jobTier1.id].meta.chaseRemindedAt).toEqual(firstRemindedAt.t1);
    expect(byId[jobTier2.id].meta.chaseRemindedAt).toEqual(firstRemindedAt.t2);
    expect(byId[jobTier3.id].meta.chaseRemindedAt).toEqual(firstRemindedAt.t3);
    expect(byId[jobTier1.id].meta.chaseRemindedTier).toEqual(1);
    expect(byId[jobTier2.id].meta.chaseRemindedTier).toEqual(2);
    expect(byId[jobTier3.id].meta.chaseRemindedTier).toEqual(3);
  });
});
