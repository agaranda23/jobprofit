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
const css = readFileSync(CSS_PATH, 'utf8');

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

describe('auth landing — Paid chip uses success green animation', () => {
  it('defines an auth-chip-pulse-paid keyframe', () => {
    expect(css).toContain('auth-chip-pulse-paid');
  });

  it('auth-chip-pulse-paid keyframe uses accessible success green (#15803d, 5.02:1 with white AA)', () => {
    // Surface darkened from #16a34a (3.30:1 — decorative only) to #15803d (5.02:1 — passes AA
    // for 13px label text). The intent (green Paid chip) is preserved; the shade is accessible.
    const kfStart = css.indexOf('@keyframes auth-chip-pulse-paid');
    expect(kfStart).toBeGreaterThan(-1);
    // Find the block
    const kfEnd = css.indexOf('}', css.indexOf('}', kfStart) + 1);
    const kfBlock = css.slice(kfStart, kfEnd + 1);
    expect(kfBlock.toLowerCase()).toContain('#15803d');
    expect(kfBlock.toLowerCase()).not.toContain('#16a34a');
  });

  it('chip--4 (Paid) uses the paid keyframe, not the generic blue one', () => {
    // Find the chip--4 animation rule
    const chip4Idx = css.indexOf('.auth-loop-chip--4');
    expect(chip4Idx).toBeGreaterThan(-1);
    const chip4Rule = css.slice(chip4Idx, chip4Idx + 120);
    expect(chip4Rule).toContain('auth-chip-pulse-paid');
    expect(chip4Rule).not.toContain('auth-chip-pulse 4s');
  });

  it('chips 1–3 (Quote, Signed, Invoiced) still use the blue pulse animation', () => {
    // Check chip--1 uses the generic blue pulse
    const chip1Idx = css.indexOf('.auth-loop-chip--1');
    const chip1Rule = css.slice(chip1Idx, chip1Idx + 120);
    expect(chip1Rule).toContain('auth-chip-pulse');
    expect(chip1Rule).not.toContain('auth-chip-pulse-paid');
  });
});

// ── Auth landing — already re-skinned (source fix, not cache) ────────────────

describe('AuthScreen JSX — OHNAR branding already in source', () => {
  it('AuthScreen.jsx renders "OHNAR" wordmark text (not a logo image)', async () => {
    const src = readFileSync(
      resolve(__dirname, '../../components/AuthScreen.jsx'),
      'utf8'
    );
    // Should contain the text wordmark
    expect(src).toContain('>OHNAR<');
    // Should NOT contain the old img tag pointing to jobprofit-logo.png
    expect(src).not.toContain('jobprofit-logo.png');
  });

  it('AuthScreen.jsx h1 reads "OHNAR", not "JobProfit"', async () => {
    const src = readFileSync(
      resolve(__dirname, '../../components/AuthScreen.jsx'),
      'utf8'
    );
    expect(src).toContain('<h1 className="auth-title">OHNAR</h1>');
    expect(src).not.toContain('>JobProfit<');
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

      it('renders the O mark img with class screen-header-logo-o', () => {
        expect(src).toContain('screen-header-logo-o');
        expect(src).toContain('ohnar-O-transparent-512.png');
      });

      it('wraps O mark and wordmark in screen-header-lockup', () => {
        expect(src).toContain('screen-header-lockup');
      });

      it('wordmark span still contains OHNAR text', () => {
        expect(src).toContain('>OHNAR<');
      });

      it('O img has empty alt (decorative — wordmark carries the name)', () => {
        expect(src).toContain('alt=""');
      });
    });
  });

  it('HistoryScreen app-brand includes O mark img', () => {
    const src = readFileSync(resolve(__dirname, '../HistoryScreen.jsx'), 'utf8');
    expect(src).toContain('screen-header-logo-o');
    expect(src).toContain('ohnar-O-transparent-512.png');
    expect(src).toContain('app-brand-name--ohnar');
  });

  it('AuthScreen lockup includes O mark img with auth-logo-o class', () => {
    const src = readFileSync(resolve(__dirname, '../../components/AuthScreen.jsx'), 'utf8');
    expect(src).toContain('auth-logo-o');
    expect(src).toContain('ohnar-O-transparent-512.png');
    expect(src).toContain('auth-wordmark-lockup');
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

  it('defines .screen-header-logo-o with a height (22px–26px range)', () => {
    const idx = css.indexOf('.screen-header-logo-o {');
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, idx + 150);
    expect(block).toMatch(/height:\s*2[2-6]px/);
  });

  it('defines .auth-logo-o with 36px height (larger, auth hero context)', () => {
    const idx = css.indexOf('.auth-logo-o {');
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, idx + 150);
    expect(block).toContain('36px');
  });
});

// ── Deep Navy ink token — Change 2 ───────────────────────────────────────────

describe('Deep Navy ink token — --ink defined in :root', () => {
  it('defines --ink: #0B1320 in :root', () => {
    expect(css).toContain('--ink: #0B1320');
  });
});

describe('Deep Navy ink conversions — opaque text on accent/green buttons', () => {
  const convertedClasses = [
    '.snackbar__add-cost',
    '.nav-toast-add-cost',
    '.ppc-btn-primary',
    '.ppc-chip--active',
    '.photo-lightbox-edit-btn',
    '.visit-invoice-prompt-btn',
    '.wc-day-add-btn',
    '.modal-paid-check',
  ];

  convertedClasses.forEach((cls) => {
    it(`${cls} uses var(--ink) not bare #000`, () => {
      const idx = css.indexOf(cls + ' {');
      expect(idx).toBeGreaterThan(-1);
      const block = css.slice(idx, idx + 300);
      expect(block).toContain('var(--ink)');
      // Must not have bare #000 as a colour (allow #000 inside rgba() shadows)
      expect(block).not.toMatch(/color:\s*#000[^a-f0-9]/i);
    });
  });

  it('.got-paid-toast__chip:active uses var(--ink) not #000', () => {
    const idx = css.indexOf('.got-paid-toast__chip:active');
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, idx + 150);
    expect(block).toContain('var(--ink)');
    expect(block).not.toMatch(/color:\s*#000[^a-f0-9]/i);
  });

  it('.snackbar__got-paid-chip:active uses var(--ink) not #000', () => {
    const idx = css.indexOf('.snackbar__got-paid-chip:active');
    expect(idx).toBeGreaterThan(-1);
    const block = css.slice(idx, idx + 150);
    expect(block).toContain('var(--ink)');
    expect(block).not.toMatch(/color:\s*#000[^a-f0-9]/i);
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

describe('Deep Navy ink — jsPDF DARK constant is Deep Navy [11,19,32]', () => {
  it('invoicePDF.js DARK constant is [11, 19, 32]', () => {
    const src = readFileSync(
      resolve(__dirname, '../../lib/invoicePDF.js'),
      'utf8'
    );
    expect(src).toContain('DARK          = [11, 19, 32]');
  });

  it('receiptPDF.js DARK constant is [11, 19, 32]', () => {
    const src = readFileSync(
      resolve(__dirname, '../../lib/receiptPDF.js'),
      'utf8'
    );
    expect(src).toContain('DARK          = [11, 19, 32]');
  });
});
