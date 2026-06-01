/**
 * Unit tests for the Call / Map tile action button logic introduced in
 * feat/tile-call-map-buttons.
 *
 * Scope: pure resolver functions + redirect decision tree.
 * No DOM, no React, no Supabase.
 *
 * Functions under test are mirrored here (same pattern as deriveDisplayStatus.test.js)
 * because they are module-internal in WorkScreen.jsx. If they are ever extracted to
 * a lib module, import directly and remove the mirrors.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Mirrors of WorkScreen resolver functions ──────────────────────────────────

function resolvePhone(job) {
  return job.customerPhone || job.phone || job.mobile || '';
}

function resolveAddress(job) {
  return job.address || '';
}

/**
 * Mirrors the Call button onClick decision:
 * - if phone exists → return { action: 'dial', value: phone }
 * - if no phone    → return { action: 'redirect', field: 'phone' }
 */
function callButtonDecision(job) {
  const phone = resolvePhone(job);
  if (phone) return { action: 'dial', value: phone };
  return { action: 'redirect', field: 'phone' };
}

/**
 * Mirrors the Map button onClick decision:
 * - if address exists → return { action: 'map', value: address }
 * - if no address    → return { action: 'redirect', field: 'address' }
 */
function mapButtonDecision(job) {
  const addr = resolveAddress(job);
  if (addr) return { action: 'map', value: addr };
  return { action: 'redirect', field: 'address' };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeJob(overrides = {}) {
  return {
    id: 'j1',
    summary: 'Boiler service',
    customer: 'Alice',
    status: 'active',
    ...overrides,
  };
}

// ── resolvePhone ──────────────────────────────────────────────────────────────

describe('resolvePhone', () => {
  it('returns customerPhone when set', () => {
    expect(resolvePhone(makeJob({ customerPhone: '07700900001' }))).toBe('07700900001');
  });

  it('falls back to phone when customerPhone is empty', () => {
    expect(resolvePhone(makeJob({ customerPhone: '', phone: '07700900002' }))).toBe('07700900002');
  });

  it('falls back to mobile when phone is also empty', () => {
    expect(resolvePhone(makeJob({ customerPhone: '', phone: '', mobile: '07700900003' }))).toBe('07700900003');
  });

  it('returns empty string when no phone field is set', () => {
    expect(resolvePhone(makeJob())).toBe('');
  });
});

// ── resolveAddress ────────────────────────────────────────────────────────────

describe('resolveAddress', () => {
  it('returns job.address when set', () => {
    expect(resolveAddress(makeJob({ address: '12 Oak Lane, London' }))).toBe('12 Oak Lane, London');
  });

  it('returns empty string when address is absent', () => {
    expect(resolveAddress(makeJob())).toBe('');
  });
});

// ── Call button decision ──────────────────────────────────────────────────────

describe('Call button — with phone', () => {
  it('returns dial action and the phone number', () => {
    const result = callButtonDecision(makeJob({ phone: '07700900010' }));
    expect(result.action).toBe('dial');
    expect(result.value).toBe('07700900010');
  });

  it('prefers customerPhone over phone', () => {
    const result = callButtonDecision(makeJob({ customerPhone: '07700900099', phone: '07700900010' }));
    expect(result.action).toBe('dial');
    expect(result.value).toBe('07700900099');
  });
});

describe('Call button — missing phone (redirect)', () => {
  it('returns redirect action with field=phone when no phone is present', () => {
    const result = callButtonDecision(makeJob());
    expect(result.action).toBe('redirect');
    expect(result.field).toBe('phone');
  });

  it('redirects when customerPhone, phone and mobile are all empty strings', () => {
    const result = callButtonDecision(makeJob({ customerPhone: '', phone: '', mobile: '' }));
    expect(result.action).toBe('redirect');
    expect(result.field).toBe('phone');
  });
});

// ── Map button decision ───────────────────────────────────────────────────────

describe('Map button — with address', () => {
  it('returns map action and the address string', () => {
    const result = mapButtonDecision(makeJob({ address: '99 High Street, Bristol' }));
    expect(result.action).toBe('map');
    expect(result.value).toBe('99 High Street, Bristol');
  });
});

describe('Map button — missing address (redirect)', () => {
  it('returns redirect action with field=address when address is absent', () => {
    const result = mapButtonDecision(makeJob());
    expect(result.action).toBe('redirect');
    expect(result.field).toBe('address');
  });

  it('redirects when address is an empty string', () => {
    const result = mapButtonDecision(makeJob({ address: '' }));
    expect(result.action).toBe('redirect');
    expect(result.field).toBe('address');
  });
});

// ── handleActionRedirect wiring ───────────────────────────────────────────────
// Tests that the redirect handler fires the correct callback with job + field.

describe('handleActionRedirect callback', () => {
  it('is called with job and field=phone on missing-phone tap', () => {
    const handler = vi.fn();
    const job = makeJob();
    const decision = callButtonDecision(job);
    if (decision.action === 'redirect') handler(job, decision.field);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(job, 'phone');
  });

  it('is called with job and field=address on missing-address tap', () => {
    const handler = vi.fn();
    const job = makeJob();
    const decision = mapButtonDecision(job);
    if (decision.action === 'redirect') handler(job, decision.field);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(job, 'address');
  });

  it('is NOT called when the job has a phone (dial path taken)', () => {
    const handler = vi.fn();
    const job = makeJob({ phone: '07700900001' });
    const decision = callButtonDecision(job);
    if (decision.action === 'redirect') handler(job, decision.field);
    expect(handler).not.toHaveBeenCalled();
  });

  it('is NOT called when the job has an address (map path taken)', () => {
    const handler = vi.fn();
    const job = makeJob({ address: '12 Oak Lane' });
    const decision = mapButtonDecision(job);
    if (decision.action === 'redirect') handler(job, decision.field);
    expect(handler).not.toHaveBeenCalled();
  });
});
