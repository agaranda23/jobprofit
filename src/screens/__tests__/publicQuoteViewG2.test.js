/**
 * Phase G-2 tests — PublicQuoteView accept/decline logic.
 *
 * No DOM, no React render — pure logic tests covering:
 *   A. isAccepted derivation — paths that show the accepted terminal state
 *   B. isDeclined derivation — the new decline terminal state
 *   C. acceptedAt / declinedAt resolution
 *   D. acceptedSource display logic for JobDetailDrawer
 *   E. Token validation used by the public page
 *   F. VAT breakdown derivation (fix/quote-public-vat-validity)
 *   G. Per-quote "Valid until" derivation (fix/quote-public-vat-validity)
 *   H. Deposit due-date display string (fix/quote-public-vat-validity)
 *
 * Signature-based detection removed (Phase G-2): quoteStatus is now the canonical
 * acceptance signal. acceptedSignature is retained as a legacy safety fallback for
 * rows that have it but no quoteStatus yet (pre G-2 data).
 *
 * The actual fetch/submit flow is covered by the Netlify function tests.
 * Component render smoke is exercised by the deploy-preview checklist.
 */

import { describe, it, expect } from 'vitest';
import { isValidToken } from '../../lib/publicQuoteToken';
import { splitVatInclusive } from '../../lib/vatUtils';

// ── A. isAccepted derivation ──────────────────────────────────────────────────
// Mirrors the logic in PublicQuoteView's render body (G-2):
//   const isAccepted = !!job.acceptedSignature || job.quoteStatus === 'accepted'
//     || depositAlreadyPaid || !!remoteAccepted;

function deriveIsAccepted(job, remoteAccepted, depositAlreadyPaid = false) {
  return !!job.acceptedSignature || job.quoteStatus === 'accepted'
    || depositAlreadyPaid || !!remoteAccepted;
}

describe('A. isAccepted derivation', () => {
  it('is false when job has no accepted status and no remoteAccepted', () => {
    const job = { quoteStatus: 'sent' };
    expect(deriveIsAccepted(job, null)).toBe(false);
  });

  it('is false when quoteStatus is declined', () => {
    const job = { quoteStatus: 'declined' };
    expect(deriveIsAccepted(job, null)).toBe(false);
  });

  it('is true when job.quoteStatus is "accepted" (primary G-2 path)', () => {
    const job = { quoteStatus: 'accepted' };
    expect(deriveIsAccepted(job, null)).toBe(true);
  });

  it('is true when job.acceptedSignature is set (legacy pre-G-2 path)', () => {
    const job = { acceptedSignature: 'data:image/png;base64,ABC' };
    expect(deriveIsAccepted(job, null)).toBe(true);
  });

  it('is true when remoteAccepted is set (G-2 customer just accepted in session)', () => {
    const job = { quoteStatus: 'sent' };
    const remoteAccepted = { acceptedAt: '2026-05-17T10:00:00.000Z' };
    expect(deriveIsAccepted(job, remoteAccepted)).toBe(true);
  });

  it('is true when deposit was already paid (auto-accept)', () => {
    const job = { quoteStatus: 'sent' };
    expect(deriveIsAccepted(job, null, true)).toBe(true);
  });
});

// ── B. isDeclined derivation ──────────────────────────────────────────────────
// Mirrors:
//   const isDeclined = !isAccepted && (job.quoteStatus === 'declined' || !!remoteDeclined);

function deriveIsDeclined(job, remoteDeclined, isAccepted) {
  return !isAccepted && (job.quoteStatus === 'declined' || !!remoteDeclined);
}

describe('B. isDeclined derivation', () => {
  it('is true when quoteStatus is declined and not accepted', () => {
    const job = { quoteStatus: 'declined' };
    expect(deriveIsDeclined(job, null, false)).toBe(true);
  });

  it('is true when remoteDeclined is set in session', () => {
    const job = { quoteStatus: 'sent' };
    const remoteDeclined = { declinedAt: '2026-06-23T10:00:00.000Z' };
    expect(deriveIsDeclined(job, remoteDeclined, false)).toBe(true);
  });

  it('is false when isAccepted is true (acceptance wins over decline)', () => {
    const job = { quoteStatus: 'declined' }; // edge case — should not happen
    expect(deriveIsDeclined(job, null, true)).toBe(false);
  });

  it('is false when quoteStatus is sent', () => {
    const job = { quoteStatus: 'sent' };
    expect(deriveIsDeclined(job, null, false)).toBe(false);
  });

  it('is false when job has no quoteStatus', () => {
    expect(deriveIsDeclined({}, null, false)).toBe(false);
  });
});

// ── C. acceptedAt / declinedAt resolution ────────────────────────────────────
// Mirrors:
//   const acceptedAt = remoteAccepted?.acceptedAt || job.acceptedAt || null;
//   const declinedAt = remoteDeclined?.declinedAt || job.declinedAt || null;

