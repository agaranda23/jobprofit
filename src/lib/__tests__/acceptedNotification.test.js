/**
 * Unit tests for src/lib/acceptedNotification.js — Phase G-3
 *
 * Tests the pure helper logic for detecting accepted-but-unseen quotes.
 * No DOM, no React, no Supabase.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isNewlyAccepted,
  getNewlyAcceptedJobs,
  buildAcceptedLabel,
  formatAcceptedDate,
} from '../acceptedNotification.js';

// ─── isNewlyAccepted ──────────────────────────────────────────────────────────

describe('isNewlyAccepted', () => {
  const base = { id: 'j1', quoteStatus: 'accepted', acceptedAt: '2026-05-31T10:00:00Z' };

  it('returns true when quoteStatus=accepted + acceptedAt set + no acceptedSeenAt', () => {
    expect(isNewlyAccepted(base)).toBe(true);
  });

  it('returns false when acceptedSeenAt is set (already seen)', () => {
    expect(isNewlyAccepted({ ...base, acceptedSeenAt: '2026-05-31T11:00:00Z' })).toBe(false);
  });

  it('returns false when quoteStatus is not accepted', () => {
    expect(isNewlyAccepted({ ...base, quoteStatus: 'sent' })).toBe(false);
  });

  it('returns false when quoteStatus is missing', () => {
    expect(isNewlyAccepted({ ...base, quoteStatus: undefined })).toBe(false);
  });

  it('returns false when acceptedAt is missing (not a real acceptance)', () => {
    expect(isNewlyAccepted({ ...base, acceptedAt: undefined })).toBe(false);
  });

  it('returns false for null input', () => {
    expect(isNewlyAccepted(null)).toBe(false);
  });

  it('returns false for undefined input', () => {
    expect(isNewlyAccepted(undefined)).toBe(false);
  });

  it('returns false when acceptedSeenAt is empty string (falsy — not seen)', () => {
    // Empty string is falsy so the job IS unseen
    expect(isNewlyAccepted({ ...base, acceptedSeenAt: '' })).toBe(true);
  });
});

// ─── getNewlyAcceptedJobs ─────────────────────────────────────────────────────

describe('getNewlyAcceptedJobs', () => {
  const accepted = { id: 'j1', quoteStatus: 'accepted', acceptedAt: '2026-05-31T10:00:00Z' };
  const seen = { id: 'j2', quoteStatus: 'accepted', acceptedAt: '2026-05-30T10:00:00Z', acceptedSeenAt: '2026-05-30T11:00:00Z' };
  const lead = { id: 'j3', quoteStatus: 'sent' };
  const paid = { id: 'j4', status: 'paid', quoteStatus: 'accepted', acceptedAt: '2026-05-28T10:00:00Z' };

  it('returns only unseen accepted jobs from a mixed array', () => {
    const result = getNewlyAcceptedJobs([accepted, seen, lead, paid]);
    expect(result.map(j => j.id)).toEqual(['j1', 'j4']);
  });

  it('returns empty array when all jobs are seen', () => {
    expect(getNewlyAcceptedJobs([seen])).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(getNewlyAcceptedJobs([])).toEqual([]);
  });

  it('returns empty array for null input', () => {
    expect(getNewlyAcceptedJobs(null)).toEqual([]);
  });

  it('returns empty array for undefined input', () => {
    expect(getNewlyAcceptedJobs(undefined)).toEqual([]);
  });

  it('returns all items when all are newly accepted', () => {
    const jobs = [
      { id: 'j1', quoteStatus: 'accepted', acceptedAt: '2026-05-31T10:00:00Z' },
      { id: 'j2', quoteStatus: 'accepted', acceptedAt: '2026-05-31T11:00:00Z' },
    ];
    expect(getNewlyAcceptedJobs(jobs)).toHaveLength(2);
  });
});

// ─── buildAcceptedLabel ───────────────────────────────────────────────────────

describe('buildAcceptedLabel', () => {
  it('includes acceptedName and amount when both present', () => {
    const job = { acceptedName: 'Gemma', total: 500 };
    expect(buildAcceptedLabel(job)).toBe('Gemma accepted · £500');
  });

  it('uses customer when acceptedName is absent', () => {
    const job = { customer: 'Bob', amount: 350 };
    expect(buildAcceptedLabel(job)).toBe('Bob accepted · £350');
  });

  it('falls back to "Customer" when no name fields exist', () => {
    expect(buildAcceptedLabel({ total: 200 })).toBe('Customer accepted · £200');
  });

  it('omits amount when total/amount are 0 or absent', () => {
    expect(buildAcceptedLabel({ acceptedName: 'Dan' })).toBe('Dan accepted');
    expect(buildAcceptedLabel({ acceptedName: 'Dan', total: 0 })).toBe('Dan accepted');
  });

  it('formats amount with en-GB locale (no pence for round numbers)', () => {
    expect(buildAcceptedLabel({ acceptedName: 'Sue', total: 1500 })).toBe('Sue accepted · £1,500');
  });

  it('returns "Quote accepted" for null job', () => {
    expect(buildAcceptedLabel(null)).toBe('Quote accepted');
  });

  it('prefers acceptedName over customer', () => {
    const job = { acceptedName: 'Gemma', customer: 'SomeCompany Ltd', total: 100 };
    expect(buildAcceptedLabel(job)).toBe('Gemma accepted · £100');
  });
});

// ─── formatAcceptedDate ───────────────────────────────────────────────────────

describe('formatAcceptedDate', () => {
  beforeEach(() => {
    // Freeze Date to 2026-05-31T12:00:00Z (a Sunday)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "Today" for a timestamp on today', () => {
    expect(formatAcceptedDate('2026-05-31T08:30:00Z')).toBe('Today');
  });

  it('returns "Yesterday" for a timestamp on yesterday', () => {
    expect(formatAcceptedDate('2026-05-30T14:00:00Z')).toBe('Yesterday');
  });

  it('returns a "D MMM" string for older dates', () => {
    const result = formatAcceptedDate('2026-05-20T10:00:00Z');
    // en-GB locale produces "20 May"
    expect(result).toBe('20 May');
  });

  it('returns empty string for null', () => {
    expect(formatAcceptedDate(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatAcceptedDate(undefined)).toBe('');
  });
});
