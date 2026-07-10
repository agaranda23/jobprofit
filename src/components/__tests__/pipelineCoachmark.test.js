// @vitest-environment jsdom
/**
 * Unit tests for the pipeline coachmark localStorage persistence helpers.
 *
 * Runs in jsdom so localStorage is available. No React rendering needed —
 * the helpers are pure functions, extracted from StageStrip.jsx into
 * src/lib/pipelineStages.js so the component file stays a component-only
 * export (react-refresh/only-export-components).
 *
 * Verifies:
 *   - readCoachmarkSeen returns false when the flag is absent
 *   - readCoachmarkSeen returns true after writeCoachmarkSeen is called
 *   - writeCoachmarkSeen is idempotent (safe to call multiple times)
 *   - readCoachmarkSeen handles a failing localStorage gracefully (no throw)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readCoachmarkSeen, writeCoachmarkSeen, COACHMARK_KEY } from '../../lib/pipelineStages.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function clearFlag() {
  try { localStorage.removeItem(COACHMARK_KEY); } catch { /* ignore */ }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('pipeline coachmark persistence', () => {
  beforeEach(clearFlag);

  it('readCoachmarkSeen returns false when the flag has never been set', () => {
    expect(readCoachmarkSeen()).toBe(false);
  });

  it('readCoachmarkSeen returns true after writeCoachmarkSeen is called', () => {
    writeCoachmarkSeen();
    expect(readCoachmarkSeen()).toBe(true);
  });

  it('writeCoachmarkSeen is idempotent — calling it twice does not throw', () => {
    expect(() => {
      writeCoachmarkSeen();
      writeCoachmarkSeen();
    }).not.toThrow();
    expect(readCoachmarkSeen()).toBe(true);
  });

  it('the localStorage key matches the documented constant jp.jobs_pipeline_coachmark_seen', () => {
    expect(COACHMARK_KEY).toBe('jp.jobs_pipeline_coachmark_seen');
  });

  it('readCoachmarkSeen returns false (no throw) when localStorage.getItem throws', () => {
    // Simulate a private-browsing environment where getItem throws SecurityError.
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    try {
      expect(readCoachmarkSeen()).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('writeCoachmarkSeen does not throw when localStorage.setItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      expect(() => writeCoachmarkSeen()).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
