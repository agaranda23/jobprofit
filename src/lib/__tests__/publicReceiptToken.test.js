/**
 * publicReceiptToken.js — unit tests.
 *
 * Mirrors publicInvoiceToken.test.js structure.
 *
 * Covers:
 *   - buildPublicReceiptUrl produces /r/<token> shape
 *   - generatePublicAccessToken returns a valid UUID
 *   - isValidToken accepts/rejects correctly
 */

import { describe, it, expect } from 'vitest';
import {
  buildPublicReceiptUrl,
  generatePublicAccessToken,
  isValidToken,
} from '../publicReceiptToken.js';

describe('buildPublicReceiptUrl — /r/<token> URL construction', () => {
  const token = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  it('builds the correct /r/ path for a known token', () => {
    const url = buildPublicReceiptUrl(token, 'https://app.jobprofit.co.uk');
    expect(url).toBe(`https://app.jobprofit.co.uk/r/${token}`);
  });

  it('uses /r/ prefix — not /i/ or /q/', () => {
    const url = buildPublicReceiptUrl(token, 'https://app.jobprofit.co.uk');
    expect(url).toContain('/r/');
    expect(url).not.toContain('/i/');
    expect(url).not.toContain('/q/');
  });

  it('includes the full token in the path', () => {
    const url = buildPublicReceiptUrl(token, 'https://app.jobprofit.co.uk');
    expect(url).toContain(token);
  });
});

describe('generatePublicAccessToken — UUID v4 shape', () => {
  it('returns a string of the correct UUID shape', () => {
    const token = generatePublicAccessToken();
    expect(typeof token).toBe('string');
    expect(isValidToken(token)).toBe(true);
  });

  it('each call returns a distinct token', () => {
    const a = generatePublicAccessToken();
    const b = generatePublicAccessToken();
    expect(a).not.toBe(b);
  });
});

describe('isValidToken — accepts valid UUIDs, rejects junk', () => {
  it('accepts a known valid UUID v4', () => {
    expect(isValidToken('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidToken('')).toBe(false);
  });

  it('rejects a non-UUID string', () => {
    expect(isValidToken('not-a-uuid')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidToken(null)).toBe(false);
  });
});
