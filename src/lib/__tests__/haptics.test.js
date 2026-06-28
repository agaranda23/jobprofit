/**
 * haptics.test.js — unit tests for the haptic() utility.
 *
 * Tests must NOT import haptics.js at the top level because the module
 * reads navigator.vibrate at import time (module-level constant).
 * We use vi.doMock / vi.resetModules to control the navigator mock per test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('haptics', () => {
  let vibrateSpy;

  beforeEach(() => {
    vi.resetModules();
    vibrateSpy = vi.fn();
    // Expose a minimal navigator mock that has vibrate
    vi.stubGlobal('navigator', {
      vibrate: vibrateSpy,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('calls navigator.vibrate(8) for light', async () => {
    const { haptic } = await import('../haptics.js');
    haptic('light');
    expect(vibrateSpy).toHaveBeenCalledWith(8);
  });

  it('calls navigator.vibrate(18) for medium', async () => {
    const { haptic } = await import('../haptics.js');
    haptic('medium');
    expect(vibrateSpy).toHaveBeenCalledWith(18);
  });

  it('calls navigator.vibrate([12,40,18]) for success', async () => {
    const { haptic } = await import('../haptics.js');
    haptic('success');
    expect(vibrateSpy).toHaveBeenCalledWith([12, 40, 18]);
  });

  it('calls navigator.vibrate([10,30,10]) for warning', async () => {
    const { haptic } = await import('../haptics.js');
    haptic('warning');
    expect(vibrateSpy).toHaveBeenCalledWith([10, 30, 10]);
  });

  it('does not call vibrate for an unknown kind', async () => {
    const { haptic } = await import('../haptics.js');
    haptic('unknown');
    expect(vibrateSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when navigator.vibrate is absent', async () => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.stubGlobal('navigator', {});
    const { haptic } = await import('../haptics.js');
    // Should not throw
    expect(() => haptic('success')).not.toThrow();
  });

  it('swallows errors thrown by navigator.vibrate', async () => {
    vibrateSpy.mockImplementation(() => { throw new Error('not allowed'); });
    const { haptic } = await import('../haptics.js');
    expect(() => haptic('medium')).not.toThrow();
  });
});
