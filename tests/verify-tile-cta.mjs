/**
 * Visual verification script for tile CTA layout.
 * Uses Playwright to render a static HTML page with the compiled CSS
 * and screenshot the 4 tile states at 375px.
 *
 * Run: node tests/verify-tile-cta.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(__dirname, '../dist/assets/index-D_iHrohl.css');
const compiledCSS = readFileSync(cssPath, 'utf8');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=375, initial-scale=1">
<title>Tile CTA verification</title>
<style>
${compiledCSS}

/* ---- Verification page scaffolding ---- */
body {
  background: #050709;
  margin: 0;
  padding: 24px 16px 48px;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
}
.frame {
  width: 343px;
  margin: 0 auto 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a8b3c0;
  margin-bottom: 4px;
}
</style>
</head>
<body data-theme="dark">

<!-- 1. Lead — single CTA -->
<div class="frame">
  <div class="label">Lead — single CTA (Send quote)</div>
  <div class="jt-card status--lead" style="border-radius:12px;padding:12px 14px;background:#151a1f;border:1px solid #2a333c;border-left:3px solid #3b82f6;">
    <div class="jt-foot">
      <button class="jt-action-btn" type="button">
        <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M16.5 12.694v2.25a1.5 1.5 0 0 1-1.635 1.5 14.843 14.843 0 0 1-6.473-2.302 14.625 14.625 0 0 1-4.5-4.5 14.843 14.843 0 0 1-2.302-6.502A1.5 1.5 0 0 1 3.08 1.5h2.25a1.5 1.5 0 0 1 1.5 1.29c.095.72.272 1.426.525 2.108a1.5 1.5 0 0 1-.337 1.582L6.068 7.43a12 12 0 0 0 4.5 4.5l.952-.952a1.5 1.5 0 0 1 1.583-.337c.682.253 1.388.43 2.108.525A1.5 1.5 0 0 1 16.5 12.694Z"/></svg>
        <span>Call</span>
      </button>
      <button class="jt-action-btn" type="button">
        <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 1C6.24 1 4 3.24 4 6c0 4.25 5 11 5 11s5-6.75 5-11c0-2.76-2.24-5-5-5z"/><circle cx="9" cy="6" r="1.8" fill="currentColor" stroke="none"/></svg>
        <span>Map</span>
      </button>
      <button class="jt-cta" type="button">Send quote</button>
    </div>
  </div>
</div>

<!-- 2. Invoiced active — Chase + Mark paid -->
<div class="frame">
  <div class="label">Invoiced active — Chase payment (urgent) + Mark paid</div>
  <div class="jt-card" style="border-radius:12px;padding:12px 14px;background:#151a1f;border:1px solid #2a333c;border-left:3px solid #28B581;">
    <div class="jt-foot">
      <button class="jt-action-btn" type="button">
        <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M16.5 12.694v2.25a1.5 1.5 0 0 1-1.635 1.5 14.843 14.843 0 0 1-6.473-2.302 14.625 14.625 0 0 1-4.5-4.5 14.843 14.843 0 0 1-2.302-6.502A1.5 1.5 0 0 1 3.08 1.5h2.25a1.5 1.5 0 0 1 1.5 1.29c.095.72.272 1.426.525 2.108a1.5 1.5 0 0 1-.337 1.582L6.068 7.43a12 12 0 0 0 4.5 4.5l.952-.952a1.5 1.5 0 0 1 1.583-.337c.682.253 1.388.43 2.108.525A1.5 1.5 0 0 1 16.5 12.694Z"/></svg>
        <span>Call</span>
      </button>
      <button class="jt-action-btn jt-action-btn--missing" type="button">
        <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 1C6.24 1 4 3.24 4 6c0 4.25 5 11 5 11s5-6.75 5-11c0-2.76-2.24-5-5-5z"/><circle cx="9" cy="6" r="1.8" fill="currentColor" stroke="none"/></svg>
        <span>Map</span>
      </button>
      <div class="jt-cta-pair">
        <button class="jt-cta jt-cta--urgent" type="button">Chase payment</button>
        <button class="jt-cta--markpaid" type="button">Mark paid</button>
      </div>
    </div>
  </div>
</div>

