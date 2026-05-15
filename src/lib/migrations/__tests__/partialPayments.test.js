import { describe, it, expect } from 'vitest';
import { runMigration } from '../partialPayments.js';

describe('runMigration', () => {
  it('legacy paid job gets a synthetic payment entry', () => {
    const jobs = [{
      id: 'j1',
      amount: 250,
      paymentStatus: 'paid',
      paidAt: '2026-05-14T10:00:00Z',
      date: '2026-05-14',
    }];
    const result = runMigration(jobs);
    expect(result[0].payments).toHaveLength(1);
    expect(result[0].payments[0]).toMatchObject({
      id: 'pay_migration_j1',
      date: '2026-05-14', // sliced from paidAt
      amount: 250,
      method: 'unknown',
      note: 'Pre-partial-payments migration',
    });
    expect(result[0].payments[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('synthetic date prefers paidAt (sliced) over date', () => {
    const jobs = [{
      id: 'j1', amount: 100, paymentStatus: 'paid',
      paidAt: '2026-04-01T15:30:00Z', date: '2099-12-31',
    }];
    expect(runMigration(jobs)[0].payments[0].date).toBe('2026-04-01');
  });

  it('synthetic date falls back to date when paidAt is absent', () => {
    const jobs = [{
      id: 'j1', amount: 100, paymentStatus: 'paid',
      date: '2026-03-15',
    }];
    expect(runMigration(jobs)[0].payments[0].date).toBe('2026-03-15');
  });

  it("synthetic date falls back to '1970-01-01' when both paidAt and date are absent", () => {
    const jobs = [{ id: 'j1', amount: 100, paymentStatus: 'paid' }];
    expect(runMigration(jobs)[0].payments[0].date).toBe('1970-01-01');
  });

  it('non-paid jobs get an empty payments array', () => {
    const jobs = [
      { id: 'j1', amount: 100, paymentStatus: 'unpaid' },
      { id: 'j2', amount: 200 }, // no paymentStatus at all
    ];
    const result = runMigration(jobs);
    expect(result[0].payments).toEqual([]);
    expect(result[1].payments).toEqual([]);
  });

  it('already-migrated jobs are left unchanged (payments key exists)', () => {
    const existing = [{ id: 'pay_old', amount: 50, date: '2026-01-01', method: 'cash', note: '', createdAt: 'x' }];
    const jobs = [{
      id: 'j1', amount: 100, paymentStatus: 'paid', paidAt: '2026-05-14T10:00:00Z',
      payments: existing,
    }];
    const result = runMigration(jobs);
    expect(result[0].payments).toBe(existing);
    expect(result[0].payments).toHaveLength(1);
  });

  it('skips when payments is an empty array (idempotency on already-set empty)', () => {
    const jobs = [{ id: 'j1', amount: 100, paymentStatus: 'unpaid', payments: [] }];
    const result = runMigration(jobs);
    expect(result[0].payments).toEqual([]);
  });

  it('is idempotent: runMigration(runMigration(jobs)) deepEquals runMigration(jobs)', () => {
    const jobs = [
      { id: 'j1', amount: 250, paymentStatus: 'paid', paidAt: '2026-05-14T10:00:00Z', date: '2026-05-14' },
      { id: 'j2', amount: 100, paymentStatus: 'unpaid' },
      { id: 'j3', amount: 50, paymentStatus: 'paid' }, // no paidAt or date → '1970-01-01'
    ];
    const once = runMigration(jobs);
    const twice = runMigration(once);
    expect(twice).toEqual(once);
  });

  it('returns a new array (input array not mutated, input job objects not mutated)', () => {
    const input = { id: 'j1', amount: 100, paymentStatus: 'paid', paidAt: '2026-05-14T10:00:00Z' };
    const jobs = [input];
    const result = runMigration(jobs);
    expect(result).not.toBe(jobs);
    expect(input.payments).toBeUndefined(); // input job not mutated
    expect(result[0]).not.toBe(input);
    expect(result[0].payments).toHaveLength(1);
  });

  it('handles non-array input by returning it unchanged', () => {
    expect(runMigration(null)).toBe(null);
    expect(runMigration(undefined)).toBe(undefined);
    expect(runMigration('not an array')).toBe('not an array');
  });

  it('handles empty array', () => {
    expect(runMigration([])).toEqual([]);
  });

  it('skips malformed job entries (null, undefined, non-object) without throwing', () => {
    const jobs = [
      null,
      undefined,
      'string',
      { id: 'j1', amount: 100, paymentStatus: 'paid' },
    ];
    const result = runMigration(jobs);
    expect(result[0]).toBe(null);
    expect(result[1]).toBe(undefined);
    expect(result[2]).toBe('string');
    expect(result[3].payments).toHaveLength(1);
  });
});
