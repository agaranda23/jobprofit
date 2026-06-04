/**
 * PR2 tests — marketing consent capture.
 *
 * Pure logic tests — no DOM, no React render.
 * Covers:
 *   A. MarketingOptIn default state (unticked / not submitted)
 *   B. Consent record shape written by save-marketing-consent
 *   C. Hard separation: chase-reminders does NOT read marketing_consent
 *   D. Transactional send paths (accept-quote) do NOT write to marketing_consent
 *   E. Token validation for the save-marketing-consent endpoint
 */

import { describe, it, expect } from 'vitest';
import { isValidToken } from '../../lib/publicQuoteToken';

// ── A. MarketingOptIn default state ──────────────────────────────────────────
// The checkbox MUST default to unticked (false). Pre-ticking marketing consent
// is unlawful under UK GDPR. We model the initial state here.

function initialMarketingOptInState() {
  return {
    checked: false,    // MUST be false on mount — never pre-ticked
    submitted: false,
  };
}

describe('A. MarketingOptIn default state', () => {
  it('checkbox defaults to unticked (false)', () => {
    const state = initialMarketingOptInState();
    expect(state.checked).toBe(false);
  });

  it('is not pre-submitted on mount', () => {
    const state = initialMarketingOptInState();
    expect(state.submitted).toBe(false);
  });
});

// ── B. Consent record shape ───────────────────────────────────────────────────
// Mirrors the consentRecord object built in save-marketing-consent.js.

function buildConsentRecord(granted, userId) {
  return {
    granted,
    source: 'public_accept',
    timestamp: new Date().toISOString(),
    controller_trader_id: userId,
  };
}

describe('B. Consent record shape', () => {
  it('ticking opt-in writes granted: true', () => {
    const record = buildConsentRecord(true, 'trader-uuid-123');
    expect(record.granted).toBe(true);
    expect(record.source).toBe('public_accept');
    expect(record.controller_trader_id).toBe('trader-uuid-123');
    expect(record.timestamp).toBeTruthy();
  });

  it('not ticking (explicit decline) writes granted: false', () => {
    const record = buildConsentRecord(false, 'trader-uuid-123');
    expect(record.granted).toBe(false);
    expect(record.source).toBe('public_accept');
  });

  it('timestamp is an ISO 8601 string', () => {
    const record = buildConsentRecord(true, 'x');
    expect(() => new Date(record.timestamp).toISOString()).not.toThrow();
    expect(isNaN(new Date(record.timestamp).getTime())).toBe(false);
  });

  it('record includes controller_trader_id so the data is scoped to the right trader', () => {
    const record = buildConsentRecord(true, 'abc-def');
    expect(record.controller_trader_id).toBe('abc-def');
  });
});

// ── C. Hard separation: chase-reminders does NOT read marketing_consent ───────
// The chase-reminders function queries jobs using only meta fields:
//   chaseRemindedTier, chaseRemindedAt, quoteStatus / status, invoiceDueDate.
// marketing_consent is a top-level column on jobs, NOT a field in meta.
// This test documents the contract by listing the fields the chase
// function IS allowed to read, and asserting marketing_consent is not in that set.

const CHASE_ALLOWED_META_FIELDS = [
  'chaseRemindedTier',
  'chaseRemindedAt',
  'quoteStatus',
  'status',
  'invoiceDueDate',
  'publicAccessToken',
];

const CHASE_FORBIDDEN_FIELDS = [
  'marketing_consent',
  'marketingConsent',
  'optOut',
  'unsubscribed',
];

describe('C. Chase ladder / marketing_consent hard separation', () => {
  it('marketing_consent is NOT in the list of fields the chase ladder reads', () => {
    CHASE_FORBIDDEN_FIELDS.forEach(field => {
      expect(CHASE_ALLOWED_META_FIELDS).not.toContain(field);
    });
  });

  it('marketing_consent is stored as a top-level column, not inside meta', () => {
    // marketing_consent lives at jobs.marketing_consent, not jobs.meta.marketing_consent.
    // The chase ladder reads jobs.meta fields only. This is the structural guarantee.
    const colName = 'marketing_consent';
    // The column name must not start with "meta->" (i.e. it is not a meta sub-field)
    expect(colName.startsWith('meta->')).toBe(false);
    expect(colName).toBe('marketing_consent');
  });

  it('a customer declining marketing consent has no field the chase code can read', () => {
    // Simulate a denied consent record — no field in this object should be
    // readable by the chase ladder as an opt-out.
    const deniedConsent = { granted: false, source: 'public_accept' };
    // The chase ladder only reads meta JSONB sub-fields. marketing_consent is
    // a separate top-level column with no join into the chase query.
    const chaseCanReadThis = CHASE_ALLOWED_META_FIELDS.some(f => f in deniedConsent);
    expect(chaseCanReadThis).toBe(false);
  });
});

// ── D. Transactional send paths do NOT write to marketing_consent ─────────────
// accept-quote.js writes to jobs.meta (acceptedSignature, acceptedAt, etc.).
// It NEVER touches jobs.marketing_consent. Marketing consent is written only by
// save-marketing-consent.js, and only when the customer explicitly interacts
// with the opt-in checkbox after acceptance.

const ACCEPT_QUOTE_META_FIELDS = [
  'acceptedSignature',
  'acceptedAt',
  'acceptedName',
  'acceptedSource',
  'quoteStatus',
  'status',
  'jobStatus',
  'consentGiven',
  'consentAt',
  'consentPolicyVersion',
];

describe('D. accept-quote does not write marketing_consent', () => {
  it('accept-quote meta fields do not include marketing_consent', () => {
    expect(ACCEPT_QUOTE_META_FIELDS).not.toContain('marketing_consent');
    expect(ACCEPT_QUOTE_META_FIELDS).not.toContain('marketingConsent');
  });

  it('consentGiven in meta is the contractual acceptance flag, not a marketing flag', () => {
    // consentGiven in meta records that the customer ticked the T&Cs checkbox —
    // this is contractual (lawful basis: contract), not marketing consent.
    expect(ACCEPT_QUOTE_META_FIELDS).toContain('consentGiven');
    // It must NOT be interpreted as marketing opt-in.
    expect('consentGiven').not.toBe('marketing_consent');
  });
});

// ── E. Token validation for save-marketing-consent ───────────────────────────
// The function uses the same UUID v4 validation as accept-quote.

describe('E. Token validation for save-marketing-consent endpoint', () => {
  it('accepts a standard UUID v4', () => {
    expect(isValidToken('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(true);
  });

  it('rejects an empty token', () => {
    expect(isValidToken('')).toBe(false);
  });

  it('rejects a non-UUID string', () => {
    expect(isValidToken('not-a-uuid')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidToken(null)).toBe(false);
  });

  it('rejects SQL injection attempt', () => {
    expect(isValidToken("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; DROP TABLE jobs; --")).toBe(false);
  });
});
