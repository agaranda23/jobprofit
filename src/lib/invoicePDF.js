import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { resolveCisStatus } from './cashflow.js';
import { splitVatInclusive } from './vatUtils.js';
import { downscaleDataUrl } from './photoCompress.js';
import { formatToday } from './today.js';
import { secureImageUrl } from './secureImageUrl.js';

// Generates an invoice PDF for the new Get Paid workflow. Distinct from
// the legacy generateInvoicePDF in App.jsx (which uses window.jspdf and
// the old `invoices` collection). This one reads everything from the job
// itself plus the structured biz fields added in PRD #2.

// ── Hanken Grotesk font registration ─────────────────────────────────────────
// Dynamic-import keeps the base64 font blob (~37 KB) out of the main app bundle.
// The promise is cached after the first call so subsequent PDF generations pay
// zero additional load cost. jsPDF requires static TTF (not woff2/variable).
// Source: @fontsource/hanken-grotesk latin subset via fonttools TTF conversion.
let _hankenFontPromise = null;

async function registerHankenFont(doc) {
  if (!_hankenFontPromise) {
    _hankenFontPromise = import('./hankenGroteskFont.js');
  }
  const { hankenGroteskRegularB64, hankenGroteskBoldB64 } = await _hankenFontPromise;
  doc.addFileToVFS('HankenGrotesk-Regular.ttf', hankenGroteskRegularB64);
  doc.addFont('HankenGrotesk-Regular.ttf', 'HankenGrotesk', 'normal');
  doc.addFileToVFS('HankenGrotesk-Bold.ttf', hankenGroteskBoldB64);
  doc.addFont('HankenGrotesk-Bold.ttf', 'HankenGrotesk', 'bold');
}


// ── Brand tokens ────────────────────────────────────────────────────────────
const BRAND_GREEN   = [37, 99, 235];   // #2563eb — OHNAR brand blue
const DARK          = [30, 58, 95];    // #1E3A5F visible-navy — headings and body text
const MID           = [80, 80, 80];    // secondary labels, address lines
const LIGHT         = [150, 150, 150]; // muted labels (BILL TO, INVOICE etc.)
const RULE          = [220, 220, 220]; // hairline separator

// ── Shared layout constants ──────────────────────────────────────────────────
const MARGIN        = 14;             // left/right margin (mm)
const PAGE_H        = 297;            // A4 height
const HEADER_LOGO_W = 28;
const HEADER_LOGO_H = 28;

// ── helpers ──────────────────────────────────────────────────────────────────

/** Draw a full-width horizontal hairline at y. */
function rule(doc, y) {
  const w = doc.internal.pageSize.getWidth();
  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, w - MARGIN, y);
}

/**
 * Normalises a logo URL / data-URL from the biz object.
 * Tries biz.logoUrl first (legacy camelCase), then biz.logo_url (new profile field).
 * Returns null when neither is present.
 */
function bizLogoUrl(biz) {
  return biz?.logoUrl || biz?.logo_url || null;
}

/**
 * Fetches a remote image URL and returns it as a base64 data URL that jsPDF
 * can embed without a browser fetch at addImage() time.
 *
 * jsPDF's addImage() cannot reliably fetch remote https:// URLs in all browsers
 * (it works in some but silently fails in others). Pre-converting to base64 here
 * guarantees the image is available synchronously when addImage() runs.
 *
 * Already-base64 strings (data:image/...) are passed through unchanged.
 * Any fetch / decode failure returns null so callers can skip the logo gracefully.
 *
 * @param {string|null} url
 * @returns {Promise<string|null>} base64 data URL or null
 */
export async function logoUrlToBase64(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return url; // already a data URL — nothing to do
  try {
    // An http:// logo URL fetched from this https-served app is mixed content
    // and can be blocked outright by the browser — upgrade before fetching.
    const res = await fetch(secureImageUrl(url));
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result || null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Draws the shared business header block (logo + name + address + contact + UTR/VAT IDs).
 * Returns the y position just below the header rule.
 *
 * Layout:
 *   logo (left)          business name (right, bold, large)
 *                        address lines (right, muted)
 *                        phone • email (right, muted)
 *                        UTR / VAT reg (right, muted — when set)
 *   ── rule ──────────────────────────────────────────────────────
 */
async function drawHeader(doc, biz) {
  const w = doc.internal.pageSize.getWidth();
  let y = 16;

  const logo = bizLogoUrl(biz);
  if (logo) {
    try {
      // Downscale the user logo to longest-edge ≤600 px and re-encode as JPEG
      // before embedding. At 28×28 mm display size a 600 px source is already
      // ~54 dpi — plenty for screen and home-print quality. Transparent PNGs
      // are flattened onto white (the header background), so JPEG is always safe.
      const { dataUrl: scaledLogo, format: scaledFmt } = await downscaleDataUrl(logo, 600, 0.85);
      doc.addImage(scaledLogo, scaledFmt, MARGIN, y, HEADER_LOGO_W, HEADER_LOGO_H);
    } catch { /* logo decode failed — skip silently */ }
  }

  // Business name — right-aligned, prominent
  doc.setFontSize(18);
  doc.setFont('HankenGrotesk', 'bold');
  doc.setTextColor(...DARK);
  doc.text(biz?.name || 'Your Business', w - MARGIN, y + 7, { align: 'right' });

  let rightY = y + 14;

  // Address lines (may contain newlines — split them)
  const address = biz?.address || '';
  if (address) {
    doc.setFontSize(9);
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(...MID);
    const lines = address.split(/\n|,\s*/).slice(0, 3); // max 3 address fragments
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) {
        doc.text(trimmed, w - MARGIN, rightY, { align: 'right' });
        rightY += 4.5;
      }
    }
  }

  // Phone • email • website
  const contact = [biz?.phone, biz?.email, biz?.website].filter(Boolean).join('  •  ');
  if (contact) {
    doc.setFontSize(9);
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(...MID);
    doc.text(contact, w - MARGIN, rightY, { align: 'right' });
    rightY += 4.5;
  }

  // UTR — shown when set (relevant for self-assessment / CIS)
  const utr = biz?.utr || biz?.utr_number || '';
  if (utr) {
    doc.setFontSize(8.5);
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(...LIGHT);
    doc.text(`UTR: ${utr}`, w - MARGIN, rightY, { align: 'right' });
    rightY += 4.5;
  }

  // VAT reg number in header when registered
  const vatNumber = biz?.vatNumber || biz?.vat_number || '';
  const vatRegistered = biz?.vatRegistered || biz?.vat_registered || false;
  if (vatRegistered && vatNumber) {
    doc.setFontSize(8.5);
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(...LIGHT);
    doc.text(`VAT Reg: ${vatNumber}`, w - MARGIN, rightY, { align: 'right' });
    rightY += 4.5;
  }

  // Horizontal rule beneath header — sits below whichever side is taller
  const logoBottom = y + HEADER_LOGO_H + 4;
  const ruleY = Math.max(logoBottom, rightY + 2);
  rule(doc, ruleY);

  return ruleY + 8; // caller starts drawing from here
}

