/**
 * OHNAR re-skin — black-box regression tests
 *
 * Pins the fixes for elements that regressed to solid-black after the
 * re-skin mapped brand colour tokens from green → navy/dark.
 *
 * Root cause: the Vite scaffold global resets `button { background:#1a1a1a }`
 * (nearly black). Any button class without an explicit `background` override
 * inherits this and renders as a black box.
 *
 * Test strategy: read index.css directly and assert each fixed class has an
 * explicit `background` or `background-color` override that is NOT dark.
 * We also assert the "Paid" loop chip uses a green keyframe (not Brand Blue).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CSS_PATH = resolve(__dirname, '../../index.css');
// Normalize to LF: on a Windows checkout with core.autocrlf=true, index.css
// is checked out with CRLF line endings. That extra \r per line was pushing
// the ".snackbar__got-paid-chip:active, .snackbar__got-paid-chip:hover"
// fixed-width slice below (see the 150-char window) just past "var(--ink)"
// — a false failure, not real content drift. CI (Linux) checks the file out
// with LF already, so this is a no-op there.
const css = readFileSync(CSS_PATH, 'utf8').replace(/\r\n/g, '\n');

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Returns the full text of the FIRST CSS rule block for a given selector.
 * Looks for `.selector {` and returns everything up to the matching `}`.
 */
function getRuleBlock(selector) {
  const needle = selector + ' {';
  const start = css.indexOf(needle);
  if (start < 0) return null;
  const braceStart = css.indexOf('{', start);
  let depth = 0;
  let end = braceStart;
  while (end < css.length) {
    if (css[end] === '{') depth++;
    if (css[end] === '}') { depth--; if (depth === 0) break; }
    end++;
  }
  return css.slice(braceStart, end + 1);
}

// ── Referral row — not a black box ───────────────────────────────────────────

describe('referral-row__pill — not a black box', () => {
  it('has a CSS rule block defined', () => {
    expect(css).toContain('.referral-row__pill {');
  });

  it('has an explicit background that is NOT dark (#1a1a1a / #000 / black)', () => {
    const block = getRuleBlock('.referral-row__pill');
    expect(block).toBeTruthy();
    expect(block).toContain('background');
    // Must NOT be the Vite dark default
    expect(block).not.toContain('#1a1a1a');
    expect(block).not.toContain('#000000');
    expect(block).not.toContain(': #000');
  });

  it('has readable text colour (var(--text) or var(--text-dim) — not hard white on black)', () => {
    const block = getRuleBlock('.referral-row__pill');
    expect(block).toContain('color');
  });

  it('has a monospace font family (link field convention)', () => {
    const block = getRuleBlock('.referral-row__pill');
    expect(block).toContain('font-family');
    expect(block).toContain('mono');
  });

  it('has a min-height of at least 36px (touch target)', () => {
    const block = getRuleBlock('.referral-row__pill');
    expect(block).toMatch(/min-height:\s*3[6-9]px|min-height:\s*4[0-9]px/);
  });
});

describe('referral-row__share-btn — not a black box', () => {
  it('has a CSS rule block defined', () => {
    expect(css).toContain('.referral-row__share-btn {');
  });

  it('background is none (ghost icon button)', () => {
    const block = getRuleBlock('.referral-row__share-btn');
    expect(block).toBeTruthy();
    expect(block).toContain('background: none');
  });

  it('has a min-height of at least 44px (WCAG touch target)', () => {
    const block = getRuleBlock('.referral-row__share-btn');
    expect(block).toMatch(/min-height:\s*44px/);
  });
});

// ── Pencil edit button on job amount chip — not a black box ──────────────────

describe('aj-amount-chip-edit — pencil edit button not a black box', () => {
  it('has a CSS rule block defined', () => {
    expect(css).toContain('.aj-amount-chip-edit {');
  });

  it('background is none (icon-only ghost button)', () => {
    const block = getRuleBlock('.aj-amount-chip-edit');
    expect(block).toBeTruthy();
    expect(block).toContain('background: none');
  });

  it('has explicit border: none (no accidental box)', () => {
    const block = getRuleBlock('.aj-amount-chip-edit');
    expect(block).toContain('border: none');
  });

  it('has a min-height for touch target accessibility', () => {
    const block = getRuleBlock('.aj-amount-chip-edit');
    expect(block).toMatch(/min-height:\s*\d+px/);
  });
});

