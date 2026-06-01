/**
 * resolveBusinessIdentity — unit tests.
 *
 * Guards the single-source-of-truth merge function that is now called by
 * every document send path. These tests pin the field-name mapping so a
 * future rename (e.g. profile.business_name → profile.name) causes a
 * visible test failure rather than a silent regression.
 */

import { describe, it, expect } from 'vitest';
import { resolveBusinessIdentity } from '../resolveBusinessIdentity.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function bizOnly(overrides = {}) {
  return {
    name:          'Legacy Biz Ltd',
    address:       '1 Old Road',
    phone:         '07700 000001',
    email:         'old@biz.co.uk',
    logoUrl:       'https://old.example.com/logo.png',
    accountName:   'Legacy Biz Ltd',
    sortCode:      '11-22-33',
    accountNumber: '11223344',
    vatNumber:     'GB999999999',
    vatRegistered: true,
    utr:           '9999999999',
    stripePaymentLink: 'https://buy.stripe.com/oldlink',
    ...overrides,
  };
}

function profileOnly(overrides = {}) {
  return {
    business_name:  'Modern Biz Ltd',
    address:        '2 New Street',
    phone:          '07800 000002',
    email:          'new@biz.co.uk',
    logo_url:       'https://storage.supabase.co/logo.png',
    account_name:   'Modern Biz Ltd',
    sort_code:      '44-55-66',
    account_number: '44556677',
    vat_number:     'GB111111111',
    vat_registered: true,
    utr_number:     '1111111111',
    stripe_payment_link: 'https://buy.stripe.com/newlink',
    ...overrides,
  };
}

// ── Profile fields win when both are present ──────────────────────────────────

describe('resolveBusinessIdentity — profile wins over biz when both set', () => {
  it('uses profile.business_name over biz.name', () => {
    const result = resolveBusinessIdentity(bizOnly(), profileOnly());
    expect(result.name).toBe('Modern Biz Ltd');
  });

  it('uses profile.address over biz.address', () => {
    const result = resolveBusinessIdentity(bizOnly(), profileOnly());
    expect(result.address).toBe('2 New Street');
  });

  it('uses profile.phone over biz.phone', () => {
    const result = resolveBusinessIdentity(bizOnly(), profileOnly());
    expect(result.phone).toBe('07800 000002');
  });

  it('uses profile.email over biz.email', () => {
    const result = resolveBusinessIdentity(bizOnly(), profileOnly());
    expect(result.email).toBe('new@biz.co.uk');
  });

  it('uses profile.logo_url over biz.logoUrl', () => {
    const result = resolveBusinessIdentity(bizOnly(), profileOnly());
    expect(result.logoUrl).toBe('https://storage.supabase.co/logo.png');
  });

  it('uses profile.sort_code over biz.sortCode', () => {
    const result = resolveBusinessIdentity(bizOnly(), profileOnly());
    expect(result.sortCode).toBe('44-55-66');
  });

  it('uses profile.account_number over biz.accountNumber', () => {
    const result = resolveBusinessIdentity(bizOnly(), profileOnly());
    expect(result.accountNumber).toBe('44556677');
  });

  it('uses profile.vat_number over biz.vatNumber', () => {
    const result = resolveBusinessIdentity(bizOnly(), profileOnly());
    expect(result.vatNumber).toBe('GB111111111');
  });

  it('uses profile.utr_number over biz.utr', () => {
    const result = resolveBusinessIdentity(bizOnly(), profileOnly());
    expect(result.utr).toBe('1111111111');
  });

  it('uses profile.stripe_payment_link over biz.stripePaymentLink', () => {
    const result = resolveBusinessIdentity(bizOnly(), profileOnly());
    expect(result.stripePaymentLink).toBe('https://buy.stripe.com/newlink');
  });
});

// ── Biz fields are the fallback when profile is empty/null ────────────────────

describe('resolveBusinessIdentity — biz fields used when profile is null', () => {
  it('returns biz.name when profile is null', () => {
    const result = resolveBusinessIdentity(bizOnly(), null);
    expect(result.name).toBe('Legacy Biz Ltd');
  });

  it('returns biz.address when profile is null', () => {
    const result = resolveBusinessIdentity(bizOnly(), null);
    expect(result.address).toBe('1 Old Road');
  });

  it('returns biz.sortCode when profile is null', () => {
    const result = resolveBusinessIdentity(bizOnly(), null);
    expect(result.sortCode).toBe('11-22-33');
  });

  it('returns biz.accountNumber when profile is null', () => {
    const result = resolveBusinessIdentity(bizOnly(), null);
    expect(result.accountNumber).toBe('11223344');
  });

  it('returns biz.utr when profile is null', () => {
    const result = resolveBusinessIdentity(bizOnly(), null);
    expect(result.utr).toBe('9999999999');
  });
});

// ── Both null/empty — graceful empty object ───────────────────────────────────

describe('resolveBusinessIdentity — null biz and profile produce empty strings', () => {
  it('returns empty strings when both null', () => {
    const result = resolveBusinessIdentity(null, null);
    expect(result.name).toBe('');
    expect(result.address).toBe('');
    expect(result.phone).toBe('');
    expect(result.email).toBe('');
    expect(result.sortCode).toBe('');
    expect(result.accountNumber).toBe('');
    expect(result.vatNumber).toBe('');
    expect(result.utr).toBe('');
    expect(result.stripePaymentLink).toBe('');
  });

  it('vatRegistered defaults to false when neither source sets it', () => {
    const result = resolveBusinessIdentity(null, null);
    expect(result.vatRegistered).toBe(false);
  });
});

// ── logoUrl + logo_url both exposed so generators can read either shape ────────

describe('resolveBusinessIdentity — logo_url available as both camelCase and snake_case', () => {
  it('logoUrl and logo_url match the resolved value', () => {
    const result = resolveBusinessIdentity(null, profileOnly());
    expect(result.logoUrl).toBe(result.logo_url);
    expect(result.logoUrl).toBe('https://storage.supabase.co/logo.png');
  });

  it('falls back to biz.logo_url (snake_case) when biz.logoUrl is absent', () => {
    const biz = { logo_url: 'https://old.example.com/via-snake.png' };
    const result = resolveBusinessIdentity(biz, null);
    expect(result.logoUrl).toBe('https://old.example.com/via-snake.png');
  });
});

// ── Profile fields fill gaps left by partial biz ─────────────────────────────

describe('resolveBusinessIdentity — profile fills gaps left by partial biz', () => {
  it('profile.address fills in when biz.address is empty', () => {
    const biz = bizOnly({ address: '' });
    const result = resolveBusinessIdentity(biz, profileOnly());
    expect(result.address).toBe('2 New Street');
  });

  it('profile.phone fills in when biz.phone is empty', () => {
    const biz = bizOnly({ phone: '' });
    const result = resolveBusinessIdentity(biz, profileOnly());
    expect(result.phone).toBe('07800 000002');
  });

  it('profile.utr_number fills in when biz.utr is empty', () => {
    const biz = bizOnly({ utr: '' });
    const result = resolveBusinessIdentity(biz, profileOnly());
    expect(result.utr).toBe('1111111111');
  });
});