function resolveAcceptedAt(job, remoteAccepted) {
  return remoteAccepted?.acceptedAt || job.acceptedAt || null;
}

function resolveDeclinedAt(job, remoteDeclined) {
  return remoteDeclined?.declinedAt || job.declinedAt || null;
}

describe('C. acceptedAt resolution', () => {
  it('uses remoteAccepted.acceptedAt when present', () => {
    const job = { acceptedAt: '2026-01-01T00:00:00.000Z' };
    const remoteAccepted = { acceptedAt: '2026-05-17T10:00:00.000Z' };
    expect(resolveAcceptedAt(job, remoteAccepted)).toBe('2026-05-17T10:00:00.000Z');
  });

  it('falls back to job.acceptedAt when remoteAccepted is null', () => {
    const job = { acceptedAt: '2026-01-01T00:00:00.000Z' };
    expect(resolveAcceptedAt(job, null)).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns null when neither is set', () => {
    expect(resolveAcceptedAt({}, null)).toBe(null);
  });
});

describe('C. declinedAt resolution', () => {
  it('uses remoteDeclined.declinedAt when present', () => {
    const job = { declinedAt: '2026-01-01T00:00:00.000Z' };
    const remoteDeclined = { declinedAt: '2026-06-23T10:00:00.000Z' };
    expect(resolveDeclinedAt(job, remoteDeclined)).toBe('2026-06-23T10:00:00.000Z');
  });

  it('falls back to job.declinedAt when remoteDeclined is null', () => {
    const job = { declinedAt: '2026-06-23T10:00:00.000Z' };
    expect(resolveDeclinedAt(job, null)).toBe('2026-06-23T10:00:00.000Z');
  });

  it('returns null when neither is set', () => {
    expect(resolveDeclinedAt({}, null)).toBe(null);
  });
});

// ── D. acceptedSource display logic (JobDetailDrawer) ─────────────────────────
// Mirrors the JSX ternary in the drawer:
//   job.acceptedSource === 'remote'
//     ? `Accepted remotely${job.acceptedName ? ` by ${job.acceptedName}` : ' by customer'}`
//     : 'Accepted on screen'

function resolveAcceptedLabel(job) {
  if (job.acceptedSource === 'remote') {
    return `Accepted remotely${job.acceptedName ? ` by ${job.acceptedName}` : ' by customer'}`;
  }
  return 'Accepted on screen';
}

describe('D. acceptedSource display label', () => {
  it('shows "Accepted on screen" when acceptedSource is not set', () => {
    expect(resolveAcceptedLabel({})).toBe('Accepted on screen');
  });

  it('shows "Accepted on screen" when acceptedSource is explicitly absent', () => {
    expect(resolveAcceptedLabel({ acceptedSource: undefined })).toBe('Accepted on screen');
  });

  it('shows "Accepted remotely by customer" when source is remote but name is absent', () => {
    expect(resolveAcceptedLabel({ acceptedSource: 'remote' })).toBe('Accepted remotely by customer');
  });

  it('shows "Accepted remotely by <name>" when source is remote and name is set', () => {
    expect(resolveAcceptedLabel({ acceptedSource: 'remote', acceptedName: 'Jane Smith' })).toBe('Accepted remotely by Jane Smith');
  });

  it('handles empty string acceptedName as absent', () => {
    const label = resolveAcceptedLabel({ acceptedSource: 'remote', acceptedName: '' });
    expect(label).toBe('Accepted remotely by customer');
  });
});

// ── E. Token validation used by the public page ───────────────────────────────

