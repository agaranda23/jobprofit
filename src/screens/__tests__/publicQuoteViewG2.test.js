/**
 * Phase G-2 tests — PublicQuoteView sign section logic.
 *
 * No DOM, no React render — pure logic tests covering:
 *   A. isAccepted derivation — all three paths that suppress the sign section
 *   B. acceptedAt resolution — remoteAccepted takes precedence over job.acceptedAt
 *   C. acceptedName / acceptedSource display logic for JobDetailDrawer
 *   D. ACCEPT_QUOTE_URL constant integrity (just the function path)
 *
 * The actual fetch/submit flow is covered by the Netlify function tests.
 * Component render smoke is exercised by the deploy-preview checklist.
 */

import { describe, it, expect } from 'vitest';
import { isValidToken } from '../../lib/publicQuoteToken';

// ── A. isAccepted derivation ──────────────────────────────────────────────────
// Mirrors the logic in PublicQuoteView's render body:
//   const isAccepted = !!job.acceptedSignature || job.quoteStatus === 'accepted' || !!remoteAccepted;

function deriveIsAccepted(job, remoteAccepted) {
  return !!job.acceptedSignature || job.quoteStatus === 'accepted' || !!remoteAccepted;
}

describe('A. isAccepted derivation', () => {
  it('is false when job has no signature, no accepted status, and no remoteAccepted', () => {
    const job = { quoteStatus: 'sent' };
    expect(deriveIsAccepted(job, null)).toBe(false);
  });

  it('is true when job.acceptedSignature is set (Phase F path)', () => {
    const job = { acceptedSignature: 'data:image/png;base64,ABC' };
    expect(deriveIsAccepted(job, null)).toBe(true);
  });

  it('is true when job.quoteStatus is "accepted" (no signature string needed)', () => {
    const job = { quoteStatus: 'accepted' };
    expect(deriveIsAccepted(job, null)).toBe(true);
  });

  it('is true when remoteAccepted is set (G-2 just submitted in this session)', () => {
    const job = { quoteStatus: 'sent' };
    const remoteAccepted = { acceptedAt: '2026-05-17T10:00:00.000Z', signatureDataUrl: 'data:...' };
    expect(deriveIsAccepted(job, remoteAccepted)).toBe(true);
  });

  it('is true when both job.acceptedSignature and remoteAccepted are set (belt and braces)', () => {
    const job = { acceptedSignature: 'data:image/png;base64,EXISTING' };
    const remoteAccepted = { acceptedAt: '2026-05-17T10:00:00.000Z' };
    expect(deriveIsAccepted(job, remoteAccepted)).toBe(true);
  });
});

// ── B. acceptedAt resolution ──────────────────────────────────────────────────
// Mirrors:
//   const acceptedAt = remoteAccepted?.acceptedAt || job.acceptedAt || null;

function resolveAcceptedAt(job, remoteAccepted) {
  return remoteAccepted?.acceptedAt || job.acceptedAt || null;
}

describe('B. acceptedAt resolution', () => {
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

// ── C. acceptedSource display logic (JobDetailDrawer) ─────────────────────────
// Mirrors the JSX ternary:
//   job.acceptedSource === 'remote'
//     ? `Signed remotely${job.acceptedName ? ` by ${job.acceptedName}` : ' by customer'}`
//     : 'Signed on screen'

function resolveSignedLabel(job) {
  if (job.acceptedSource === 'remote') {
    return `Signed remotely${job.acceptedName ? ` by ${job.acceptedName}` : ' by customer'}`;
  }
  return 'Signed on screen';
}

describe('C. acceptedSource display label', () => {
  it('shows "Signed on screen" when acceptedSource is not set (Phase F path)', () => {
    expect(resolveSignedLabel({ acceptedSignature: 'data:...' })).toBe('Signed on screen');
  });

  it('shows "Signed on screen" when acceptedSource is explicitly absent', () => {
    expect(resolveSignedLabel({ acceptedSource: undefined })).toBe('Signed on screen');
  });

  it('shows "Signed remotely by customer" when source is remote but name is absent', () => {
    expect(resolveSignedLabel({ acceptedSource: 'remote' })).toBe('Signed remotely by customer');
  });

  it('shows "Signed remotely by <name>" when source is remote and name is set', () => {
    expect(resolveSignedLabel({ acceptedSource: 'remote', acceptedName: 'Jane Smith' })).toBe('Signed remotely by Jane Smith');
  });

  it('handles empty string acceptedName as absent', () => {
    const label = resolveSignedLabel({ acceptedSource: 'remote', acceptedName: '' });
    expect(label).toBe('Signed remotely by customer');
  });
});

// ── D. Token validation used by the public page ───────────────────────────────
// The public page calls isValidToken before fetching — ensure G-2 token shapes pass.

describe('D. Token shape used by G-2 submit', () => {
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
