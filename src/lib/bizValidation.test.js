import { describe, it, expect } from 'vitest';
import { getMissingInvoiceFields } from './bizValidation.js';

// Helpers to build minimal valid objects
const fullProfile = {
  business_name: 'Acme Plumbing',
  first_name: 'Joe',
  last_name: 'Smith',
  sort_code: '12-34-56',
  account_number: '12345678',
};

const fullBiz = {
  name: 'Acme Plumbing',
  accountName: 'Joe Smith',
  sortCode: '12-34-56',
  accountNumber: '12345678',
};

const emptyBiz = {};
const emptyProfile = {};

describe('getMissingInvoiceFields', () => {
  it('returns no warnings when profile alone has all required fields (new-nav path)', () => {
    const missing = getMissingInvoiceFields(emptyBiz, fullProfile);
    expect(missing).toEqual([]);
  });

  it('returns no warnings when biz alone has all required fields (legacy path)', () => {
    const missing = getMissingInvoiceFields(fullBiz, undefined);
    expect(missing).toEqual([]);
  });

  it('prefers profile fields over biz when both present and profile is complete', () => {
    // biz is complete too — no warnings, profile wins without conflict
    const missing = getMissingInvoiceFields(fullBiz, fullProfile);
    expect(missing).toEqual([]);
  });

  it('profile sort_code present, biz sortCode absent — no Sort code warning', () => {
    const biz = { name: 'Acme', accountName: 'Joe Smith', accountNumber: '12345678' };
    const profile = { sort_code: '12-34-56' };
    const missing = getMissingInvoiceFields(biz, profile);
    expect(missing).not.toContain('Sort code');
  });

  it('biz sortCode present, profile sort_code absent — no Sort code warning (fallback works)', () => {
    const biz = { name: 'Acme', accountName: 'Joe Smith', sortCode: '12-34-56', accountNumber: '12345678' };
    const profile = { business_name: 'Acme' }; // no sort_code
    const missing = getMissingInvoiceFields(biz, profile);
    expect(missing).not.toContain('Sort code');
  });

  it('returns all bank-detail and business-name warnings when neither source has data', () => {
    const missing = getMissingInvoiceFields(emptyBiz, emptyProfile);
    expect(missing).toContain('Business name');
    expect(missing).toContain('Account name');
    expect(missing).toContain('Sort code');
    expect(missing).toContain('Account number');
  });

  it('returns no warnings when neither source is provided (null profile)', () => {
    // When profile is null, should not crash — falls back to biz entirely
    const missing = getMissingInvoiceFields(fullBiz, null);
    expect(missing).toEqual([]);
  });

  it('treats whitespace-only values as missing', () => {
    const biz = { name: '   ', accountName: '   ', sortCode: '   ', accountNumber: '   ' };
    const profile = { business_name: '   ', sort_code: '   ', account_number: '   ' };
    const missing = getMissingInvoiceFields(biz, profile);
    expect(missing).toContain('Business name');
    expect(missing).toContain('Sort code');
    expect(missing).toContain('Account number');
  });

  it('does not require VAT number when vatRegistered is false', () => {
    const biz = { ...fullBiz, vatRegistered: false, vatNumber: '' };
    const missing = getMissingInvoiceFields(biz, fullProfile);
    expect(missing).not.toContain('VAT number');
  });

  it('requires VAT number when vatRegistered is true and vatNumber absent', () => {
    const biz = { ...fullBiz, vatRegistered: true, vatNumber: '' };
    const missing = getMissingInvoiceFields(biz, fullProfile);
    expect(missing).toContain('VAT number');
  });

  it('biz.bankDetails free-text blob skips structured bank checks', () => {
    // Legacy users who stored everything in the blob field
    const biz = { name: 'Acme', bankDetails: 'Sort: 12-34-56 Acc: 12345678 Joe Smith' };
    const missing = getMissingInvoiceFields(biz, null);
    expect(missing).toEqual([]);
  });
});