/**
 * Draws the document-type block (e.g. "INVOICE") and its meta fields.
 * `fields` is an array of [label, value] pairs rendered as key: value lines.
 * Returns the y position after the block.
 */
function drawDocTitle(doc, title, fields, startY) {
  // Large document title
  doc.setFontSize(26);
  doc.setFont('HankenGrotesk', 'bold');
  doc.setTextColor(...BRAND_GREEN);
  doc.text(title, MARGIN, startY);

  // Meta fields directly below title
  let y = startY + 9;
  doc.setFontSize(9);
  doc.setFont('HankenGrotesk', 'normal');
  doc.setTextColor(...MID);
  for (const [label, value] of fields) {
    if (value) {
      doc.setFont('HankenGrotesk', 'bold');
      doc.setTextColor(...DARK);
      doc.text(`${label}: `, MARGIN, y);
      const labelW = doc.getTextWidth(`${label}: `);
      doc.setFont('HankenGrotesk', 'normal');
      doc.setTextColor(...MID);
      doc.text(value, MARGIN + labelW, y);
      y += 5.5;
    }
  }

  return y + 4;
}

/**
 * Draws the "recipient" section (BILL TO / PREPARED FOR / RECEIVED FROM).
 * Returns the y position after the block.
 *
 * Renders: label, customer name, phone (when present), address (when present).
 */
function drawRecipientBlock(doc, label, job, startY) {
  const w = doc.internal.pageSize.getWidth();

  // Faint background band — height depends on content
  const hasPhone   = !!(job?.customerPhone || job?.phone);
  const hasAddress = !!job?.address;
  const lineCount  = 1 + (hasPhone ? 1 : 0) + (hasAddress ? 1 : 0);
  const bandH      = 10 + lineCount * 5.5;

  doc.setFillColor(248, 248, 248);
  doc.roundedRect(MARGIN, startY - 3, w - MARGIN * 2, bandH, 2, 2, 'F');

  // Label
  doc.setFontSize(7.5);
  doc.setFont('HankenGrotesk', 'bold');
  doc.setTextColor(...LIGHT);
  doc.text(label.toUpperCase(), MARGIN + 4, startY + 3);

  // Customer name
  doc.setFontSize(12);
  doc.setFont('HankenGrotesk', 'bold');
  doc.setTextColor(...DARK);
  doc.text(job?.customer || job?.customerName || 'Customer', MARGIN + 4, startY + 10);

  let lineY = startY + 16;

  if (hasPhone) {
    doc.setFontSize(9);
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(...MID);
    doc.text(job.customerPhone || job.phone, MARGIN + 4, lineY);
    lineY += 5.5;
  }

  if (hasAddress) {
    doc.setFontSize(9);
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(...MID);
    doc.text(job.address, MARGIN + 4, lineY);
    lineY += 5.5;
  }

  return lineY + 4;
}

/**
 * Draws the line-items autotable with Description / Rate / Qty / Amount columns.
 * When a line item has qty > 1 or an explicit rate, the Rate and Qty columns are
 * populated. When both are absent (single-amount items), those cells are empty so
 * the document stays clean.
 *
 * Returns the y position after the table.
 */
function drawLineItems(doc, job, startY) {
  const rawItems = Array.isArray(job?.lineItems) ? job.lineItems : [];

  // Build table rows — normalise qty/rate from the item shape.
  // job.lineItems[n] shape: { desc, cost, qty?, quantity?, rate? }
  const items = rawItems.length > 0
    ? rawItems.map(li => {
        const qty  = Number(li.qty ?? li.quantity ?? 1);
        const cost = Number(li.cost || 0);
        // If an explicit rate per-unit exists, use it; otherwise derive from cost/qty.
        const rate = li.rate != null ? Number(li.rate) : (qty !== 1 ? cost / qty : null);
        const showRate = qty > 1 || li.rate != null;

        return [
          li.desc || '',
          showRate
            ? { content: rate != null ? `£${rate.toFixed(2)}` : '', styles: { halign: 'right' } }
            : { content: '', styles: { halign: 'right' } },
          showRate
            ? { content: qty !== 1 ? String(qty) : '', styles: { halign: 'center' } }
            : { content: '', styles: { halign: 'center' } },
          { content: `£${cost.toFixed(2)}`, styles: { halign: 'right' } },
        ];
      })
    : [[
        job?.summary || 'Work completed',
        { content: '', styles: { halign: 'right' } },
        { content: '', styles: { halign: 'center' } },
        { content: `£${(job?.total ?? job?.amount ?? 0).toFixed(2)}`, styles: { halign: 'right' } },
      ]];

  autoTable(doc, {
    startY,
    head: [['Description',
      { content: 'Rate',   styles: { halign: 'right' } },
      { content: 'Qty',    styles: { halign: 'center' } },
      { content: 'Amount', styles: { halign: 'right' } },
    ]],
    body: items,
    theme: 'plain',
    headStyles: {
      fillColor: BRAND_GREEN,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      font: 'HankenGrotesk',
      fontSize: 9,
      cellPadding: { top: 4, bottom: 4, left: 4, right: 4 },
    },
    bodyStyles: {
      fontSize: 10,
      textColor: DARK,
      font: 'HankenGrotesk',
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
    },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 26 },
      2: { cellWidth: 14 },
      3: { cellWidth: 28 },
    },
    tableLineColor: RULE,
    tableLineWidth: 0.2,
  });

  return doc.lastAutoTable.finalY;
}