<!-- 3. Invoiced blocked — Chased today (deep red) + Mark paid -->
<div class="frame">
  <div class="label">Invoiced blocked — Chased today (deep-red) + Mark paid</div>
  <div class="jt-card" style="border-radius:12px;padding:12px 14px;background:#151a1f;border:1px solid #2a333c;border-left:3px solid #28B581;">
    <div class="jt-foot">
      <button class="jt-action-btn" type="button">
        <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M16.5 12.694v2.25a1.5 1.5 0 0 1-1.635 1.5 14.843 14.843 0 0 1-6.473-2.302 14.625 14.625 0 0 1-4.5-4.5 14.843 14.843 0 0 1-2.302-6.502A1.5 1.5 0 0 1 3.08 1.5h2.25a1.5 1.5 0 0 1 1.5 1.29c.095.72.272 1.426.525 2.108a1.5 1.5 0 0 1-.337 1.582L6.068 7.43a12 12 0 0 0 4.5 4.5l.952-.952a1.5 1.5 0 0 1 1.583-.337c.682.253 1.388.43 2.108.525A1.5 1.5 0 0 1 16.5 12.694Z"/></svg>
        <span>Call</span>
      </button>
      <button class="jt-action-btn jt-action-btn--missing" type="button">
        <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 1C6.24 1 4 3.24 4 6c0 4.25 5 11 5 11s5-6.75 5-11c0-2.76-2.24-5-5-5z"/><circle cx="9" cy="6" r="1.8" fill="currentColor" stroke="none"/></svg>
        <span>Map</span>
      </button>
      <div class="jt-cta-pair">
        <button class="jt-cta jt-cta--blocked" type="button" disabled>Chased today</button>
        <button class="jt-cta--markpaid" type="button">Mark paid</button>
      </div>
    </div>
  </div>
</div>

<!-- 4. Overdue — Chase payment (urgent) + Mark paid -->
<div class="frame">
  <div class="label">Overdue — Chase payment (urgent) + Mark paid</div>
  <div class="jt-card" style="border-radius:12px;padding:12px 14px;background:#151a1f;border:1px solid #2a333c;border-left:3px solid #E5484D;">
    <div class="jt-foot">
      <button class="jt-action-btn" type="button">
        <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M16.5 12.694v2.25a1.5 1.5 0 0 1-1.635 1.5 14.843 14.843 0 0 1-6.473-2.302 14.625 14.625 0 0 1-4.5-4.5 14.843 14.843 0 0 1-2.302-6.502A1.5 1.5 0 0 1 3.08 1.5h2.25a1.5 1.5 0 0 1 1.5 1.29c.095.72.272 1.426.525 2.108a1.5 1.5 0 0 1-.337 1.582L6.068 7.43a12 12 0 0 0 4.5 4.5l.952-.952a1.5 1.5 0 0 1 1.583-.337c.682.253 1.388.43 2.108.525A1.5 1.5 0 0 1 16.5 12.694Z"/></svg>
        <span>Call</span>
      </button>
      <button class="jt-action-btn jt-action-btn--missing" type="button">
        <svg width="15" height="15" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M9 1C6.24 1 4 3.24 4 6c0 4.25 5 11 5 11s5-6.75 5-11c0-2.76-2.24-5-5-5z"/><circle cx="9" cy="6" r="1.8" fill="currentColor" stroke="none"/></svg>
        <span>Map</span>
      </button>
      <div class="jt-cta-pair">
        <button class="jt-cta jt-cta--urgent" type="button">Chase payment</button>
        <button class="jt-cta--markpaid" type="button">Mark paid</button>
      </div>
    </div>
  </div>
</div>

</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 375, height: 900 });
await page.setContent(html, { waitUntil: 'load' });

// Wait for fonts/styles to settle
await page.waitForTimeout(500);

const screenshotPath = path.join(__dirname, 'screenshots', 'tile-cta-after.png');
await page.screenshot({ path: screenshotPath, fullPage: true });

// Measure button widths to verify alignment
const measurements = await page.evaluate(() => {
  const rows = document.querySelectorAll('.jt-foot');
  return Array.from(rows).map((row, i) => {
    const foot = row.getBoundingClientRect();
    const pair = row.querySelector('.jt-cta-pair');
    const singleCta = row.querySelector('.jt-cta:not(.jt-cta-pair .jt-cta)');
    const actionBtns = row.querySelectorAll('.jt-action-btn');
    return {
      rowIndex: i,
      footWidth: Math.round(foot.width),
      pairWidth: pair ? Math.round(pair.getBoundingClientRect().width) : null,
      singleCtaWidth: singleCta ? Math.round(singleCta.getBoundingClientRect().width) : null,
      actionBtnWidths: Array.from(actionBtns).map(b => Math.round(b.getBoundingClientRect().width)),
    };
  });
});

console.log('\\n=== Layout measurements at 375px ===');
measurements.forEach(m => {
  console.log(`Row ${m.rowIndex}: foot=${m.footWidth}px | actionBtns=${JSON.stringify(m.actionBtnWidths)} | pair=${m.pairWidth}px | singleCta=${m.singleCtaWidth}px`);
});

// Alignment check: all pair widths (rows 1,2,3) and singleCta width (row 0) should be identical
const ctaWidths = measurements.map(m => m.pairWidth ?? m.singleCtaWidth);
const allSame = ctaWidths.every(w => w === ctaWidths[0]);
console.log(`\\nCTA column widths: ${JSON.stringify(ctaWidths)}`);
console.log(`Alignment check: ${allSame ? 'PASS — all CTA columns identical width' : 'FAIL — widths differ!'}`);

await browser.close();
console.log(`\\nScreenshot saved: ${screenshotPath}`);