describe('E. Token shape used by G-2 submit', () => {
  it('accepts a standard UUID v4 token', () => {
    expect(isValidToken('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(true);
  });

  it('rejects an empty token (guard in PublicQuoteView)', () => {
    expect(isValidToken('')).toBe(false);
  });

  it('rejects a token with injected characters', () => {
    expect(isValidToken("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; DROP TABLE jobs; --")).toBe(false);
  });
});

// ── F. VAT breakdown derivation (fix/quote-public-vat-validity) ──────────────
// Mirrors PublicQuoteView's render body:
//   const showVat = !!vatRegistered || job.vat === true;
//   const { net: vatNet, vat: vatAmount } = showVat ? splitVatInclusive(total) : { net: total, vat: 0 };
// Must match generateQuotePDF's showVat exactly and never re-derive the split
// by hand — splitVatInclusive() is the single source of truth.

function deriveShowVat(vatRegistered, job) {
  return !!vatRegistered || job.vat === true;
}

function deriveVatBreakdown(vatRegistered, job, total) {
  const showVat = deriveShowVat(vatRegistered, job);
  return showVat ? splitVatInclusive(total) : { gross: total, net: total, vat: 0 };
}

describe('F. showVat derivation', () => {
  it('is false when the trader is not VAT-registered and job.vat is unset', () => {
    expect(deriveShowVat(false, {})).toBe(false);
  });

  it('is true when the trader profile is VAT-registered', () => {
    expect(deriveShowVat(true, {})).toBe(true);
  });

  it('is true when job.vat is true even if the trader is not VAT-registered (voice-quote flag)', () => {
    expect(deriveShowVat(false, { vat: true })).toBe(true);
  });

  it('is false when job.vat is a truthy-but-not-true value (strict === true check)', () => {
    expect(deriveShowVat(false, { vat: 'yes' })).toBe(false);
  });
});

describe('F. VAT breakdown values — penny-correct via splitVatInclusive', () => {
  it('returns net/vat that sum back to a round gross (£240 → £200 net + £40 VAT)', () => {
    const { net, vat } = deriveVatBreakdown(true, {}, 240);
    expect(net).toBe(200);
    expect(vat).toBe(40);
    expect(net + vat).toBe(240);
  });

  it('is penny-correct for a non-round gross total (£137.50)', () => {
    const { net, vat } = deriveVatBreakdown(true, {}, 137.50);
    expect(net).toBeCloseTo(114.5833333, 5);
    expect(vat).toBeCloseTo(22.9166667, 5);
    expect(net + vat).toBeCloseTo(137.50, 8);
  });

  it('returns net === total and vat === 0 when VAT does not apply', () => {
    const { net, vat } = deriveVatBreakdown(false, {}, 137.50);
    expect(net).toBe(137.50);
    expect(vat).toBe(0);
  });
});

// ── G. Per-quote "Valid until" derivation (fix/quote-public-vat-validity) ────
// Mirrors PublicQuoteView's render body: job.quoteValidUntil (per-quote
// override) wins over issueDate + profile.quote_validity_days. The founder
// flagged that editing "Valid until" used to silently rewrite the trader's
// GLOBAL default (profile.quote_validity_days) for every future quote — this
// derivation is the fix: a per-job field that never touches the profile.

function deriveValidUntil(job, issueDateIso, quoteValidityDays) {
  const issueDate = new Date(`${issueDateIso}T00:00:00`);
  const defaultValidUntil = new Date(issueDate);
  defaultValidUntil.setDate(defaultValidUntil.getDate() + quoteValidityDays);
  if (job.quoteValidUntil) {
    return new Date(`${job.quoteValidUntil}T00:00:00`);
  }
  return defaultValidUntil;
}

describe('G. Per-quote valid-until override', () => {
  // Dates compared via toLocaleDateString('en-GB') (DD/MM/YYYY) — same
  // convention as invoicePDF.test.js — NOT toISOString(), which shifts by the
  // runner's local UTC offset and can roll the date back/forward a day.

  it('falls back to issueDate + profile default when job.quoteValidUntil is absent', () => {
    const result = deriveValidUntil({}, '2026-06-01', 30);
    expect(result.toLocaleDateString('en-GB')).toBe('01/07/2026');
  });

  it('uses job.quoteValidUntil when set, ignoring the profile default entirely', () => {
    const job = { quoteValidUntil: '2026-09-15' };
    const result = deriveValidUntil(job, '2026-06-01', 30); // default would be 01/07/2026
    expect(result.toLocaleDateString('en-GB')).toBe('15/09/2026');
  });

  it('a per-quote override does not change what a DIFFERENT job with no override derives', () => {
    const editedJob = { quoteValidUntil: '2026-09-15' };
    const otherJob = {};
    expect(deriveValidUntil(editedJob, '2026-06-01', 30).toLocaleDateString('en-GB')).toBe('15/09/2026');
    // The "global default" (quote_validity_days) is untouched by the edit above —
    // a sibling job with no override still derives from the same 30-day default.
    expect(deriveValidUntil(otherJob, '2026-06-01', 30).toLocaleDateString('en-GB')).toBe('01/07/2026');
  });
});

// ── H. Deposit due-date display (fix/quote-public-vat-validity) ──────────────
// Mirrors PublicQuoteView's render body:
//   const depositDueStr = job.deposit_due_date ? fmtDate(job.deposit_due_date) : '';
// fmtDate itself is exercised elsewhere; this covers the presence/absence gate
// that decides whether the "Due <date>" trailer renders on the deposit blocks.

function deriveDepositDueStr(job) {
  return job.deposit_due_date ? job.deposit_due_date : '';
}

describe('H. Deposit due-date gate', () => {
  it('is present when job.deposit_due_date is set', () => {
    expect(deriveDepositDueStr({ deposit_due_date: '2026-07-11' })).toBe('2026-07-11');
  });

  it('is empty when job.deposit_due_date is absent (falls back to the existing generic copy)', () => {
    expect(deriveDepositDueStr({})).toBe('');
  });
});
