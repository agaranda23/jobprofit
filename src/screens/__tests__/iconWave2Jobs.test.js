/**
 * Wave 2 icon system — Jobs/Work surface
 *
 * Node-env tests (no jsdom dependency):
 *
 *   1. Icon.jsx registry: all new Wave 2 semantic names are registered.
 *   2. WorkScreen.jsx EmptyState: source uses <Icon> not raw emoji chars.
 *   3. CollapsedSectionRow.jsx: source uses <Icon> for chevron glyphs.
 *   4. StatusBadge.jsx: source uses <Icon> for status icons.
 *
 * Render tests (jsdom) live in iconSystem.test.jsx (Wave 0+1 coverage) and
 * screenSmoke.test.jsx (full mount smoke). The node-env source guards here are
 * the fast-path CI check that the emoji→Icon swap was not accidentally reverted.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── File paths ────────────────────────────────────────────────────────────────

const ICON_JSX   = path.resolve(__dirname, '../../components/Icon.jsx');
const WORK_JSX   = path.resolve(__dirname, '../WorkScreen.jsx');
const CSR_JSX    = path.resolve(__dirname, '../../components/CollapsedSectionRow.jsx');
const BADGE_JSX  = path.resolve(__dirname, '../../components/StatusBadge.jsx');

const iconSrc  = fs.readFileSync(ICON_JSX, 'utf8');
const workSrc  = fs.readFileSync(WORK_JSX, 'utf8');
const csrSrc   = fs.readFileSync(CSR_JSX, 'utf8');
const badgeSrc = fs.readFileSync(BADGE_JSX, 'utf8');

// ── 1. Registry — Wave 2 semantic names ───────────────────────────────────────

describe('Icon registry — Wave 2 semantic names present', () => {
  const WAVE2_NAMES = [
    'lead',
    'quote-sent',
    'active-job',
    'invoice',
    'complete',
    'paid',
    'overdue',
    'chase-firm',
    'chase',
  ];

  WAVE2_NAMES.forEach(name => {
    it(`registry contains "${name}"`, () => {
      // Registry keys may be quoted ('quote-sent': ...) or unquoted (lead: ...).
      // Match either form followed by whitespace and a colon.
      const quoted   = new RegExp(`'${name.replace(/-/g, '\\-')}'\\s*:`);
      const unquoted = new RegExp(`\\b${name.replace(/-/g, '\\-')}\\s*:`);
      const found = quoted.test(iconSrc) || unquoted.test(iconSrc);
      expect(found).toBe(true);
    });
  });

  it('imports ClipboardList from lucide-react', () => {
    expect(iconSrc).toContain('ClipboardList');
  });

  it('imports Hammer from lucide-react', () => {
    expect(iconSrc).toContain('Hammer');
  });

  it('imports ReceiptText from lucide-react', () => {
    expect(iconSrc).toContain('ReceiptText');
  });

  it('imports CircleCheck from lucide-react', () => {
    expect(iconSrc).toContain('CircleCheck');
  });

  it('imports MessageCircle from lucide-react', () => {
    expect(iconSrc).toContain('MessageCircle');
  });

  it('nobody imports lucide-react outside Icon.jsx (single import gate)', () => {
    // WorkScreen, StatusBadge, and CollapsedSectionRow must not bypass Icon.jsx.
    expect(workSrc).not.toContain("from 'lucide-react'");
    expect(badgeSrc).not.toContain("from 'lucide-react'");
    expect(csrSrc).not.toContain("from 'lucide-react'");
  });
});

// ── 2. WorkScreen EmptyState — Icon not emoji ─────────────────────────────────

describe('WorkScreen EmptyState — icon system (no raw emoji)', () => {
  it('imports Icon component', () => {
    expect(workSrc).toContain("import Icon from '../components/Icon'");
  });

  it('EmptyState renders <Icon> elements (iconName prop pattern present)', () => {
    expect(workSrc).toContain('iconName:');
  });

  it('EmptyState no longer has raw emoji in the copy map', () => {
    // The old pattern was: icon: '📋' (or any of the six pipeline emoji).
    // After Wave 2 these must not appear as string literals in the copy map.
    const emojiChars = ['📋', '📨', '🔨', '🔧', '🧾', '✅', '💷', '🚨'];
    emojiChars.forEach(emoji => {
      expect(workSrc).not.toContain(`'${emoji}'`);
      expect(workSrc).not.toContain(`"${emoji}"`);
    });
  });

  it('EmptyState uses variant="brand" for the Overdue all-clear state', () => {
    // The branded micro-touch: Overdue empty state uses brand-green on the icon.
    expect(workSrc).toContain("branded: true");
    expect(workSrc).toContain("variant = branded ? 'brand' : 'muted'");
  });

  it('EmptyState wraps <Icon> in screen-empty-icon container (spacing preserved)', () => {
    expect(workSrc).toContain('screen-empty-icon');
  });
});

// ── 3. CollapsedSectionRow — chevron glyphs replaced with <Icon> ──────────────

describe('CollapsedSectionRow — chevron glyphs use <Icon>', () => {
  it('imports Icon component', () => {
    expect(csrSrc).toContain("import Icon from './Icon'");
  });

  it('does not use the raw ▴ upward triangle glyph', () => {
    expect(csrSrc).not.toContain('▴');
  });

  it('does not use the raw › single right angle quotation mark', () => {
    expect(csrSrc).not.toContain('›');
  });

  it('uses <Icon name="chevron-up"> for the expanded chevron', () => {
    expect(csrSrc).toContain("'chevron-up'");
  });

  it('uses <Icon name="chevron-right"> for the collapsed chevron', () => {
    expect(csrSrc).toContain("'chevron-right'");
  });
});

// ── 4. StatusBadge — icon per status ─────────────────────────────────────────

describe('StatusBadge — icon system', () => {
  it('imports Icon component', () => {
    expect(badgeSrc).toContain("import Icon from './Icon'");
  });

  it('defines a STAGE_ICON map (updated from STATUS_ICON to use deriveDisplayStatus stages)', () => {
    expect(badgeSrc).toContain('STAGE_ICON');
  });

  it('STAGE_ICON covers all six deriveDisplayStatus pipeline stages', () => {
    const stages = ['Lead', 'Quoted', 'On', 'Invoiced', 'Overdue', 'Paid'];
    stages.forEach(s => {
      expect(badgeSrc).toContain(s + ':');
    });
  });

  it('renders <Icon> using iconName (not raw emoji)', () => {
    // The old component had no emoji but the new one should use iconName variable.
    expect(badgeSrc).toContain('iconName');
    expect(badgeSrc).toContain('<Icon name={iconName}');
  });

  it('badge container uses inline-flex so icon and label align', () => {
    expect(badgeSrc).toContain("'inline-flex'");
  });
});
