/**
 * Phase G-2 tests — PublicQuoteView accept/decline logic.
 *
 * No DOM, no React render — pure logic tests covering:
 *   A. isAccepted derivation — paths that show the accepted terminal state
 *   B. isDeclined derivation — the new decline terminal state
 *   C. acceptedAt / declinedAt resolution
 *   D. acceptedSource display logic for JobDetailDrawer
 *   E. Token validation used by the public page
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