/**
 * Draws the SUMMARY block: Labour, Materials (additional costs), VAT (20%) when
 * VAT-registered, CIS Deduction as a negative line when the job is CIS, and
 * Total Payable (bold). Right-aligned panel.
 *
 * VAT is calculated on the quote subtotal (ex-materials, ex-CIS) — the gross
 * invoice amount. CIS deduction = max(0, quote − materials) × rate/100.
 *
 * Returns the y position after the block.
 *
 * @param {object} doc
 * @param {object} opts
 * @param {number}  opts.quote           — job quote / total
 * @param {number}  opts.materials       — linked receipt costs (additional costs)
 * @param {boolean} opts.showVat         — true when the biz is VAT-registered
 * @param {string}  opts.vatNumber       — VAT registration number (for display)
 * @param {boolean} opts.isCisJob        — whether CIS deduction applies to this job
 * @param {number}  opts.cisRate         — CIS rate (20 or 30)
 * @param {boolean} opts.hasDeposit      — whether a deposit deduction follows
 * @param {boolean} opts.itemiseDocuments — when false (default) the Labour and
 *   Additional costs lines are suppressed; only the Total is shown. CIS
 *   deduction is still computed internally but only printed when itemiseDocuments
 *   is true or the job is CIS (deduction is a legal line, not a cost reveal).
 *   Pass false / undefined for customer-facing PDFs; true for itemised invoices.
 * @param {number}  startY
 */
function drawSummaryBlock(doc, {
  quote,
  materials,
  showVat,
  vatNumber,
  isCisJob,
  cisRate,
  hasDeposit,
  itemiseDocuments = false,
}, startY) {
  const w = doc.internal.pageSize.getWidth();
  const panelX = w - MARGIN - 88;
  const panelW = 88;
  const valX   = w - MARGIN - 4;
  const labelX = panelX + 6;

  // Derived values — computed regardless of itemiseDocuments so CIS is always correct
  // Prices entered in the app are VAT-INCLUSIVE (gross). VAT is derived from
  // the entered quote, never added on top. Decision locked: ACC, 2026-06-21.
  const labour     = Math.max(0, quote - materials);
  const { vat }    = showVat ? splitVatInclusive(quote) : { vat: 0 };
  const grossTotal = quote; // quote IS the gross (VAT-inclusive); customer pays exactly this

  // CIS deduction applied to labour (not materials, not VAT)
  // CRITICAL: materials always feeds this calculation even when itemiseDocuments=false
  const cisDeduction = (isCisJob && cisRate > 0)
    ? Math.round(labour * (cisRate / 100) * 100) / 100
    : 0;

  const totalPayable = grossTotal - cisDeduction;

  // Decide which rows are visible on the customer-facing document
  const showLabourRow = itemiseDocuments;            // suppressed when toggle is OFF
  const showMatsRow   = itemiseDocuments && materials > 0; // suppressed when toggle is OFF
  const showVatRow    = showVat;                     // always shown when VAT-registered
  const showCisRow    = isCisJob && cisDeduction > 0; // always shown (legal deduction)

  const rowCount = (showLabourRow ? 1 : 0)
                 + (showMatsRow   ? 1 : 0)
                 + (showVatRow    ? 1 : 0)
                 + (showCisRow    ? 1 : 0)
                 + 1; // Total row always
  const panelH = 12 + (rowCount - 1) * 8 + 14; // padding + breakdown rows + total row

  doc.setFillColor(248, 248, 248);
  doc.roundedRect(panelX, startY + 4, panelW, panelH, 2, 2, 'F');

  let y = startY + 13;
  const rowStep = 8;

  // Helper — draws one summary row
  const summaryRow = (lbl, val, opts = {}) => {
    doc.setFontSize(9.5);
    doc.setFont('HankenGrotesk', opts.bold ? 'bold' : 'normal');
    doc.setTextColor(...(opts.color ?? MID));
    doc.text(lbl, labelX, y);
    doc.text(val, valX, y, { align: 'right' });
    y += rowStep;
  };

  // Labour row — only when itemise toggle is ON
  if (showLabourRow) {
    summaryRow('Labour', `£${labour.toFixed(2)}`);
  }

  // Materials (additional costs) row — only when itemise toggle is ON and non-zero
  if (showMatsRow) {
    summaryRow('Additional costs', `£${materials.toFixed(2)}`);
  }

  // VAT row — only when VAT-registered
  if (showVatRow) {
    summaryRow('VAT (20%)', `£${vat.toFixed(2)}`);
  }

  // CIS Deduction row — NEGATIVE, shown in red-ish/mid tone with − prefix.
  // Always shown when it applies — it is a legal deduction the customer needs to see.
  if (showCisRow) {
    doc.setFontSize(9.5);
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(180, 60, 60); // muted red to signal deduction
    doc.text(`CIS Deduction (${cisRate}%)`, labelX, y);
    doc.text(`−£${cisDeduction.toFixed(2)}`, valX, y, { align: 'right' });
    y += rowStep;
  }

  // Dividing rule before total
  y += 1;
  doc.setDrawColor(...BRAND_GREEN);
  doc.setLineWidth(0.5);
  doc.line(panelX + 4, y, w - MARGIN - 4, y);
  y += 7;

  // Total Payable (bold, dark)
  const totalLabel = hasDeposit ? 'Subtotal' : 'Total Payable';
  doc.setFontSize(12);
  doc.setFont('HankenGrotesk', 'bold');
  doc.setTextColor(...DARK);
  doc.text(totalLabel, labelX, y);
  doc.text(`£${totalPayable.toFixed(2)}`, valX, y, { align: 'right' });
  y += 8;

  // VAT number footnote beneath panel (when VAT-registered)
  if (showVat && vatNumber) {
    doc.setFontSize(8.5);
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(...LIGHT);
    doc.text(`VAT Reg: ${vatNumber}`, MARGIN, y);
  }

  return y + 4;
}

/**
 * Draws a deposit-paid deduction row in the totals area.
 * Returns the new y position after the row.
 *
 * @param {object} doc       — jsPDF instance
 * @param {number} depositPence — deposit amount in pence
 * @param {number} startY
 */
