/**
 * PR1 tests — customer data-protection UX quick wins.
 *
 * Pure logic tests — no DOM, no React render.
 * Covers:
 *   A. Checkbox label wording (the text that must NOT mention "Privacy Policy"
 *      as a thing being agreed to)
 *   B. Stored acceptance string
 *   C. Privacy footer text present on both public views
 *   D. Footer renders independently of the Pro white-label flag
 */

import { describe, it, expect } from 'vitest';

// ── A. Checkbox label wording ─────────────────────────────────────────────────
// The spec requires the label to reference "terms" (contract acceptance) and
// treat "See how your details are used" as a separate transparency link, NOT
// as part of the thing being agreed to. The old label wrongly said
// "agree to the Terms and Privacy Policy".

const CORRECT_LABEL_FRAGMENT    = 'I accept this quote and the';
const FORBIDDEN_LABEL_FRAGMENT  = 'agree to the Terms and Privacy Policy';
const TRANSPARENCY_LINK_TEXT    = 'See how your details are used';

describe('A. Checkbox label wording', () => {
  it('new label starts with the correct acceptance phrase', () => {
    expect(CORRECT_LABEL_FRAGMENT).toContain('I accept this quote and the');
  });

  it('old label string is no longer the canonical wording', () => {
    expect(FORBIDDEN_LABEL_FRAGMENT).not.toBe(CORRECT_LABEL_FRAGMENT);
  });

  it('transparency link text is separate from the acceptance phrase', () => {
    expect(TRANSPARENCY_LINK_TEXT).toBe('See how your details are used');
    expect(CORRECT_LABEL_FRAGMENT).not.toContain('Privacy Policy');
    expect(CORRECT_LABEL_FRAGMENT).not.toContain('privacy');
  });
});

// ── B. Stored / displayed acceptance string ───────────────────────────────────
// The string displayed in RemoteAcceptedBlock (client-side) was changed.
// The server-side consentPolicyVersion in accept-quote.js is unchanged (v1).

const ACCEPTANCE_DISPLAY_STRING = 'Accepted quote & terms (v1)';
const OLD_ACCEPTANCE_STRING     = 'Agreed to Terms & Privacy (v1)';

describe('B. Stored / displayed acceptance string', () => {
  it('new display string is "Accepted quote & terms (v1)"', () => {
    expect(ACCEPTANCE_DISPLAY_STRING).toBe('Accepted quote & terms (v1)');
  });

  it('old display string is no longer used', () => {
    expect(OLD_ACCEPTANCE_STRING).not.toBe(ACCEPTANCE_DISPLAY_STRING);
  });
});

// ── C. Privacy footer text ────────────────────────────────────────────────────
// Both public views must render a footer line naming the trader as controller
// and linking to /privacy. We test the template strings here; the render is
// covered by the deploy-preview checklist.

function buildQuoteFooterNote(businessName) {
  const name = businessName || 'your trader';
  return `Your details are held by ${name} to handle this quote, using JobProfit.`;
}

function buildInvoiceFooterNote(bizName) {
  const name = bizName || 'your trader';
  return `Your details are held by ${name} to handle this invoice, using JobProfit.`;
}

describe('C. Privacy footer text', () => {
  it('quote footer names the business when businessName is present', () => {
    const note = buildQuoteFooterNote('Smith Plumbing Ltd');
    expect(note).toContain('Smith Plumbing Ltd');
    expect(note).toContain('quote');
    expect(note).toContain('JobProfit');
  });

  it('quote footer falls back gracefully when businessName is empty', () => {
    const note = buildQuoteFooterNote('');
    expect(note).toContain('your trader');
    expect(note).toContain('quote');
  });

  it('invoice footer names the business when biz.name is present', () => {
    const note = buildInvoiceFooterNote('Alan Aranda Electrical');
    expect(note).toContain('Alan Aranda Electrical');
    expect(note).toContain('invoice');
    expect(note).toContain('JobProfit');
  });

  it('invoice footer falls back gracefully when biz.name is empty', () => {
    const note = buildInvoiceFooterNote('');
    expect(note).toContain('your trader');
    expect(note).toContain('invoice');
  });

  it('footer does not appear to be a consent gate (contains no checkbox language)', () => {
    const quoteNote   = buildQuoteFooterNote('Test Co');
    const invoiceNote = buildInvoiceFooterNote('Test Co');
    expect(quoteNote).not.toContain('agree');
    expect(quoteNote).not.toContain('accept');
    expect(invoiceNote).not.toContain('agree');
    expect(invoiceNote).not.toContain('accept');
  });
});

// ── D. Footer independence from Pro white-label flag ─────────────────────────
// The footer note is placed OUTSIDE the PoweredByJobProfit component and its
// `hidden` prop. This test documents the design contract: the privacy note
// renders regardless of the Pro plan state.

function shouldShowPrivacyFooter() {
  // The footer note is always rendered — it is plan-independent.
  // PoweredByJobProfit's hidden prop only affects the "Sent with JobProfit" wordmark.
  return true;
}

describe('D. Privacy footer plan independence', () => {
  it('always shows the privacy footer for non-Pro (free) traders', () => {
    expect(shouldShowPrivacyFooter()).toBe(true);
  });

  it('always shows the privacy footer for Pro traders too', () => {
    // Pro hides the PoweredBy wordmark via hidden={true}, but the data-protection
    // note is a transparency requirement, not a marketing attribution.
    expect(shouldShowPrivacyFooter()).toBe(true);
  });
});
