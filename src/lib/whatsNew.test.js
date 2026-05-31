/**
 * whatsNew — data integrity tests.
 *
 * Guards the WHATS_NEW changelog array and formatWhatsNewDate helper.
 * No DOM, no React — pure logic, matches project test convention.
 */

import { describe, it, expect } from 'vitest';
import { WHATS_NEW, formatWhatsNewDate } from './whatsNew.js';

// ── WHATS_NEW array integrity ─────────────────────────────────────────────────

describe('WHATS_NEW array', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(WHATS_NEW)).toBe(true);
    expect(WHATS_NEW.length).toBeGreaterThan(0);
  });

  it('every entry has a date string in YYYY-MM-DD format', () => {
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    for (const entry of WHATS_NEW) {
      expect(entry.date).toMatch(ISO_DATE);
    }
  });

  it('every entry has a non-empty title', () => {
    for (const entry of WHATS_NEW) {
      expect(typeof entry.title).toBe('string');
      expect(entry.title.trim().length).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty emoji', () => {
    for (const entry of WHATS_NEW) {
      expect(typeof entry.emoji).toBe('string');
      expect(entry.emoji.trim().length).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty blurb', () => {
    for (const entry of WHATS_NEW) {
      expect(typeof entry.blurb).toBe('string');
      expect(entry.blurb.trim().length).toBeGreaterThan(0);
    }
  });

  it('entries are ordered newest first (descending date)', () => {
    for (let i = 0; i < WHATS_NEW.length - 1; i++) {
      expect(WHATS_NEW[i].date >= WHATS_NEW[i + 1].date).toBe(true);
    }
  });

  it('no two entries share the same date+title combination', () => {
    const keys = WHATS_NEW.map(e => `${e.date}:${e.title}`);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

// ── formatWhatsNewDate ────────────────────────────────────────────────────────

describe('formatWhatsNewDate', () => {
  it('formats 2026-05-31 as "31 May 2026"', () => {
    expect(formatWhatsNewDate('2026-05-31')).toBe('31 May 2026');
  });

  it('formats 2026-01-01 as "1 January 2026"', () => {
    expect(formatWhatsNewDate('2026-01-01')).toBe('1 January 2026');
  });

  it('formats 2025-12-25 as "25 December 2025"', () => {
    expect(formatWhatsNewDate('2025-12-25')).toBe('25 December 2025');
  });

  it('returns a string', () => {
    expect(typeof formatWhatsNewDate('2026-05-15')).toBe('string');
  });
});
