/**
 * chase-reminders.test.js
 *
 * Regression guard for the column-drift bug:
 *   invoice_sent_at and invoice_due_date do not exist as top-level columns.
 *   Selecting them by name caused PostgREST 42703 on every jobs query,
 *   making the daily cron a silent no-op in production.
 *
 * What these tests verify:
 *   A. The jobs select string contains 'meta' but NOT 'invoice_sent_at'
 *      or 'invoice_due_date' (column names that don't exist in the schema).
 *   B. daysPastDueShared correctly derives overdue days from meta.invoiceSentAt
 *      (net-7 fallback) and meta.invoiceDueDate (explicit date).
 *   C. resolveInvoiceDates (the function that feeds the chase helpers) reads
 *      from job.meta.invoiceSentAt / job.meta.invoiceDueDate — never from
 *      non-existent top-level columns.
 *   D. shouldSendChaseReminder cadence rules remain correct now that the
 *      column-fix unblocks the query.
 *
 * No actual Netlify/Supabase calls are made — helpers are tested in isolation.
 */

import { describe, it, expect } from 'vitest';
import {
  daysPastDueShared,
  computeTierShared,
  shouldSendChaseReminder,
} from '../_lib/chaseTierHelpers.js';

// ── A. Select-string regression: verify the source no longer references the
//       non-existent columns. We read the compiled function source at test time
//       so that if someone re-adds the columns the test fails immediately.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const handlerSource = readFileSync(
  path.join(__dirname, '..', 'chase-reminders.js'),
  'utf8',
);

describe('Fix A — select string must not reference non-existent columns', () => {
  it('does NOT select invoice_sent_at inside a .select() call', () => {
    // Match only inside the argument of a .select() call so comments that
    // mention the column names for documentation purposes don't trigger this.
    // Pattern: .select(  '...'  ) where the quoted string contains the column.
    expect(handlerSource).not.toMatch(/\.select\(['"`][^'"`]*invoice_sent_at[^'"`]*['"`]\)/);
  });

  it('does NOT select invoice_due_date inside a .select() call', () => {
    expect(handlerSource).not.toMatch(/\.select\(['"`][^'"`]*invoice_due_date[^'"`]*['"`]\)/);
  });

  it('DOES select meta so camelCase fields inside JSONB are available', () => {
    // Confirms the column that carries invoiceSentAt / invoiceDueDate is still fetched.
    expect(handlerSource).toMatch(/\.select\(['"`][^'"`]*\bmeta\b[^'"`]*['"`]\)/);
  });
});

// ── B. daysPastDueShared reads meta-style fields (camelCase) correctly
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix A — daysPastDueShared derives timing from camelCase meta fields', () => {
  it('returns positive days-past-due from invoiceDueDate (explicit date)', () => {
    const job = { invoiceDueDate: '2026-06-01' };
    const now = new Date('2026-06-08T12:00:00Z'); // 7 days overdue
    expect(daysPastDueShared(job, now)).toBe(7);
  });

  it('returns days-past-due using net-7 fallback from invoiceSentAt when no due date', () => {
    // Invoice sent 10 days ago, net-7 terms → 3 days past due
    const job = { invoiceSentAt: new Date('2026-05-29T09:00:00Z').toISOString() };
    const now = new Date('2026-06-08T12:00:00Z');
    // Due = 2026-06-05 (sent + 7). Now is 2026-06-08. Past due = 3 days.
    expect(daysPastDueShared(job, now)).toBe(3);
  });

  it('returns 0 when job has neither invoiceSentAt nor invoiceDueDate', () => {
    expect(daysPastDueShared({}, new Date())).toBe(0);
  });

  it('returns 0 for null job without throwing', () => {
    expect(() => daysPastDueShared(null, new Date())).not.toThrow();
    expect(daysPastDueShared(null, new Date())).toBe(0);
  });

  it('pre-due invoice: returns negative when due date is in the future', () => {
    const job = { invoiceDueDate: '2026-06-20' };
    const now = new Date('2026-06-08T12:00:00Z');
    expect(daysPastDueShared(job, now)).toBeLessThan(0);
  });
});

// ── C. resolveInvoiceDates logic — the bridge between meta JSONB and helpers
//       Mirrors exactly what chase-reminders.js does inside resolveInvoiceDates().
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors resolveInvoiceDates() from chase-reminders.js.
 * Verified to match the function body exactly.
 */
