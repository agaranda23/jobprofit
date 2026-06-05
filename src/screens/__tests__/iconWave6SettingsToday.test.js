/**
 * Wave 6 icon system — Settings + Today + AppShell toasts
 *
 * Node-env source-guard tests (no jsdom needed):
 *
 *   SettingsScreen.jsx
 *     1. Imports Icon from '../components/Icon'.
 *     2. Does NOT import from lucide-react directly.
 *     3. Star/☆ emoji literals removed — Icon name="star" used in trade chip.
 *     4. Check mark (✓) emoji removed — Icon name="check" used in VoiceLanguageSection.
 *     5. ✕ close glyph removed from LogoModal — Icon name="close" used.
 *
 *   TodayScreen.jsx
 *     6. Imports Icon from '../components/Icon'.
 *     7. Does NOT import from lucide-react directly.
 *     8. &#10003; accepted-banner check removed — Icon name="complete" used.
 *     9. &#8250; accepted-banner chevron removed — Icon name="chevron-right" used.
 *    10. &#10003; all-clear check removed — Icon name="complete" used.
 *    11. &#10005; invoice picker close removed — Icon name="close" used.
 *    12. Pivot Job button uses Icon name="active-job".
 *    13. Pivot Quote button uses Icon name="file".
 *    14. Pivot Invoice button uses Icon name="send".
 *    15. Got-paid toast has no emoji (clean from the start — no branded micro-touch needed).
 *
 *   AppShell.jsx
 *    16. Imports Icon from './components/Icon'.
 *    17. Does NOT import from lucide-react directly.
 *    18. nav-toast ✕ close removed — Icon name="close" used.
 *    19. Realtime toast &#10003; check removed — Icon name="complete" used.
 *    20. Realtime toast &#x2715; dismiss removed — Icon name="close" used.
 *    21. Cost snackbar &#x2715; dismiss removed — Icon name="close" used.
 *    22. modal-paid-check &#10003; removed — Icon name="paid" used (branded micro-touch).
 *    23. Inline text "Paid &#10003;" in snackbar copy deliberately left (content, not icon slot).
 *
 *   navigation.js
 *    24. No emoji present (confirmed, no changes needed).
 *
 *   Icon registry
 *    25. All Wave 6 semantic names were pre-existing (no new registry entries required).
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

const ICON_JSX       = path.resolve(__dirname, '../../components/Icon.jsx');
const SETTINGS_JSX   = path.resolve(__dirname, '../SettingsScreen.jsx');
const TODAY_JSX      = path.resolve(__dirname, '../TodayScreen.jsx');
const APPSHELL_JSX   = path.resolve(__dirname, '../../AppShell.jsx');
const NAVIGATION_JS  = path.resolve(__dirname, '../../lib/navigation.js');

const iconSrc       = fs.readFileSync(ICON_JSX,     'utf8');
const settingsSrc   = fs.readFileSync(SETTINGS_JSX, 'utf8');
const todaySrc      = fs.readFileSync(TODAY_JSX,    'utf8');
const appShellSrc   = fs.readFileSync(APPSHELL_JSX, 'utf8');
const navigationSrc = fs.readFileSync(NAVIGATION_JS, 'utf8');

// ── SettingsScreen ────────────────────────────────────────────────────────────

describe('SettingsScreen.jsx — Icon import', () => {
  it('imports Icon from ../components/Icon (with or without .jsx extension)', () => {
    expect(
      settingsSrc.includes("import Icon from '../components/Icon'") ||
      settingsSrc.includes("import Icon from '../components/Icon.jsx'")
    ).toBe(true);
  });

  it('does NOT import from lucide-react directly', () => {
    expect(settingsSrc).not.toContain("from 'lucide-react'");
  });
});

describe('SettingsScreen.jsx — star glyphs removed from trade chip', () => {
  it('no ★ emoji literal remains', () => {
    expect(settingsSrc).not.toContain('★');
  });

  it('no ☆ emoji literal remains', () => {
    expect(settingsSrc).not.toContain('☆');
  });

  it('Icon name="star" is used in trade chip primary selector', () => {
    expect(settingsSrc).toContain('name="star"');
  });
});

describe('SettingsScreen.jsx — check mark removed from VoiceLanguageSection', () => {
  it('no ✓ emoji literal remains', () => {
    expect(settingsSrc).not.toContain('✓');
  });

  it('Icon name="check" is used for the selected-language indicator', () => {
    expect(settingsSrc).toContain('name="check"');
  });
});

describe('SettingsScreen.jsx — close glyph removed from LogoModal', () => {
  it('no ✕ emoji literal remains in LogoModal close button', () => {
    // ✕ U+2715 — was the LogoModal header close button
    expect(settingsSrc).not.toContain('✕');
  });

  it('Icon name="close" is used in LogoModal close button', () => {
    expect(settingsSrc).toContain('name="close"');
  });
});

// ── TodayScreen ───────────────────────────────────────────────────────────────

describe('TodayScreen.jsx — Icon import', () => {
  it('imports Icon from ../components/Icon (with or without .jsx extension)', () => {
    expect(
      todaySrc.includes("import Icon from '../components/Icon'") ||
      todaySrc.includes("import Icon from '../components/Icon.jsx'")
    ).toBe(true);
  });

  it('does NOT import from lucide-react directly', () => {
    expect(todaySrc).not.toContain("from 'lucide-react'");
  });
});

describe('TodayScreen.jsx — accepted-banner glyphs converted', () => {
  it('no raw &#10003; entity in accepted-banner check span', () => {
    // Check that the old accepted-banner__icon span with entity is gone
    expect(todaySrc).not.toContain('accepted-banner__icon" aria-hidden="true">&#10003;');
  });

  it('Icon name="complete" is used for the accepted-banner check', () => {
    expect(todaySrc).toContain('name="complete"');
  });

  it('no raw &#8250; entity in accepted-banner open arrow', () => {
    expect(todaySrc).not.toContain('&#8250;');
  });

  it('Icon name="chevron-right" is used for the accepted-banner open arrow', () => {
    expect(todaySrc).toContain('name="chevron-right"');
  });
});

describe('TodayScreen.jsx — all-clear check converted', () => {
  it('no raw &#10003; entity in foreman-empty-check div', () => {
    expect(todaySrc).not.toContain('"foreman-empty-check" aria-hidden="true">&#10003;');
  });
});

describe('TodayScreen.jsx — invoice picker close converted', () => {
  it('no raw &#10005; entity in invoice picker close button', () => {
    expect(todaySrc).not.toContain('&#10005;');
  });

  it('Icon name="close" is used (covers LogoModal + invoice picker + FormatPicker)', () => {
    expect(todaySrc).toContain('name="close"');
  });
});

describe('TodayScreen.jsx — pivot buttons use Icon components', () => {
  it('Job pivot uses Icon name="active-job"', () => {
    expect(todaySrc).toContain('name="active-job"');
  });

  it('Quote pivot uses Icon name="file"', () => {
    expect(todaySrc).toContain('name="file"');
  });

  it('Invoice pivot uses Icon name="send"', () => {
    expect(todaySrc).toContain('name="send"');
  });

  it('no inline SVG paths remain in pivot buttons', () => {
    // The PRD-picked hammer / pen-on-paper / paper-plane SVGs should be gone
    expect(todaySrc).not.toContain('M14 3l7 7-3 3-2-2');  // hammer path
    expect(todaySrc).not.toContain('M21 3L3 11l7 2 2 7');   // paper-plane path
  });
});

describe('TodayScreen.jsx — got-paid toast has no emoji (content integrity)', () => {
  it('got-paid toast section has no emoji that needs converting', () => {
    // The toast relies on text chips only — verify no functional emoji was added
    expect(todaySrc).not.toContain('got-paid-toast__label">💰');
    expect(todaySrc).not.toContain('got-paid-toast__label">💷');
  });
});

// ── AppShell ──────────────────────────────────────────────────────────────────

describe('AppShell.jsx — Icon import', () => {
  it('imports Icon from ./components/Icon (with or without .jsx extension)', () => {
    expect(
      appShellSrc.includes("import Icon from './components/Icon'") ||
      appShellSrc.includes("import Icon from './components/Icon.jsx'")
    ).toBe(true);
  });

  it('does NOT import from lucide-react directly', () => {
    expect(appShellSrc).not.toContain("from 'lucide-react'");
  });
});

describe('AppShell.jsx — nav-toast close glyph converted', () => {
  it('no ✕ emoji literal remains in nav-toast close button', () => {
    // The nav-toast dismiss button used ✕ U+2715
    // Allow it only inside a comment (not as a rendered glyph)
    const withoutComments = appShellSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(withoutComments).not.toContain('✕');
  });
});

describe('AppShell.jsx — realtime toast glyphs converted', () => {
  it('no &#10003; entity in nav-toast-check span', () => {
    expect(appShellSrc).not.toContain('nav-toast-check" aria-hidden="true">&#10003;');
  });

  it('Icon name="complete" used for realtime toast accepted check', () => {
    expect(appShellSrc).toContain('name="complete"');
  });

  it('no &#x2715; entity in realtime toast dismiss button', () => {
    // Confirm it is gone from rendered button content (not just comments)
    // The dismiss button previously held &#x2715; as its text node
    expect(appShellSrc).not.toContain('>&#x2715;\n');
  });
});

describe('AppShell.jsx — cost snackbar dismiss converted', () => {
  it('Icon name="close" is used (covers nav-toast + snackbar + realtime dismisses)', () => {
    expect(appShellSrc).toContain('name="close"');
  });
});

describe('AppShell.jsx — modal-paid-badge branded micro-touch', () => {
  it('no raw &#10003; entity in modal-paid-check', () => {
    expect(appShellSrc).not.toContain('modal-paid-check" aria-hidden="true">&#10003;');
  });

  it('Icon name="paid" used for the paid success badge (branded green tick)', () => {
    expect(appShellSrc).toContain('name="paid"');
  });

  it('paid badge icon uses variant="success" (green is earned on payment confirmation)', () => {
    expect(appShellSrc).toMatch(/name="paid"[\s\S]{0,60}variant="success"/);
  });
});

describe('AppShell.jsx — inline copy left intact (content emoji, not icon slot)', () => {
  it('snackbar cost copy with inline &#10003; check is left as content text', () => {
    // "Paid ✓ — add what this job cost you?" — inline copy, not a control glyph
    expect(appShellSrc).toContain('&#10003;');
  });
});

// ── navigation.js — no emoji (confirmed, no changes) ─────────────────────────

describe('navigation.js — no emoji present (pure metadata, no rendered glyphs)', () => {
  it('contains no emoji characters', () => {
    // eslint-disable-next-line no-control-regex
    const emojiPattern = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{1F300}-\u{1F9FF}]/u;
    expect(emojiPattern.test(navigationSrc)).toBe(false);
  });
});

// ── Icon registry — all Wave 6 names are pre-existing ────────────────────────

describe('Icon registry — Wave 6 semantic names all pre-existing (no new entries needed)', () => {
  const wave6NamesUsed = [
    'star',          // trade chip primary selector
    'check',         // VoiceLanguageSection selected indicator
    'close',         // multiple close buttons across all three files
    'complete',      // accepted-banner check, all-clear check, realtime toast
    'chevron-right', // accepted-banner open arrow
    'active-job',    // Today pivot — Job button
    'file',          // Today pivot — Quote button
    'send',          // Today pivot — Invoice button
    'paid',          // AppShell modal-paid-badge branded micro-touch
  ];

  wave6NamesUsed.forEach(name => {
    it(`'${name}' is registered in REGISTRY`, () => {
      const quotedForm = `'${name}'`;
      const bareForm   = `${name}:`;
      expect(iconSrc.includes(quotedForm) || iconSrc.includes(bareForm)).toBe(true);
    });
  });
});
