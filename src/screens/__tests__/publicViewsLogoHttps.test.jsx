// @vitest-environment jsdom
/**
 * PublicInvoiceView / PublicReceiptView — logo mixed-content regression tests.
 *
 * Bug: a business logo_url stored as http:// rendered as
 * <img src="http://…"> on these https public pages → browser "Not secure" /
 * mixed-content warning shown directly to the TRADER'S CUSTOMER (real trust
 * damage, not just an internal app quirk).
 *
 * Fix: both views wrap the logo src in secureImageUrl() before rendering.
 * These tests mock the two fetch calls each view makes (fetch-public-job +
 * fetch-public-invoice/receipt) so we can reach the fully-loaded state and
 * assert on the actual rendered <img src>, rather than just the loading/
 * error states covered in publicInvoiceView.test.js / screenSmoke.test.jsx.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import PublicInvoiceView from '../PublicInvoiceView';
import PublicReceiptView from '../PublicReceiptView';

const VALID_TOKEN = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const JOB = {
  id: 'j1',
  customer: 'Sarah Jones',
  total: 200,
  amount: 200,
  lineItems: [{ desc: 'Boiler service', cost: 200 }],
  status: 'paid',
  invoiceNumber: 'INV-0001',
};

function mockFetchSequence({ profileBody }) {
  global.fetch = vi.fn((url) => {
    if (typeof url === 'string' && url.includes('fetch-public-job')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(JOB) });
    }
    // fetch-public-invoice or fetch-public-receipt
    return Promise.resolve({ ok: true, json: () => Promise.resolve(profileBody) });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete global.fetch;
});

describe('PublicInvoiceView — logo renders as https even when stored as http', () => {
  it('upgrades an http:// profile.logoUrl to https:// in the rendered <img>', async () => {
    mockFetchSequence({
      profileBody: {
        businessName: 'Test Plumbing Ltd',
        logoUrl: 'http://example.com/logo.png',
      },
    });

    render(<PublicInvoiceView token={VALID_TOKEN} />);

    const img = await waitFor(() => screen.getByAltText('Business logo'));
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
  });

  it('leaves an already-https logoUrl unchanged', async () => {
    mockFetchSequence({
      profileBody: {
        businessName: 'Test Plumbing Ltd',
        logoUrl: 'https://example.com/logo.png',
      },
    });

    render(<PublicInvoiceView token={VALID_TOKEN} />);

    const img = await waitFor(() => screen.getByAltText('Business logo'));
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
  });
});

describe('PublicReceiptView — logo renders as https even when stored as http', () => {
  it('upgrades an http:// profile.logoUrl to https:// in the rendered <img>', async () => {
    mockFetchSequence({
      profileBody: {
        businessName: 'Test Plumbing Ltd',
        logoUrl: 'http://example.com/logo.png',
      },
    });

    render(<PublicReceiptView token={VALID_TOKEN} />);

    const img = await waitFor(() => screen.getByAltText('Logo'));
    expect(img).toHaveAttribute('src', 'https://example.com/logo.png');
  });
});