// ── Add-details button — blue tint post re-skin ───────────────────────────────

describe('aj-details-btn — blue tint post re-skin (no green)', () => {
  it('has a CSS rule block defined', () => {
    expect(css).toContain('.aj-details-btn {');
  });

  it('does not use the old green rgba tint in the base rule', () => {
    // The old tint was rgba(34, 197, 94, ...) which is green #22c55e
    const block = getRuleBlock('.aj-details-btn');
    expect(block).not.toContain('rgba(34, 197, 94');
  });

  it('uses the Brand Blue rgba tint in the base rule', () => {
    const block = getRuleBlock('.aj-details-btn');
    // Brand Blue is #2563EB = rgb(37, 99, 235)
    expect(block).toContain('rgba(37, 99, 235');
  });
});

// ── Auth loop — "Paid" chip animates to success green ────────────────────────

describe('auth landing pipeline animates with the jobs-tab stage palette', () => {
  // The pre-login loop (Quote > Signed > Invoiced > Paid) is a travelling "comet": one chip
  // lit at a time in its own jobs-tab stage colour on a 4s loop, replacing the old
  // monochrome-blue pulse. These tests guard the new intent AND its accessibility.

  it('drives the loop with the auth-comet keyframe (old monochrome pulse removed)', () => {
    expect(css).toContain('@keyframes auth-comet');
    expect(css).not.toContain('auth-chip-pulse');
  });

  it('lights each chip in its own jobs-tab stage colour, not a single blue', () => {
    expect(css).toContain('--lit-bg:#0E7490'); // Quote    -> quoted teal
    expect(css).toContain('--lit-bg:#4F46E5'); // Signed   -> on indigo
    expect(css).toContain('--lit-bg:#F59E0B'); // Invoiced -> invoiced amber
    expect(css).toContain('--lit-bg:#15803D'); // Paid     -> paid green
  });

  it('keeps the Paid chip accessible success green (#15803D, 5.02:1 with white, not #16A34A)', () => {
    const idx = css.indexOf('.auth-loop-chip--4 {');
    expect(idx).toBeGreaterThan(-1);
    const rule = css.slice(idx, css.indexOf('}', idx) + 1);
    expect(rule.toLowerCase()).toContain('#15803d');
    expect(rule.toLowerCase()).not.toContain('#16a34a');
  });

  it('gates all chip motion behind prefers-reduced-motion: no-preference', () => {
    const kf = css.indexOf('@keyframes auth-comet');
    expect(kf).toBeGreaterThan(-1);
    // the nearest enclosing @media at/above the keyframe must be the no-preference gate
    const openMedia = css.lastIndexOf('@media (prefers-reduced-motion: no-preference)', kf);
    expect(openMedia).toBeGreaterThan(-1);
  });

  it('reduced-motion falls back to a static, fully-coloured pipeline (no animation)', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.auth-loop-chip { background: var(--lit-bg); color: var(--lit-ink); }');
  });
});

// ── Auth landing — already re-skinned (source fix, not cache) ────────────────