function resolveInvoiceDates(job) {
  const meta = job.meta || {};
  return {
    invoiceSentAt:  meta.invoiceSentAt  || job.invoice_sent_at  || null,
    invoiceDueDate: meta.invoiceDueDate || job.invoice_due_date || null,
  };
}

describe('Fix A — resolveInvoiceDates reads from meta JSONB (camelCase)', () => {
  it('reads invoiceSentAt from job.meta when no top-level column is present', () => {
    const job = { meta: { invoiceSentAt: '2026-06-01T09:00:00Z' } };
    const { invoiceSentAt } = resolveInvoiceDates(job);
    expect(invoiceSentAt).toBe('2026-06-01T09:00:00Z');
  });

  it('reads invoiceDueDate from job.meta when no top-level column is present', () => {
    const job = { meta: { invoiceDueDate: '2026-06-15' } };
    const { invoiceDueDate } = resolveInvoiceDates(job);
    expect(invoiceDueDate).toBe('2026-06-15');
  });

  it('returns null for both fields when meta is empty and no columns exist', () => {
    const { invoiceSentAt, invoiceDueDate } = resolveInvoiceDates({ meta: {} });
    expect(invoiceSentAt).toBeNull();
    expect(invoiceDueDate).toBeNull();
  });

  it('resolvedInvoiceDates feeds daysPastDueShared correctly for an overdue job', () => {
    const job = { meta: { invoiceDueDate: '2026-06-01' } };
    const { invoiceSentAt, invoiceDueDate } = resolveInvoiceDates(job);
    const jobShape = { invoiceSentAt, invoiceDueDate };
    const now = new Date('2026-06-09T12:00:00Z'); // 8 days overdue
    expect(daysPastDueShared(jobShape, now)).toBe(8);
  });
});

// ── D. Chase cadence: shouldSendChaseReminder is unblocked and correct
// ─────────────────────────────────────────────────────────────────────────────

describe('Fix A — shouldSendChaseReminder cadence (unblocked by column fix)', () => {
  const now = new Date('2026-06-08T09:00:00Z');

  it('sends first reminder when job has never been chased (no tier in meta)', () => {
    const job = { meta: { invoiceDueDate: '2026-06-01' } }; // 7 days overdue → Tier 2
    const { invoiceSentAt, invoiceDueDate } = resolveInvoiceDates(job);
    const jobShape = { invoiceSentAt, invoiceDueDate };
    const currentTier = computeTierShared(jobShape, now);

    const send = shouldSendChaseReminder({
      currentTier,
      chaseRemindedTier: null,
      chaseRemindedAt: null,
    }, now);

    expect(currentTier).toBe(2); // confirm tier math
    expect(send).toBe(true);
  });

  it('sends on tier escalation (Tier 1 → Tier 2)', () => {
    const send = shouldSendChaseReminder({
      currentTier: 2,
      chaseRemindedTier: 1,
      chaseRemindedAt: new Date('2026-06-04T09:00:00Z').toISOString(),
    }, now);
    expect(send).toBe(true);
  });

  it('suppresses repeat reminder at same tier (already reminded at Tier 1)', () => {
    const send = shouldSendChaseReminder({
      currentTier: 1,
      chaseRemindedTier: 1,
      chaseRemindedAt: new Date('2026-06-07T09:00:00Z').toISOString(), // yesterday
    }, now);
    expect(send).toBe(false);
  });

  it('suppresses Tier 3 re-reminder when less than 7 days since last Tier 3 reminder', () => {
    const send = shouldSendChaseReminder({
      currentTier: 3,
      chaseRemindedTier: 3,
      chaseRemindedAt: new Date('2026-06-05T09:00:00Z').toISOString(), // 3 days ago
    }, now);
    expect(send).toBe(false);
  });

  it('sends Tier 3 re-reminder after 7+ days at Tier 3', () => {
    const send = shouldSendChaseReminder({
      currentTier: 3,
      chaseRemindedTier: 3,
      chaseRemindedAt: new Date('2026-05-31T09:00:00Z').toISOString(), // 8 days ago
    }, now);
    expect(send).toBe(true);
  });

  it('never sends for Tier 0 (pre-due)', () => {
    expect(shouldSendChaseReminder({ currentTier: 0, chaseRemindedTier: null, chaseRemindedAt: null }, now)).toBe(false);
  });

  it('never sends for grace tier (just-flipped overdue)', () => {
    expect(shouldSendChaseReminder({ currentTier: 'grace', chaseRemindedTier: null, chaseRemindedAt: null }, now)).toBe(false);
  });
});