function drawDepositRow(doc, depositPence, startY) {
  const w = doc.internal.pageSize.getWidth();
  const panelX = w - MARGIN - 88;
  const valX = w - MARGIN - 4;
  const labelX = panelX + 6;
  const depositGbp = (depositPence / 100).toFixed(2);

  let y = startY + 2;

  doc.setFontSize(9.5);
  doc.setFont('HankenGrotesk', 'normal');
  doc.setTextColor(...BRAND_GREEN);
  doc.text('Deposit paid', labelX, y);
  doc.text(`−£${depositGbp}`, valX, y, { align: 'right' });

  return y + 8;
}

/**
 * Draws the terms & conditions block just above the footer rule, when set.
 * Returns the y position to use for the footer rule (moves it up to make room).
 *
 * The terms block is a small italic grey text area, capped at ~6 lines so it
 * never crowds the totals section. Long text is truncated with an ellipsis.
 */
function drawTermsBlock(doc, termsText, footerRuleY) {
  if (!termsText) return footerRuleY;
  const w = doc.internal.pageSize.getWidth();
  const maxWidth = w - MARGIN * 2;

  doc.setFontSize(7);
  doc.setFont('HankenGrotesk', 'normal');
  doc.setTextColor(...LIGHT);

  // Split into wrapped lines. jsPDF splitTextToSize handles long paragraphs.
  const lines = doc.splitTextToSize(termsText, maxWidth).slice(0, 6);

  const lineH = 4;
  const blockH = lines.length * lineH + 8; // 4px top padding + lines + 4px bottom

  const blockY = footerRuleY - blockH;

  doc.setFontSize(6.5);
  doc.setFont('HankenGrotesk', 'bold');
  doc.setTextColor(...LIGHT);
  doc.text('Terms & conditions', MARGIN, blockY);

  doc.setFont('HankenGrotesk', 'normal');
  let ty = blockY + lineH;
  for (const line of lines) {
    doc.text(line, MARGIN, ty);
    ty += lineH;
  }

  // Return new footerRuleY — the rule sits below the terms block
  return blockY - 2;
}

/**
 * Draws the standard footer line (and terms block above it when set).
 *
 * @param {object} doc        - jsPDF instance
 * @param {object} biz        - business identity object
 * @param {string} [label]    - override text for the main footer line
 * @param {string} [termsText]- terms & conditions text to draw above the rule
 * @param {boolean} [hidePoweredBy] - true for Pro traders (white-label perk); suppresses the "Sent with OHNAR" footer line
 */
async function drawFooter(doc, biz, label = '', termsText = '', hidePoweredBy = false) {
  const w = doc.internal.pageSize.getWidth();
  let footerRuleY = PAGE_H - 14;

  footerRuleY = drawTermsBlock(doc, termsText, footerRuleY);

  rule(doc, footerRuleY);
  doc.setFontSize(7.5);
  doc.setFont('HankenGrotesk', 'normal');
  doc.setTextColor(...LIGHT);
  const text = label
    || `${biz?.name || 'OHNAR'}  •  Generated ${new Date().toLocaleDateString('en-GB')}`;
  doc.text(text, w / 2, footerRuleY + 6, { align: 'center' });

  if (!hidePoweredBy) {
    // OHNAR "O" mark — drawn as a vector ring so no base64 blob is needed.
    // Brand blue #2563EB ring, 5 mm diameter, centred on the footer strip.
    const LOGO_SIZE = 5;  // mm
    const logoX = w / 2 - 30;
    const logoY = footerRuleY + 8;
    const cx = logoX + LOGO_SIZE / 2;
    const cy = logoY + LOGO_SIZE / 2;
    const r = LOGO_SIZE / 2;
    doc.setDrawColor(37, 99, 235);   // #2563EB brand blue
    doc.setLineWidth(0.8);
    doc.circle(cx, cy, r, 'S');
    doc.setFontSize(6.5);
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(...LIGHT);
    doc.text('Sent with OHNAR — ohnar.co.uk', logoX + LOGO_SIZE + 1.5, footerRuleY + 11.5, { align: 'left' });
  }
}

// ── Pay-now button + QR helper (Section 2.1, wireframe 4.4) ─────────────────
// Only called when the trader is connected AND a payNowUrl was generated.
// Returns the new y position after drawing the row.
// qrDataUrl must be a pre-generated PNG data URL (from QRCode.toDataURL).

function drawPayNowRow(doc, { amount, payNowUrl, qrDataUrl }, startY) {
  const w = doc.internal.pageSize.getWidth();
  const PAYNOW_ACCENT = [37, 99, 235]; // brand blue (#2563eb)
  const QR_SIZE = 22; // mm
  const BTN_H = 12;
  const BTN_W = w - MARGIN * 2 - QR_SIZE - 6; // content width minus QR and gap
  const rowY = startY + 4;

  // Button background (rounded rectangle approximated with rect)
  doc.setFillColor(...PAYNOW_ACCENT);
  doc.roundedRect(MARGIN, rowY, BTN_W, BTN_H, 3, 3, 'F');

  // Button label
  doc.setFontSize(11);
  doc.setFont('HankenGrotesk', 'bold');
  doc.setTextColor(255, 255, 255);
  const btnLabel = `Pay £${amount.toFixed(2)} by card`;
  doc.text(btnLabel, MARGIN + BTN_W / 2, rowY + 7.5, { align: 'center' });

  // "Powered by Stripe · Secure" subtitle
  doc.setFontSize(7.5);
  doc.setFont('HankenGrotesk', 'normal');
  doc.setTextColor(...LIGHT);
  doc.text('Powered by Stripe  ·  Secure card payment', MARGIN + BTN_W / 2, rowY + BTN_H + 5, { align: 'center' });

  // QR code (right edge of the row)
  const qrX = MARGIN + BTN_W + 6;
  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, 'PNG', qrX, rowY - 2, QR_SIZE, QR_SIZE);
    } catch {
      // QR decode failed — skip silently. Button-only fallback is fine.
    }
  }

  // Make the button area a clickable link (PDF viewers honour this)
  doc.link(MARGIN, rowY, BTN_W, BTN_H, { url: payNowUrl });

  return rowY + QR_SIZE + 4;
}

