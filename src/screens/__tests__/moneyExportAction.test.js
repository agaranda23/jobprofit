/**
 * Money tab export action — source-guard + handler tests.
 *
 * No @testing-library/react. Tests split into two layers:
 *
 *   Layer 1 (node-env): source text guards confirming the export wiring was not
 *   reverted — same pattern as iconWave5Money.test.js. Runs in CI in milliseconds.
 *
 *   Layer 2 (pure-function): exercises the CSV-build path the handler delegates
 *   to, so any breakage in buildJobsCsv or downloadOrShareCsv signature is caught
 *   before a deploy preview is needed. Reuses the same fixtures as exportCsv.test.js
 *   to avoid fixture drift.
 *
 * Component render tests live in screenSmoke.test.jsx.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const FINANCE_JSX  = path.resolve(__dirname, '../FinanceScreen.jsx');
const APPSHELL_JSX = path.resolve(__dirname, '../../AppShell.jsx');

const financeSrc  = fs.readFileSync(FINANCE_JSX,  'utf8');
const appshellSrc = fs.readFileSync(APPSHELL_JSX, 'utf8');

// ── Layer 1: Source-guard tests ───────────────────────────────────────────────

describe('FinanceScreen — onExport prop wiring', () => {
  it('accepts onExport in the component signature', () => {
    expect(financeSrc).toContain('onExport');
  });

  it('renders the accountant-tools card only when onExport is provided', () => {
    // Guard: the card is conditional on `onExport &&`
    expect(financeSrc).toMatch(/onExport\s*&&/);
  });

  it('renders an Export for your accountant button label', () => {
    expect(financeSrc).toContain('Export for your accountant (CSV)');
  });

  it('uses <Icon name="download"> not a raw emoji for the button icon', () => {
    expect(financeSrc).toContain('name="download"');
    // No download emoji should appear in this file
    expect(financeSrc).not.toContain('⬇'); // ⬇ emoji
    expect(financeSrc).not.toContain('&#x2B07;');
  });

  it('has no isPro gate on the export button', () => {
    // Confirm the accountant-tools card block does not wrap in ProGate.
    // The card sits between the UpgradeBanner and the Pay-now banner (position 2b).
    // Boundary: end of the onExport && block — the next unique landmark is
    // "4. True Profit" comment that immediately follows the closing )} of the card.
    const toolsBlockStart = financeSrc.indexOf('money-accountant-tools');
    const toolsBlockEnd   = financeSrc.indexOf('4. True Profit', toolsBlockStart);
    const toolsBlock = toolsBlockStart !== -1 && toolsBlockEnd !== -1
      ? financeSrc.slice(toolsBlockStart, toolsBlockEnd)
      : '';
    expect(toolsBlock).not.toContain('ProGate');
    expect(toolsBlock).not.toContain('isPro');
  });

  it('calls handleMoneyExport onClick — handler is defined', () => {
    expect(financeSrc).toContain('handleMoneyExport');
    expect(financeSrc).toContain('onClick={handleMoneyExport}');
  });

  it('handler delegates to onExport prop', () => {
    expect(financeSrc).toContain("await onExport?.('records')");
  });

  it('button has disabled state during export (aria-busy)', () => {
    expect(financeSrc).toContain('disabled={exporting}');
    expect(financeSrc).toContain('aria-busy={exporting}');
  });

  it('includes a hint about what the CSV contains', () => {
    expect(financeSrc).toContain('Excel or Google Sheets');
  });

  it('has a seam comment for the future Pro insight-export', () => {
    // The seam comment must reference the Pro Profit & tax summary export
    expect(financeSrc).toContain('Profit & tax summary');
    // And it must call out the two migration dependencies
    expect(financeSrc).toContain('overheads');
    expect(financeSrc).toContain('tax_set_aside_pct');
  });
});

describe('AppShell — handleExportFromMoney wiring', () => {
  it('imports buildJobsCsv from ./lib/exportCsv', () => {
    expect(appshellSrc).toContain("from './lib/exportCsv'");
    expect(appshellSrc).toContain('buildJobsCsv');
  });

  it('imports downloadOrShareCsv from ./lib/exportCsv', () => {
    expect(appshellSrc).toContain('downloadOrShareCsv');
  });

  it('defines handleExportFromMoney handler', () => {
    expect(appshellSrc).toContain('handleExportFromMoney');
  });

  it('passes onExport to the finance view FinanceScreen', () => {
    // The finance view (NAV_SLICE_3 / view=finance) must receive onExport
    expect(appshellSrc).toContain('onExport={handleExportFromMoney}');
  });

  it('handleExportFromMoney has no isPro() gate (free export, GDPR-safe)', () => {
    // Tight slice: only handleExportFromMoney (opens the format sheet).
    // handleMoneyExportFormatPick starts immediately after and is tested separately.
    const handlerStart = appshellSrc.indexOf('handleExportFromMoney');
    const handlerEnd   = appshellSrc.indexOf('handleMoneyExportFormatPick', handlerStart);
    const handlerBody  = handlerStart !== -1 && handlerEnd !== -1
      ? appshellSrc.slice(handlerStart, handlerEnd)
      : '';
    // isPro() must not appear in the opener — it just shows the format sheet.
    expect(handlerBody).not.toMatch(/isPro\s*\(/);
    expect(handlerBody).not.toContain('ProGate');
  });

  it('handleMoneyExportFormatPick uses isPro for PDF branding, not as an access gate', () => {
    // Since the PDF export branch (feat/money-tab-pdf-export) was merged, the
    // format-picker handler passes isPro(profile) to buildJobsPdf for watermarking /
    // branding — this is intentional, not a paywall. Verify it is present and that
    // the handler does NOT gate format access behind an isPro() conditional.
    const handlerStart = appshellSrc.indexOf('handleMoneyExportFormatPick');
    const handlerEnd   = appshellSrc.indexOf('const openDetailed', handlerStart);
    const handlerBody  = handlerStart !== -1 && handlerEnd !== -1
      ? appshellSrc.slice(handlerStart, handlerEnd)
      : '';
    // isPro(profile) present — used as metadata passed to buildJobsPdf, not a gate.
    expect(handlerBody).toMatch(/isPro\s*\(/);
    // Must NOT gate any format behind isPro — all formats are free.
    expect(handlerBody).not.toMatch(/isPro\s*\(.*\)\s*&&\s*(?:format|build|download)/);
    expect(handlerBody).not.toMatch(/if\s*\(\s*!?\s*isPro/);
    expect(handlerBody).not.toContain('ProGate');
  });

  it('handler uses buildJobsCsv (jobs-ledger-only, not buildEverythingCsv)', () => {
    // Wide slice covers both handlers — buildJobsCsv lives in handleMoneyExportFormatPick.
    const handlerStart = appshellSrc.indexOf('handleExportFromMoney');
    const handlerEnd   = appshellSrc.indexOf('const openDetailed', handlerStart);
    const handlerBody  = handlerStart !== -1 && handlerEnd !== -1
      ? appshellSrc.slice(handlerStart, handlerEnd)
      : '';
    expect(handlerBody).toContain('buildJobsCsv');
    expect(handlerBody).not.toContain('buildEverythingCsv');
  });
});

// ── Layer 2: Pure-function handler path ───────────────────────────────────────
// Exercises buildJobsCsv (the exact function the Money export handler calls)
// to confirm the output is a non-empty CSV string. These tests catch signature
// or output-format regressions independently of the UI.

import { buildJobsCsv } from '../../lib/exportCsv.js';

describe('Money export handler path — buildJobsCsv output', () => {
  function makeJob(overrides = {}) {
    return {
      id: 'money-j1',
      date: '2026-06-13',
      customer: 'Flat 4 Jones',
      summary: 'Bathroom retile',
      amount: 850,
      total: 850,
      paid: true,
      paymentDate: '2026-06-13',
      ...overrides,
    };
  }

  function makeReceipt(overrides = {}) {
    return {
      id: 'money-r1',
      jobId: 'money-j1',
      amount: 120,
      date: '2026-06-12',
      ...overrides,
    };
  }

  it('returns a non-empty string for a single job', () => {
    const csv = buildJobsCsv([makeJob()], []);
    expect(typeof csv).toBe('string');
    expect(csv.length).toBeGreaterThan(0);
  });

  it('first line is the header row', () => {
    const csv = buildJobsCsv([makeJob()], []);
    const firstLine = csv.split('\n')[0];
    expect(firstLine).toContain('Date');
    expect(firstLine).toContain('Customer');
    expect(firstLine).toContain('Profit');
  });

  it('profit = invoiced - costs (the headline metric)', () => {
    const csv = buildJobsCsv([makeJob()], [makeReceipt()]);
    const dataLine = csv.split('\n')[1];
    // invoiced=850, costs=120, profit=730
    expect(dataLine).toContain('850.00');
    expect(dataLine).toContain('120.00');
    expect(dataLine).toContain('730.00');
  });

  it('returns just a header for an empty jobs array', () => {
    const csv = buildJobsCsv([], []);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(1); // header only
  });

  it('is null-safe: null inputs produce a header-only CSV without throwing', () => {
    expect(() => buildJobsCsv(null, null)).not.toThrow();
    const csv = buildJobsCsv(null, null);
    expect(csv.trim().split('\n').length).toBe(1);
  });
});
