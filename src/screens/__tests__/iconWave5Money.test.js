/**
 * Wave 5 icon system — Money/Insight surface (FinanceScreen)
 *
 * Node-env source-guard tests (no jsdom needed):
 *
 *   1. Icon.jsx registry: all Wave 5 semantic names are registered.
 *   2. Icon.jsx imports: TrendingDown, ChartColumn, Lightbulb added.
 *   3. FinanceScreen.jsx: imports Icon from '../components/Icon'.
 *   4. FinanceScreen.jsx: no functional emoji glyphs remain in UI render paths.
 *   5. FinanceScreen.jsx: trend-up / trend-down used for margin nudge.
 *   6. FinanceScreen.jsx: money (GbpGlyph) used for empty-state hero.
 *   7. FinanceScreen.jsx: info icon used for trust-hint and tooltip affordances.
 *   8. FinanceScreen.jsx: lock icon used in Pro badge (not raw 🔒 entity).
 *   9. FinanceScreen.jsx: chevron-down Icon used for timeline disclosure.
 *  10. Green-is-earned discipline: trend-up uses 'success', trend-down uses 'danger'.
 *
 * Render tests (jsdom) for the full component mount live in screenSmoke.test.jsx.
 * These node-env guards are the fast CI check that the swap was not reverted.
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

const ICON_JSX    = path.resolve(__dirname, '../../components/Icon.jsx');
const FINANCE_JSX = path.resolve(__dirname, '../FinanceScreen.jsx');

const iconSrc    = fs.readFileSync(ICON_JSX, 'utf8');
const financeSrc = fs.readFileSync(FINANCE_JSX, 'utf8');

// ── 1. Registry — Wave 5 semantic names present ────────────────────────────────

describe('Icon registry — Wave 5 semantic names present', () => {
  const wave5Names = [
    'trend-down',   // 📉 margin-down nudge → TrendingDown
    'insights',     // 📊 chart/insights header → ChartColumn
    'tip',          // 💡 tip / insight callout → Lightbulb
    'money-alert',  // 💰 money alert → Lightbulb (danger at call site)
  ];

  wave5Names.forEach(name => {
    it(`'${name}' is registered in REGISTRY`, () => {
      // Hyphenated names are quoted ('trend-down'), single-word names are bare (insights:).
      // Check for either form: the name appears as an object key.
      const quotedForm = `'${name}'`;
      const bareForm = `${name}:`;
      expect(iconSrc.includes(quotedForm) || iconSrc.includes(bareForm)).toBe(true);
    });
  });

  it('"trend-up" was already registered (reused, not duplicated)', () => {
    // trend-up was seeded in Wave 0; verify it is still present
    expect(iconSrc).toContain("'trend-up'");
  });

  it('"money" (GbpGlyph) was already registered (reused for empty-state)', () => {
    expect(iconSrc).toContain("money:");
  });

  it('"lock" was already registered (reused for Pro badge)', () => {
    expect(iconSrc).toContain("lock:");
  });

  it('"info" was already registered (reused for tooltip and trust-hint)', () => {
    expect(iconSrc).toContain("info:");
  });

  it('"chevron-down" was already registered (reused for timeline disclosure)', () => {
    expect(iconSrc).toContain("'chevron-down'");
  });
});

// ── 2. Icon.jsx imports — new Lucide components added ─────────────────────────

describe('Icon.jsx — Wave 5 Lucide imports', () => {
  it('imports TrendingDown from lucide-react', () => {
    expect(iconSrc).toContain('TrendingDown');
  });

  it('imports ChartColumn from lucide-react', () => {
    expect(iconSrc).toContain('ChartColumn');
  });

  it('imports Lightbulb from lucide-react', () => {
    expect(iconSrc).toContain('Lightbulb');
  });
});

// ── 3. FinanceScreen.jsx — Icon import present ────────────────────────────────

describe('FinanceScreen.jsx — Icon import', () => {
  it('imports Icon from ../components/Icon', () => {
    expect(financeSrc).toContain("import Icon from '../components/Icon'");
  });

  it('does NOT import from lucide-react directly', () => {
    expect(financeSrc).not.toContain("from 'lucide-react'");
  });
});

// ── 4. FinanceScreen.jsx — functional emoji removed ───────────────────────────

describe('FinanceScreen.jsx — no functional emoji glyphs in UI render paths', () => {
  it('no 📈 emoji literal remains', () => {
    expect(financeSrc).not.toContain('📈');
  });

  it('no 📉 emoji literal remains', () => {
    expect(financeSrc).not.toContain('📉');
  });

  it('no 💷 emoji literal remains', () => {
    expect(financeSrc).not.toContain('💷');
  });

  it('no 💰 emoji literal remains', () => {
    expect(financeSrc).not.toContain('💰');
  });

  it('no 💡 emoji literal remains', () => {
    expect(financeSrc).not.toContain('💡');
  });

  it('no 📊 emoji literal remains', () => {
    expect(financeSrc).not.toContain('📊');
  });

  it('no raw lock emoji HTML entity (&#x1F512;) remains', () => {
    expect(financeSrc).not.toContain('&#x1F512;');
  });

  it('no raw small triangle HTML entity (&#x25BE;) remains as a disclosure chevron', () => {
    // &#x25BE; was the timeline chevron glyph before Wave 5
    expect(financeSrc).not.toContain('&#x25BE;');
  });

  it('no raw circled-i HTML entity (&#x24D8;) remains as a UI icon', () => {
    // &#x24D8; was the info/tooltip glyph used for trust-hint and pph tooltip
    expect(financeSrc).not.toContain('&#x24D8;');
  });
});

// ── 5. Margin nudge — trend-up / trend-down semantic names used ───────────────

describe('FinanceScreen.jsx — margin nudge uses Icon components', () => {
  it('references name="trend-up" for the positive nudge icon', () => {
    expect(financeSrc).toContain('name="trend-up"');
  });

  it('references name="trend-down" for the negative nudge icon', () => {
    expect(financeSrc).toContain('name="trend-down"');
  });
});

// ── 6. Empty-state hero — money icon used ────────────────────────────────────

describe('FinanceScreen.jsx — empty-state hero uses money Icon', () => {
  it('renders <Icon name="money" ...> for the full empty state', () => {
    expect(financeSrc).toContain('name="money"');
  });

  it('empty-state money icon uses size=32 (hero size)', () => {
    // The empty-state is the only size=32 usage in FinanceScreen
    expect(financeSrc).toContain('size={32}');
  });

  it('empty-state money icon uses variant="muted" (not brand/success)', () => {
    // Green is earned: an empty state does not earn green — it should be muted
    expect(financeSrc).toContain('variant="muted"');
  });
});

// ── 7. Info icon — trust-hint and tooltip affordances ────────────────────────

describe('FinanceScreen.jsx — info icon used for hint and tooltip', () => {
  it('references name="info" for the info icon', () => {
    expect(financeSrc).toContain('name="info"');
  });
});

// ── 8. Lock icon — Pro badge ──────────────────────────────────────────────────

describe('FinanceScreen.jsx — lock icon used for Pro badge', () => {
  it('references name="lock" for the Pro-locked badge', () => {
    expect(financeSrc).toContain('name="lock"');
  });
});

// ── 9. Chevron-down icon — timeline disclosure ────────────────────────────────

describe('FinanceScreen.jsx — chevron-down Icon used for timeline', () => {
  it('references name="chevron-down" for the timeline collapse toggle', () => {
    expect(financeSrc).toContain('name="chevron-down"');
  });
});

// ── 10. Green-is-earned discipline ───────────────────────────────────────────

describe('FinanceScreen.jsx — green-is-earned colour discipline on Money screen', () => {
  it('trend-up (margin up) uses variant="success" (brand green — genuinely positive)', () => {
    // Improved margin is a genuine money-positive signal → earns brand/success green
    expect(financeSrc).toContain("variant=\"success\"");
  });

  it('trend-down (margin drop) uses variant="danger" (red — money-negative signal)', () => {
    expect(financeSrc).toContain("variant=\"danger\"");
  });

  it('empty-state money icon is muted, not brand (no data = not a positive signal)', () => {
    // Verifies green was not applied to the empty/no-data hero state
    // The money icon with size=32 must have variant="muted"
    expect(financeSrc).toContain('size={32}');
    expect(financeSrc).toMatch(/name="money"[\s\S]{0,60}variant="muted"/);
  });
});