// ── Sign-quote button + QR helper ──────────────────────────────────────────
// Mirrors drawPayNowRow's layout (button + QR side-by-side). Renders a green
// "Tap to view and sign" CTA panel with a clickable PDF link annotation + QR
// code linking to the public quote view at /q/<token>.
//
// Returns the new y position after drawing the row. Caller must pre-generate
// qrDataUrl via QRCode.toDataURL(quoteUrl).
function drawSignQuoteRow(doc, { quoteUrl, qrDataUrl }, startY) {
  const w = doc.internal.pageSize.getWidth();
  const SIGN_ACCENT = [37, 99, 235]; // brand blue (#2563eb)
  const QR_SIZE = 22; // mm
  const BTN_H = 12;
  const BTN_W = w - MARGIN * 2 - QR_SIZE - 6;
  const rowY = startY + 4;

  // Button background
  doc.setFillColor(...SIGN_ACCENT);
  doc.roundedRect(MARGIN, rowY, BTN_W, BTN_H, 3, 3, 'F');

  // Button label
  doc.setFontSize(11);
  doc.setFont('HankenGrotesk', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('Tap to view and accept this quote', MARGIN + BTN_W / 2, rowY + 7.5, { align: 'center' });

  // Subtitle (mirrors pay-now styling)
  doc.setFontSize(7.5);
  doc.setFont('HankenGrotesk', 'normal');
  doc.setTextColor(...LIGHT);
  doc.text('Accept or decline on your phone — no app, no login', MARGIN + BTN_W / 2, rowY + BTN_H + 5, { align: 'center' });

  // QR code (right side)
  const qrX = MARGIN + BTN_W + 6;
  if (qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, 'PNG', qrX, rowY - 2, QR_SIZE, QR_SIZE);
    } catch {
      // QR decode failed — fall through, button alone is fine
    }
  }

  // Make the button area clickable
  doc.link(MARGIN, rowY, BTN_W, BTN_H, { url: quoteUrl });

  return rowY + QR_SIZE + 4;
}

// ═══════════════════════════════════════════════════════════════════════════
// INVOICE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generates an invoice PDF.
 *
 * @param {object} args
 * @param {object} args.job
 * @param {object} args.biz
 * @param {object} [args.profile]    — Supabase profiles row; read for CIS status and
 *   logo_url / sort_code / account_number when not set on biz. If both biz and profile
 *   carry a field, biz wins (legacy data takes precedence).
 * @param {string} args.invoiceNumber
 * @param {string} [args.dueDate]    — explicit YYYY-MM-DD due date. When absent,
 *   auto-computed as today + profile.payment_terms_days (default 14 days).
 * @param {string} [args.payNowUrl] — when provided (trader connected + token generated),
 *   draws the Pay-now button + QR row directly under the Total Payable line.
 *   When absent or empty, falls back to the legacy stripePaymentLink in biz (plain text link).
 *   Set to empty string when not connected — the PDF renders as before with bank details only.
 *   When a deposit was paid, payNowUrl should be for the BALANCE (not gross).
 * @param {number} [args.depositPaidPence] — when set, shows a green "Deposit paid −£X" row
 *   and the Pay-now button (if present) covers the balance only. Defaults to 0 (no deposit).
 * @param {object[]} [args.receipts] — all receipts in the app; used to derive materials cost
 *   for the CIS deduction line. When absent, materials = 0 (CIS deduction based on full quote).
 * @returns {Promise<jsPDF>} — async because QR code generation is async.
 */
