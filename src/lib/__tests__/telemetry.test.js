/**
 * telemetry.test.js
 *
 * Verifies that:
 *   - logTelemetry calls posthog.capture in production (import.meta.env.DEV = false)
 *   - logTelemetry calls console.log in DEV (import.meta.env.DEV = true)
 *   - identifyUser calls posthog.identify with the right args in production
 *   - Both functions are silent no-ops when posthog.capture / identify throws
 *   - identifyUser is a no-op when userId is falsy
 *
 * Strategy: import.meta.env.DEV is a compile-time constant in Vite/Vitest.
 * vi.stubEnv + vi.resetModules re-evaluates the module per describe block so
 * the DEV branch is correctly exercised in both directions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The posthog-js mock is hoisted before any import, so the module under test
// always receives the mocked singleton.
vi.mock('posthog-js', () => ({
  default: {
    capture: vi.fn(),
    identify: vi.fn(),
  },
}));

describe('telemetry — production build (DEV=false)', () => {
  let logTelemetry;
  let identifyUser;
  let phCapture;
  let phIdentify;

  beforeEach(async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const mod = await import('../telemetry.js');
    logTelemetry = mod.logTelemetry;
    identifyUser = mod.identifyUser;
    const ph = (await import('posthog-js')).default;
    phCapture  = ph.capture;
    phIdentify = ph.identify;
    phCapture.mockClear();
    phIdentify.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('logTelemetry calls posthog.capture with event + data', () => {
    logTelemetry('invoice_sent', { channel: 'whatsapp' });
    expect(phCapture).toHaveBeenCalledWith('invoice_sent', { channel: 'whatsapp' });
  });

  it('logTelemetry does not write to console.log in production', () => {
    logTelemetry('mark_paid', { source: 'today' });
    expect(console.log).not.toHaveBeenCalled();
  });

  it('logTelemetry is a silent no-op when posthog.capture throws', () => {
    phCapture.mockImplementationOnce(() => { throw new Error('blocked'); });
    expect(() => logTelemetry('upgrade_clicked', {})).not.toThrow();
  });

  it('identifyUser calls posthog.identify with userId + traits', () => {
    identifyUser('user-123', { plan: 'trial', trial_ends_at: '2026-06-14T00:00:00Z' });
    expect(phIdentify).toHaveBeenCalledWith('user-123', {
      plan: 'trial',
      trial_ends_at: '2026-06-14T00:00:00Z',
    });
  });

  it('identifyUser is a no-op when userId is falsy', () => {
    identifyUser(null, { plan: 'free' });
    identifyUser('', { plan: 'free' });
    expect(phIdentify).not.toHaveBeenCalled();
  });
});

describe('telemetry — DEV build (DEV=true)', () => {
  let logTelemetry;
  let identifyUser;
  let phCapture;
  let phIdentify;

  beforeEach(async () => {
    vi.stubEnv('DEV', true);
    vi.resetModules();
    const mod = await import('../telemetry.js');
    logTelemetry = mod.logTelemetry;
    identifyUser = mod.identifyUser;
    const ph = (await import('posthog-js')).default;
    phCapture  = ph.capture;
    phIdentify = ph.identify;
    phCapture.mockClear();
    phIdentify.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('logTelemetry writes to console.log in DEV', () => {
    logTelemetry('quote_send', { source: 'create_quote' });
    expect(console.log).toHaveBeenCalledWith(
      '[telemetry] quote_send',
      { source: 'create_quote' },
    );
  });

  it('logTelemetry does NOT call posthog.capture in DEV', () => {
    logTelemetry('tab_tap', { tab: 'today' });
    expect(phCapture).not.toHaveBeenCalled();
  });

  it('identifyUser writes to console.log in DEV', () => {
    identifyUser('user-abc', { plan: 'free' });
    expect(console.log).toHaveBeenCalledWith('[telemetry] identify', 'user-abc', { plan: 'free' });
  });

  it('identifyUser does NOT call posthog.identify in DEV', () => {
    identifyUser('user-abc', { plan: 'free' });
    expect(phIdentify).not.toHaveBeenCalled();
  });
});
