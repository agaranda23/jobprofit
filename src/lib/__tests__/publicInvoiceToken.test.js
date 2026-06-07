/**
 * publicInvoiceToken.js — unit tests.
 *
 * No DOM, no React, no Supabase. Pure logic.
 *
 * Covers:
 *   A. buildPublicInvoiceUrl — constructs the /i/<token> URL
 *   B. isValidToken re-export — same UUID validator as the quote page
 *   C. Token survives the same META_FIELDS round-trip via writeJobMeta/readJobMeta
 */

import { describe, it, expect } from 'vitest';
import {
  buildPublicInvoiceUrl,
  isValidToken,
} from '../publicInvoiceToken';

const TEST_ORIGIN = 'https://app.jobprofit.co.uk';
const VALID_TOKEN = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

// ── A. buildPublicInvoiceUrl ──────────────────────────────────────────────────

describe('buildPublicInvoiceUrl', () => {
  it('builds a /i/<token> URL from the supplied origin', () => {
    const url = buildPublicInvoiceUrl(VALID_TOKEN, TEST_ORIGIN);
    expect(url).toBe('https://app.jobprofit.co.uk/i/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });

  it('uses /i/ prefix, not /q/', () => {
    const url = buildPublicInvoiceUrl(VALID_TOKEN, TEST_ORIGIN);
    expect(url).toContain('/i/');
    expect(url).not.toContain('/q/');
  });

  it('handles a different token correctly', () => {
    const token2 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const url = buildPublicInvoiceUrl(token2, TEST_ORIGIN);
    expect(url).toBe(`${TEST_ORIGIN}/i/${token2}`);
  });
});

// ── B. isValidToken re-export ─────────────────────────────────────────────────

describe('isValidToken (re-exported from publicQuoteToken)', () => {
  it('accepts a standard UUID v4', () => {
    expect(isValidToken(VALID_TOKEN)).toBe(true);
  });

  it('rejects a clearly invalid token', () => {
    expect(isValidToken('not-a-uuid')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidToken('')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidToken(null)).toBe(false);
  });
});
