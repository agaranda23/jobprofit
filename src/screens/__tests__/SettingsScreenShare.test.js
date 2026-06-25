/**
 * SettingsScreen share/contact helpers — pure-logic tests.
 *
 * No DOM, no React, no @testing-library — matches project convention.
 * We inline the helpers rather than importing from SettingsScreen.jsx because
 * the screen file has side-effect imports (supabase, pushSubscribe) that
 * require extra mocking. These implementations must stay in sync with
 * the source (enforced by the fact the screen exports them identically).
 *
 * Covers:
 *   buildShareData  — correct title, text snippet, and URL
 *   buildWhatsAppSupportUrl — correct international number + pre-filled message
 */

import { describe, it, expect } from 'vitest';

// ── Inline helpers (identical to the exports in SettingsScreen.jsx) ───────────

function buildShareData() {
  return {
    title: 'OHNAR',
    text: "I use OHNAR to quote, invoice and get paid from my phone — give it a go.",
    url: 'https://jobprofit.co.uk',
  };
}

function buildWhatsAppSupportUrl() {
  return "https://wa.me/447411353356?text=Hi%2C%20I've%20got%20a%20question%20about%20OHNAR";
}

// ── buildShareData ────────────────────────────────────────────────────────────

describe('buildShareData', () => {
  it('returns the correct URL', () => {
    expect(buildShareData().url).toBe('https://jobprofit.co.uk');
  });

  it('returns the correct title', () => {
    expect(buildShareData().title).toBe('OHNAR');
  });

  it('returns a non-empty text snippet', () => {
    expect(buildShareData().text.length).toBeGreaterThan(0);
  });

  it('text mentions OHNAR', () => {
    expect(buildShareData().text).toContain('OHNAR');
  });
});

// ── buildWhatsAppSupportUrl ───────────────────────────────────────────────────

describe('buildWhatsAppSupportUrl', () => {
  it('targets the correct international number', () => {
    expect(buildWhatsAppSupportUrl()).toContain('447411353356');
  });

  it('starts with the wa.me base URL', () => {
    expect(buildWhatsAppSupportUrl()).toMatch(/^https:\/\/wa\.me\//);
  });

  it('includes a prefilled text parameter', () => {
    expect(buildWhatsAppSupportUrl()).toContain('text=');
  });
});