export async function generateInvoicePDF({
  job,
  biz,
  profile = null,
  invoiceNumber,
  dueDate,
  payNowUrl = '',
  depositPaidPence = 0,
  receipts = [],
  hidePoweredBy = false,
}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  await registerHankenFont(doc);
  const w = doc.internal.pageSize.getWidth();

  // Pre-generate QR code data URL while other work proceeds.
  let qrDataUrl = null;
  if (payNowUrl) {
    try {
      qrDataUrl = await QRCode.toDataURL(payNowUrl, {
        width: 128,
        margin: 1,
        color: { dark: '#141414', light: '#ffffff' },
      });
    } catch {
      // QR generation failed — continue without it. The button still renders.
    }
  }

  // ── Normalise biz/profile field names ────────────────────────────────────
  // The legacy biz object uses camelCase; the new profile uses snake_case.
  // We build a merged biz view where biz fields take precedence.
  const effectiveBiz = {
    name:          biz?.name          || profile?.business_name || '',
    address:       biz?.address       || profile?.address        || '',
    phone:         biz?.phone         || profile?.phone          || '',
    email:         biz?.email         || profile?.email          || '',
    website:       biz?.website       || profile?.website        || '',
    logoUrl:       biz?.logoUrl       || profile?.logo_url       || '',
    logo_url:      biz?.logo_url      || profile?.logo_url       || '',
    utr:           biz?.utr           || profile?.utr_number     || '',
    vatRegistered: biz?.vatRegistered ?? biz?.vat_registered     ?? profile?.vat_registered ?? false,
    vatNumber:     biz?.vatNumber     || biz?.vat_number         || profile?.vat_number      || '',
    accountName:   biz?.accountName   || profile?.account_name   || '',
    sortCode:      biz?.sortCode      || biz?.sort_code          || profile?.sort_code       || '',
    accountNumber: biz?.accountNumber || biz?.account_number     || profile?.account_number  || '',
    bankDetails:   biz?.bankDetails   || profile?.bank_details   || '',
    stripePaymentLink: biz?.stripePaymentLink || biz?.stripe_payment_link
                     || profile?.stripe_payment_link || '',
    termsText:     biz?.termsText     || biz?.terms_text         || profile?.terms_text      || '',
  };

  // ── Document settings from profile ───────────────────────────────────────
  // itemise_documents: when false (default) we suppress labour/materials lines.
  // payment_terms_days: used to auto-compute due date when none is provided.
  const itemiseDocuments = profile?.itemise_documents ?? false;
  const paymentTermsDays = profile?.payment_terms_days ?? 14;

  // Auto-compute due date when the caller did not supply one.
  const resolvedDueDate = (() => {
    if (dueDate) return dueDate; // caller-supplied takes precedence
    const d = new Date();
    d.setDate(d.getDate() + paymentTermsDays);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  })();

  // ── CIS status ────────────────────────────────────────────────────────────
  // Use resolveCisStatus from cashflow.js — the canonical source of truth.
  // Profile may come from the function arg or from biz.is_cis_subcontractor
  // (when callers in the legacy flow pass partial data via biz).
  const cisProfile = profile || {
    is_cis_subcontractor: biz?.is_cis_subcontractor ?? false,
    cis_default_rate:     biz?.cis_default_rate ?? 20,
  };
  const { isCisJob, rate: cisRate } = resolveCisStatus(job || {}, cisProfile);

  // ── Materials cost for CIS deduction ─────────────────────────────────────
  // Materials = sum of receipts linked to this job (matching by jobId/cloudId).
  const safeReceipts = Array.isArray(receipts) ? receipts : [];
  const materials = safeReceipts
    .filter(r => r && r.jobId != null && (
      String(r.jobId) === String(job?.id) ||
      (job?.cloudId != null && String(r.jobId) === String(job.cloudId))
    ))
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  // ── Logo pre-fetch ────────────────────────────────────────────────────
  // jsPDF.addImage() cannot reliably fetch remote https:// URLs in all browsers.
  // Convert to base64 first so addImage() always receives a data URL.
  const rawLogoUrl = effectiveBiz.logoUrl || effectiveBiz.logo_url || null;
  if (rawLogoUrl) {
    const b64 = await logoUrlToBase64(rawLogoUrl);
    effectiveBiz.logoUrl = b64 || '';
    effectiveBiz.logo_url = b64 || '';
  }

  // ── Header ──────────────────────────────────────────────────────────────
  let y = await drawHeader(doc, effectiveBiz);

  // ── Document title block ──────────────────────────────────────────────
  const metaFields = [
    ['Invoice no', invoiceNumber],
    ['Issued',     new Date().toLocaleDateString('en-GB')],
    ['Due',        new Date(resolvedDueDate + 'T00:00:00').toLocaleDateString('en-GB')],
  ];
  y = drawDocTitle(doc, 'INVOICE', metaFields, y);

  // ── Bill To ───────────────────────────────────────────────────────────
  y = drawRecipientBlock(doc, 'Bill To', job, y);

  // ── Job description line (context when line items present)
  if (job?.summary && (job?.lineItems || []).length > 0) {
    doc.setFontSize(10);
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(...MID);
    doc.text(job.summary, MARGIN, y);
    y += 7;
  }

  // ── Line items ────────────────────────────────────────────────────────
  y = drawLineItems(doc, job, y + 2) + 4;

  // ── Summary block (Labour / Materials / VAT / CIS / Total Payable) ────
  // Prices entered in the app are VAT-INCLUSIVE (gross). VAT is derived from
  // the entered quote, never added on top. Decision locked: ACC, 2026-06-21.
  const quote      = job?.total ?? job?.amount ?? 0;
  const showVat    = !!effectiveBiz.vatRegistered;
  const grossTotal = quote; // quote IS the gross (VAT-inclusive); customer pays exactly this
  const cisDeduction = (isCisJob && cisRate > 0)
    ? Math.round(Math.max(0, quote - materials) * (cisRate / 100) * 100) / 100
    : 0;
  // Total Payable = gross − CIS deduction (before any deposit offset)
  const totalPayable = grossTotal - cisDeduction;

  // Auto-derive depositPaidPence from job.payments when the caller did not
  // explicitly supply it (i.e. depositPaidPence === 0 from default). This
  // fixes the latent bug where RecordPaymentModal in deposit mode produces a
  // blank-note payment — the note-matching path in callers never fires, so the
  // PDF showed no deposit credit line. Resolution order:
  //   1. type === 'deposit' flag (set by RecordPaymentModal since the bug fix)
  //   2. /deposit/i note match (back-compat: Stripe "Deposit on acceptance",
  //      any previously-recorded deposit with a descriptive note)
  // Only runs when depositPaidPence was not explicitly supplied by the caller.
  const resolvedDepositPaidPence = (() => {
    if (depositPaidPence > 0) return depositPaidPence;
    if (!Array.isArray(job?.payments)) return 0;
    const depositTotal = job.payments
      .filter(p => p.type === 'deposit' || /deposit/i.test(p.note || ''))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);
    return Math.round(depositTotal * 100);
  })();

  const hasDeposit = resolvedDepositPaidPence > 0;

  y = drawSummaryBlock(doc, {
    quote,
    materials,
    showVat,
    vatNumber: effectiveBiz.vatNumber,
    isCisJob,
    cisRate,
    hasDeposit,
    itemiseDocuments,
  }, y);

  // ── Deposit deduction row ──────────────────────────────────────────────
  if (hasDeposit) {
    y = drawDepositRow(doc, resolvedDepositPaidPence, y);

    // Balance due row
    const balanceGbp = Math.max(0, totalPayable - resolvedDepositPaidPence / 100);
    const panelX2 = w - MARGIN - 88;
    const valX2   = w - MARGIN - 4;
    const labelX2 = panelX2 + 6;

    doc.setDrawColor(...BRAND_GREEN);
    doc.setLineWidth(0.5);
    doc.line(panelX2 + 4, y, w - MARGIN - 4, y);
    y += 7;

    doc.setFontSize(12);
    doc.setFont('HankenGrotesk', 'bold');
    doc.setTextColor(...DARK);
    doc.text('BALANCE DUE', labelX2, y);
    doc.text(`£${balanceGbp.toFixed(2)}`, valX2, y, { align: 'right' });
    y += 8;
  }

  // ── Pay-now button + QR (Section 2.1, wireframe 4.4) ──────────────────
  if (payNowUrl) {
    const displayAmount = hasDeposit
      ? Math.max(0, totalPayable - resolvedDepositPaidPence / 100)
      : totalPayable;
    y = drawPayNowRow(doc, { amount: displayAmount, payNowUrl, qrDataUrl }, y);
    y += 4;
  }

  // ── Payment details ───────────────────────────────────────────────────
  y += 4;
  rule(doc, y);
  y += 8;

  doc.setFontSize(8);
  doc.setFont('HankenGrotesk', 'bold');
  doc.setTextColor(...LIGHT);
  doc.text('PAYMENT DETAILS', MARGIN, y);
  y += 7;

  // Legacy pay-by-card block — shown when payNowUrl is absent but the trader
  // has a manually-entered static payment link in their Settings.
  const stripeLink = !payNowUrl ? (effectiveBiz.stripePaymentLink || '') : '';
  if (stripeLink) {
    doc.setFontSize(9.5);
    doc.setFont('HankenGrotesk', 'bold');
    doc.setTextColor(...DARK);
    doc.text('Pay by card:', MARGIN, y);
    y += 5;
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(0, 91, 204);
    doc.textWithLink(stripeLink, MARGIN, y, { url: stripeLink });
    doc.setTextColor(...MID);
    y += 7;
  }

  // Bank transfer block
  const bankHeader = (stripeLink || payNowUrl) ? 'Or pay by bank transfer:' : 'Bank details:';
  const hasBankFields = effectiveBiz.accountName || effectiveBiz.sortCode || effectiveBiz.accountNumber;

  if (hasBankFields || effectiveBiz.bankDetails) {
    doc.setFontSize(9.5);
    doc.setFont('HankenGrotesk', 'bold');
    doc.setTextColor(...DARK);
    doc.text(bankHeader, MARGIN, y);
    y += 5;
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(...MID);

    if (hasBankFields) {
      if (effectiveBiz.accountName)   { doc.text(`Name: ${effectiveBiz.accountName}`,         MARGIN, y); y += 5; }
      if (effectiveBiz.sortCode)      { doc.text(`Sort code: ${effectiveBiz.sortCode}`,        MARGIN, y); y += 5; }
      if (effectiveBiz.accountNumber) { doc.text(`Account: ${effectiveBiz.accountNumber}`,     MARGIN, y); y += 5; }
    } else {
      effectiveBiz.bankDetails.split('\n').forEach(line => { doc.text(line, MARGIN, y); y += 5; });
    }
  }

  y += 2;
  doc.setFontSize(9.5);
  doc.setFont('HankenGrotesk', 'bold');
  doc.setTextColor(...DARK);
  doc.text(`Reference: ${invoiceNumber}`, MARGIN, y);

  // ── Thank you line ────────────────────────────────────────────────────
  y += 10;
  doc.setFontSize(9);
  doc.setFont('HankenGrotesk', 'normal');
  doc.setTextColor(...MID);
  doc.text('Thank you for your business.', MARGIN, y);

  // ── Footer (with terms & conditions when set) ────────────────────────
  await drawFooter(doc, effectiveBiz, '', effectiveBiz.termsText, hidePoweredBy);

  return doc;
}

