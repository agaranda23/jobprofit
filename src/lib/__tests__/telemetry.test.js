// @vitest-environment jsdom
/**
 * telemetry.test.js
 *
 * Verifies that:
 *   - logTelemetry calls window.gtag('event', ...) in production (DEV = false)
 *   - logTelemetry calls console.log in DEV (DEV = true)
 *   - identifyUser calls window.gtag('config', ...) and window.gtag('set', ...) in production
 *   - Both functions are silent no-ops when window.gtag throws
 *   - identifyUser is a no-op when userId is falsy
 *   - Consent guard blocks gtag calls when consent is not granted
 *
 * Strategy: import.meta.env.DEV is a compile-time constant in Vite/Vitest.
 * vi.stubEnv + vi.resetModules re-evaluates the module per describe block so
 * the DEV branch is correctly exercised in both directions.
 *
 * jsdom environment is required because the production consent guard reads
 * localStorage via consent.js — we exercise the real consent.js by seeding
 * the key before each production-build test rather than mocking it away.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('telemetry — production build (DEV=false)', () => {
  let logTelemetry;
  let identifyUser;
  let gtagMock;

  beforeEach(async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_GA4_ID', 'G-TEST1234567');
    // Grant analytics consent so isConsentGranted() returns true and the
    // production guard inside logTelemetry / identifyUser doesn't short-circuit.
    localStorage.setItem('jp.analytics_consent', 'granted');
    // Set up window.gtag mock before module loads.
    gtagMock = vi.fn();
    window.gtag = gtagMock;
    vi.resetModules();
    const mod = await import('../telemetry.js');
    logTelemetry = mod.logTelemetry;
    identifyUser = mod.identifyUser;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    localStorage.removeItem('jp.analytics_consent');
    delete window.gtag;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('logTelemetry calls window.gtag event with event name + data', () => {
    logTelemetry('invoice_sent', { channel: 'whatsapp' });
    expect(gtagMock).toHaveBeenCalledWith('event', 'invoice_sent', { channel: 'whatsapp' });
  });

  it('logTelemetry does not write to console.log in production', () => {
    logTelemetry('mark_paid', { source: 'today' });
    expect(console.log).not.toHaveBeenCalled();
  });

  it('logTelemetry is a silent no-op when window.gtag throws', () => {
    gtagMock.mockImplementationOnce(() => { throw new Error('blocked'); });
    expect(() => logTelemetry('upgrade_clicked', {})).not.toThrow();
  });

  it('logTelemetry is a no-op when consent is not granted', async () => {
    localStorage.setItem('jp.analytics_consent', 'denied');
    vi.resetModules();
    const mod = await import('../telemetry.js');
    mod.logTelemetry('invoice_sent', { channel: 'whatsapp' });
    expect(gtagMock).not.toHaveBeenCalled();
  });

  it('identifyUser calls gtag config with user_id and gtag set with user_properties', () => {
    identifyUser('user-123', { plan: 'trial', trial_ends_at: '2026-06-14T00:00:00Z' });
    expect(gtagMock).toHaveBeenCalledWith('config', 'G-TEST1234567', { user_id: 'user-123' });
    expect(gtagMock).toHaveBeenCalledWith('set', 'user_properties', {
      plan: 'trial',
      trial_ends_at: '2026-06-14T00:00:00Z',
    });
  });

  it('identifyUser is a no-op when userId is falsy', () => {
    identifyUser(null, { plan: 'free' });
    identifyUser('', { plan: 'free' });
    expect(gtagMock).not.toHaveBeenCalled();
  });
});

describe('telemetry — DEV build (DEV=true)', () => {
  let logTelemetry;
  let identifyUser;
  let gtagMock;

  beforeEach(async () => {
    vi.stubEnv('DEV', true);
    gtagMock = vi.fn();
    window.gtag = gtagMock;
    vi.resetModules();
    const mod = await import('../telemetry.js');
    logTelemetry = mod.logTelemetry;
    identifyUser = mod.identifyUser;
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    delete window.gtag;
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

  it('logTelemetry does NOT call window.gtag in DEV', () => {
    logTelemetry('tab_tap', { tab: 'today' });
    expect(gtagMock).not.toHaveBeenCalled();
  });

  it('identifyUser writes to console.log in DEV', () => {
    identifyUser('user-abc', { plan: 'free' });
    expect(console.log).toHaveBeenCalledWith('[telemetry] identify', 'user-abc', { plan: 'free' });
  });

  it('identifyUser does NOT call window.gtag in DEV', () => {
    identifyUser('user-abc', { plan: 'free' });
    expect(gtagMock).not.toHaveBeenCalled();
  });
});

// ── UPGRADE_TRIGGERS enum ────────────────────────────────────────────────────

describe('UPGRADE_TRIGGERS enum', () => {
  it('exports the required trigger values', async () => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    const { UPGRADE_TRIGGERS } = await import('../telemetry.js');
    expect(UPGRADE_TRIGGERS.INSIGHT_LOCKED).toBe('insight_locked');
    expect(UPGRADE_TRIGGERS.WHITELABEL_FOOTER).toBe('whitelabel_footer');
    expect(UPGRADE_TRIGGERS.AUTO_CHASE_LOCKED).toBe('auto_chase_locked');
    expect(UPGRADE_TRIGGERS.SETTINGS).toBe('settings');
    expect(UPGRADE_TRIGGERS.TRIAL_BANNER).toBe('trial_banner');
    expect(UPGRADE_TRIGGERS.TODAY_PILL).toBe('today_pill');
    expect(UPGRADE_TRIGGERS.UPGRADE_BANNER).toBe('upgrade_banner');
    vi.unstubAllEnvs();
  });
});

// ── getLastUpgradeTrigger / setLastUpgradeTrigger ────────────────────────────

describe('upgrade trigger sessionStorage helpers', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false);
    vi.resetModules();
    // jsdom provides sessionStorage — clear it before each test.
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    sessionStorage.clear();
  });

  it('getLastUpgradeTrigger returns null when nothing has been set', async () => {
    const { getLastUpgradeTrigger } = await import('../telemetry.js');
    expect(getLastUpgradeTrigger()).toBeNull();
  });

  it('setLastUpgradeTrigger persists and getLastUpgradeTrigger reads it back', async () => {
    const { getLastUpgradeTrigger, setLastUpgradeTrigger, UPGRADE_TRIGGERS } = await import('../telemetry.js');
    setLastUpgradeTrigger(UPGRADE_TRIGGERS.INSIGHT_LOCKED);
    expect(getLastUpgradeTrigger()).toBe('insight_locked');
  });

  it('setLastUpgradeTrigger overwrites a previous value', async () => {
    const { getLastUpgradeTrigger, setLastUpgradeTrigger, UPGRADE_TRIGGERS } = await import('../telemetry.js');
    setLastUpgradeTrigger(UPGRADE_TRIGGERS.TODAY_PILL);
    setLastUpgradeTrigger(UPGRADE_TRIGGERS.SETTINGS);
    expect(getLastUpgradeTrigger()).toBe('settings');
  });
});
