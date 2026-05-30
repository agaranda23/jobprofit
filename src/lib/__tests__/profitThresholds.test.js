/**
 * profitThresholds.test.js
 *
 * Unit tests for marginState() — boundary values as specified in the
 * Step 2 PRD (2026-05-30, page 4).
 *
 * Thresholds:
 *   ≥ 25%  → 'healthy'
 *   5–24%  → 'thin'
 *   < 5%   → 'underwater'
 */

import { describe, it, expect } from 'vitest';
import { marginState } from '../profitThresholds';

describe('marginState — margin colour thresholds', () => {
  // ── healthy band (≥ 25%) ──────────────────────────────────────────────────

  it('returns healthy at exactly 25%', () => {
    expect(marginState(25)).toBe('healthy');
  });

  it('returns healthy at 26%', () => {
    expect(marginState(26)).toBe('healthy');
  });

  it('returns healthy at 100% (pure profit, no costs)', () => {
    expect(marginState(100)).toBe('healthy');
  });

  it('returns healthy at 42% (typical trade job)', () => {
    expect(marginState(42)).toBe('healthy');
  });

  // ── thin band (5–24%) ────────────────────────────────────────────────────

  it('returns thin at exactly 24.9% (one step below healthy)', () => {
    expect(marginState(24.9)).toBe('thin');
  });

  it('returns thin at 24%', () => {
    expect(marginState(24)).toBe('thin');
  });

  it('returns thin at exactly 5%', () => {
    expect(marginState(5)).toBe('thin');
  });

  it('returns thin at 10%', () => {
    expect(marginState(10)).toBe('thin');
  });

  // ── underwater band (< 5%) ───────────────────────────────────────────────

  it('returns underwater at exactly 4.9% (one step below thin)', () => {
    expect(marginState(4.9)).toBe('underwater');
  });

  it('returns underwater at 0% (break-even)', () => {
    expect(marginState(0)).toBe('underwater');
  });

  it('returns underwater at negative margin (job is losing money)', () => {
    expect(marginState(-10)).toBe('underwater');
  });

  it('returns underwater at -100%', () => {
    expect(marginState(-100)).toBe('underwater');
  });

  it('returns underwater at 1% (just above zero but well below thin)', () => {
    expect(marginState(1)).toBe('underwater');
  });
});