export async function downloadInvoicePDF(args) {
  const doc = await generateInvoicePDF(args);
  doc.save(`${args.invoiceNumber}.pdf`);
}

export async function getInvoicePDFBlob(args) {
  const doc = await generateInvoicePDF(args);
  return doc.output('blob');
}

// ══════════════════════════════════════════════════════════════════════════
// QUOTE PDF — Phase F
// ══════════════════════════════════════════════════════════════════════════
//
// Differences from the invoice template:
//   - Heading reads "QUOTE" not "INVOICE" (accent green, same size)
//   - No invoice number / due date block — just the date issued
//   - If job.acceptedSignature is present, embeds the PNG below the totals
//     with an "Accepted by customer" label and the acceptedAt date
//   - No bank details (quote is a price proposal, not a payment request)
//
// acceptedSignature: PNG dataURL string captured in the drawer. Embedded with
// doc.addImage; silently skipped if the dataURL fails to decode.

export async function generateQuotePDF({ job, biz, profile = null, quoteUrl = '', qrDataUrl = '', hidePoweredBy = false }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  await registerHankenFont(doc);

  const effectiveBiz = {
    name:          biz?.name          || profile?.business_name || '',
    address:       biz?.address       || profile?.address        || '',
    phone:         biz?.phone         || profile?.phone          || '',
    email:         biz?.email         || profile?.email          || '',
    website:       biz?.website       || profile?.website        || '',
    logoUrl:       biz?.logoUrl       || profile?.logo_url       || '',
    logo_url:      biz?.logo_url      || profile?.logo_url       || '',
    utr:           biz?.utr           || profile?.utr_number     || '',
    vatRegistered: biz?.vatRegistered ?? biz?.vat_registered     ?? profile?.vat_registered ?? false,
    vatNumber:     biz?.vatNumber     || biz?.vat_number         || profile?.vat_number      || '',
    accountName:   biz?.accountName   || profile?.account_name   || '',
    sortCode:      biz?.sortCode      || biz?.sort_code          || profile?.sort_code       || '',
    accountNumber: biz?.accountNumber || biz?.account_number     || profile?.account_number  || '',
    termsText:     biz?.termsText     || biz?.terms_text         || profile?.terms_text      || '',
  };

  // ── Document settings from profile ──────────────────────────────────────
  const itemiseDocuments = profile?.itemise_documents ?? false;
  const quoteValidityDays = profile?.quote_validity_days ?? 30;

  // Quote number — mirrors the JP- invoice scheme but with a Q- prefix.
  // job.quoteNumber is stored when the quote is saved; fall back to deriving
  // from job.id so every quote has a reference even in the legacy flow.
  const quoteNumber = job?.quoteNumber || (job?.id ? `Q-${String(job.id).slice(-4).toUpperCase()}` : '');

  // Valid-until date: quote issue date (job.date / today) + quoteValidityDays,
  // UNLESS this specific quote has a per-job override (job.quoteValidUntil, set
  // via DocumentPreview's "Valid until" editor — fix/quote-public-vat-validity).
  // The override is per-quote ONLY: it must never be derived from or written
  // back to profile.quote_validity_days (that would silently change every
  // future quote's default window — the exact bug this fix corrects).
  const issueDate = job?.date
    ? (job.date.length === 10 ? new Date(job.date + 'T00:00:00') : new Date(job.date))
    : new Date();
  const validUntil = job?.quoteValidUntil
    ? (job.quoteValidUntil.length === 10 ? new Date(job.quoteValidUntil + 'T00:00:00') : new Date(job.quoteValidUntil))
    : new Date(issueDate);
  if (!job?.quoteValidUntil) validUntil.setDate(validUntil.getDate() + quoteValidityDays);
  const validUntilStr = validUntil.toLocaleDateString('en-GB');

  // ── Logo pre-fetch ────────────────────────────────────────────────────
  const rawLogoUrlQ = effectiveBiz.logoUrl || effectiveBiz.logo_url || null;
  if (rawLogoUrlQ) {
    const b64 = await logoUrlToBase64(rawLogoUrlQ);
    effectiveBiz.logoUrl = b64 || '';
    effectiveBiz.logo_url = b64 || '';
  }

  // ── Header ──────────────────────────────────────────────────────────────
  let y = await drawHeader(doc, effectiveBiz);

  // ── Document title block ──────────────────────────────────────────────
  const metaFields = [
    ['Quote ref',    quoteNumber],
    ['Date',         issueDate.toLocaleDateString('en-GB')],
    ['Valid until',  validUntilStr],
  ];
  y = drawDocTitle(doc, 'QUOTE', metaFields, y);

  // ── Prepared for ──────────────────────────────────────────────────────
  y = drawRecipientBlock(doc, 'Prepared For', job, y);

  // ── Job description line
  if (job?.summary && (job?.lineItems || []).length > 0) {
    doc.setFontSize(10);
    doc.setFont('HankenGrotesk', 'normal');
    doc.setTextColor(...MID);
    doc.text(job.summary, MARGIN, y);
    y += 7;
  }

  // ── Line items ────────────────────────────────────────────────────────
  y = drawLineItems(doc, job, y + 2) + 4;

  // ── Totals (legacy drawTotals-style for quotes — no CIS, simpler) ────
  // Prices entered in the app are VAT-INCLUSIVE (gross). VAT is derived from
  // the entered subtotal, never added on top. Decision locked: ACC, 2026-06-21.
  // showVat: profile-level VAT registration OR this specific quote's
  // voice-captured "plus/inc VAT" flag (job.vat, set by AddJobModal from
  // voiceParse's `vat` field via buildQuotePayload).
  const subtotal = job?.total ?? job?.amount ?? 0;
  const showVat  = !!effectiveBiz.vatRegistered || job?.vat === true;
  const gross    = subtotal; // subtotal IS the gross (VAT-inclusive)

  // Re-use the summary block for quotes too (simpler: no CIS, no deposit)
  y = drawSummaryBlock(doc, {
    quote:            subtotal,
    materials:        0,        // receipts not relevant at quote stage
    showVat,
    vatNumber:        effectiveBiz.vatNumber,
    isCisJob:         false,    // CIS deduction is not shown on quotes
    cisRate:          0,
    hasDeposit:       false,
    itemiseDocuments,
  }, y);

  // ── Deposit row (PR 4) — shown when deposit_percent > 0 ──────────────
  const depositPercent = Number(job?.deposit_percent ?? 0);
  if (depositPercent > 0) {
    const depositAmount = Math.round(gross * (depositPercent / 100) * 100) / 100;
    const w = doc.internal.pageSize.getWidth();
    const panelX = MARGIN;
    const panelW = w - MARGIN * 2;
    doc.setFillColor(214, 245, 230); // #D6F5E6
    doc.roundedRect(panelX, y + 2, panelW, 16, 2, 2, 'F');

    // Deposit due-date — set by sendQuote.js from the voice-quote confirm
    // card's depositDue (job.deposit_due_date). Falls back to the original
    // "Locks in your slot" copy when no due date was captured.
    const depositDueDate = job?.deposit_due_date
      ? (job.deposit_due_date.length === 10
          ? new Date(job.deposit_due_date + 'T00:00:00')
          : new Date(job.deposit_due_date))
      : null;
    const depositTrailer = depositDueDate
      ? `due ${formatToday(depositDueDate)}`
      : 'Locks in your slot';

    doc.setFontSize(10);
    doc.setFont('HankenGrotesk', 'bold');
    doc.setTextColor(8, 107, 69); // #086B45
    doc.text(`Deposit (${depositPercent}%) · £${depositAmount.toFixed(2)} · ${depositTrailer}`, panelX + 6, y + 12);
    y += 22;
  }

  // ── Accept/decline CTA ─────────────────────────────────────────────────────
  // Shown when the quote has not yet been decided AND we have a public URL.
  // Skipped after acceptance/decline. Legacy: also skip when acceptedSignature is
  // present (pre G-2 rows).
  const isAlreadyDecided = job?.quoteStatus === 'accepted' || job?.quoteStatus === 'declined'
    || !!job?.acceptedSignature;
  if (quoteUrl && !isAlreadyDecided) {
    y += 4;
    y = drawSignQuoteRow(doc, { quoteUrl, qrDataUrl }, y);
  }

  // ── Accepted signature — embed when present ───────────────────────────
  if (job?.acceptedSignature) {
    try {
      y += 4;
      rule(doc, y);
      y += 8;

      doc.setFontSize(8);
      doc.setFont('HankenGrotesk', 'bold');
      doc.setTextColor(...LIGHT);
      doc.text('ACCEPTED BY CUSTOMER', MARGIN, y);
      y += 5;

      // Downscale signature: 80×40 mm at PDF resolution needs ~470 px longest edge.
      // Flatten on white — the signature block sits on a white page background.
      const { dataUrl: scaledSig, format: sigFmt } = await downscaleDataUrl(job.acceptedSignature, 470, 0.80);
      doc.addImage(scaledSig, sigFmt, MARGIN, y, 80, 40);
      y += 44;

      if (job.acceptedAt) {
        doc.setFontSize(8.5);
        doc.setFont('HankenGrotesk', 'normal');
        doc.setTextColor(...MID);
        doc.text(
          `Signed: ${new Date(job.acceptedAt).toLocaleString('en-GB')}`,
          MARGIN,
          y,
        );
      }
    } catch {
      // Signature decode failed — skip block, don't crash
    }
  }

  // ── Footer (with terms & conditions when set) ────────────────────────
  await drawFooter(doc, effectiveBiz, '', effectiveBiz.termsText, hidePoweredBy);

  return doc;
}

export async function downloadQuotePDF(args) {
  const doc = await generateQuotePDF(args);
  const customer = (args.job?.customer || 'quote').replace(/\s/g, '-');
  doc.save(`quote-${customer}.pdf`);
}

export async function getQuotePDFBlob(args) {
  const doc = await generateQuotePDF(args);
  return doc.output('blob');
}