describe('AuthScreen JSX — OHNAR branding already in source', () => {
  it('AuthScreen.jsx uses OhnarWordmark component (lockup, not plain text)', async () => {
    const src = readFileSync(
      resolve(__dirname, '../../components/AuthScreen.jsx'),
      'utf8'
    );
    // Now uses the <OhnarWordmark> component instead of a plain text span
    expect(src).toContain('OhnarWordmark');
    // Should NOT contain the old img tag pointing to jobprofit-logo.png
    expect(src).not.toContain('jobprofit-logo.png');
  });

  it('AuthScreen.jsx h1 wraps OhnarWordmark (O-ring + HNAR), not bare "OHNAR" text', async () => {
    const src = readFileSync(
      resolve(__dirname, '../../components/AuthScreen.jsx'),
      'utf8'
    );
    expect(src).toContain('auth-title');
    expect(src).toContain('<OhnarWordmark');
    expect(src).not.toContain('>JobProfit<');
    // The old plain-text pattern is gone — no bare OHNAR inside a closing tag
    expect(src).not.toContain('<h1 className="auth-title">OHNAR</h1>');
  });

  it('auth-submit button uses var(--accent) — Brand Blue via CSS token', () => {
    const submitIdx = css.indexOf('.auth-submit {');
    expect(submitIdx).toBeGreaterThan(-1);
    const block = css.slice(submitIdx, submitIdx + 300);
    expect(block).toContain('var(--accent)');
  });
});

// ── O mark + wordmark header lockup ──────────────────────────────────────────

describe('OHNAR O mark header lockup — screen headers', () => {
  const screens = [
    ['TodayScreen', resolve(__dirname, '../TodayScreen.jsx')],
    ['WorkScreen',  resolve(__dirname, '../WorkScreen.jsx')],
    ['FinanceScreen', resolve(__dirname, '../FinanceScreen.jsx')],
    ['SettingsScreen', resolve(__dirname, '../SettingsScreen.jsx')],
  ];

  screens.forEach(([name, path]) => {
    describe(name, () => {
      const src = readFileSync(path, 'utf8');

      it('uses OhnarWordmark component (not a bespoke img+span lockup)', () => {
        // Unified: all screen headers now use the <OhnarWordmark> component.
        expect(src).toContain('OhnarWordmark');
        // The old padded asset must be gone from this file.
        expect(src).not.toContain('ohnar-O-transparent-512.png');
        // The old bespoke span class must be gone.
        expect(src).not.toContain('screen-header-logo-o');
        expect(src).not.toContain('screen-header-wordmark');
      });

      it('wraps OhnarWordmark in screen-header-lockup', () => {
        expect(src).toContain('screen-header-lockup');
      });

      it('passes size="30px" so the header lockup renders at a legible ~23px visible height (tight-cropped asset)', () => {
        expect(src).toContain('size="30px"');
      });

      it('does not contain a standalone "HNAR" text node (OhnarWordmark renders it internally)', () => {
        // The bespoke ">HNAR<" span is gone; HNAR is now inside OhnarWordmark.
        expect(src).not.toMatch(/<span[^>]+screen-header-wordmark[^>]*>HNAR</);
      });
    });
  });

  it('HistoryScreen app-brand uses OhnarWordmark (not bespoke img+span)', () => {
    const src = readFileSync(resolve(__dirname, '../HistoryScreen.jsx'), 'utf8');
    expect(src).toContain('OhnarWordmark');
    expect(src).toContain('app-brand');
    // Bespoke lockup elements must be gone.
    expect(src).not.toContain('screen-header-logo-o');
    expect(src).not.toContain('ohnar-O-transparent-512.png');
    expect(src).not.toContain('app-brand-name--ohnar');
  });

  it('AuthScreen uses OhnarWordmark which renders the O-ring + HNAR lockup', () => {
    const src = readFileSync(resolve(__dirname, '../../components/AuthScreen.jsx'), 'utf8');
    // The auth screen now uses <OhnarWordmark> inside the h1 — the
    // OhnarWordmark component itself renders the ohnar-O-tight-512.png img.
    expect(src).toContain('OhnarWordmark');
    expect(src).toContain('auth-title');
    // The old bespoke lockup HTML is gone.
    expect(src).not.toContain('auth-wordmark-lockup');
    expect(src).not.toContain('auth-logo-o');
  });
});

