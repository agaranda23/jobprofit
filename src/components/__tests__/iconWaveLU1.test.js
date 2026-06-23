/**
 * JP-LU1 icon wave — finish emoji → Lucide on user-facing surfaces
 *
 * Node-env tests (no jsdom):
 *
 *   1. Icon.jsx registry: new LU1 semantic names registered + lucide imports present.
 *   2. SendInvoiceModal.jsx: 💬 replaced with <Icon name="send">, Icon imported.
 *   3. AwaitingCard.jsx: 💵 💷 💳 replaced with <Icon>, Icon imported.
 *   4. ExportFormatSheet.jsx: {opt.icon} rendered via <Icon>, Icon imported.
 *   5. AppShell.jsx: export sheet option icons use semantic strings not emoji.
 *   6. SettingsScreen.jsx: export sheet option icons use semantic strings not emoji.
 *   7. AuthScreen.jsx: ✉️ replaced with <Icon name="email">, Icon imported.
 *   8. HistoryScreen.jsx: 📊 replaced with <Icon name="bar-chart">, Icon imported.
 *   9. Out-of-scope files (whatsNew.js, quoteMessage.js, invoiceMessage.js) untouched.
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

const ICON_JSX         = path.resolve(__dirname, '../Icon.jsx');
const SEND_INVOICE_JSX = path.resolve(__dirname, '../SendInvoiceModal.jsx');
const AWAITING_JSX     = path.resolve(__dirname, '../AwaitingCard.jsx');
const EXPORT_SHEET_JSX = path.resolve(__dirname, '../ExportFormatSheet.jsx');
const APPSHELL_JSX     = path.resolve(__dirname, '../../AppShell.jsx');
const SETTINGS_JSX     = path.resolve(__dirname, '../../screens/SettingsScreen.jsx');
const AUTH_JSX         = path.resolve(__dirname, '../AuthScreen.jsx');
const HISTORY_JSX      = path.resolve(__dirname, '../../screens/HistoryScreen.jsx');
const QUOTE_MSG        = path.resolve(__dirname, '../../lib/quoteMessage.js');
const INV_MSG          = path.resolve(__dirname, '../../lib/invoiceMessage.js');

const iconSrc       = fs.readFileSync(ICON_JSX,         'utf8');
const sendInvSrc    = fs.readFileSync(SEND_INVOICE_JSX, 'utf8');
const awaitingSrc   = fs.readFileSync(AWAITING_JSX,     'utf8');
const exportSheetSrc= fs.readFileSync(EXPORT_SHEET_JSX, 'utf8');
const appShellSrc   = fs.readFileSync(APPSHELL_JSX,     'utf8');
const settingsSrc   = fs.readFileSync(SETTINGS_JSX,     'utf8');
const authSrc       = fs.readFileSync(AUTH_JSX,         'utf8');
const historySrc    = fs.readFileSync(HISTORY_JSX,      'utf8');
const quoteMsgSrc   = fs.readFileSync(QUOTE_MSG,        'utf8');
const invMsgSrc     = fs.readFileSync(INV_MSG,          'utf8');

// Strip JS comments before emoji checks so codepoints in comments don't false-positive
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

// ── 1. Icon.jsx — new registry entries + lucide imports ──────────────────────

describe('Icon registry — LU1 new entries present', () => {
  it('imports FileSpreadsheet from lucide-react', () => {
    expect(iconSrc).toContain('FileSpreadsheet');
  });

  it('imports CreditCard from lucide-react', () => {
    expect(iconSrc).toContain('CreditCard');
  });

  it('registry contains "file-spreadsheet"', () => {
    expect(iconSrc).toMatch(/'file-spreadsheet'\s*:/);
  });

  it('registry contains "credit-card"', () => {
    expect(iconSrc).toMatch(/'credit-card'\s*:/);
  });

  it('"file-spreadsheet" maps to FileSpreadsheet', () => {
    expect(iconSrc).toMatch(/'file-spreadsheet'\s*:\s*FileSpreadsheet/);
  });

  it('"credit-card" maps to CreditCard', () => {
    expect(iconSrc).toMatch(/'credit-card'\s*:\s*CreditCard/);
  });

  // Pre-existing entries required by LU1 call sites
  it('registry still contains "send"',      () => { expect(iconSrc).toMatch(/\bsend\s*:/); });
  it('registry still contains "price"',     () => { expect(iconSrc).toMatch(/\bprice\s*:/); });
  it('registry still contains "paid"',      () => { expect(iconSrc).toMatch(/\bpaid\s*:/); });
  it('registry still contains "email"',     () => { expect(iconSrc).toMatch(/\bemail\s*:/); });
  it('registry still contains "bar-chart"', () => { expect(iconSrc).toMatch(/'bar-chart'\s*:/); });
  it('registry still contains "pdf"',       () => { expect(iconSrc).toMatch(/\bpdf\s*:/); });
});

// ── 2. SendInvoiceModal — 💬 replaced, Icon imported ────────────────────────

describe('SendInvoiceModal — 💬 emoji replaced with <Icon name="send">', () => {
  it('imports Icon', () => {
    expect(sendInvSrc).toContain("import Icon from './Icon'");
  });

  it('uses <Icon name="send"> for the primary CTA', () => {
    expect(sendInvSrc).toContain('name="send"');
  });

  it('does not contain raw 💬 emoji in render path', () => {
    expect(stripComments(sendInvSrc)).not.toContain('💬');
  });
});

// ── 3. AwaitingCard — 💵 💷 💳 replaced, Icon imported ───────────────────────

describe('AwaitingCard — payment-method emoji replaced with <Icon>', () => {
  it('imports Icon', () => {
    expect(awaitingSrc).toContain("import Icon from './Icon'");
  });

  it('uses <Icon name="credit-card"> for Bank / Card buttons', () => {
    const matches = awaitingSrc.match(/name="credit-card"/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('uses <Icon name="price"> for Cash button', () => {
    expect(awaitingSrc).toContain('name="price"');
  });

  it('uses <Icon name="paid"> for Mark Paid button', () => {
    expect(awaitingSrc).toContain('name="paid"');
  });

  it('does not contain raw 💵 emoji in render path', () => {
    expect(stripComments(awaitingSrc)).not.toContain('💵');
  });

  it('does not contain raw 💷 emoji in render path', () => {
    expect(stripComments(awaitingSrc)).not.toContain('💷');
  });

  it('does not contain raw 💳 emoji in render path', () => {
    expect(stripComments(awaitingSrc)).not.toContain('💳');
  });
});

// ── 4. ExportFormatSheet — renders via <Icon>, not raw {opt.icon} string ─────

describe('ExportFormatSheet — icon rendered via <Icon name={opt.icon}>', () => {
  it('imports Icon', () => {
    expect(exportSheetSrc).toContain("import Icon from './Icon'");
  });

  it('uses <Icon name={opt.icon}> to render option icons', () => {
    expect(exportSheetSrc).toContain('name={opt.icon}');
  });
});

// ── 5. AppShell — export sheet icon values are semantic strings not emoji ─────

describe('AppShell — export format sheet icon values are semantic strings', () => {
  it('uses "bar-chart" for CSV option icon', () => {
    expect(appShellSrc).toContain("icon: 'bar-chart'");
  });

  it('uses "file-spreadsheet" for XLSX option icon', () => {
    expect(appShellSrc).toContain("icon: 'file-spreadsheet'");
  });

  it('uses "pdf" for PDF option icon', () => {
    expect(appShellSrc).toContain("icon: 'pdf'");
  });

  it('does not contain 📊 emoji as an export icon value', () => {
    expect(stripComments(appShellSrc)).not.toMatch(/icon:\s*'📊'/);
  });

  it('does not contain 📗 emoji as an export icon value', () => {
    expect(stripComments(appShellSrc)).not.toMatch(/icon:\s*'📗'/);
  });

  it('does not contain 📄 emoji as an export icon value', () => {
    expect(stripComments(appShellSrc)).not.toMatch(/icon:\s*'📄'/);
  });
});

// ── 6. SettingsScreen — export sheet icon values are semantic strings ─────────

describe('SettingsScreen — export format sheet icon values are semantic strings', () => {
  it('uses "bar-chart" for CSV option icon', () => {
    expect(settingsSrc).toContain("icon: 'bar-chart'");
  });

  it('uses "file-spreadsheet" for XLSX option icon', () => {
    expect(settingsSrc).toContain("icon: 'file-spreadsheet'");
  });

  it('uses "pdf" for PDF option icon (in export options)', () => {
    expect(settingsSrc).toContain("icon: 'pdf'");
  });

  it('does not contain 📊 as an export icon value', () => {
    expect(stripComments(settingsSrc)).not.toMatch(/icon:\s*'📊'/);
  });

  it('does not contain 📗 as an export icon value', () => {
    expect(stripComments(settingsSrc)).not.toMatch(/icon:\s*'📗'/);
  });

  it('does not contain 📄 as an export icon value', () => {
    expect(stripComments(settingsSrc)).not.toMatch(/icon:\s*'📄'/);
  });
});

// ── 7. AuthScreen — ✉️ replaced with <Icon name="email"> ─────────────────────

describe('AuthScreen — ✉️ replaced with <Icon name="email">', () => {
  it('imports Icon', () => {
    expect(authSrc).toContain("import Icon from './Icon'");
  });

  it('uses <Icon name="email"> in auth-sent-icon', () => {
    expect(authSrc).toContain('name="email"');
  });

  it('does not contain raw ✉️ emoji in render path', () => {
    expect(stripComments(authSrc)).not.toContain('✉️');
  });
});

// ── 8. HistoryScreen — 📊 replaced with <Icon name="bar-chart"> ──────────────

describe('HistoryScreen — 📊 replaced with <Icon name="bar-chart">', () => {
  it('imports Icon', () => {
    expect(historySrc).toContain("import Icon from '../components/Icon'");
  });

  it('uses <Icon name="bar-chart"> for empty-state icon', () => {
    expect(historySrc).toContain('name="bar-chart"');
  });

  it('does not contain raw 📊 emoji in render path', () => {
    expect(stripComments(historySrc)).not.toContain('📊');
  });
});

// ── 9. Out-of-scope files — emoji preserved (not stripped) ───────────────────

describe('Out-of-scope files — emoji not touched', () => {
  it('quoteMessage.js does not import Icon', () => {
    expect(quoteMsgSrc).not.toContain('import Icon');
  });

  it('invoiceMessage.js does not import Icon', () => {
    expect(invMsgSrc).not.toContain('import Icon');
  });
});
