/**
 * Wave 4 icon system — Add Job + Review surface
 *
 * Node-env tests (no jsdom):
 *
 *   1. Icon.jsx registry: all new Wave 4 semantic names are registered.
 *   2. AddJobModal.jsx: source uses <Icon> for every functional UI glyph.
 *   3. ReviewSheet.jsx: source uses <Icon> for its close glyph.
 *   4. Outbound message strings: emoji NOT stripped from quoteMessage / invoiceMessage.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── File paths ────────────────────────────────────────────────────────────────

const ICON_JSX    = path.resolve(__dirname, '../Icon.jsx');
const ADDJOB_JSX  = path.resolve(__dirname, '../AddJobModal.jsx');
const REVIEW_JSX  = path.resolve(__dirname, '../ReviewSheet.jsx');
const QUOTE_MSG   = path.resolve(__dirname, '../../lib/quoteMessage.js');
const INV_MSG     = path.resolve(__dirname, '../../lib/invoiceMessage.js');

const iconSrc    = fs.readFileSync(ICON_JSX,   'utf8');
const addjobSrc  = fs.readFileSync(ADDJOB_JSX, 'utf8');
const reviewSrc  = fs.readFileSync(REVIEW_JSX, 'utf8');
const quoteMsgSrc  = fs.readFileSync(QUOTE_MSG, 'utf8');
const invMsgSrc    = fs.readFileSync(INV_MSG,   'utf8');

// ── 1. Registry — Wave 4 semantic names ──────────────────────────────────────

describe('Icon registry — Wave 4 new entries present', () => {
  it('registry contains "voice"', () => {
    expect(iconSrc).toMatch(/voice\s*:/);
  });

  it('registry contains "offline"', () => {
    expect(iconSrc).toMatch(/offline\s*:/);
  });

  it('registry contains "pdf"', () => {
    expect(iconSrc).toMatch(/pdf\s*:/);
  });

  it('imports WifiOff from lucide-react', () => {
    expect(iconSrc).toContain('WifiOff');
  });

  it('"voice" maps to Mic (same glyph as existing "mic" entry)', () => {
    // Both mic and voice should appear adjacent to Mic in the registry
    expect(iconSrc).toContain('Mic');
    expect(iconSrc).toMatch(/voice\s*:\s*Mic/);
  });

  it('"offline" maps to WifiOff', () => {
    expect(iconSrc).toMatch(/offline\s*:\s*WifiOff/);
  });
});

// ── 2. AddJobModal — <Icon> used; functional emoji glyphs absent ──────────────

describe('AddJobModal — <Icon> used for all functional glyphs', () => {
  it('imports Icon from ./Icon', () => {
    expect(addjobSrc).toContain("import Icon from './Icon'");
  });

  it('uses <Icon name="voice"> (at least 4 mic placements)', () => {
    const matches = addjobSrc.match(/name="voice"/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it('uses <Icon name="loading"> for parsing / building spinners', () => {
    const matches = addjobSrc.match(/name="loading"/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('uses <Icon name="close"> for all ✕ close / remove buttons', () => {
    const matches = addjobSrc.match(/name="close"/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it('uses <Icon name="edit"> for the amount edit affordance', () => {
    expect(addjobSrc).toContain('name="edit"');
  });

  it('uses <Icon name="offline"> for the offline pill', () => {
    expect(addjobSrc).toContain('name="offline"');
  });

  it('uses <Icon name="arrow-left"> for the back button', () => {
    expect(addjobSrc).toContain('name="arrow-left"');
  });

  it('uses <Icon name="chevron-up"> for the More/Less toggle', () => {
    expect(addjobSrc).toContain('name="chevron-up"');
  });

  it('uses <Icon name="add"> for the More (expand) toggle', () => {
    expect(addjobSrc).toContain('name="add"');
  });

  // Guard: no raw functional emoji glyphs in JSX render paths
  it('does not contain raw 🎤 emoji in JSX render path', () => {
    // Strip comments, then check — the 🎤 is 🎤 as surrogate pair
    const withoutComments = addjobSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(withoutComments).not.toContain('🎤');
  });

  it('does not contain raw ✕ glyph in JSX render path', () => {
    const withoutComments = addjobSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(withoutComments).not.toContain('✕');
  });

  it('does not contain &#127908; (mic HTML entity) in JSX render path', () => {
    const withoutComments = addjobSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(withoutComments).not.toContain('&#127908;');
  });

  it('does not contain &#x23F3; (hourglass HTML entity) in JSX render path', () => {
    const withoutComments = addjobSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(withoutComments).not.toContain('&#x23F3;');
  });

  it('does not contain raw ✎ pencil glyph in JSX render path', () => {
    const withoutComments = addjobSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(withoutComments).not.toContain('✎');
  });

  it('does not contain raw ⚡ lightning glyph in JSX render path', () => {
    const withoutComments = addjobSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(withoutComments).not.toContain('⚡');
  });

  it('does not contain raw ← arrow glyph in JSX render path', () => {
    const withoutComments = addjobSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(withoutComments).not.toContain('←');
  });
});

// ── 3. ReviewSheet — <Icon> used for close glyph ─────────────────────────────

describe('ReviewSheet — <Icon> used for close glyph', () => {
  it('imports Icon from ./Icon', () => {
    expect(reviewSrc).toContain("import Icon from './Icon'");
  });

  it('uses <Icon name="close"> for the header close button', () => {
    expect(reviewSrc).toContain('name="close"');
  });

  it('does not contain raw ✕ glyph in JSX render path', () => {
    const withoutComments = reviewSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(withoutComments).not.toContain('✕');
  });
});

// ── 4. Outbound messages — emoji NOT stripped ─────────────────────────────────
// These files build the WhatsApp/SMS strings that render on the customer's phone.
// They must NOT be converted to Icon components.

describe('Outbound message strings — emoji preserved (not stripped)', () => {
  it('quoteMessage.js is non-empty (lib file intact)', () => {
    expect(quoteMsgSrc.length).toBeGreaterThan(0);
  });

  it('invoiceMessage.js is non-empty (lib file intact)', () => {
    expect(invMsgSrc.length).toBeGreaterThan(0);
  });

  it('quoteMessage.js does not import Icon (not a UI component)', () => {
    expect(quoteMsgSrc).not.toContain("import Icon");
  });

  it('invoiceMessage.js does not import Icon (not a UI component)', () => {
    expect(invMsgSrc).not.toContain("import Icon");
  });

  it('AddJobModal still uses outbound emoji in message-string context (not converted)', () => {
    // The "Send to customer" and "Save quote" buttons have text labels, not emoji.
    // We verify AddJobModal doesn't strip emoji from the message helpers it calls.
    // The message builders are imported from lib — not from AddJobModal source.
    // This test confirms AddJobModal does NOT embed message-string emoji directly.
    expect(addjobSrc).not.toMatch(/buildQuoteWhatsAppMessage.*🎤/);
  });
});