describe('OHNAR O mark CSS — screen-header-lockup token', () => {
  it('defines .screen-header-lockup rule', () => {
    expect(css).toContain('.screen-header-lockup {');
  });

  it('.screen-header-lockup uses inline-flex to sit O and wordmark side by side', () => {
    const idx = css.indexOf('.screen-header-lockup {');
    const block = css.slice(idx, idx + 250);
    expect(block).toContain('inline-flex');
  });

  it('does NOT define .screen-header-logo-o (removed — replaced by OhnarWordmark)', () => {
    // The bespoke fixed-pixel img class is gone; the tight-ring asset scales in em via .ohnar-wm__o.
    expect(css).not.toContain('.screen-header-logo-o {');
  });

  it('does NOT define .screen-header-wordmark (removed — replaced by OhnarWordmark)', () => {
    expect(css).not.toContain('.screen-header-wordmark {');
  });

  it('defines .ohnar-wm__o — the tight-cropped O-ring image class used inside OhnarWordmark', () => {
    // OhnarWordmark uses .ohnar-wm__o; height is 0.78em to match HNAR cap height.
    expect(css).toContain('.ohnar-wm__o {');
    const idx = css.indexOf('.ohnar-wm__o {');
    const block = css.slice(idx, idx + 350);
    // Tight-cropped asset (ohnar-O-tight-512.png) — 0.78em matches HNAR cap height
    expect(block).toContain('height: 0.78em');
  });
});

// ── Deep Navy ink token — Change 2 ───────────────────────────────────────────

describe('Deep Navy ink token — --ink defined in :root', () => {
  it('defines --ink: #0B1320 in :root', () => {
    expect(css).toContain('--ink: #0B1320');
  });
});

describe('Deep Navy ink conversions — opaque text on accent/green buttons', () => {
  // WCAG AA contrast pass (fix/dark-ink-on-blue-contrast-aa): the near-black
  // var(--ink) that these buttons used failed AA on their saturated blue
  // fills (--accent #2563EB in particular). All of them flipped to white
  // ink; three of them (the --jp-green-backed ones) also repointed their
  // fill from --jp-green to --accent, since --jp-green resolves to a lighter
  // blue in dark mode where white text alone wouldn't clear AA either.
  const whiteInkClasses = [
    '.snackbar__add-cost',
    '.nav-toast-add-cost',
    '.ppc-btn-primary',
    '.ppc-chip--active',
    '.photo-lightbox-edit-btn',
    '.visit-invoice-prompt-btn',
    '.modal-paid-check',
  ];

  whiteInkClasses.forEach((cls) => {
    it(`${cls} uses #FFFFFF ink, not var(--ink) / bare #000`, () => {
      const idx = css.indexOf(cls + ' {');
      expect(idx).toBeGreaterThan(-1);
      const block = css.slice(idx, idx + 300);
      expect(block).toMatch(/color:\s*#FFFFFF/i);
      expect(block).not.toContain('var(--ink)');
      // Must not have bare #000 as a colour (allow #000 inside rgba() shadows)
      expect(block).not.toMatch(/color:\s*#000[^a-f0-9]/i);
    });
  });

  it('.wc-day-add-btn uses #FFFFFF ink on var(--accent) fill, not var(--ink) on var(--jp-green)', () => {
    const idx = css.indexOf('.wc-day-add-btn {');
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, idx + 300);
    expect(block).toContain('background: var(--accent)');
    expect(block).toMatch(/color:\s*#FFFFFF/i);
    expect(block).not.toContain('var(--jp-green)');
    expect(block).not.toContain('var(--ink)');
  });

  it('.got-paid-toast__chip:active/:hover uses #FFFFFF ink on var(--accent) fill+border, not var(--ink) on var(--jp-green)', () => {
    const idx = css.indexOf('.got-paid-toast__chip:active');
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, idx + 150);
    expect(block).toContain('var(--accent)');
    expect(block).toMatch(/color:\s*#FFFFFF/i);
    expect(block).not.toContain('var(--jp-green)');
    expect(block).not.toContain('var(--ink)');
  });

  it('.snackbar__got-paid-chip:active/:hover uses #FFFFFF ink on var(--accent) fill+border, not var(--ink) on var(--jp-green)', () => {
    const idx = css.indexOf('.snackbar__got-paid-chip:active');
    expect(idx).toBeGreaterThan(-1);
    // Wider than the sibling checks above — this selector is combined with
    // its own :hover rule (".snackbar__got-paid-chip:active,\n
    // .snackbar__got-paid-chip:hover {"), which eats more of a 150-char
    // window than a single-selector rule does before reaching `color:`.
    const block = css.slice(idx, idx + 250);
    expect(block).toContain('var(--accent)');
    expect(block).toMatch(/color:\s*#FFFFFF/i);
    expect(block).not.toContain('var(--jp-green)');
    expect(block).not.toContain('var(--ink)');
  });
});

describe('Deep Navy ink — rgba fills/borders use 11,19,32 not 0,0,0 where converted', () => {
  it('--cf-track-bg uses rgba(11, 19, 32, ...) not rgba(0, 0, 0, ...)', () => {
    const idx = css.indexOf('--cf-track-bg');
    expect(idx).toBeGreaterThan(-1);
    const chunk = css.slice(idx, idx + 60);
    expect(chunk).toContain('11, 19, 32');
    expect(chunk).not.toContain('0, 0, 0');
  });

  it('--avatar-border uses rgba(11, 19, 32, ...) not rgba(0, 0, 0, ...)', () => {
    const idx = css.indexOf('--avatar-border:');
    expect(idx).toBeGreaterThan(-1);
    const chunk = css.slice(idx, idx + 60);
    expect(chunk).toContain('11, 19, 32');
  });

  it('[data-theme=light] .pro-gate__lock-badge uses rgba(11, 19, 32, ...)', () => {
    const idx = css.indexOf('[data-theme="light"] .pro-gate__lock-badge {');
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, idx + 120);
    expect(block).toContain('11, 19, 32');
  });

  it('[data-theme=light] .stage-timeline__dot uses rgba(11, 19, 32, ...)', () => {
    const idx = css.indexOf('[data-theme="light"] .stage-timeline__dot {');
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, idx + 150);
    expect(block).toContain('11, 19, 32');
  });
});

describe('Deep Navy ink — shadows/overlays/scrims left black (kept)', () => {
  const keptBlackScrims = [
    '.modal-backdrop',
    '.drawer-backdrop',
    '.photo-lightbox-backdrop',
    '.jd-pbs-backdrop',
  ];

  keptBlackScrims.forEach((cls) => {
    it(`${cls} still uses rgba(0,0,*) black scrim (not converted)`, () => {
      const idx = css.indexOf(cls + ' {');
      if (idx < 0) return; // skip if class renamed in future
      const block = css.slice(idx, idx + 200);
      expect(block).toMatch(/rgba\(0,\s*0,\s*0,/);
    });
  });

  it('--shadow-xs keeps black shadow (not converted to navy)', () => {
    const idx = css.indexOf('--shadow-xs:');
    expect(idx).toBeGreaterThan(-1);
    const chunk = css.slice(idx, idx + 60);
    expect(chunk).toContain('rgba(0,0,0,');
  });
});

describe('Deep Navy ink — SignaturePad canvas stroke is Deep Navy', () => {
  it('SignaturePad.jsx init uses #0B1320 not #000 for strokeStyle', () => {
    const src = readFileSync(
      resolve(__dirname, '../../components/SignaturePad.jsx'),
      'utf8'
    );
    const occurrences = (src.match(/#0B1320/gi) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2); // init + draw handler
    expect(src).not.toContain("strokeStyle = '#000'");
  });
});

describe('Primary text ink — jsPDF DARK constant is visible navy [30,58,95] (#1E3A5F)', () => {
  it('invoicePDF.js DARK constant is [30, 58, 95] (visible navy #1E3A5F)', () => {
    const src = readFileSync(
      resolve(__dirname, '../../lib/invoicePDF.js'),
      'utf8'
    );
    expect(src).toContain('DARK          = [30, 58, 95]');
  });

  it('receiptPDF.js DARK constant is [30, 58, 95] (visible navy #1E3A5F)', () => {
    const src = readFileSync(
      resolve(__dirname, '../../lib/receiptPDF.js'),
      'utf8'
    );
    expect(src).toContain('DARK          = [30, 58, 95]');
  });
});
